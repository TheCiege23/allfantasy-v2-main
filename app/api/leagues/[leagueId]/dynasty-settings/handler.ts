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
import {
  DYNASTY_ROSTER_PRESETS,
  DYNASTY_SCORING_PRESETS,
  DYNASTY_SUPPORTED_TEAM_SIZES,
  VETO_RECOMMENDATION_COPY,
  isDynastyFootballSport,
} from '@/lib/dynasty-core/constants'
import { TAXI_ELIGIBILITY_YEARS_OPTIONS, TAXI_LOCK_BEHAVIOR_OPTIONS } from '@/lib/taxi/constants'
import {
  ROOKIE_DRAFT_CALENDAR_SETTINGS_KEY,
  normalizeAutoStartDays,
  normalizeCustomOpenDate,
  readRookieDraftCalendarSettings,
} from '@/lib/dynasty-core/rookieDraftCalendar'
import { dynastyRulesFromConfig, taxiRulesFromEffective } from '@/lib/league-rules-explainer/snapshot'
import { getEffectiveTaxiSettings } from '@/lib/taxi/TaxiSettingsService'
import { diffRuleSnapshots } from '@/lib/league-rules-explainer/changeKeys'
import { publishRuleChangesEvent } from '@/lib/league-rules-explainer/publishRuleChanges'
import { getDynastySportPresets } from '@/lib/dynasty-core/DynastySportPresets'
import { applyDynastySportPresetToLeague, isLeagueBeforeDraft } from '@/lib/dynasty-core/applyDynastySportPreset'
import {
  PROSPECT_STASH_UNAVAILABLE_CODE,
  PROSPECT_STASH_UNAVAILABLE_MESSAGE,
  isTaxiIncreaseRefused,
  sportSupportsProspectStash,
} from '@/lib/league-creation/prospectStashPolicy'

export const dynamic = 'force-dynamic'

/** The taxi fields the rules popup shows (lib/league-rules-explainer/load.ts). */
const TAXI_CARD_FIELDS = ['taxiSlots', 'taxiEligibilityYears', 'taxiDeadlineWeek'] as const

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
    select: { sport: true, isDynasty: true, leagueVariant: true, status: true, lifecycleState: true, settings: true },
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
  const footballFormats = isDynastyFootballSport(sport)

  const rookiePickOrderMethods = [
    ...ROOKIE_PICK_ORDER_METHODS,
    ...(lotteryEligibility.eligible
      ? [{ value: 'weighted_lottery', label: '🎱 Weighted Lottery (NBA-style, year 2+)' }]
      : []),
  ]

  return NextResponse.json({
    effective: effective ?? undefined,
    presets: {
      // Football-only formats (Superflex, PPR, TEP…). Empty for MLB/NBA/NHL rather than offering a
      // commissioner a QB/RB/WR/TE format their league cannot use.
      roster: footballFormats ? getDynastyRosterPresets() : [],
      scoring: footballFormats ? getDynastyScoringPresets() : [],
      playoff: getDynastyPlayoffPresets(sport),
      // NBA/NHL/MLB roster + points-scoring formats (lib/dynasty-core/DynastySportPresets). Empty otherwise.
      sportFormats: getDynastySportPresets(sport),
    },
    sportFormatPreset: {
      current: ((league.settings as Record<string, unknown> | null)?.dynasty_sport_preset_id as string | undefined) ?? null,
      editable: isDynasty && isLeagueBeforeDraft(league),
    },
    constants: {
      supportedTeamSizes: [...DYNASTY_SUPPORTED_TEAM_SIZES],
      rookiePickOrderMethods,
      vetoRecommendationCopy: VETO_RECOMMENDATION_COPY,
      taxiEligibilityYearsOptions: [...TAXI_ELIGIBILITY_YEARS_OPTIONS],
      taxiLockBehaviorOptions: [...TAXI_LOCK_BEHAVIOR_OPTIONS],
      // NHL / MLB: taxi may be kept or lowered, never grown (PUT refuses an increase).
      taxiSlotsMax: sportSupportsProspectStash(sport) ? 20 : (effective?.taxiSlots ?? 4),
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

  const leagueSport = (league.sport as string) ?? (league.settings as Record<string, unknown> | null)?.sport_type ?? 'NFL'
  if (!isDynastyFootballSport(String(leagueSport))) {
    const footballRoster = new Set<string>(DYNASTY_ROSTER_PRESETS.map((p) => p.formatType))
    const footballScoring = new Set<string>(DYNASTY_SCORING_PRESETS.map((p) => p.formatType))
    if (
      (body.roster_format_type != null && footballRoster.has(String(body.roster_format_type))) ||
      (body.scoring_format_type != null && footballScoring.has(String(body.scoring_format_type)))
    ) {
      return NextResponse.json(
        { error: `That roster/scoring preset is a football format and cannot be applied to a ${String(leagueSport).toUpperCase()} league.` },
        { status: 400 },
      )
    }
  }

  // A dynasty format preset (NBA/NHL/MLB) is applied on its own, before the draft only.
  if (body.sportPresetId != null) {
    const applied = await applyDynastySportPresetToLeague(leagueId, String(body.sportPresetId), userId)
    if (!applied.ok) return NextResponse.json({ error: applied.error }, { status: applied.status })
    return NextResponse.json({ ok: true, sportPresetId: applied.presetId, slots: applied.slots })
  }

  const priorDynasty = await prisma.dynastyLeagueConfig.findUnique({ where: { leagueId } })

  // NHL / MLB have no prospect pool: a commissioner may keep or lower an existing taxi squad, never
  // grow one. The baseline with no config row is 4, the value GET reports for such a league.
  if (body.taxiSlots != null && isTaxiIncreaseRefused(String(leagueSport), Number(body.taxiSlots), priorDynasty?.taxiSlots ?? 4)) {
    return NextResponse.json(
      { error: PROSPECT_STASH_UNAVAILABLE_MESSAGE, code: PROSPECT_STASH_UNAVAILABLE_CODE },
      { status: 400 },
    )
  }

  const settingsPatch: Record<string, unknown> = {}
  if (body.roster_format_type != null) settingsPatch.roster_format_type = String(body.roster_format_type)
  if (body.scoring_format_type != null) settingsPatch.scoring_format_type = String(body.scoring_format_type)
  if (body.playoff_team_count != null) settingsPatch.playoff_team_count = Number(body.playoff_team_count)
  if (body.regular_season_weeks != null) settingsPatch.regular_season_weeks = Number(body.regular_season_weeks)
  if (body.playoff_structure != null && typeof body.playoff_structure === 'object')
    settingsPatch.playoff_structure = body.playoff_structure

  // Rookie-draft calendar: auto-open on the sport's window, and an optional custom open date.
  if (body.rookieDraftAutoOpen !== undefined || body.rookieDraftCustomOpenDate !== undefined || body.rookieDraftAutoStartDays !== undefined) {
    // Only the keys sent are written, so an unset auto-open keeps following the platform default.
    const stored = ((league.settings as Record<string, unknown> | null)?.[ROOKIE_DRAFT_CALENDAR_SETTINGS_KEY] ?? {}) as Record<string, unknown>
    const calendar: Record<string, unknown> = { ...(typeof stored === 'object' && !Array.isArray(stored) ? stored : {}) }
    if (body.rookieDraftAutoOpen !== undefined) {
      if (typeof body.rookieDraftAutoOpen !== 'boolean') {
        return NextResponse.json({ error: 'rookieDraftAutoOpen must be true or false.' }, { status: 400 })
      }
      calendar.autoOpen = body.rookieDraftAutoOpen
    }
    if (body.rookieDraftCustomOpenDate !== undefined) {
      const raw = body.rookieDraftCustomOpenDate
      const date = raw === null || raw === '' ? null : normalizeCustomOpenDate(raw)
      if (raw !== null && raw !== '' && !date) {
        return NextResponse.json({ error: 'rookieDraftCustomOpenDate must be a date (YYYY-MM-DD) or empty.' }, { status: 400 })
      }
      calendar.customOpenDate = date
    }
    // Start an automatically opened draft by itself N days later (null: the commissioner presses Start).
    if (body.rookieDraftAutoStartDays !== undefined) {
      const raw = body.rookieDraftAutoStartDays
      const days = raw === null || raw === 0 ? null : normalizeAutoStartDays(raw)
      if (raw !== null && raw !== 0 && days == null) {
        return NextResponse.json({ error: 'rookieDraftAutoStartDays must be 3, 7, 14 or empty.' }, { status: 400 })
      }
      calendar.autoStartDays = days
    }
    settingsPatch[ROOKIE_DRAFT_CALENDAR_SETTINGS_KEY] = calendar
  }

  // When only playoff_team_count is updated, merge matching dynasty preset (first_round_byes, playoff_weeks) so bracket stays consistent
  const newCount = body.playoff_team_count != null ? Number(body.playoff_team_count) : null
  if (newCount != null && settingsPatch.playoff_structure == null) {
    const playoffList = getDynastyPlayoffPresets(String(leagueSport))
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

  // The taxi squad members read comes from the effective settings (Devy / C2C override the slot
  // count), so it is read before and after rather than diffed from the config row. Only when the save
  // sends a taxi field the popup shows; a failed read drops those lines from the card, never the save.
  const touchesTaxi = TAXI_CARD_FIELDS.some((k) => dynastyPayload[k] !== undefined)
  const taxiBefore = touchesTaxi ? await getEffectiveTaxiSettings(leagueId).catch(() => null) : null

  const config = await upsertDynastyConfig(leagueId, dynastyPayload)

  const taxiAfter = taxiBefore ? await getEffectiveTaxiSettings(leagueId).catch(() => null) : null
  const taxiChange = taxiBefore && taxiAfter ? [taxiRulesFromEffective(taxiBefore), taxiRulesFromEffective(taxiAfter)] : [{}, {}]

  // The league home's "What changed" card (lib/league-rules-explainer): the dynasty rules members read.
  const settingsAfter = { ...((league.settings as Record<string, unknown>) ?? {}), ...settingsPatch }
  await publishRuleChangesEvent({
    leagueId,
    actorUserId: userId,
    section: 'dynasty',
    changes: diffRuleSnapshots(
      { ...dynastyRulesFromConfig(priorDynasty), rookieDraftAutoStartDays: readRookieDraftCalendarSettings(league.settings).autoStartDays, ...taxiChange[0] },
      { ...dynastyRulesFromConfig(config), rookieDraftAutoStartDays: readRookieDraftCalendarSettings(settingsAfter).autoStartDays, ...taxiChange[1] },
    ),
  })

  return NextResponse.json({ ok: true, config })
}
