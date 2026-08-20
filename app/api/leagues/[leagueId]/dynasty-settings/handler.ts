/**
 * GET: Effective dynasty settings + presets (roster, scoring, playoff).
 * PUT: Update dynasty config and optional League.settings (roster_format_type, scoring_format_type, playoff, regular_season_weeks).
 * Commissioner only for PUT.
 */
import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { canAccessLeagueDraft } from '@/lib/live-draft-engine/auth'
import { isCommissioner } from '@/lib/commissioner/permissions'
import {
  getEffectiveDynastySettings,
  getDynastyRosterPresets,
  getDynastyScoringPresets,
  getDynastyPlayoffPresets,
  upsertDynastyConfig,
  getDraftOrderAuditLog,
  ROOKIE_PICK_ORDER_METHODS,
} from '@/lib/dynasty-core/DynastySettingsService'
import { checkDynastyLotteryEligibility } from '@/lib/draft-lottery/dynastyYearGuard'
import {
  getDraftOrderModeAndLotteryConfig,
  setDraftOrderModeAndLotteryConfig,
} from '@/lib/draft-lottery/lotteryConfigStorage'
import { prisma } from '@/lib/prisma'
import { toPrismaJsonInput } from '@/lib/prisma-json'
import { DYNASTY_SUPPORTED_TEAM_SIZES, VETO_RECOMMENDATION_COPY } from '@/lib/dynasty-core/constants'
import { TAXI_ELIGIBILITY_YEARS_OPTIONS, TAXI_LOCK_BEHAVIOR_OPTIONS } from '@/lib/taxi/constants'

export const dynamic = 'force-dynamic'

export async function GET(
  _req: NextRequest,
  ctx: { params: Promise<{ leagueId: string }> }
) {
  const session = (await getServerSession(authOptions as any)) as { user?: { id?: string } } | null
  const userId = session?.user?.id
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { leagueId } = await ctx.params
  if (!leagueId) return NextResponse.json({ error: 'Missing leagueId' }, { status: 400 })

  const allowed = await canAccessLeagueDraft(leagueId, userId)
  if (!allowed) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const league = await prisma.league.findUnique({
    where: { id: leagueId },
    select: { sport: true, isDynasty: true, leagueVariant: true },
  })
  if (!league) return NextResponse.json({ error: 'League not found' }, { status: 404 })

  const isDynasty =
    league.isDynasty ||
    (league.leagueVariant && ['devy_dynasty', 'merged_devy_c2c'].includes(String(league.leagueVariant).toLowerCase()))

  const [effective, auditLog, lotteryEligibility, weightedLotterySettings] = await Promise.all([
    getEffectiveDynastySettings(leagueId),
    isDynasty ? getDraftOrderAuditLog(leagueId, 20) : Promise.resolve([]),
    checkDynastyLotteryEligibility(leagueId),
    isDynasty ? getDraftOrderModeAndLotteryConfig(leagueId).catch(() => null) : Promise.resolve(null),
  ])

  const sport = (league.sport as string) ?? 'NFL'

  const rookiePickOrderMethods = [
    ...ROOKIE_PICK_ORDER_METHODS,
    ...(lotteryEligibility.eligible
      ? [{ value: 'weighted_lottery', label: '🎱 Weighted Lottery (NBA-style, year 2+)' }]
      : []),
  ]

  return NextResponse.json({
    effective: effective ?? undefined,
    presets: {
      roster: getDynastyRosterPresets(),
      scoring: getDynastyScoringPresets(),
      playoff: getDynastyPlayoffPresets(sport),
    },
    constants: {
      supportedTeamSizes: [...DYNASTY_SUPPORTED_TEAM_SIZES],
      rookiePickOrderMethods,
      vetoRecommendationCopy: VETO_RECOMMENDATION_COPY,
      taxiEligibilityYearsOptions: [...TAXI_ELIGIBILITY_YEARS_OPTIONS],
      taxiLockBehaviorOptions: [...TAXI_LOCK_BEHAVIOR_OPTIONS],
    },
    draftOrderAuditLog: auditLog,
    isDynasty,
    lotteryEligibility: {
      eligible: lotteryEligibility.eligible,
      reason: lotteryEligibility.reason,
      isStartupLeague: lotteryEligibility.isStartupLeague,
    },
    weightedLotterySettings: weightedLotterySettings ?? undefined,
  })
}

export async function PUT(
  req: NextRequest,
  ctx: { params: Promise<{ leagueId: string }> }
) {
  const session = (await getServerSession(authOptions as any)) as { user?: { id?: string } } | null
  const userId = session?.user?.id
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { leagueId } = await ctx.params
  if (!leagueId) return NextResponse.json({ error: 'Missing leagueId' }, { status: 400 })

  const commissioner = await isCommissioner(leagueId, userId)
  if (!commissioner) return NextResponse.json({ error: 'Commissioner only' }, { status: 403 })

  const body = await req.json().catch(() => ({}))
  const league = await prisma.league.findUnique({
    where: { id: leagueId },
    select: { id: true, sport: true, settings: true, isDynasty: true, leagueVariant: true },
  })
  if (!league) return NextResponse.json({ error: 'League not found' }, { status: 404 })

  const isDynasty =
    league.isDynasty ||
    (league.leagueVariant && ['devy_dynasty', 'merged_devy_c2c'].includes(String(league.leagueVariant).toLowerCase()))
  if (!isDynasty) return NextResponse.json({ error: 'Not a dynasty league' }, { status: 400 })

  const priorDynasty = await prisma.dynastyLeagueConfig.findUnique({ where: { leagueId } })

  const settingsPatch: Record<string, unknown> = {}
  if (body.roster_format_type != null) settingsPatch.roster_format_type = String(body.roster_format_type)
  if (body.scoring_format_type != null) settingsPatch.scoring_format_type = String(body.scoring_format_type)
  if (body.playoff_team_count != null) settingsPatch.playoff_team_count = Number(body.playoff_team_count)
  if (body.regular_season_weeks != null) settingsPatch.regular_season_weeks = Number(body.regular_season_weeks)
  if (body.playoff_structure != null && typeof body.playoff_structure === 'object')
    settingsPatch.playoff_structure = body.playoff_structure

  // When only playoff_team_count is updated, merge matching dynasty preset (first_round_byes, playoff_weeks) so bracket stays consistent
  const newCount = body.playoff_team_count != null ? Number(body.playoff_team_count) : null
  if (newCount != null && settingsPatch.playoff_structure == null) {
    const sport = (league.sport as string) ?? (league.settings as Record<string, unknown> | null)?.sport_type ?? 'NFL'
    const playoffList = getDynastyPlayoffPresets(String(sport))
    const preset = playoffList.find((p) => p.playoffTeamCount === newCount)
    if (preset) {
      const current = (league.settings as Record<string, unknown>) ?? {}
      const existing = (current.playoff_structure as Record<string, unknown>) ?? {}
      settingsPatch.playoff_structure = {
        ...existing,
        first_round_byes: preset.firstRoundByes,
        playoff_weeks: preset.playoffWeeks,
        playoff_start_week: preset.playoffStartWeek ?? existing.playoff_start_week,
      }
    }
  }

  if (Object.keys(settingsPatch).length > 0) {
    const current = (league.settings as Record<string, unknown>) ?? {}
    await prisma.league.update({
      where: { id: leagueId },
      data: { settings: toPrismaJsonInput({ ...current, ...settingsPatch }) },
    })
  }

  const dynastyPayload: Parameters<typeof upsertDynastyConfig>[1] = {}
  if (body.regularSeasonWeeks != null) dynastyPayload.regularSeasonWeeks = Number(body.regularSeasonWeeks)
  if (body.rookiePickOrderMethod != null) dynastyPayload.rookiePickOrderMethod = String(body.rookiePickOrderMethod)
  if (body.useMaxPfForNonPlayoff != null) dynastyPayload.useMaxPfForNonPlayoff = Boolean(body.useMaxPfForNonPlayoff)
  if (body.rookieDraftRounds != null) dynastyPayload.rookieDraftRounds = Number(body.rookieDraftRounds)
  if (body.rookieDraftType != null) dynastyPayload.rookieDraftType = String(body.rookieDraftType)
  if (body.divisionsEnabled != null) dynastyPayload.divisionsEnabled = Boolean(body.divisionsEnabled)
  if (body.tradeDeadlineWeek !== undefined) dynastyPayload.tradeDeadlineWeek = body.tradeDeadlineWeek === null ? null : Number(body.tradeDeadlineWeek)
  if (body.waiverTypeRecommended != null) dynastyPayload.waiverTypeRecommended = String(body.waiverTypeRecommended)
  if (body.futurePicksYearsOut != null) dynastyPayload.futurePicksYearsOut = Number(body.futurePicksYearsOut)
  if (body.taxiSlots != null) dynastyPayload.taxiSlots = Number(body.taxiSlots)
  if (body.taxiEligibilityYears != null) dynastyPayload.taxiEligibilityYears = Number(body.taxiEligibilityYears)
  if (body.taxiLockBehavior != null) dynastyPayload.taxiLockBehavior = String(body.taxiLockBehavior)
  if (body.taxiInSeasonMoves != null) dynastyPayload.taxiInSeasonMoves = Boolean(body.taxiInSeasonMoves)
  if (body.taxiPostseasonMoves != null) dynastyPayload.taxiPostseasonMoves = Boolean(body.taxiPostseasonMoves)
  if (body.taxiScoringOn != null) dynastyPayload.taxiScoringOn = Boolean(body.taxiScoringOn)
  if (body.taxiDeadlineWeek !== undefined) dynastyPayload.taxiDeadlineWeek = body.taxiDeadlineWeek === null ? null : Number(body.taxiDeadlineWeek)
  if (body.taxiPromotionDeadlineWeek !== undefined) dynastyPayload.taxiPromotionDeadlineWeek = body.taxiPromotionDeadlineWeek === null ? null : Number(body.taxiPromotionDeadlineWeek)

  if (body.rookiePickOrderMethod != null) {
    const method = String(body.rookiePickOrderMethod)
    if (method === 'weighted_lottery') {
      const el = await checkDynastyLotteryEligibility(leagueId)
      if (!el.eligible) {
        return NextResponse.json({ error: el.reason }, { status: 400 })
      }
      await setDraftOrderModeAndLotteryConfig(leagueId, {
        draftOrderMode: 'weighted_lottery',
        lotteryConfig: { enabled: true },
      })
    } else if (priorDynasty?.rookiePickOrderMethod === 'weighted_lottery' && method !== 'weighted_lottery') {
      await setDraftOrderModeAndLotteryConfig(leagueId, { draftOrderMode: 'randomize' })
    }
  }

  const config = await upsertDynastyConfig(leagueId, dynastyPayload)

  return NextResponse.json({ ok: true, config })
}
