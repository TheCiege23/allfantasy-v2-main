/**
 * Replays every head-to-head game through Glicko-2 — the pure half of the
 * per-game skill rating. `loadRatedGames.ts` reads the games; this turns them
 * into ratings and a per-game log. No prisma, so it is unit-tested directly.
 *
 * ── ONE RATING PER SPORT ─────────────────────────────────────────────────────
 * Beating people at fantasy football says little about fantasy baseball, and
 * the two calendars do not line up, so each sport is replayed on its own.
 *
 * ── RATING PERIODS ───────────────────────────────────────────────────────────
 * A period is one (season, week) in that sport, shared across every league:
 * week 6 of 2025 is one period for everyone. Within a period all games use the
 * ratings as they stood at its start — Glicko-2's simultaneous update — so the
 * order leagues happen to be read in cannot change anyone's number.
 *
 * The gap between two periods is measured on `season * WEEKS_PER_SEASON_SLOT +
 * week`, so an offseason counts as the idle weeks it is: a manager coming back
 * in September is less certain than one who played last Sunday.
 */

import {
  GLICKO_DEFAULT_RD,
  conservativeRating,
  decay,
  newRating,
  ratePeriod,
  type GameScore,
  type GlickoRating,
  type PeriodResult,
} from '@/lib/rank/skillRating/glicko2'

/** Slots reserved per season when measuring idle periods. Longer than any fantasy season. */
export const WEEKS_PER_SEASON_SLOT = 40

export type RatedGame = {
  sport: string
  season: number
  week: number
  /** Provider league id (or our League.id when there is none) — for the game log only. */
  leagueKey: string
  leagueName: string | null
  /** Manager keys: `af:<userId>` for an AllFantasy user, otherwise a platform or slot key. */
  a: string
  b: string
  aName: string | null
  bName: string | null
  scoreA: number
  scoreB: number
}

export type GameLogEntry = {
  season: number
  week: number
  leagueKey: string
  leagueName: string | null
  opponent: string
  opponentName: string | null
  /** Opponent's rating going into the game. */
  opponentRating: number
  myScore: number
  oppScore: number
  result: 'W' | 'L' | 'T'
  /** Rating going into the week this game was in. */
  ratingBefore: number
  /** Rating after that week — shared by every game the manager played that week. */
  ratingAfter: number
  /** Probability the system gave this manager of winning, before the game. */
  expected: number
}

export type ManagerSkill = GlickoRating & {
  key: string
  name: string | null
  games: number
  wins: number
  losses: number
  ties: number
  /** Ordinal of the last period played — for idle decay at read time. */
  lastPeriod: number
  /** Rating minus two deviations: what ordering and classes use. */
  conservative: number
}

export type SportReplay = {
  sport: string
  managers: Map<string, ManagerSkill>
  /** Game log per manager, oldest first. Only kept for keys `keepLogFor` accepts. */
  logs: Map<string, GameLogEntry[]>
  games: number
  periods: number
  latestPeriod: number
}

export function periodOrdinal(season: number, week: number): number {
  return season * WEEKS_PER_SEASON_SLOT + week
}

function scoreOf(mine: number, theirs: number): GameScore {
  return mine > theirs ? 1 : mine < theirs ? 0 : 0.5
}

function resultOf(score: GameScore): 'W' | 'L' | 'T' {
  return score === 1 ? 'W' : score === 0 ? 'L' : 'T'
}

function winProb(me: GlickoRating, opp: GlickoRating): number {
  // Same expectation Glicko-2 itself uses: the opponent's deviation only.
  const q = Math.log(10) / 400
  const g = 1 / Math.sqrt(1 + (3 * q * q * opp.rd * opp.rd) / (Math.PI * Math.PI))
  return 1 / (1 + 10 ** ((-g * (me.rating - opp.rating)) / 400))
}

/**
 * Replays one sport's games. Games with the same manager on both sides, or a
 * blank key, are skipped — they cannot say anything about skill.
 */
export function replaySport(
  sport: string,
  games: RatedGame[],
  keepLogFor: (key: string) => boolean = () => false,
): SportReplay {
  const periods = new Map<number, RatedGame[]>()
  let counted = 0
  for (const g of games) {
    if (!g.a || !g.b || g.a === g.b) continue
    const p = periodOrdinal(g.season, g.week)
    const list = periods.get(p)
    if (list) list.push(g)
    else periods.set(p, [g])
    counted += 1
  }

  const managers = new Map<string, ManagerSkill>()
  const logs = new Map<string, GameLogEntry[]>()
  const ensure = (key: string, name: string | null): ManagerSkill => {
    const held = managers.get(key)
    if (held) {
      if (!held.name && name) held.name = name
      return held
    }
    const fresh: ManagerSkill = {
      key,
      name,
      ...newRating(),
      games: 0,
      wins: 0,
      losses: 0,
      ties: 0,
      lastPeriod: -1,
      conservative: 0,
    }
    managers.set(key, fresh)
    return fresh
  }

  const ordered = [...periods.keys()].sort((x, y) => x - y)
  for (const period of ordered) {
    const list = periods.get(period)!

    // Ratings at the start of the period, after idle decay since each manager last played.
    const start = new Map<string, GlickoRating>()
    const startOf = (key: string, name: string | null): GlickoRating => {
      const held = start.get(key)
      if (held) return held
      const m = ensure(key, name)
      const idle = m.lastPeriod < 0 ? 0 : period - m.lastPeriod - 1
      const r = decay({ rating: m.rating, rd: m.rd, volatility: m.volatility }, idle)
      start.set(key, r)
      return r
    }

    const results = new Map<string, PeriodResult[]>()
    const pending: Array<{ key: string; entry: Omit<GameLogEntry, 'ratingAfter'> }> = []
    const push = (key: string, r: PeriodResult) => {
      const list2 = results.get(key)
      if (list2) list2.push(r)
      else results.set(key, [r])
    }

    for (const g of list) {
      const ra = startOf(g.a, g.aName)
      const rb = startOf(g.b, g.bName)
      const sa = scoreOf(g.scoreA, g.scoreB)
      const sb = scoreOf(g.scoreB, g.scoreA)
      push(g.a, { opponent: rb, score: sa })
      push(g.b, { opponent: ra, score: sb })

      for (const side of [
        { key: g.a, me: ra, opp: rb, oppKey: g.b, oppName: g.bName, mine: g.scoreA, theirs: g.scoreB, s: sa },
        { key: g.b, me: rb, opp: ra, oppKey: g.a, oppName: g.aName, mine: g.scoreB, theirs: g.scoreA, s: sb },
      ]) {
        if (!keepLogFor(side.key)) continue
        pending.push({
          key: side.key,
          entry: {
            season: g.season,
            week: g.week,
            leagueKey: g.leagueKey,
            leagueName: g.leagueName,
            opponent: side.oppKey,
            opponentName: side.oppName,
            opponentRating: Math.round(side.opp.rating),
            myScore: side.mine,
            oppScore: side.theirs,
            result: resultOf(side.s),
            ratingBefore: Math.round(side.me.rating),
            expected: Math.round(winProb(side.me, side.opp) * 1000) / 1000,
          },
        })
      }
    }

    // Simultaneous update: every manager who played this period, from the start ratings.
    for (const [key, res] of results) {
      const before = start.get(key)!
      const after = ratePeriod(before, res)
      const m = managers.get(key)!
      m.rating = after.rating
      m.rd = after.rd
      m.volatility = after.volatility
      m.lastPeriod = period
      for (const r of res) {
        m.games += 1
        if (r.score === 1) m.wins += 1
        else if (r.score === 0) m.losses += 1
        else m.ties += 1
      }
    }

    for (const p of pending) {
      const m = managers.get(p.key)!
      const entry: GameLogEntry = { ...p.entry, ratingAfter: Math.round(m.rating) }
      const list3 = logs.get(p.key)
      if (list3) list3.push(entry)
      else logs.set(p.key, [entry])
    }
  }

  for (const m of managers.values()) m.conservative = conservativeRating(m)

  return {
    sport,
    managers,
    logs,
    games: counted,
    periods: ordered.length,
    latestPeriod: ordered.length ? ordered[ordered.length - 1] : -1,
  }
}

/** Replays every sport present in `games`. */
export function replayAll(
  games: RatedGame[],
  keepLogFor: (key: string) => boolean = () => false,
): Map<string, SportReplay> {
  const bySport = new Map<string, RatedGame[]>()
  for (const g of games) {
    const list = bySport.get(g.sport)
    if (list) list.push(g)
    else bySport.set(g.sport, [g])
  }
  const out = new Map<string, SportReplay>()
  for (const [sport, list] of bySport) out.set(sport, replaySport(sport, list, keepLogFor))
  return out
}

/**
 * A manager's rating as of `asOfPeriod`, with idle decay applied — what a
 * reader shows today for someone whose last game was weeks ago.
 */
export function currentSkill(m: ManagerSkill, asOfPeriod: number): ManagerSkill {
  const idle = m.lastPeriod < 0 ? 0 : Math.max(0, asOfPeriod - m.lastPeriod)
  const r = decay(m, idle)
  return { ...m, rd: Math.min(GLICKO_DEFAULT_RD, r.rd), conservative: conservativeRating(r) }
}
