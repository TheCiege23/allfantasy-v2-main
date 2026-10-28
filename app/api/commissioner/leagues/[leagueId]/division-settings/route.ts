/**
 * GET/PUT: Commissioner division settings.
 * Stores division config in League.settings JSON (division_config key), read back by the standings,
 * the schedule and the playoff seeding (lib/league/divisions/leagueDivisions.ts).
 * Standard leagues: no divisions or 2–4, split evenly or within one team, plus the division playoff
 * rule. Survivor tribes keep 2/4/8 and are not validated as divisions.
 * Handles AI naming requests.
 */
import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { resolveLeagueMembership } from '@/lib/league-access'
import { toPrismaJsonInput } from '@/lib/prisma-json'
import { notifyCommissionerChange } from '@/lib/commissioner/CommissionerChangeNotifier'
import {
  DIVISION_CONFIG_KEY,
  DIVISION_NAME_MAX,
  DIVISION_PLAYOFF_RULES,
  STANDARD_DIVISION_COUNTS,
  SURVIVOR_TRIBE_COUNTS,
  readDivisionConfig,
  validateDivisionSetup,
  type DivisionPlayoffRule,
  type LeagueDivisionConfig,
} from '@/lib/league/divisions/leagueDivisions'

export const dynamic = 'force-dynamic'

type DivisionConfig = LeagueDivisionConfig

function defaultNames(count: number, isSurvivor: boolean): string[] {
  const label = isSurvivor ? 'Tribe' : 'Division'
  return Array.from({ length: count }, (_, i) => `${label} ${i + 1}`)
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ leagueId: string }> }
) {
  const session = (await getServerSession(authOptions as never)) as { user?: { id?: string } } | null
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { leagueId } = await params
  /*
   * 🛑 MEMBER GATE. This GET returned the league to ANY signed-in user. It
   * computed the commissioner flag and handed it back as a FIELD for the UI to
   * branch on, and never refused on it — so naming any leagueId returned that
   * league's settings and team list, owner names included.
   *
   * ⚠ MEMBER-LEVEL, NOT COMMISSIONER-LEVEL, AND THAT IS LOAD-BEARING.
   * `LeagueDuesTrackerPanel` and `RosterSettingsEditor` fetch this, read
   * `isCommissioner` off the response, and render READ-ONLY for ordinary
   * members. Gating at commissioner level would close the hole and break every
   * non-commissioner in the league. The write handlers keep their own stricter
   * check; this one only has to exclude non-members.
   *
   * ⚠ BEFORE THE READ, not after. `resolveLeagueMembership` is the four-path
   * canonical predicate (owner, RedraftLeagueMember, roster-backed, claimed
   * team) and returns 401/404/403 itself, so a missing league and a league that
   * is not yours stay indistinguishable to the caller.
   */
  const membership = await resolveLeagueMembership(leagueId, session.user.id)
  if (!membership.ok) {
    return NextResponse.json(
      { error: membership.status === 404 ? 'Not found' : 'Forbidden' },
      { status: membership.status },
    )
  }

  const league = await prisma.league.findUnique({
    where: { id: leagueId },
    select: {
      userId: true,
      sport: true,
      settings: true,
      leagueVariant: true,
      teams: {
        select: {
          id: true,
          teamName: true,
          ownerName: true,
          avatarUrl: true,
          wins: true,
          losses: true,
          platformUserId: true,
          isCommissioner: true,
          isCoCommissioner: true,
          isOrphan: true,
          role: true,
        },
      },
    },
  })
  if (!league) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const settings = (league.settings as Record<string, unknown>) ?? {}
  const config: DivisionConfig = readDivisionConfig(settings)
  const isSurvivor = (league.leagueVariant ?? '').toLowerCase().includes('survivor')
    || (settings.league_type as string ?? '').toLowerCase().includes('survivor')
    || (settings.leagueType as string ?? '').toLowerCase().includes('survivor')

  return NextResponse.json({
    config,
    isCommissioner: league.userId === session.user.id,
    isSurvivor,
    sport: league.sport,
    leagueVariant: league.leagueVariant,
    teams: league.teams,
  })
}

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ leagueId: string }> }
) {
  const session = (await getServerSession(authOptions as never)) as { user?: { id?: string } } | null
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { leagueId } = await params
  const league = await prisma.league.findUnique({
    where: { id: leagueId },
    select: { userId: true, settings: true, leagueVariant: true, teams: { select: { id: true, teamName: true, ownerName: true, avatarUrl: true, lifecycleState: true } } },
  })
  if (!league) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  if (league.userId !== session.user.id) return NextResponse.json({ error: 'Commissioner only' }, { status: 403 })

  const body = await req.json().catch(() => ({}))
  const currentSettings = (league.settings as Record<string, unknown>) ?? {}
  const existing = readDivisionConfig(currentSettings)

  const isSurvivor = (league.leagueVariant ?? '').toLowerCase().includes('survivor')
    || (currentSettings.league_type as string ?? '').toLowerCase().includes('survivor')
    || (currentSettings.leagueType as string ?? '').toLowerCase().includes('survivor')

  const allowedCounts = isSurvivor ? SURVIVOR_TRIBE_COUNTS : STANDARD_DIVISION_COUNTS
  if (body.count !== undefined && !(typeof body.count === 'number' && allowedCounts.includes(body.count))) {
    return NextResponse.json(
      { error: isSurvivor ? 'Pick no tribes, or 2, 4 or 8 tribes.' : 'Pick no divisions, or 2, 3 or 4 divisions.', code: 'COUNT_NOT_ALLOWED' },
      { status: 400 },
    )
  }
  if (body.playoffRule !== undefined && !(DIVISION_PLAYOFF_RULES as readonly unknown[]).includes(body.playoffRule)) {
    return NextResponse.json({ error: 'Unknown division playoff rule.', code: 'BAD_PLAYOFF_RULE' }, { status: 400 })
  }
  const count: number = typeof body.count === 'number' ? body.count : existing.count
  const names: string[] = Array.isArray(body.names)
    ? body.names.map((n: unknown) => String(n ?? '').trim().slice(0, DIVISION_NAME_MAX))
    : existing.names
  const rawAssignments = (typeof body.teamAssignments === 'object' && body.teamAssignments !== null && !Array.isArray(body.teamAssignments))
    ? body.teamAssignments as Record<string, unknown>
    : existing.teamAssignments
  // A team that has left the league keeps no division; it neither counts toward the split nor blocks a save.
  const archived = new Set(league.teams.filter((t) => t.lifecycleState === 'ARCHIVED').map((t) => t.id))
  const currentTeamIds = league.teams.filter((t) => !archived.has(t.id)).map((t) => t.id)
  const teamAssignments: Record<string, number> = {}
  for (const [teamId, idx] of Object.entries(rawAssignments)) {
    if (typeof idx === 'number' && !archived.has(teamId)) teamAssignments[teamId] = idx
  }
  const aiNamingEnabled = typeof body.aiNamingEnabled === 'boolean' ? body.aiNamingEnabled : existing.aiNamingEnabled
  const playoffRule: DivisionPlayoffRule = body.playoffRule !== undefined ? body.playoffRule : existing.playoffRule

  // If count changed, reset names to defaults if names array doesn't match
  const finalNames = names.length === count ? names : defaultNames(count, isSurvivor)

  if (!isSurvivor) {
    const check = validateDivisionSetup(
      { count, names: finalNames, teamAssignments: count === 0 ? {} : teamAssignments, playoffRule },
      currentTeamIds,
    )
    if (!check.ok) return NextResponse.json({ error: check.error, code: check.code }, { status: 400 })
  }

  const updatedConfig: DivisionConfig = {
    count,
    names: finalNames,
    teamAssignments: count === 0 ? {} : teamAssignments,
    aiNamingEnabled,
    playoffRule,
    lastUpdatedAt: new Date().toISOString(),
    lastUpdatedBy: session.user.id,
  }

  await prisma.league.update({
    where: { id: leagueId },
    data: {
      settings: toPrismaJsonInput({
        ...currentSettings,
        [DIVISION_CONFIG_KEY]: updatedConfig,
        // Also write num_divisions for backward compat
        num_divisions: count,
      }),
    },
  })

  // Notify league chat of division changes
  const changes: { field: string; oldValue: string; newValue: string }[] = []
  if (existing.count !== updatedConfig.count) {
    const label = isSurvivor ? 'Tribes' : 'Divisions'
    changes.push({ field: `Number of ${label}`, oldValue: String(existing.count || 'None'), newValue: String(updatedConfig.count || 'None') })
  }
  if (JSON.stringify(existing.names) !== JSON.stringify(updatedConfig.names) && updatedConfig.count > 0) {
    const label = isSurvivor ? 'Tribe' : 'Division'
    changes.push({ field: `${label} Names`, oldValue: existing.names.join(', ') || '(none)', newValue: updatedConfig.names.join(', ') })
  }
  if (existing.playoffRule !== updatedConfig.playoffRule && updatedConfig.count > 0 && !isSurvivor) {
    const label = (r: DivisionPlayoffRule) =>
      r === 'top_seeds' ? 'Division winners take the top seeds' : r === 'guaranteed' ? 'Division winners guaranteed a spot, seeded by record' : 'No playoff advantage'
    changes.push({ field: 'Division playoff rule', oldValue: label(existing.playoffRule), newValue: label(updatedConfig.playoffRule) })
  }
  if (changes.length > 0) {
    await notifyCommissionerChange(leagueId, session.user.id, isSurvivor ? 'Tribe Settings' : 'Division Settings', changes).catch(() => {})
  }

  return NextResponse.json({
    ok: true,
    config: updatedConfig,
    teams: league.teams,
    isSurvivor,
  })
}
