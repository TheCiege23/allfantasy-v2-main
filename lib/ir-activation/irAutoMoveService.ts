import 'server-only'

import { prisma } from '@/lib/prisma'
import { resolveWriteAuthority } from '@/lib/league/write-authority'
import { isElevatedCommissioner } from '@/server/services/permissionService'
import { ownerHasAfCommissionerPlan } from '@/lib/stat-corrections/applyStatCorrections'
import { applyInjuryStatuses } from '@/lib/redraft/rosterInjuryStatus'
import { resolveFullLineupLockContext } from '@/lib/roster-lineup-engine/lineupLockService'
import { persistRosterLineupWithEngine } from '@/lib/roster-lineup-engine/lineupService'
import type { WorkspaceTaskCandidate } from '@/lib/commissioner-workspace/taskSources'
import { activatedIrPlayers, irNotice, irPlayerIds, IR_AUTO_MOVE_KEY, moveOffIr, readIrAutoMoveEnabled } from './irAutoMove'

/**
 * IR auto-move (./irAutoMove.ts) against the league's rows: the hourly run, the Commissioner Hub's
 * view, and the Commish OS task.
 *
 * DB-first: the lineup is `Roster.playerData` (what the lineup screen saves), names come from the
 * team's `RedraftRosterPlayer` rows, and designations from `SportsInjury`'s live rows — the same rows
 * the roster screen reads. Nothing here calls a provider. Leagues AllFantasy runs, during a season.
 */

type LeagueRow = NonNullable<Awaited<ReturnType<typeof loadLeague>>>

function loadLeague(leagueId: string) {
  return prisma.league.findUnique({
    where: { id: leagueId },
    select: {
      id: true, name: true, userId: true, platform: true, sport: true, season: true, settings: true,
      leagueVariant: true, lifecycleState: true, lockAllMoves: true,
      irAllowOut: true, irAllowCovid: true, irAllowSuspended: true, irAllowNA: true, irAllowDNR: true, irAllowDoubtful: true,
    },
  })
}

export type IrTeamScan = {
  rosterId: string
  ownerUserId: string
  teamName: string
  playerData: unknown
  /** Activated players still on IR. */
  activated: string[]
  names: Record<string, string>
}

type LeagueScan = { seasonId: string; season: number; week: number; teams: IrTeamScan[] }

/** Every team with an activated player still on its IR. Null: no season being played. */
async function scanLeague(league: LeagueRow, now: Date): Promise<LeagueScan | null> {
  const season = await prisma.redraftSeason.findFirst({
    where: { leagueId: league.id, status: 'active' },
    orderBy: { createdAt: 'desc' },
    select: { id: true, season: true, currentWeek: true },
  })
  if (!season) return null
  const week = Math.max(1, season.currentWeek ?? 1)
  const rosters = await prisma.roster.findMany({
    where: { leagueId: league.id, redraftRosterId: { not: null } },
    select: { id: true, platformUserId: true, redraftRosterId: true, playerData: true },
  })
  const withIr = rosters.map((r) => ({ ...r, irIds: irPlayerIds(r.playerData) })).filter((r) => r.irIds.length > 0)
  if (withIr.length === 0) return { seasonId: season.id, season: season.season, week, teams: [] }

  const redraftIds = withIr.map((r) => r.redraftRosterId!)
  const [teams, players] = await Promise.all([
    prisma.redraftRoster.findMany({ where: { id: { in: redraftIds } }, select: { id: true, teamName: true, ownerName: true } }),
    prisma.redraftRosterPlayer.findMany({
      where: { rosterId: { in: redraftIds }, droppedAt: null, playerId: { in: withIr.flatMap((r) => r.irIds) } },
      select: { rosterId: true, playerId: true, playerName: true, sport: true },
    }),
  ])
  const sports = [...new Set(players.map((p) => p.sport).filter(Boolean))]
  const [rows, live] = await Promise.all([
    prisma.sportsInjury.findMany({
      where: {
        sport: { in: sports },
        expiresAt: { gte: now },
        AND: [
          { OR: [{ playerId: { in: players.map((p) => p.playerId) } }, { playerName: { in: players.map((p) => p.playerName) } }] },
          { OR: [{ season: season.season }, { season: null }] },
          { OR: [{ week }, { week: null }] },
        ],
      },
      orderBy: [{ fetchedAt: 'desc' }],
      take: Math.max(50, players.length * 3),
    }),
    // A sport with no live injury rows at all is an outage, not a league-wide recovery.
    Promise.all(sports.map(async (sport) => [sport, (await prisma.sportsInjury.count({ where: { sport, expiresAt: { gte: now } } })) > 0] as const)),
  ])
  const feedLive = new Map(live)
  const statuses = applyInjuryStatuses(players.map((p) => ({ ...p, injuryStatus: null as string | null })), rows)
  const teamById = new Map(teams.map((t) => [t.id, t.teamName?.trim() || t.ownerName || 'A team']))

  const out: IrTeamScan[] = []
  for (const r of withIr) {
    const mine = statuses.filter((p) => p.rosterId === r.redraftRosterId)
    const statusById = new Map(mine.map((p) => [p.playerId, p.injuryStatus ?? null]))
    // A player with no roster row, or in a sport with no live feed, cannot be judged: left where they are.
    const judged = r.irIds.filter((id) => mine.some((p) => p.playerId === id && feedLive.get(p.sport)))
    const activated = activatedIrPlayers({ irIds: judged, statusById, rules: league, feedLive: true })
    if (activated.length === 0) continue
    out.push({
      rosterId: r.id,
      ownerUserId: r.platformUserId,
      teamName: teamById.get(r.redraftRosterId!) ?? 'A team',
      playerData: r.playerData,
      activated,
      names: Object.fromEntries(mine.map((p) => [p.playerId, p.playerName])),
    })
  }
  return { seasonId: season.id, season: season.season, week, teams: out }
}

const native = (league: LeagueRow) => resolveWriteAuthority(league.platform) === 'NATIVE'

export type IrAutoMoveView =
  | { supported: false }
  | {
      supported: true
      enabled: boolean
      /** The league owner has AF Commissioner, which the rule needs. */
      available: boolean
      week: number | null
      /** Teams with an activated player still on IR right now. */
      teams: { teamName: string; players: string[] }[]
    }

/** Commissioner or co-commissioner. */
export async function readIrAutoMoveView(leagueId: string, userId: string): Promise<{ ok: true; view: IrAutoMoveView } | { ok: false; status: 403 | 404 }> {
  if (!(await isElevatedCommissioner(leagueId, userId))) return { ok: false, status: 403 }
  const league = await loadLeague(leagueId)
  if (!league) return { ok: false, status: 404 }
  if (!native(league)) return { ok: true, view: { supported: false } }
  const [scan, available] = await Promise.all([scanLeague(league, new Date()), ownerHasAfCommissionerPlan(league.userId)])
  return {
    ok: true,
    view: {
      supported: true,
      enabled: readIrAutoMoveEnabled(league.settings),
      available,
      week: scan?.week ?? null,
      teams: (scan?.teams ?? []).map((t) => ({ teamName: t.teamName, players: t.activated.map((id) => t.names[id] ?? id) })),
    },
  }
}

export type IrAutoMoveRunResult = {
  leagues: number
  teams: number
  moved: number
  notified: number
  skipped: Record<string, number>
  failures: { leagueId: string; rosterId?: string; error: string }[]
}

const DEFAULT_LEAGUE_LIMIT = 25

async function preferredLanguage(userId: string): Promise<'en' | 'es'> {
  const p = await prisma.userProfile.findUnique({ where: { userId }, select: { preferredLanguage: true } }).catch(() => null)
  return p?.preferredLanguage?.toLowerCase().startsWith('es') ? 'es' : 'en'
}

/**
 * Hourly: in every league with the rule on and an owner on the plan, move each activated IR player to
 * the team's bench through the ordinary lineup save. A refused save tells the manager once that week.
 */
export async function runIrAutoMove(opts?: { limit?: number; deadline?: number; now?: Date }): Promise<IrAutoMoveRunResult> {
  const now = opts?.now ?? new Date()
  const deadline = opts?.deadline ?? Date.now() + 25_000
  const result: IrAutoMoveRunResult = { leagues: 0, teams: 0, moved: 0, notified: 0, skipped: {}, failures: [] }
  const skip = (reason: string) => (result.skipped[reason] = (result.skipped[reason] ?? 0) + 1)
  const ids = await prisma.$queryRaw<Array<{ id: string }>>`
    SELECT id FROM leagues
    WHERE settings -> ${IR_AUTO_MOVE_KEY} ->> 'enabled' = 'true'
    ORDER BY id LIMIT ${Math.max(1, Math.min(opts?.limit ?? DEFAULT_LEAGUE_LIMIT, 100))}`

  for (const { id: leagueId } of ids) {
    if (Date.now() >= deadline) break
    result.leagues += 1
    try {
      const league = await loadLeague(leagueId)
      if (!league || !readIrAutoMoveEnabled(league.settings)) continue
      if (!native(league)) {
        skip('not_native')
        continue
      }
      if (league.lockAllMoves) {
        skip('moves_locked')
        continue
      }
      if (!(await ownerHasAfCommissionerPlan(league.userId))) {
        skip('not_entitled')
        continue
      }
      const scan = await scanLeague(league, now)
      if (!scan) {
        skip('not_in_season')
        continue
      }
      for (const team of scan.teams) {
        if (Date.now() >= deadline) break
        result.teams += 1
        try {
          const outcome = await moveTeam(league, scan, team, now)
          if (outcome === 'moved') result.moved += 1
          else if (outcome === 'notified') result.notified += 1
          else skip(outcome)
        } catch (e) {
          result.failures.push({ leagueId, rosterId: team.rosterId, error: e instanceof Error ? e.message : String(e) })
        }
      }
    } catch (e) {
      result.failures.push({ leagueId, error: e instanceof Error ? e.message : String(e) })
    }
  }
  return result
}

async function moveTeam(league: LeagueRow, scan: LeagueScan, team: IrTeamScan, now: Date): Promise<'moved' | 'notified' | 'lineup_locked' | 'started' | 'already_told'> {
  const lock = await resolveFullLineupLockContext({
    leagueId: league.id,
    rosterId: team.rosterId,
    sport: String(league.sport ?? 'NFL'),
    leagueVariant: league.leagueVariant,
    settings: league.settings,
    leagueWeek: scan.week,
    editingWeek: scan.week,
    season: scan.season,
    now,
    playerData: team.playerData,
    lockAllMoves: league.lockAllMoves,
    lifecycleState: league.lifecycleState,
  })
  if (lock.locked) return 'lineup_locked'
  // A player whose game has started stays put; the next run moves them.
  const movable = team.activated.filter((id) => !lock.lockedPlayerIds.includes(id))
  if (movable.length === 0) return 'started'

  const names = movable.map((id) => team.names[id] ?? id)
  const pd = team.playerData && typeof team.playerData === 'object' ? (team.playerData as Record<string, unknown>) : {}
  const saved = await persistRosterLineupWithEngine({
    leagueId: league.id,
    rosterId: team.rosterId,
    actorUserId: team.ownerUserId,
    expectedOwnerUserId: team.ownerUserId,
    season: scan.season,
    week: scan.week,
    source: 'system',
    nextPlayerData: moveOffIr(team.playerData, movable),
    ...(Array.isArray(pd.starters) ? { expectedStarters: pd.starters.map(String) } : {}),
    automationAudit: {
      id: `ir-auto-move:${JSON.stringify([league.id, team.rosterId, scan.season, scan.week, movable, now.getTime()])}`,
      action: 'ir_auto_move.moved',
      message: `IR auto-move: ${names.join(', ')} ${names.length === 1 ? 'was' : 'were'} activated and moved from IR to ${team.teamName}'s bench.`,
      metadata: { season: scan.season, week: scan.week, playerIds: movable },
    },
  })

  const key = saved.ok
    ? `ir-auto-move:moved:${league.id}:${team.rosterId}:${scan.season}:${scan.week}:${[...movable].sort().join(',')}`
    : `ir-auto-move:stuck:${league.id}:${team.rosterId}:${scan.season}:${scan.week}`
  if (!saved.ok) {
    const sent = await prisma.platformNotification.findFirst({ where: { sourceKey: `${key}:${team.ownerUserId}` }, select: { id: true } })
    if (sent) return 'already_told'
  }
  const lang = await preferredLanguage(team.ownerUserId)
  const notice = irNotice({ names, leagueName: league.name ?? 'your league', moved: saved.ok, reason: saved.ok ? null : saved.error })
  const { dispatchNotification } = await import('@/lib/notifications/NotificationDispatcher')
  await dispatchNotification({
    userIds: [team.ownerUserId],
    category: 'league_announcements',
    type: saved.ok ? 'ir_auto_move' : 'ir_auto_move_blocked',
    title: notice.title[lang],
    body: notice.body[lang],
    actionHref: `/core/my-team?league=${encodeURIComponent(league.id)}`,
    actionLabel: lang === 'es' ? 'Ver plantilla' : 'Open roster',
    leagueId: league.id,
    severity: saved.ok ? 'low' : 'medium',
    dedupePrefix: key,
    meta: { week: scan.week, season: scan.season, rosterId: team.rosterId, playerIds: movable },
  })
  return saved.ok ? 'moved' : 'notified'
}

/**
 * Commish OS: one task per week naming the teams whose activated players are still on IR — the ones
 * the hourly run could not move (a full bench or roster). Rule off, or the owner's plan lapsed:
 * nothing, because the rule is not running. A failed read throws, as the other task sources do.
 */
export async function readIrAutoMoveTasks(leagueId: string): Promise<WorkspaceTaskCandidate[]> {
  const league = await loadLeague(leagueId)
  if (!league || !native(league) || !readIrAutoMoveEnabled(league.settings)) return []
  if (!(await ownerHasAfCommissionerPlan(league.userId))) return []
  const scan = await scanLeague(league, new Date())
  if (!scan || scan.teams.length === 0) return []
  const lines = scan.teams.map((t) => `${t.teamName} (${t.activated.map((id) => t.names[id] ?? id).join(', ')})`)
  return [
    {
      sourceKey: `ir-auto-move-stuck:${scan.season}:${scan.week}:v1`,
      title: lines.length === 1 ? 'An activated player is still on IR' : `${lines.length} teams have activated players still on IR`,
      description:
        `Week ${scan.week}: ${lines.join('; ')}. AllFantasy moves an activated player to the bench every hour when the roster has room; ` +
        'these teams need to make room first, and each manager has been told.',
      priority: 'standard',
      // Dropping a player to make room is the manager's call, never automated.
      automationCandidate: false,
      relatedLinks: [{ label: 'Commissioner Hub', moduleId: 'managers', href: `/core/commissioner?league=${encodeURIComponent(leagueId)}#ch-ir-auto-move` }],
    },
  ]
}

/** For Chimmy: whether the rule is running in this league. */
export async function readIrAutoMoveActive(leagueId: string): Promise<boolean> {
  const league = await loadLeague(leagueId)
  if (!league || !native(league) || !readIrAutoMoveEnabled(league.settings)) return false
  return ownerHasAfCommissionerPlan(league.userId)
}

