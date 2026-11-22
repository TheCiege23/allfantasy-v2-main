import type { FactorLevels, FactorObservation } from './factorLearner'
import type { GameContextLevels } from './gameContext'

/**
 * PAST GAMES AS FACTOR OBSERVATIONS (`factorLearner.ts`). PURE apart from the one read in `factorLearning.ts`.
 *
 * One stored game line per player per game, walked in time order, each turned into: his trailing average going in
 * (the baseline), what he scored, and the situation — measured only from what was known BEFORE that game:
 *
 *   rest         days since his previous game: back-to-back, short rest, long rest (NBA / NHL: 1 day = back-to-back;
 *                NFL: under 6 days = short week, over 9 = after a bye). MLB plays daily, so it has no rest factor.
 *   form         his last 3 games against his last 10: hot (25%+ above), cold (25%+ below).
 *   usage        playing time over his last 3 games against his last 10 — minutes (NBA), ice time (NHL), snaps (NFL):
 *                rising (15%+), falling (15%+). Sports without a stored playing-time line have no usage factor.
 *   opponent     what that opponent had allowed per player-game so far, against the league: soft (10%+ more), tough.
 *   team_change  his first five games for a team other than the one he played for before.
 *   returning    his first game back after missing a long stretch (two weeks in the NBA / NHL / MLB, three in the NFL).
 *
 * Points are the feed's own (`fantasyPoints`): every factor is a RATIO to his own trailing average, so a league that
 * scores differently shifts both sides of the ratio together.
 */

export type GameLine = {
  playerId: string
  /** One game (an MLB two-way line arrives as two rows of one game and is summed). */
  gameKey: string
  atMs: number
  team: string | null
  opponent: string | null
  points: number
  /** Playing time this game, when the feed carries it. */
  usage: number | null
  /** What was known about THIS game before kickoff — Vegas, weather, coaching (`gameContext.ts`). NFL for now. */
  context?: GameContextLevels
  /** Season and week, for joining that context (weekly sports). */
  season?: number
  week?: number
}

const DAY = 86_400_000
const TRAILING = 10
const RECENT = 3
const MIN_PRIOR_GAMES = 5
const MIN_OPPONENT_GAMES = 50

/** Playing time in a stored line: NBA minutes, NHL time on ice, NFL offensive snaps. Null when not carried. PURE. */
export function usageOf(sport: string, map: unknown): number | null {
  const m = map && typeof map === 'object' ? (map as Record<string, unknown>) : {}
  const stats = m.stats && typeof m.stats === 'object' ? (m.stats as Record<string, unknown>) : {}
  const pick = (...vals: unknown[]) => {
    for (const v of vals) {
      const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() ? Number(v) : NaN
      if (Number.isFinite(n) && n > 0) return n
    }
    return null
  }
  const s = sport.toUpperCase()
  if (s === 'NBA' || s === 'NCAAB') return pick(stats.minutes, m.minutes, m.min)
  if (s === 'NHL') return pick(stats.time_on_ice_minutes, m.time_on_ice_minutes)
  if (s === 'NFL') return pick(m.off_snp, stats.off_snp)
  return null
}

function restLevel(sport: string, days: number): string {
  if (sport === 'MLB' || sport === 'SOCCER') return 'normal'
  if (sport === 'NFL' || sport === 'NCAAF') return days < 6 ? 'short_rest' : days > 9 ? 'long_rest' : 'normal'
  if (days <= 1.5) return 'back_to_back'
  if (days >= 4) return 'long_rest'
  return 'normal'
}

const mean = (xs: number[]) => (xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : 0)

/** What was known about a player going into a game: his recent lines and the game ahead. */
export type Situation = { baseline: number; levels: FactorLevels }

/**
 * His situation going into the next game, from ONLY his past games (oldest first) and the game itself — the one rule
 * the learner and the live projection share, so a factor is applied exactly as it was measured. Null with fewer than
 * MIN_PRIOR_GAMES. `opponentRatio` is what that opponent allows per player-game over the league's, when known. PURE.
 */
export function situationOf(
  sport: string,
  past: readonly Pick<GameLine, 'atMs' | 'team' | 'points' | 'usage'>[],
  next: { atMs: number; team: string | null; context?: GameContextLevels },
  opponentRatio: number | null,
): Situation | null {
  if (past.length < MIN_PRIOR_GAMES) return null
  const s = sport.toUpperCase()
  const longGapDays = s === 'NFL' || s === 'NCAAF' ? 21 : 14
  const last10 = past.slice(-TRAILING)
  const last3 = past.slice(-RECENT)
  const baseline = mean(last10.map((x) => x.points))
  const levels: FactorLevels = {}
  const gapDays = (next.atMs - past[past.length - 1]!.atMs) / DAY

  levels.rest = restLevel(s, gapDays)
  levels.returning = gapDays >= longGapDays ? 'returning' : 'playing'

  const recent = mean(last3.map((x) => x.points))
  levels.form = baseline > 0 && recent >= baseline * 1.25 ? 'hot' : baseline > 0 && recent <= baseline * 0.75 ? 'cold' : 'steady'

  const u10 = last10.map((x) => x.usage).filter((x): x is number => x != null)
  const u3 = last3.map((x) => x.usage).filter((x): x is number => x != null)
  if (u10.length >= MIN_PRIOR_GAMES && u3.length === RECENT) {
    const r = mean(u3) / mean(u10)
    levels.usage = r >= 1.15 ? 'rising' : r <= 0.85 ? 'falling' : 'steady'
  }

  if (opponentRatio != null && Number.isFinite(opponentRatio)) {
    levels.opponent = opponentRatio >= 1.1 ? 'soft' : opponentRatio <= 0.9 ? 'tough' : 'average'
  }

  // A new team: his team now differs from the team of his game five back, and he has fewer than five games for it.
  if (next.team) {
    const withTeam = past.slice(-5).filter((x) => x.team === next.team).length
    const before = past[past.length - Math.min(past.length, 6)]
    levels.team_change = before?.team && before.team !== next.team && withTeam < 5 ? 'new_team' : 'same_team'
  }
  // The game's own context, as stored before kickoff — only the levels that were actually read.
  for (const [k, v] of Object.entries(next.context ?? {})) if (v) levels[k as keyof GameContextLevels] = v
  return { baseline, levels }
}

/** Sum the rows of one game (MLB two-way lines) and sort every game by time. PURE. */
export function gamesOf(lines: readonly GameLine[]): GameLine[] {
  const byGame = new Map<string, GameLine>()
  for (const l of lines) {
    const key = `${l.playerId}::${l.gameKey}`
    const prev = byGame.get(key)
    byGame.set(key, prev ? { ...prev, points: prev.points + l.points, usage: prev.usage ?? l.usage } : { ...l })
  }
  return [...byGame.values()].sort((a, b) => a.atMs - b.atMs)
}

/**
 * What each opponent allowed per player-game over the league's, over all the lines given — the state the live
 * projection reads (stored with the learned table). Teams under MIN_OPPONENT_GAMES are left out. PURE.
 */
export function opponentRatios(lines: readonly GameLine[]): Record<string, number> {
  const allowed = new Map<string, { sum: number; n: number }>()
  let sum = 0
  let n = 0
  for (const g of gamesOf(lines)) {
    sum += g.points
    n++
    if (!g.opponent) continue
    const a = allowed.get(g.opponent) ?? { sum: 0, n: 0 }
    a.sum += g.points
    a.n++
    allowed.set(g.opponent, a)
  }
  const out: Record<string, number> = {}
  if (!n) return out
  for (const [team, a] of allowed) if (a.n >= MIN_OPPONENT_GAMES) out[team] = Math.round((a.sum / a.n / (sum / n)) * 1000) / 1000
  return out
}

/** Turn a sport's game lines into observations, using only what was known before each game. PURE. */
export function buildFactorObservations(sport: string, lines: readonly GameLine[]): FactorObservation[] {
  const games = gamesOf(lines)
  const history = new Map<string, GameLine[]>()
  const allowed = new Map<string, { sum: number; n: number }>()
  const league = { sum: 0, n: 0 }
  const out: FactorObservation[] = []

  for (const g of games) {
    const past = history.get(g.playerId) ?? []
    const opp = g.opponent ? allowed.get(g.opponent) : undefined
    const ratio = opp && opp.n >= MIN_OPPONENT_GAMES && league.n > 0 ? opp.sum / opp.n / (league.sum / league.n) : null
    const sit = situationOf(sport, past, { atMs: g.atMs, team: g.team, context: g.context }, ratio)
    if (sit) out.push({ baseline: sit.baseline, actual: g.points, levels: sit.levels, atMs: g.atMs })
    // Only now does this game become history — nothing about it was known before it was played.
    past.push(g)
    history.set(g.playerId, past)
    if (g.opponent) {
      const a = allowed.get(g.opponent) ?? { sum: 0, n: 0 }
      a.sum += g.points
      a.n++
      allowed.set(g.opponent, a)
    }
    league.sum += g.points
    league.n++
  }
  return out
}
