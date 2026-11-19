/**
 * GET/PUT: Commissioner division settings.
 * Stores division config in League.settings JSON (division_config key), read back by the standings,
 * the schedule and the playoff seeding (lib/league/divisions/leagueDivisions.ts).
 * Standard leagues: no divisions or 2–4, split evenly or within one team, plus the division playoff
 * rule. Survivor tribes keep 2/4/8 and are not validated as divisions.
 * Handles AI naming requests.
 */
import { commissionerAccessResponse, canCommissionerAct } from '@/lib/league/commissionerAccess'
import { poolSetupError,readPlayerPoolScope } from '@/lib/league/player-pools/policy'
import { lockPlayerPools } from '@/lib/league/player-pools/load'
import { validateCurrentPoolOwnership } from '@/lib/league/player-pools/changeLayout'
import { settingsLockedResponse } from '@/lib/league/settingsLockGuard'
import { logAction } from '@/server/services/auditService'
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
  MAX_STANDARD_DIVISIONS,
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
    playerPoolScope:readPlayerPoolScope(settings),
    divisionConferences:Array.isArray(settings.division_conferences) ? settings.division_conferences : [],
    isCommissioner: await canCommissionerAct(leagueId, session.user.id, 'league'),
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
  const refused = await commissionerAccessResponse(leagueId, session.user.id, 'league')
  if (refused) return refused
  // 🛑 Divisions decide the schedule and playoff seeding, and this save skipped the settings lock and the league log
  // (2026-11-15). They are locked with the playoffs.
  const locked = await settingsLockedResponse(leagueId, 'playoffs')
  if (locked) return locked

  const body = await req.json().catch(() => ({}))
  const currentSettings = (league.settings as Record<string, unknown>) ?? {}
  const existing = readDivisionConfig(currentSettings)

  const isSurvivor = (league.leagueVariant ?? '').toLowerCase().includes('survivor')
    || (currentSettings.league_type as string ?? '').toLowerCase().includes('survivor')
    || (currentSettings.leagueType as string ?? '').toLowerCase().includes('survivor')

  const allowedCounts = isSurvivor ? SURVIVOR_TRIBE_COUNTS : STANDARD_DIVISION_COUNTS
  if (body.count !== undefined && !(typeof body.count === 'number' && allowedCounts.includes(body.count))) {
    return NextResponse.json(
      { error: isSurvivor ? 'Pick no tribes, or 2, 4 or 8 tribes.' : `Pick no divisions, or 2 to ${MAX_STANDARD_DIVISIONS} divisions.`, code: 'COUNT_NOT_ALLOWED' },
      { status: 400 },
    )
  }
  if (body.playoffRule !== undefined && !(DIVISION_PLAYOFF_RULES as readonly unknown[]).includes(body.playoffRule)) {
    return NextResponse.json({ error: 'Unknown division playoff rule.', code: 'BAD_PLAYOFF_RULE' }, { status: 400 })
  }
  if (body.rivalsTwice !== undefined && typeof body.rivalsTwice !== 'boolean') {
    return NextResponse.json({ error: '"Play division rivals twice" must be on or off.', code: 'BAD_RIVALS_TWICE' }, { status: 400 })
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
  // Survivor tribes are not schedule divisions, so the rematch setting never applies to them.
  const rivalsTwice = isSurvivor ? false : typeof body.rivalsTwice === 'boolean' ? body.rivalsTwice : existing.rivalsTwice

  // If count changed, reset names to defaults if names array doesn't match
  const finalNames = names.length === count ? names : defaultNames(count, isSurvivor)

  if (!isSurvivor) {
    const check = validateDivisionSetup(
      { count, names: finalNames, teamAssignments: count === 0 ? {} : teamAssignments, playoffRule, rivalsTwice },
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
    rivalsTwice,
    lastUpdatedAt: new Date().toISOString(),
    lastUpdatedBy: session.user.id,
  }

  const poolScope = body.playerPoolScope ?? readPlayerPoolScope(currentSettings)
  const conferences = body.divisionConferences ?? currentSettings.division_conferences ?? []
  const poolError = poolSetupError(poolScope,count,conferences,currentTeamIds.length)
  if (poolError || (poolScope !== 'league' && currentTeamIds.some(id => teamAssignments[id] === undefined))) {
    return NextResponse.json({error:poolError ?? 'Assign every team to a division.'},{status:400})
  }
  const patch = {[DIVISION_CONFIG_KEY]:updatedConfig,num_divisions:count,player_pool_scope:poolScope,division_conferences:conferences}
  try {
    await prisma.$transaction(async tx => {
      await lockPlayerPools(tx, leagueId)
      const fresh = await tx.league.findUniqueOrThrow({ where: { id: leagueId }, select: { settings: true } })
      const settings = (fresh.settings as Record<string, unknown> | null) ?? {}
      if (readPlayerPoolScope(settings) !== readPlayerPoolScope(currentSettings)
        || JSON.stringify(readDivisionConfig(settings)) !== JSON.stringify(existing)
        || JSON.stringify(settings.division_conferences ?? []) !== JSON.stringify(currentSettings.division_conferences ?? [])) {
        throw new Error('Another commissioner changed the division settings. Reload and retry.')
      }
      const next = { ...settings, ...patch }
      if (poolScope !== 'league' || readPlayerPoolScope(settings) !== 'league') {
        await validateCurrentPoolOwnership(tx, leagueId, next)
      }
      await tx.league.update({ where: { id: leagueId }, data: { settings: toPrismaJsonInput(next) } })
    }, { timeout: 30_000 })
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Unable to change player pools.' }, { status: 409 })
  }

  // Notify league chat of division changes
  const changes: { field: string; oldValue: string; newValue: string }[] = []
  const previousScope = readPlayerPoolScope(currentSettings)
  if (previousScope !== poolScope) {
    changes.push({ field: 'Player ownership', oldValue: previousScope, newValue: poolScope })
  }
  if (poolScope === 'conference' && JSON.stringify(currentSettings.division_conferences ?? []) !== JSON.stringify(conferences)) {
    changes.push({ field: 'Conference assignments', oldValue: JSON.stringify(currentSettings.division_conferences ?? []), newValue: JSON.stringify(conferences) })
  }
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
  if (existing.rivalsTwice !== updatedConfig.rivalsTwice && updatedConfig.count > 0 && !isSurvivor) {
    const label = (on: boolean) => (on ? 'Division rivals played twice' : 'Division rivals played once')
    changes.push({ field: 'Division schedule', oldValue: label(existing.rivalsTwice), newValue: label(updatedConfig.rivalsTwice) })
  }
  if (changes.length > 0) {
    await notifyCommissionerChange(leagueId, session.user.id, isSurvivor ? 'Tribe Settings' : 'Division Settings', changes).catch(() => {})
    await logAction({
      leagueId,
      userId: session.user.id,
      actionType: 'settings_patch',
      entityType: 'league',
      entityId: leagueId,
      metadata: { section: 'divisions', source: 'division-settings', fields: changes.map((c) => c.field).slice(0, 20) },
    }).catch(() => {})
  }

  return NextResponse.json({
    ok: true,
    config: updatedConfig,
    teams: league.teams,
    isSurvivor,
  })
}
