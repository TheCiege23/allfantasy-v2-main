import 'server-only'

import { prisma } from '@/lib/prisma'
import { resolveCurrentWeek } from './currentWeek'
import { readLeagueWeekMetadata } from './leagueWeekMetadata'
import { leagueWeekFromSettings } from './seasonTimeline'
import { finishedWeekKey, loadFinishedNflWeeks } from './finishedNflWeeks'
import { isNativePlatform } from './careerWireModel'

/**
 * Your week, across every league — read from WeeklyMatchup.
 *
 * ⚠ THE JOIN IS `League.platformLeagueId`, NOT `League.id`. WeeklyMatchup is
 * written by lib/rankings-engine/sleeper-matchup-cache.ts from Sleeper's payload,
 * so its `leagueId` holds the PLATFORM league id ("1313536441829068800"), and its
 * `rosterId` holds Sleeper's numeric roster_id. Measured on production:
 *
 *     WeeklyMatchup.leagueId matching League.id               → 0
 *     WeeklyMatchup.leagueId matching League.platformLeagueId → 2
 *
 * Joining on `id` — the obvious choice, and the one every other loader here uses —
 * returns an empty set with no error. This repo has two league-id spaces and this
 * table lives in the other one.
 *
 * Rows may contain partial current-period scores or historical results. Carry
 * their season and completion evidence through to every consuming view.
 *
 * AllFantasy-native leagues are read from `redraft_matchups` instead (see
 * `nativeWeekRows`) — WeeklyMatchup never holds them.
 */

export type WeekRow = {
  leagueId: string
  leagueName: string
  platform: string | null
  season: number
  week: number
  pointsFor: number
  pointsAgainst: number
  won: boolean
  /** Provider period advanced, league finished, or this is a past season; scores alone never prove completion. */
  completed?: boolean
}

export type WeekAllData = {
  rows: WeekRow[]
  /** The season these rows come from — never assume it is the current one. */
  season: number | null
  week: number | null
  /** Leagues the user has that carry no matchup history at all. */
  withoutHistory: number
  /**
   * Matchups that EXIST for this week but have not been played. Distinct from
   * `withoutHistory`: those leagues have no schedule at all, these have one that
   * has not started. Before a season opens this is the whole list, and saying so
   * is the difference between "no results yet" and an empty screen.
   */
  unscored: number
  record: { wins: number; losses: number } | null
  /**
   * When the newest of YOUR scored rows last changed (`WeeklyMatchup.updatedAt`), as ISO — the
   * matchup card's freshness stamp. Null when no row is scored. Optional so older fixtures that
   * predate it still type.
   */
  scoresAt?: string | null
}

export async function getWeekAll(
  userId: string,
  leagues: Array<{ id: string; name?: string | null; platform?: string | null; platformLeagueId?: string | null }>,
  /**
   * `previous`: the preceding provider period for results review. The current
   * period is eligible only when completion evidence exists for every league.
   * Each returned row must independently pass the same completion check.
   */
  opts: { previous?: boolean } = {},
): Promise<WeekAllData> {
  const empty: WeekAllData = {
    rows: [],
    season: null,
    week: null,
    withoutHistory: leagues.length,
    unscored: 0,
    record: null,
  }

  /*
   * ⚠ AllFantasy-NATIVE LEAGUES ARE NOT IN WeeklyMatchup. That table is written from a provider's
   * payload; a league AF scores itself keeps its games in `redraft_matchups`, so it was simply
   * missing from "your week", the home routine and the weekly story. Native is decided by the Career
   * Wire's own rule (`isNativePlatform`), and native leagues are read by `nativeWeekRows` below.
   */
  const nativeIds = leagues.filter((l) => isNativePlatform(l.platform, l.platformLeagueId)).map((l) => l.id)
  const platformIds = leagues
    .filter((l) => !isNativePlatform(l.platform, l.platformLeagueId))
    .map((l) => l.platformLeagueId)
    .filter((v): v is string => typeof v === 'string' && v.length > 0)
  if (platformIds.length === 0 && nativeIds.length === 0) return empty

  const provider = platformIds.length > 0 ? await providerWeek(platformIds, opts) : null
  /*
   * The week the rows describe. Provider leagues decide it when there are any — the native rows then
   * join that same week (AllFantasy runs its leagues on the NFL calendar). With ONLY native leagues
   * the newest native week of yours decides it; otherwise a native-only player would have no week.
   */
  const latest = provider?.latest ?? (nativeIds.length > 0 ? await latestNativeWeek(userId, nativeIds, opts) : null)
  if (!latest) return empty

  const rows: WeekRow[] = []
  let unscored = 0
  let scoresAt: Date | null = null

  if (provider) {
    const [matchups, myTeams] = await Promise.all([
      prisma.weeklyMatchup.findMany({
        where: { leagueId: { in: platformIds }, seasonYear: latest.seasonYear, week: latest.week },
        select: { leagueId: true, rosterId: true, pointsFor: true, pointsAgainst: true, win: true, updatedAt: true },
      }),
      prisma.leagueTeam.findMany({
        where: { league: { platformLeagueId: { in: platformIds } }, claimedByUserId: userId },
        select: { externalId: true, league: { select: { id: true, name: true, platform: true, platformLeagueId: true } } },
      }),
    ])

    // WeeklyMatchup.rosterId and LeagueTeam.externalId are both String now (see the
    // migration's README entry) -- was a number/string mismatch bridged by Number().
    const mine = new Map<string, { leagueId: string; name: string; platform: string | null }>()
    for (const team of myTeams) {
      const platformLeagueId = team.league?.platformLeagueId
      if (!platformLeagueId || !team.externalId) continue
      mine.set(`${platformLeagueId}:${team.externalId}`, {
        leagueId: team.league!.id,
        name: team.league?.name?.trim() || 'League',
        platform: team.league?.platform ?? null,
      })
    }

    for (const m of matchups) {
      const meta = mine.get(`${m.leagueId}:${m.rosterId}`)
      if (!meta) continue // not the user's team in that league

      const completed = provider.completedFor(m.leagueId, latest.seasonYear, latest.week)
      // Zero-zero alone is a schedule placeholder, but completion evidence can
      // establish a real tie. Custom scoring can also yield negative points.
      const scored = completed || m.pointsFor !== 0 || m.pointsAgainst !== 0
      if (!scored || (opts.previous && !completed)) {
        unscored += 1
        continue
      }

      if (m.updatedAt && (scoresAt == null || m.updatedAt > scoresAt)) scoresAt = m.updatedAt
      rows.push({
        leagueId: meta.leagueId,
        leagueName: meta.name,
        platform: meta.platform,
        season: latest.seasonYear,
        week: latest.week,
        pointsFor: m.pointsFor,
        pointsAgainst: m.pointsAgainst,
        won: completed && m.pointsFor > m.pointsAgainst,
        completed,
      })
    }
  }

  if (nativeIds.length > 0) {
    const native = await nativeWeekRows(userId, nativeIds, leagues, latest, opts)
    rows.push(...native.rows)
    unscored += native.unscored
  }

  rows.sort((a, b) => b.pointsFor - a.pointsFor)

  /*
   * Surfaced rather than swallowed. "Nothing to show" and "12 matchups exist but
   * none have been played" are different states, and the second one is the
   * common case before a season opens — the reader should be told which they are
   * looking at.
   */

  const settled = rows.filter((r) => r.completed)
  const record = settled.length
    ? { wins: settled.filter((r) => r.pointsFor > r.pointsAgainst).length, losses: settled.filter((r) => r.pointsFor < r.pointsAgainst).length }
    : null

  return {
    rows,
    season: latest.seasonYear,
    week: latest.week,
    withoutHistory: Math.max(0, leagues.length - rows.length),
    unscored,
    record,
    scoresAt: scoresAt ? scoresAt.toISOString() : null,
  }
}

type WeekRef = { seasonYear: number; week: number }

/** The provider leagues' week and their completion rule — the original body of `getWeekAll`. */
async function providerWeek(
  platformIds: string[],
  opts: { previous?: boolean },
): Promise<{ latest: WeekRef; completedFor: (platformId: string, season: number, week: number) => boolean } | null> {
  /*
   * The week actually in play, rather than "now" — the clock can be 2026 while
   * every row on file is 2025, and asking for the current week then returns
   * nothing and reads as a bug rather than as an empty season.
   *
   * ⚠ AND NOT `max(week)`, which is what this took until the sync began
   * bootstrapping whole seasons of 0-0 rows ahead of kickoff: the maximum then
   * selects week 18 in August, every row of it unscored, so this loader returned
   * nothing and the home rendered "no scored matchups" for a Week 1 that had
   * simply not been looked at. See lib/core-app/currentWeek.ts for the
   * production measurement and the rule that survives both shapes.
   */
  const current = await resolveCurrentWeek(platformIds)
  if (!current) return null
  const metadata = await readLeagueWeekMetadata(platformIds, 'platform')
  const metadataByLeague = new Map<string, typeof metadata>()
  for (const meta of metadata) {
    if (!meta.platformLeagueId) continue
    const copies = metadataByLeague.get(meta.platformLeagueId) ?? []
    copies.push(meta)
    metadataByLeague.set(meta.platformLeagueId, copies)
  }
  /*
   * The schedule's answer for the weeks these NFL leagues are ON — see leagueWeekProgress for why
   * the league's own marker is not enough on the Tuesday after a week. One read for the account.
   */
  const isNfl = (meta: (typeof metadata)[number]) => String(meta.sport ?? '').toUpperCase() === 'NFL'
  const finishedNfl = await loadFinishedNflWeeks(
    metadata.flatMap((meta) => {
      const period = leagueWeekFromSettings(meta.settings)
      return isNfl(meta) && meta.season != null && period != null ? [{ season: meta.season, week: period }] : []
    }),
  )
  const completedFor = (platformId: string, season: number, week: number): boolean => {
    const copies = metadataByLeague.get(platformId) ?? []
    const sameSeason = copies.filter((meta) => meta.season === season)
    if (sameSeason.length) {
      // A season can continue into January. Its saved period outranks the clock;
      // conflicting imports must all support completion before claiming a result.
      return sameSeason.every((meta) => {
        if (String(meta.status).toLowerCase() === 'complete') return true
        const period = leagueWeekFromSettings(meta.settings)
        if (period == null) return false
        if (week < period) return true
        return week === period && isNfl(meta) && finishedNfl.has(finishedWeekKey(season, week))
      })
    }
    if (copies.some((meta) => meta.season != null && meta.season > season)) return true
    return season < new Date().getUTCFullYear()
  }
  let latest: WeekRef = current
  if (opts.previous) {
    // Thursday points on every roster do not turn the current period into a completed week.
    const allCompleted = platformIds.every((id) => completedFor(id, current.seasonYear, current.week))
    latest = allCompleted ? current : { seasonYear: current.seasonYear, week: current.week - 1 }
    if (latest.week < 1) return null
  }
  return { latest, completedFor }
}

/*
 * ── AllFantasy-native leagues ───────────────────────────────────────────────────────────────
 *
 * Read by the rules League Career already applies to `redraft_matchups` (#1800,
 * `readNativeFixtures` in leagueCareer.ts):
 *   - YOU are `RedraftRoster.ownerId` — an AppUser id; every other native roster is a placeholder.
 *   - COMPLETED is the engine's own `status = 'final'`; `active` is a week being played.
 *   - a bye (no away roster) and a median game are not games against a manager.
 */
const NATIVE_GAME = { isMedianMatchup: false, awayRosterId: { not: null } } as const

function mineIn(userId: string) {
  return [{ homeRoster: { ownerId: userId } }, { awayRoster: { ownerId: userId } }]
}

/** Your newest native week: `final` for a results review, `active` or `final` for the live view. */
async function latestNativeWeek(userId: string, nativeIds: string[], opts: { previous?: boolean }): Promise<WeekRef | null> {
  const row = await prisma.redraftMatchup
    .findFirst({
      where: {
        leagueId: { in: nativeIds },
        ...NATIVE_GAME,
        status: opts.previous ? 'final' : { in: ['active', 'final'] },
        OR: mineIn(userId),
      },
      orderBy: [{ season: { season: 'desc' } }, { week: 'desc' }],
      select: { week: true, season: { select: { season: true } } },
    })
    .catch(() => null)
  return row?.season ? { seasonYear: row.season.season, week: row.week } : null
}

async function nativeWeekRows(
  userId: string,
  nativeIds: string[],
  leagues: Array<{ id: string; name?: string | null; platform?: string | null }>,
  week: WeekRef,
  opts: { previous?: boolean },
): Promise<{ rows: WeekRow[]; unscored: number }> {
  const matchups = await prisma.redraftMatchup
    .findMany({
      where: { leagueId: { in: nativeIds }, week: week.week, season: { season: week.seasonYear }, ...NATIVE_GAME, OR: mineIn(userId) },
      select: {
        leagueId: true,
        status: true,
        homeScore: true,
        awayScore: true,
        homeRoster: { select: { ownerId: true } },
      },
    })
    .catch(() => [])
  const byId = new Map(leagues.map((l) => [l.id, l]))
  const rows: WeekRow[] = []
  let unscored = 0
  const seen = new Set<string>()
  for (const m of matchups) {
    if (seen.has(m.leagueId)) continue // one game per league per week
    seen.add(m.leagueId)
    const home = m.homeRoster?.ownerId === userId
    const pointsFor = home ? m.homeScore : m.awayScore
    const pointsAgainst = home ? m.awayScore : m.homeScore
    const completed = m.status === 'final'
    const scored = completed || pointsFor !== 0 || pointsAgainst !== 0
    if (!scored || (opts.previous && !completed)) {
      unscored += 1
      continue
    }
    const league = byId.get(m.leagueId)
    rows.push({
      leagueId: m.leagueId,
      leagueName: league?.name?.trim() || 'League',
      platform: league?.platform ?? null,
      season: week.seasonYear,
      week: week.week,
      pointsFor,
      pointsAgainst,
      won: completed && pointsFor > pointsAgainst,
      completed,
    })
  }
  return { rows, unscored }
}

/**
 * The league ids whose matchup cards Dashboard3A will actually render.
 *
 * The 3a screen builds its `scored` list as: leagues carrying a LIVE score
 * first (`Dash34League.score` — null on every production row today, since no
 * score reader exists), then this loader's scored rows for the remaining
 * leagues, sliced to four. Win-probability pricing must target exactly that
 * set — pricing `playedLeagues.slice(0, 4)` paid four `getMatchupData`
 * round-trips per home load while the cards rendered a DIFFERENT four (or,
 * before the season starts, none at all). Derived here, beside the row shape
 * it reads, so the server and the screen cannot silently drift apart.
 */
export function scoredMatchupLeagueIds(
  liveScoredIds: string[],
  week: Pick<WeekAllData, 'rows'> | null | undefined,
  limit = 4,
): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const id of liveScoredIds) {
    if (seen.has(id)) continue
    seen.add(id)
    out.push(id)
    if (out.length >= limit) return out
  }
  for (const r of week?.rows ?? []) {
    if (seen.has(r.leagueId)) continue
    seen.add(r.leagueId)
    out.push(r.leagueId)
    if (out.length >= limit) return out
  }
  return out
}
