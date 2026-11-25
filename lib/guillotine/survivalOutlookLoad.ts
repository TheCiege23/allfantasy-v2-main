import 'server-only'

/**
 * Server half of ./survivalOutlook.ts: for each team alive in a Guilly league, its starters this week, how
 * many games each still has, and the AF projection for those games. Two entry points, one core:
 *
 *   - `loadSurvivalOutlook` (native): starters from the season's redraft rosters and this week's lineups,
 *     keyed by the LEAGUE roster id the chop line (`dangerTiers`, `home.scores`) is keyed by — mapped from
 *     the redraft rosters exactly as the chop preview maps them (./chopPreviewLoad.ts).
 *   - `loadImportedSurvivalOutlook` (imported): starters from each team's stored `Roster` row, keyed by the
 *     provider roster id the imported view is keyed by (./importedGuillyView.ts), joined by the shared
 *     team↔roster resolver. The stored row is the last sync's lineup: the live Sleeper read would call the
 *     provider from a request path, which the DB-first boundary forbids.
 *
 * The core reads only what is stored: the league player board (`loadLeaguePlayerMetrics` — each starter's
 * weekly AF projection AND his club, in any roster id space) and the week's slate (`readWeekGames`, every
 * sport). No provider is called. Never throws: a part that cannot be read leaves the outlook null, and the
 * board then shows no odds rather than wrong ones.
 */
import { prisma } from '@/lib/prisma'
import { readWeekGames } from '@/lib/redraft/weekGames'
import { loadWeekLineups, weekSlotType } from '@/lib/redraft/weekLineupSlots'
import { isNflRedraftScoringStarterSlot } from '@/lib/scoring-runtime/canonicalNflRedraftScoringRuntime'
import { resolveDailySportWeekWindow } from '@/lib/season-week/dailySportSeasonStarts'
import { projectionTeamKey } from '@/lib/af-projections/leagueProjectionSchedule'
import { loadLeaguePlayerMetrics } from '@/lib/af-projections/leaguePlayerMetrics'
import { normalizeGameStatus } from '@/lib/sports/gameStatus'
import { resolveRostersForTeams } from '@/lib/leagues/rosterTeamIdentity'
import { rosterIdForOwner } from './finishGuillotineSeason'
import { teamOutlook, type StarterGames, type TeamOutlook } from './survivalOutlook'

const DAILY = new Set(['NBA', 'NHL', 'MLB', 'NCAAB', 'SOCCER'])

type Lineup = { playerId: string; team?: string | null }

/** The shared core: each team's lineup → its outlook. Null when the slate or the board cannot be read. */
async function outlookForLineups(args: {
  leagueId: string
  sport: string
  season: number
  week: number
  lineups: ReadonlyMap<string, readonly Lineup[]>
  now: Date
}): Promise<Record<string, TeamOutlook> | null> {
  const sport = args.sport.toUpperCase()
  const ids = [...new Set([...args.lineups.values()].flat().map((p) => p.playerId))]
  const window = DAILY.has(sport) ? resolveDailySportWeekWindow(sport, args.season, args.week) : null
  const [games, board] = await Promise.all([
    readWeekGames(prisma, { sport, season: args.season, week: args.week, seasonType: 'regular', dateWindow: window, now: args.now }),
    ids.length
      ? loadLeaguePlayerMetrics({ leagueId: args.leagueId, week: args.week, rosterIds: ids, limit: ids.length, includeTradeValues: false }).catch(() => null)
      : Promise.resolve(null),
  ])
  // A slate we cannot read would put every starter at "no games left" and every team at 100%.
  if (games.length === 0) return null
  const pointBoard = board?.season === args.season && board.unit === 'fantasy points'
  const projection = new Map<string, number>()
  const clubOf = new Map<string, string>()
  for (const row of board?.rows ?? []) {
    if (!row.rosterPlayerId) continue
    if (pointBoard && row.weekly != null && Number.isFinite(row.weekly)) projection.set(row.rosterPlayerId, row.weekly)
    if (row.team) clubOf.set(row.rosterPlayerId, row.team)
  }

  // Games per club this week, and how many of them are not over yet.
  const byClub = new Map<string, { total: number; left: number }>()
  for (const g of games) {
    const state = normalizeGameStatus(g.status)
    if (state === 'postponed' || state === 'cancelled') continue
    for (const club of [g.homeTeam, g.awayTeam]) {
      const key = projectionTeamKey(sport, club)
      if (!key) continue
      const cur = byClub.get(key) ?? { total: 0, left: 0 }
      cur.total += 1
      if (state !== 'final') cur.left += 1
      byClub.set(key, cur)
    }
  }

  const out: Record<string, TeamOutlook> = {}
  for (const [teamId, lineup] of args.lineups) {
    const starters: StarterGames[] = lineup.map((p) => {
      const key = projectionTeamKey(sport, p.team ?? clubOf.get(p.playerId) ?? null)
      const sched = key ? byClub.get(key) : undefined
      return { weekProjection: projection.get(p.playerId) ?? null, gamesThisWeek: sched?.total ?? 0, gamesLeft: sched?.left ?? 0 }
    })
    out[teamId] = teamOutlook(starters)
  }
  return out
}

/** Native Guilly league: keyed by league roster id. */
export async function loadSurvivalOutlook(leagueId: string, week: number, now: Date = new Date()): Promise<Record<string, TeamOutlook> | null> {
  try {
    const [league, season, rosters] = await Promise.all([
      prisma.league.findUnique({ where: { id: leagueId }, select: { sport: true } }),
      prisma.redraftSeason.findFirst({ where: { leagueId }, orderBy: { createdAt: 'desc' }, select: { id: true, season: true } }),
      prisma.roster.findMany({ where: { leagueId }, select: { id: true, platformUserId: true, redraftRosterId: true } }),
    ])
    if (!league || !season) return null
    const active = await prisma.redraftRoster.findMany({ where: { seasonId: season.id, isEliminated: false }, select: { id: true, ownerId: true } })
    const leagueRosterOf = new Map<string, string>()
    for (const r of active) {
      const id = rosters.find((x) => x.redraftRosterId === r.id)?.id ?? rosterIdForOwner(r.ownerId, rosters)
      if (id) leagueRosterOf.set(r.id, id)
    }
    const redraftIds = [...leagueRosterOf.keys()]
    if (redraftIds.length === 0) return null
    const [players, weekLineups] = await Promise.all([
      prisma.redraftRosterPlayer.findMany({
        where: { rosterId: { in: redraftIds }, droppedAt: null },
        select: { rosterId: true, playerId: true, team: true, slotType: true, position: true },
      }),
      loadWeekLineups(prisma, { redraftRosterIds: redraftIds, season: season.season, week }),
    ])
    const lineups = new Map<string, Lineup[]>()
    for (const leagueRosterId of leagueRosterOf.values()) lineups.set(leagueRosterId, [])
    for (const p of players) {
      if (!isNflRedraftScoringStarterSlot(weekSlotType(p, weekLineups))) continue
      lineups.get(leagueRosterOf.get(p.rosterId)!)?.push({ playerId: p.playerId, team: p.team })
    }
    return await outlookForLineups({ leagueId, sport: String(league.sport ?? 'NFL'), season: season.season, week, lineups, now })
  } catch {
    return null
  }
}

/** A stored lineup's starter ids: an empty slot ('0') and an unresolved `name:` entry are not players. */
function storedStarters(playerData: unknown): string[] {
  if (!playerData || typeof playerData !== 'object') return []
  const s = (playerData as Record<string, unknown>).starters
  return Array.isArray(s) ? s.map(String).filter((id) => id && id !== '0' && !id.startsWith('name:')) : []
}

/**
 * Imported Guilly league: keyed by provider roster id, for the teams in `aliveRosterIds` (the imported
 * view's standings). Null when the league has no season or no team can be joined to a stored roster.
 */
export async function loadImportedSurvivalOutlook(
  leagueId: string,
  week: number | null,
  aliveRosterIds: readonly string[],
  now: Date = new Date(),
): Promise<Record<string, TeamOutlook> | null> {
  if (week == null || aliveRosterIds.length === 0) return null
  try {
    const [league, teams, rosters] = await Promise.all([
      prisma.league.findUnique({ where: { id: leagueId }, select: { sport: true, season: true } }),
      prisma.leagueTeam.findMany({ where: { leagueId }, select: { externalId: true, platformUserId: true } }),
      prisma.roster.findMany({ where: { leagueId }, select: { id: true, platformUserId: true, playerData: true } }),
    ])
    if (!league?.season) return null
    const alive = new Set(aliveRosterIds)
    const wanted = teams.filter((t) => alive.has(String(t.externalId))).map((t) => ({ externalId: String(t.externalId), platformUserId: t.platformUserId }))
    const rowOf = resolveRostersForTeams(wanted, rosters)
    const lineups = new Map<string, Lineup[]>()
    for (const t of wanted) {
      const row = rowOf.get(t.externalId)
      if (row) lineups.set(t.externalId, storedStarters(row.playerData).map((playerId) => ({ playerId })))
    }
    // Odds need every team alive; a team we cannot join has no outlook, and the board then shows none.
    if (lineups.size === 0) return null
    return await outlookForLineups({ leagueId, sport: String(league.sport ?? 'NFL'), season: league.season, week, lineups, now })
  } catch {
    return null
  }
}
