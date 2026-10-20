/**
 * GET: The playoff bracket format — team count, the valid bye plans for it (natural first), the
 *      saved plan and whether the season has room for each. `?teams=N` lists the plans for another
 *      count without saving.
 * PUT: Save `{ playoffTeams, byePlan }`. Any team count (odd included) with the natural byes is
 *      free; commissioner-granted byes are AF Commissioner (`advanced_playoff_setup`). Goes through
 *      `executeLeagueSettingsPatch`, which enforces that gate for every caller.
 *
 * See lib/playoff-brackets/byePlan.ts and docs/AF_COMMISSIONER_SETTINGS_SPEC.md §1.3.
 */
import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { isCommissioner } from '@/lib/commissioner/permissions'
import { executeLeagueSettingsPatch } from '@/lib/league/execute-league-settings-patch'
import { FeatureGateService } from '@/lib/subscription/FeatureGateService'
import {
  MAX_PLAYOFF_TEAMS,
  checkByePlan,
  describeByePlan,
  isNaturalByePlan,
  naturalByePlan,
  parseStoredByePlan,
  validByePlans,
} from '@/lib/playoff-brackets/byePlan'
import { normalizeWeeksPerRound } from '@/lib/playoff-runtime/playoffRoundWeeks'

export const dynamic = 'force-dynamic'

/** The last week a fantasy playoff round can use. Only NFL is pinned; other sports are not checked. */
const LAST_PLAYOFF_WEEK: Record<string, number> = { NFL: 18 }

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {}
}

async function load(leagueId: string) {
  return prisma.league.findUnique({
    where: { id: leagueId },
    select: { id: true, userId: true, sport: true, season: true, leagueSize: true, playoffTeams: true, playoffStartWeek: true, playoffWeeksPerRound: true, settings: true },
  })
}

async function bracketLocked(leagueId: string, season: number): Promise<boolean> {
  const row = await prisma.redraftSeason.findUnique({
    where: { leagueId_season: { leagueId, season } },
    select: { playoffBracket: { select: { status: true } } },
  })
  const status = row?.playoffBracket?.status
  return status != null && status !== 'pending'
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ leagueId: string }> }) {
  const session = (await getServerSession(authOptions as never)) as { user?: { id?: string } } | null
  const userId = session?.user?.id
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { leagueId } = await params
  if (!(await isCommissioner(leagueId, userId))) return NextResponse.json({ error: 'Commissioner only' }, { status: 403 })
  const league = await load(leagueId)
  if (!league) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const maxTeams = Math.min(MAX_PLAYOFF_TEAMS, league.leagueSize ?? MAX_PLAYOFF_TEAMS)
  const requested = Number(new URL(req.url).searchParams.get('teams'))
  const savedTeams = Math.min(maxTeams, Math.max(2, league.playoffTeams ?? 6))
  const teams = Number.isInteger(requested) && requested >= 2 && requested <= maxTeams ? requested : savedTeams

  const savedPlan = teams === savedTeams ? parseStoredByePlan(asRecord(league.settings).playoff_bye_plan, teams) : null
  const startWeek = league.playoffStartWeek ?? 15
  const weeksPerRound = normalizeWeeksPerRound(league.playoffWeeksPerRound)
  const lastWeek = LAST_PLAYOFF_WEEK[String(league.sport).toUpperCase()] ?? null

  const options = validByePlans(teams).map((plan) => {
    const check = checkByePlan(teams, plan)
    const roundCount = check.ok ? check.roundCount : 0
    const finalWeek = startWeek + roundCount * weeksPerRound - 1
    return {
      plan,
      natural: isNaturalByePlan(teams, plan),
      description: describeByePlan(plan),
      rounds: check.ok ? check.rounds : [],
      roundCount,
      finalWeek,
      fitsSeason: lastWeek == null || finalWeek <= lastWeek,
    }
  })

  const access = await new FeatureGateService().evaluateUserFeatureAccess(userId, 'advanced_playoff_setup').catch(() => null)
  return NextResponse.json({
    playoffTeams: teams,
    savedPlayoffTeams: savedTeams,
    maxTeams,
    plan: savedPlan ?? naturalByePlan(teams),
    options,
    playoffStartWeek: startWeek,
    weeksPerRound,
    lastWeek,
    isPremium: Boolean(access?.allowed),
    locked: await bracketLocked(league.id, league.season),
  })
}

export async function PUT(req: NextRequest, { params }: { params: Promise<{ leagueId: string }> }) {
  const session = (await getServerSession(authOptions as never)) as { user?: { id?: string } } | null
  const userId = session?.user?.id
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { leagueId } = await params
  if (!(await isCommissioner(leagueId, userId))) return NextResponse.json({ error: 'Commissioner only' }, { status: 403 })
  const league = await load(leagueId)
  if (!league) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  if (await bracketLocked(league.id, league.season)) {
    return NextResponse.json({ error: 'The playoff bracket for this season is already set.' }, { status: 409 })
  }

  const body = (await req.json().catch(() => ({}))) as { playoffTeams?: unknown; byePlan?: unknown }
  const teams = Number(body.playoffTeams)
  const maxTeams = Math.min(MAX_PLAYOFF_TEAMS, league.leagueSize ?? MAX_PLAYOFF_TEAMS)
  if (!Number.isInteger(teams) || teams < 2 || teams > maxTeams) {
    return NextResponse.json({ error: `Pick 2 to ${maxTeams} playoff teams.` }, { status: 400 })
  }
  const plan = Array.isArray(body.byePlan) ? body.byePlan.map((v) => Number(v)) : naturalByePlan(teams)
  const check = checkByePlan(teams, plan)
  if (!check.ok) return NextResponse.json({ error: check.error }, { status: 400 })

  const lastWeek = LAST_PLAYOFF_WEEK[String(league.sport).toUpperCase()]
  const finalWeek = (league.playoffStartWeek ?? 15) + check.roundCount * normalizeWeeksPerRound(league.playoffWeeksPerRound) - 1
  if (lastWeek != null && finalWeek > lastWeek) {
    return NextResponse.json(
      { error: `This bracket needs ${check.roundCount} rounds and would end in week ${finalWeek}, after week ${lastWeek}. Start the playoffs earlier or pick fewer rounds.` },
      { status: 400 },
    )
  }

  // Natural byes are stored as null, so the runtime keeps its fixed bracket for them.
  const res = await executeLeagueSettingsPatch(
    userId,
    { leagueId, playoffTeams: teams, settingsMerge: { playoff_bye_plan: isNaturalByePlan(teams, plan) ? null : plan } },
    { section: 'playoffs' },
  )
  const data = await res.json().catch(() => ({}))
  if (!res.ok) {
    const premium = res.status === 403 && /AF Commissioner/.test(String(data.error ?? ''))
    return NextResponse.json(
      { error: data.error ?? 'Save failed', ...(premium ? { errorCode: 'AF_COMMISSIONER_REQUIRED', upgradePath: '/upgrade?plan=commissioner' } : {}) },
      { status: res.status },
    )
  }
  return NextResponse.json({ ok: true, playoffTeams: teams, plan, roundCount: check.roundCount, finalWeek })
}
