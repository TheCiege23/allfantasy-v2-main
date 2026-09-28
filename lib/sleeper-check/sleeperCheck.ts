import 'server-only'

import {
  getLeagueRosters,
  getSleeperState,
  getUserLeagues,
  resolveSleeperUser,
} from '@/lib/api-cache/SleeperCacheLayer'
import { prisma } from '@/lib/prisma'
import { composePlayerIdentities } from '@/lib/core-app/playerIdentityCompose'
import { namesBySleeperId, readInjuryStatusById } from '@/lib/core-app/injuryStatusById'
import { isBestBallSettings } from '@/lib/core-app/lineupMode'
import { consumeRateLimit } from '@/lib/rate-limit'
import {
  buildCheckPlayers,
  lineupAlerts,
  rostersOwnedBy,
  slotsOnRoster,
  type CheckLeague,
  type CheckPlayer,
  type CheckSlot,
  type PlayerIdentity,
  type SleeperRosterLike,
} from './aggregate'

/**
 * The PUBLIC Sleeper check behind `/check`: username → NFL leagues → every rostered player, with
 * the injury designations we hold. No account. Signing up is what it takes to act on any of it.
 *
 * 🛑 DB-FIRST: EVERY SLEEPER READ GOES THROUGH `SleeperCacheLayer`, the repo's Sleeper gateway —
 * memory, then `sportsDataCache`, then the provider only on a miss, writing back what it fetched
 * (rosters 5 min, users and league lists 1 h). That is the read-through shape CLAUDE.md accepts
 * for FantasyCalc; a live call per visitor would not be. Names and injuries are Postgres reads.
 *
 * 🛑 AND A PUBLIC PAGE IS A WAY FOR ANYONE TO SPEND OUR SLEEPER QUOTA — which our imports share,
 * from the same server address. So the route limits each visitor, and this module additionally
 * caps LEAGUE READS per instance per minute: a busy minute reads fewer leagues and says so, rather
 * than letting one username with sixty leagues cost sixty cold fetches on repeat. Cache hits count
 * against the cap too; that is conservative, and it keeps the bound independent of cache state.
 */

export const MAX_CHECK_LEAGUES = 60
export const LEAGUE_READS_PER_MINUTE = 600
const ROSTER_CONCURRENCY = 6

export type CheckLeagueView = CheckLeague & { read: boolean }

export type SleeperCheckResult =
  | { status: 'not_found' }
  | { status: 'unavailable' }
  | {
      status: 'ok'
      username: string
      displayName: string | null
      avatarId: string | null
      season: string
      asOf: string
      leagues: CheckLeagueView[]
      /** Leagues beyond the cap, never read. */
      leaguesNotShown: number
      /** Leagues skipped because this minute's read budget ran out — try again shortly. */
      leaguesDeferred: number
      /** Leagues Sleeper failed to answer for, with no cached copy to fall back on. */
      leaguesUnavailable: number
      players: CheckPlayer[]
      alerts: CheckPlayer[]
    }

type Row = Record<string, unknown>

export type SleeperCheckDeps = {
  now: () => Date
  nflSeason: () => Promise<string | null>
  resolveUser: (encodedUsername: string) => Promise<Row | null>
  userLeagues: (userId: string, season: string) => Promise<Row[]>
  leagueRosters: (leagueId: string) => Promise<SleeperRosterLike[]>
  playerRows: (
    sleeperIds: string[],
  ) => Promise<Array<{ sleeperId: string | null; name: string; position: string | null; team: string | null; sport: string | null; imageUrl: string | null }>>
  injuries: (namesById: Map<string, string[]>, teamsById: Map<string, string | null>) => Promise<Map<string, string>>
  /** One unit of the per-minute league-read budget; false when it is spent. */
  takeLeagueRead: () => boolean
}

export const defaultSleeperCheckDeps: SleeperCheckDeps = {
  now: () => new Date(),
  nflSeason: async () => (await getSleeperState('nfl'))?.season ?? null,
  resolveUser: resolveSleeperUser,
  userLeagues: (userId, season) => getUserLeagues(userId, 'nfl', season),
  leagueRosters: getLeagueRosters,
  playerRows: (sleeperIds) =>
    prisma.sportsPlayer.findMany({
      where: { sleeperId: { in: sleeperIds } },
      // `sport` is required by composePlayerIdentities — it gates the NFL club fold.
      select: { sleeperId: true, name: true, position: true, team: true, sport: true, imageUrl: true },
    }),
  injuries: (namesById, teamsById) => readInjuryStatusById('NFL', namesById, teamsById),
  takeLeagueRead: () =>
    consumeRateLimit({
      scope: 'sleeper_check',
      action: 'league_reads',
      sleeperUsername: null,
      ip: null,
      maxRequests: LEAGUE_READS_PER_MINUTE,
      windowMs: 60_000,
    }).success,
}

async function pool<T>(items: readonly T[], limit: number, fn: (item: T) => Promise<void>): Promise<void> {
  let next = 0
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const item = items[next++]!
      await fn(item)
    }
  })
  await Promise.all(workers)
}

/** Sleeper answers an unknown username with `null`; case may matter, so the lowercase form is tried first. */
async function findUser(username: string, deps: SleeperCheckDeps): Promise<Row | null | 'unavailable'> {
  const candidates = [...new Set([username.toLowerCase(), username])]
  let failed = false
  for (const c of candidates) {
    try {
      const user = await deps.resolveUser(encodeURIComponent(c))
      if (user && typeof user === 'object' && user.user_id) return user
    } catch {
      failed = true
    }
  }
  return failed ? 'unavailable' : null
}

export async function runSleeperCheck(
  username: string,
  deps: SleeperCheckDeps = defaultSleeperCheckDeps,
): Promise<SleeperCheckResult> {
  const user = await findUser(username, deps)
  if (user === 'unavailable') return { status: 'unavailable' }
  if (!user) return { status: 'not_found' }
  const userId = String(user.user_id)

  const season = (await deps.nflSeason().catch(() => null)) ?? String(deps.now().getUTCFullYear())

  let rawLeagues: Row[]
  try {
    rawLeagues = await deps.userLeagues(userId, season)
  } catch {
    return { status: 'unavailable' }
  }
  const allLeagues: CheckLeague[] = (Array.isArray(rawLeagues) ? rawLeagues : [])
    .filter((l) => l && l.league_id)
    .map((l) => ({
      leagueId: String(l.league_id),
      name: String(l.name ?? 'Sleeper league'),
      bestBall: isBestBallSettings(l),
    }))
  const shown = allLeagues.slice(0, MAX_CHECK_LEAGUES)

  const slotsByLeague = new Map<string, Map<string, CheckSlot>>()
  const readIds = new Set<string>()
  let deferred = 0
  let unavailable = 0
  await pool(shown, ROSTER_CONCURRENCY, async (league) => {
    if (!deps.takeLeagueRead()) {
      deferred += 1
      return
    }
    try {
      const rosters = await deps.leagueRosters(league.leagueId)
      const merged = new Map<string, CheckSlot>()
      for (const r of rostersOwnedBy(Array.isArray(rosters) ? rosters : [], userId)) {
        for (const [id, slot] of slotsOnRoster(r)) {
          // Two rosters in one league: a start anywhere is a start.
          if (merged.get(id) !== 'starter') merged.set(id, slot)
        }
      }
      slotsByLeague.set(league.leagueId, merged)
      readIds.add(league.leagueId)
    } catch {
      unavailable += 1
    }
  })

  const sleeperIds = [...new Set([...slotsByLeague.values()].flatMap((m) => [...m.keys()]))]
  const rows = sleeperIds.length ? await deps.playerRows(sleeperIds).catch(() => []) : []
  const composed = composePlayerIdentities(rows)
  const identities = new Map<string, PlayerIdentity>(
    [...composed].map(([id, p]) => [id, { name: p.name, position: p.position, team: p.team, imageUrl: p.imageUrl }]),
  )
  const injuries = rows.length
    ? await deps
        .injuries(namesBySleeperId(rows), new Map([...composed].map(([id, p]) => [id, p.team])))
        .catch(() => new Map<string, string>())
    : new Map<string, string>()

  const players = buildCheckPlayers({ leagues: shown, slotsByLeague, identities, injuries })

  return {
    status: 'ok',
    username: String(user.username ?? username),
    displayName: typeof user.display_name === 'string' ? user.display_name : null,
    avatarId: typeof user.avatar === 'string' ? user.avatar : null,
    season,
    asOf: deps.now().toISOString(),
    leagues: shown.map((l) => ({ ...l, read: readIds.has(l.leagueId) })),
    leaguesNotShown: allLeagues.length - shown.length,
    leaguesDeferred: deferred,
    leaguesUnavailable: unavailable,
    players,
    alerts: lineupAlerts(players),
  }
}
