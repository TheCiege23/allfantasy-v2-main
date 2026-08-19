import 'server-only'

import { prisma } from '@/lib/prisma'

/**
 * sleeperH2HService — the Legacy deep sync: every week's matchups across every
 * season in the league chain → real manager-vs-manager records and scoring
 * profiles. This is the sync the Legacy tab's honesty card promised.
 *
 *  - Head-to-head: W–L–T per manager pair, average margin, closest game.
 *  - Scoring profile per manager: games, average, high, low, consistency
 *    (stdev), top-half weeks (finished above the weekly median — the "would
 *    you have won a random matchup" rate).
 *  - Trend per manager: last-3-completed-weeks average vs season average in
 *    the newest season (up / down / flat), counted, not vibes.
 *
 * Completed seasons cache for a year (they never change); the aggregate and
 * the in-progress season refresh on the 6h cycle. Anything unfetchable lands
 * in `missing` and renders as absence.
 */

const SLEEPER = 'https://api.sleeper.app/v1'
const SEASON_PREFIX = 'h2h:season:v1:'
const AGG_PREFIX = 'h2h:v2:'
const AGG_TTL_MS = 6 * 60 * 60 * 1000
const COMPLETE_TTL_MS = 365 * 24 * 60 * 60 * 1000
const MAX_CHAIN = 12
const MAX_WEEKS = 18

async function j<T>(path: string): Promise<T | null> {
  try {
    const res = await fetch(`${SLEEPER}${path}`, { cache: 'no-store' })
    if (!res.ok) return null
    return (await res.json()) as T
  } catch {
    return null
  }
}

type WireLeague = {
  league_id: string
  season: string
  status: string
  previous_league_id?: string | null
}
type WireUser = {
  user_id: string
  display_name: string
  avatar: string | null
  metadata?: { team_name?: string | null } | null
}
type WireRoster = { roster_id: number; owner_id: string | null }
type WireMatchup = { roster_id: number; matchup_id: number | null; points: number }

// ── Per-season sync ──────────────────────────────────────────────────────────
export type H2HGame = {
  season: string
  week: number
  aOwnerId: string
  bOwnerId: string
  aPoints: number
  bPoints: number
}
type SeasonSync = {
  version: 1
  season: string
  complete: boolean
  games: H2HGame[]
  /** ownerId → weekly points (in week order) for scoring profiles. */
  weekly: Record<string, { week: number; points: number; topHalf: boolean }[]>
  managers: Record<string, { name: string; avatar: string | null; teamName: string | null }>
  missingWeeks: number
}

async function syncSeason(league: WireLeague): Promise<SeasonSync | null> {
  const cacheKey = `${SEASON_PREFIX}${league.league_id}`
  const complete = String(league.status).toLowerCase() === 'complete'
  const now = new Date()
  const cached = await prisma.sportsDataCache.findUnique({ where: { cacheKey } }).catch(() => null)
  const cachedPayload =
    cached && cached.data && typeof cached.data === 'object'
      ? (cached.data as unknown as SeasonSync)
      : null
  if (cachedPayload?.version === 1 && cached && cached.expiresAt > now) return cachedPayload

  const weekFetches = Array.from({ length: MAX_WEEKS }, (_, i) =>
    j<WireMatchup[]>(`/league/${league.league_id}/matchups/${i + 1}`),
  )
  const [users, rosters, ...weeks] = await Promise.all([
    j<WireUser[]>(`/league/${league.league_id}/users`),
    j<WireRoster[]>(`/league/${league.league_id}/rosters`),
    ...weekFetches,
  ])
  if (!users || !rosters) return cachedPayload?.version === 1 ? cachedPayload : null

  const ownerOf = new Map(rosters.map((r) => [r.roster_id, r.owner_id ?? null]))
  const managers: SeasonSync['managers'] = {}
  for (const u of users) {
    managers[u.user_id] = {
      name: u.display_name,
      avatar: u.avatar,
      teamName: u.metadata?.team_name?.trim() || null,
    }
  }

  const games: H2HGame[] = []
  const weekly: SeasonSync['weekly'] = {}
  let missingWeeks = 0
  weeks.forEach((rows, i) => {
    const week = i + 1
    if (!rows) {
      missingWeeks += 1
      return
    }
    // A week with no points at all hasn't been played (pre-season / bye chain end).
    const played = rows.some((r) => (r.points ?? 0) > 0)
    if (!played) return
    const median = [...rows].map((r) => r.points).sort((a, b) => a - b)
    const mid =
      median.length % 2 === 1
        ? median[(median.length - 1) / 2]
        : (median[median.length / 2 - 1] + median[median.length / 2]) / 2
    for (const r of rows) {
      const owner = ownerOf.get(r.roster_id)
      if (!owner) continue
      ;(weekly[owner] ??= []).push({ week, points: r.points, topHalf: r.points > mid })
    }
    const byMatchup = new Map<number, WireMatchup[]>()
    for (const r of rows) {
      if (r.matchup_id == null) continue
      const list = byMatchup.get(r.matchup_id)
      if (list) list.push(r)
      else byMatchup.set(r.matchup_id, [r])
    }
    for (const pair of byMatchup.values()) {
      if (pair.length !== 2) continue
      const [a, b] = pair
      const aOwner = ownerOf.get(a.roster_id)
      const bOwner = ownerOf.get(b.roster_id)
      if (!aOwner || !bOwner) continue
      games.push({
        season: league.season,
        week,
        aOwnerId: aOwner,
        bOwnerId: bOwner,
        aPoints: a.points,
        bPoints: b.points,
      })
    }
  })

  const fresh: SeasonSync = {
    version: 1,
    season: league.season,
    complete,
    games,
    weekly,
    managers,
    missingWeeks,
  }
  await prisma.sportsDataCache
    .upsert({
      where: { cacheKey },
      update: {
        data: fresh as unknown as object,
        expiresAt: new Date(now.getTime() + (complete ? COMPLETE_TTL_MS : AGG_TTL_MS)),
      },
      create: {
        cacheKey,
        data: fresh as unknown as object,
        expiresAt: new Date(now.getTime() + (complete ? COMPLETE_TTL_MS : AGG_TTL_MS)),
      },
    })
    .catch(() => null)
  return fresh
}

// ── Aggregate payload ────────────────────────────────────────────────────────
export type H2HOpponentRecord = {
  opponentOwnerId: string
  wins: number
  losses: number
  ties: number
  avgMargin: number
  closest: { season: string; week: number; margin: number } | null
}
export type H2HManager = {
  ownerId: string
  name: string
  avatar: string | null
  teamName: string | null
  games: number
  avgPoints: number
  high: number
  low: number
  stdev: number
  topHalfPct: number
  trend: 'up' | 'down' | 'flat' | null
  byOpponent: H2HOpponentRecord[]
}
// ── Records book + weekly awards (all counted from synced games) ─────────────
export type RecordWeek = { ownerId: string; points: number; season: string; week: number }
export type RecordGame = {
  winnerOwnerId: string
  loserOwnerId: string
  margin: number
  season: string
  week: number
}
export type RecordStreak = {
  ownerId: string
  length: number
  fromSeason: string
  fromWeek: number
  toSeason: string
  toWeek: number
  /** Still alive as of the newest synced week. */
  active: boolean
}
export type LeagueRecords = {
  highestWeek: RecordWeek | null
  lowestWeek: RecordWeek | null
  biggestBlowout: RecordGame | null
  closestGame: RecordGame | null
  longestWinStreak: RecordStreak | null
  longestLossStreak: RecordStreak | null
  bestSeasonAvg: { ownerId: string; season: string; avg: number; games: number } | null
}
export type WeeklyAwards = {
  season: string
  week: number
  topScore: RecordWeek | null
  lowScore: RecordWeek | null
  narrowEscape: RecordGame | null
  biggestBlowout: RecordGame | null
}

export type LeagueH2HPayload = {
  version: 2
  fetchedAt: string
  staleAsOf: string | null
  /** For source 'sleeper' this is the Sleeper league id; for 'imported-facts' it is the AllFantasy league id. */
  sleeperLeagueId: string
  /** Where the games came from. Absent on older cached payloads (which are all Sleeper). */
  source?: 'sleeper' | 'imported-facts'
  seasons: string[]
  managers: H2HManager[]
  totalGames: number
  records: LeagueRecords
  latestWeekAwards: WeeklyAwards | null
  missing: string[]
}

/**
 * One season of head-to-head input, source-agnostic: Sleeper's chain walk and
 * the imported-league facts warehouse (Yahoo/ESPN/etc.) both produce this.
 * `ownerId` keys are Sleeper user ids for Sleeper leagues and provider team
 * keys for imported leagues — the aggregation only needs them to be stable.
 */
export type H2HSeasonData = {
  season: string
  games: H2HGame[]
  weekly: Record<string, { week: number; points: number; topHalf: boolean }[]>
  managers: Record<string, { name: string; avatar: string | null; teamName: string | null }>
}

/**
 * Pure aggregation: seasons of games → manager profiles, pair records, the
 * records book, and latest-week awards. Extracted so imported (non-Sleeper)
 * leagues get EXACTLY the same math over their persisted matchup facts.
 * Seasons must be ordered oldest → newest (trend uses the last entry).
 */
export function aggregateH2HSeasons(
  syncs: H2HSeasonData[],
): Pick<LeagueH2HPayload, 'seasons' | 'managers' | 'totalGames' | 'records' | 'latestWeekAwards'> {
  // Merge manager identities (newest season wins name/avatar).
  const identity = new Map<string, { name: string; avatar: string | null; teamName: string | null }>()
  for (const s of syncs) {
    for (const [ownerId, m] of Object.entries(s.managers)) identity.set(ownerId, m)
  }

  type PairAcc = { wins: number; losses: number; ties: number; margins: number[]; closest: H2HOpponentRecord['closest'] }
  const pairAcc = new Map<string, Map<string, PairAcc>>() // ownerId → opponentId → acc
  const acc = (a: string, b: string): PairAcc => {
    const inner = pairAcc.get(a) ?? new Map<string, PairAcc>()
    pairAcc.set(a, inner)
    const cur = inner.get(b) ?? { wins: 0, losses: 0, ties: 0, margins: [], closest: null }
    inner.set(b, cur)
    return cur
  }
  let totalGames = 0
  for (const s of syncs) {
    for (const g of s.games) {
      totalGames += 1
      const margin = g.aPoints - g.bPoints
      const aAcc = acc(g.aOwnerId, g.bOwnerId)
      const bAcc = acc(g.bOwnerId, g.aOwnerId)
      if (margin > 0) {
        aAcc.wins += 1
        bAcc.losses += 1
      } else if (margin < 0) {
        aAcc.losses += 1
        bAcc.wins += 1
      } else {
        aAcc.ties += 1
        bAcc.ties += 1
      }
      aAcc.margins.push(margin)
      bAcc.margins.push(-margin)
      const absMargin = Math.abs(margin)
      if (!aAcc.closest || absMargin < Math.abs(aAcc.closest.margin)) {
        aAcc.closest = { season: g.season, week: g.week, margin: Math.round(margin * 10) / 10 }
      }
      if (!bAcc.closest || absMargin < Math.abs(bAcc.closest.margin)) {
        bAcc.closest = { season: g.season, week: g.week, margin: Math.round(-margin * 10) / 10 }
      }
    }
  }

  const managers: H2HManager[] = [...identity.entries()].map(([ownerId, m]) => {
    const allWeeks = syncs.flatMap((s) => s.weekly[ownerId] ?? [])
    const games = allWeeks.length
    const total = allWeeks.reduce((a, w) => a + w.points, 0)
    const avg = games > 0 ? total / games : 0
    const high = games > 0 ? Math.max(...allWeeks.map((w) => w.points)) : 0
    const low = games > 0 ? Math.min(...allWeeks.map((w) => w.points)) : 0
    const variance =
      games > 0 ? allWeeks.reduce((a, w) => a + (w.points - avg) ** 2, 0) / games : 0
    const topHalf = allWeeks.filter((w) => w.topHalf).length

    // Trend: newest season, last 3 played weeks vs that season's average.
    let trend: H2HManager['trend'] = null
    const newest = syncs[syncs.length - 1]
    const newestWeeks = newest?.weekly[ownerId] ?? []
    if (newestWeeks.length >= 4) {
      const seasonAvg = newestWeeks.reduce((a, w) => a + w.points, 0) / newestWeeks.length
      const last3 = newestWeeks.slice(-3)
      const recentAvg = last3.reduce((a, w) => a + w.points, 0) / last3.length
      trend = recentAvg > seasonAvg + 8 ? 'up' : recentAvg < seasonAvg - 8 ? 'down' : 'flat'
    }

    const byOpponent: H2HOpponentRecord[] = [...(pairAcc.get(ownerId) ?? new Map()).entries()]
      .map(([opp, a]: [string, PairAcc]) => ({
        opponentOwnerId: opp,
        wins: a.wins,
        losses: a.losses,
        ties: a.ties,
        avgMargin:
          a.margins.length > 0
            ? Math.round((a.margins.reduce((x, y) => x + y, 0) / a.margins.length) * 10) / 10
            : 0,
        closest: a.closest,
      }))
      .sort((a, b) => b.wins + b.losses + b.ties - (a.wins + a.losses + a.ties))

    return {
      ownerId,
      name: m.name,
      avatar: m.avatar,
      teamName: m.teamName,
      games,
      avgPoints: Math.round(avg * 10) / 10,
      high: Math.round(high * 10) / 10,
      low: Math.round(low * 10) / 10,
      stdev: Math.round(Math.sqrt(variance) * 10) / 10,
      topHalfPct: games > 0 ? Math.round((topHalf / games) * 100) : 0,
      trend,
      byOpponent,
    }
  })
  managers.sort((a, b) => b.games - a.games || b.avgPoints - a.avgPoints)

  // ── Records book: all-time superlatives from every synced game/week ──
  const allWeekEntries: RecordWeek[] = []
  for (const s of syncs) {
    for (const [ownerId, weeks] of Object.entries(s.weekly)) {
      for (const w of weeks) {
        allWeekEntries.push({ ownerId, points: w.points, season: s.season, week: w.week })
      }
    }
  }
  const highestWeek = allWeekEntries.reduce<RecordWeek | null>(
    (best, e) => (best == null || e.points > best.points ? e : best),
    null,
  )
  const lowestWeek = allWeekEntries
    .filter((e) => e.points > 0)
    .reduce<RecordWeek | null>((worst, e) => (worst == null || e.points < worst.points ? e : worst), null)

  const decidedGames: RecordGame[] = []
  for (const s of syncs) {
    for (const g of s.games) {
      const margin = Math.abs(g.aPoints - g.bPoints)
      if (margin === 0) continue
      const aWon = g.aPoints > g.bPoints
      decidedGames.push({
        winnerOwnerId: aWon ? g.aOwnerId : g.bOwnerId,
        loserOwnerId: aWon ? g.bOwnerId : g.aOwnerId,
        margin: Math.round(margin * 10) / 10,
        season: g.season,
        week: g.week,
      })
    }
  }
  const biggestBlowout = decidedGames.reduce<RecordGame | null>(
    (best, g) => (best == null || g.margin > best.margin ? g : best),
    null,
  )
  const closestGame = decidedGames.reduce<RecordGame | null>(
    (best, g) => (best == null || g.margin < best.margin ? g : best),
    null,
  )

  // Streaks: chronological W/L runs per manager across the whole chain.
  type OwnerGame = { season: string; week: number; order: number; result: 'W' | 'L' | 'T' }
  const gamesByOwner = new Map<string, OwnerGame[]>()
  syncs.forEach((s, seasonIdx) => {
    for (const g of s.games) {
      const order = seasonIdx * 100 + g.week
      const push = (ownerId: string, result: 'W' | 'L' | 'T') => {
        const list = gamesByOwner.get(ownerId) ?? []
        list.push({ season: g.season, week: g.week, order, result })
        gamesByOwner.set(ownerId, list)
      }
      if (g.aPoints > g.bPoints) {
        push(g.aOwnerId, 'W')
        push(g.bOwnerId, 'L')
      } else if (g.aPoints < g.bPoints) {
        push(g.aOwnerId, 'L')
        push(g.bOwnerId, 'W')
      } else {
        push(g.aOwnerId, 'T')
        push(g.bOwnerId, 'T')
      }
    }
  })
  const bestStreak = (want: 'W' | 'L'): RecordStreak | null => {
    let best: RecordStreak | null = null
    for (const [ownerId, list] of gamesByOwner) {
      const sorted = [...list].sort((x, y) => x.order - y.order)
      let run: OwnerGame[] = []
      const consider = (endedAtEnd: boolean) => {
        if (run.length === 0) return
        if (best == null || run.length > best.length) {
          best = {
            ownerId,
            length: run.length,
            fromSeason: run[0].season,
            fromWeek: run[0].week,
            toSeason: run[run.length - 1].season,
            toWeek: run[run.length - 1].week,
            active: endedAtEnd,
          }
        }
      }
      for (const gm of sorted) {
        if (gm.result === want) run.push(gm)
        else {
          consider(false)
          run = []
        }
      }
      consider(true)
    }
    return best
  }
  const longestWinStreak = bestStreak('W')
  const longestLossStreak = bestStreak('L')

  let bestSeasonAvg: LeagueRecords['bestSeasonAvg'] = null
  for (const s of syncs) {
    for (const [ownerId, weeks] of Object.entries(s.weekly)) {
      if (weeks.length < 3) continue
      const avg = weeks.reduce((x, w) => x + w.points, 0) / weeks.length
      if (bestSeasonAvg == null || avg > bestSeasonAvg.avg) {
        bestSeasonAvg = { ownerId, season: s.season, avg: Math.round(avg * 10) / 10, games: weeks.length }
      }
    }
  }

  // ── Weekly awards: superlatives for the newest played week ──
  let latestWeekAwards: WeeklyAwards | null = null
  for (let i = syncs.length - 1; i >= 0 && !latestWeekAwards; i -= 1) {
    const s = syncs[i]
    const weeksPlayed = new Set(s.games.map((g) => g.week))
    if (weeksPlayed.size === 0) continue
    const week = Math.max(...weeksPlayed)
    const entries = allWeekEntries.filter((e) => e.season === s.season && e.week === week)
    const weekGames = decidedGames.filter((g) => g.season === s.season && g.week === week)
    latestWeekAwards = {
      season: s.season,
      week,
      topScore: entries.reduce<RecordWeek | null>(
        (best, e) => (best == null || e.points > best.points ? e : best),
        null,
      ),
      lowScore: entries.reduce<RecordWeek | null>(
        (worst, e) => (worst == null || e.points < worst.points ? e : worst),
        null,
      ),
      narrowEscape: weekGames.reduce<RecordGame | null>(
        (best, g) => (best == null || g.margin < best.margin ? g : best),
        null,
      ),
      biggestBlowout: weekGames.reduce<RecordGame | null>(
        (best, g) => (best == null || g.margin > best.margin ? g : best),
        null,
      ),
    }
  }

  return {
    seasons: syncs.map((s) => s.season),
    managers,
    totalGames,
    records: {
      highestWeek,
      lowestWeek,
      biggestBlowout,
      closestGame,
      longestWinStreak,
      longestLossStreak,
      bestSeasonAvg,
    },
    latestWeekAwards,
  }
}

export async function getLeagueH2H(sleeperLeagueId: string): Promise<LeagueH2HPayload | null> {
  const cacheKey = `${AGG_PREFIX}${sleeperLeagueId}`
  const now = new Date()
  const cached = await prisma.sportsDataCache.findUnique({ where: { cacheKey } }).catch(() => null)
  const cachedPayload =
    cached && cached.data && typeof cached.data === 'object'
      ? (cached.data as unknown as LeagueH2HPayload)
      : null
  if (cachedPayload?.version === 2 && cached && cached.expiresAt > now) return cachedPayload

  const missing: string[] = []
  const chain: WireLeague[] = []
  let cursor: string | null = sleeperLeagueId
  for (let i = 0; i < MAX_CHAIN && cursor; i += 1) {
    // Explicit annotation breaks a circular inference: `cursor` builds the URL
    // that yields `league`, and `league.previous_league_id` reassigns `cursor`.
    const league: WireLeague | null = await j<WireLeague>(`/league/${cursor}`)
    if (!league) {
      missing.push('part of the league chain')
      break
    }
    chain.unshift(league)
    cursor = league.previous_league_id ?? null
  }
  if (chain.length === 0) {
    return cachedPayload?.version === 2 && cached
      ? { ...cachedPayload, staleAsOf: cached.expiresAt.toISOString() }
      : null
  }

  const syncs: SeasonSync[] = []
  for (const league of chain) {
    const sync = await syncSeason(league)
    if (sync) syncs.push(sync)
    else missing.push(`${league.season}: matchups`)
  }

  const agg = aggregateH2HSeasons(syncs)

  const fresh: LeagueH2HPayload = {
    version: 2,
    fetchedAt: new Date().toISOString(),
    staleAsOf: null,
    sleeperLeagueId,
    source: 'sleeper',
    ...agg,
    missing,
  }
  await prisma.sportsDataCache
    .upsert({
      where: { cacheKey },
      update: { data: fresh as unknown as object, expiresAt: new Date(now.getTime() + AGG_TTL_MS) },
      create: { cacheKey, data: fresh as unknown as object, expiresAt: new Date(now.getTime() + AGG_TTL_MS) },
    })
    .catch(() => null)
  return fresh
}
