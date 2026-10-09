import type { LeagueImpact } from './playerImpact'
import type { SeasonWeek } from './playerSeason'

/**
 * The Player Finder's "make it fun" layer (Guap, 2026-10-08, item #5) — pure, client-safe, and
 * built only from numbers the card already holds:
 *
 *   - EXPOSURE: how much of your fantasy life rides on him — "in 4 of your 65 leagues, 6%" — with a
 *     tier you can brag or worry about.
 *   - FORM: his last few games against his own season, as a sparkline and a 🔥 / 🧊 call.
 *   - COIN FLIPS: the leagues where starting him (or sitting him) is within a few points either way,
 *     framed as "who do you start?" — you pick, then AllFantasy shows its lean.
 *
 * ⚠ None of these invent a number. A tier is a ratio of two counts the header already prints; a form
 * call needs MIN_FORM_GAMES real games; a coin flip needs both sides priced under that league's own
 * scoring (playerImpact.ts). Missing data means the piece does not render, never a guess.
 */

// ── Exposure ─────────────────────────────────────────────────────────────────────────────────────
export type ExposureTier = 'core' | 'big' | 'piece' | 'sprinkle'

export type Exposure = { leagues: number; of: number; pct: number; tier: ExposureTier }

/** Null when you have him nowhere, or when the denominator is unknown. */
export function exposureOf(leagues: number, of: number): Exposure | null {
  if (leagues <= 0 || of <= 0) return null
  const share = leagues / of
  const pct = Math.max(1, Math.round(share * 100))
  const tier: ExposureTier = share >= 0.4 ? 'core' : share >= 0.2 ? 'big' : share >= 0.08 ? 'piece' : 'sprinkle'
  return { leagues, of, pct, tier }
}

// ── Form ─────────────────────────────────────────────────────────────────────────────────────────
/** Real games needed before a hot/cold call is made. */
export const MIN_FORM_GAMES = 3
/** Games the sparkline shows, newest last. */
export const SPARK_GAMES = 6
/** Recent average this far above / below the season average is hot / cold. */
export const FORM_BAND = 0.2

export type Form = {
  /** Points per game, oldest first — the sparkline. */
  points: number[]
  /** The last three games' average. */
  recent: number
  season: number
  call: 'hot' | 'cold' | 'steady'
}

export function formOf(weeks: readonly SeasonWeek[]): Form | null {
  const played = weeks
    .filter((w) => w.played && typeof w.actual === 'number' && Number.isFinite(w.actual))
    .sort((a, b) => a.week - b.week)
    .map((w) => w.actual as number)
  if (played.length < MIN_FORM_GAMES) return null
  const season = played.reduce((s, n) => s + n, 0) / played.length
  const last3 = played.slice(-3)
  const recent = last3.reduce((s, n) => s + n, 0) / last3.length
  // A season average near zero cannot anchor a ratio; call it steady rather than divide by nothing.
  const call: Form['call'] = season < 1 ? 'steady' : recent >= season * (1 + FORM_BAND) ? 'hot' : recent <= season * (1 - FORM_BAND) ? 'cold' : 'steady'
  const round1 = (n: number) => Math.round(n * 10) / 10
  return { points: played.slice(-SPARK_GAMES), recent: round1(recent), season: round1(season), call }
}

/** SVG polyline points for the sparkline in a w×h box; a flat line sits mid-height. */
export function sparkPath(points: readonly number[], w: number, h: number, pad = 2): string {
  if (points.length === 0) return ''
  const max = Math.max(...points)
  const min = Math.min(...points)
  const span = max - min
  const step = points.length > 1 ? (w - pad * 2) / (points.length - 1) : 0
  return points
    .map((p, i) => {
      const x = pad + i * step
      const y = span === 0 ? h / 2 : pad + (1 - (p - min) / span) * (h - pad * 2)
      return `${x.toFixed(1)},${y.toFixed(1)}`
    })
    .join(' ')
}

// ── Coin flips ───────────────────────────────────────────────────────────────────────────────────
/** Within this many points (league scoring), start-or-sit is a coin flip. */
export const COIN_FLIP_POINTS = 3
export const MAX_COIN_FLIPS = 3

export type CoinFlip = {
  leagueId: string
  leagueName: string
  /** Him. */
  a: { name: string; points: number }
  /** The other name in the decision: the bench player who could replace him, or the starter he could replace. */
  b: { name: string; points: number }
  /** True when he is the one starting now. */
  aStarting: boolean
  /** Who AllFantasy's numbers favour, and by how much. */
  lean: 'a' | 'b'
  margin: number
}

const round1 = (n: number) => Math.round(n * 10) / 10

/**
 * The leagues where his start/sit call is close. Best ball is the caller's to exclude (no lineup to
 * set); a league without both sides priced is skipped. Closest first, at most MAX_COIN_FLIPS.
 */
export function coinFlipsOf(impacts: readonly LeagueImpact[], playerName: string): CoinFlip[] {
  const out: CoinFlip[] = []
  for (const i of impacts) {
    if (!i.afPoints.available) continue
    const mine = i.afPoints.data.points
    if (i.isStarting) {
      if (!i.replacements.available) continue
      const best = i.replacements.data
        .filter((r) => r.afPoints != null && r.delta != null && !/^(out|ir|doubtful|suspended)$/i.test(r.injuryStatus ?? ''))
        .sort((x, y) => (y.delta as number) - (x.delta as number))[0]
      if (!best || Math.abs(best.delta as number) > COIN_FLIP_POINTS) continue
      out.push({
        leagueId: i.leagueId,
        leagueName: i.leagueName,
        a: { name: playerName, points: round1(mine) },
        b: { name: best.name, points: round1(best.afPoints as number) },
        aStarting: true,
        lean: (best.delta as number) > 0 ? 'b' : 'a',
        margin: round1(Math.abs(best.delta as number)),
      })
    } else if (i.startOver && Math.abs(i.startOver.delta) <= COIN_FLIP_POINTS) {
      out.push({
        leagueId: i.leagueId,
        leagueName: i.leagueName,
        a: { name: playerName, points: round1(mine) },
        b: { name: i.startOver.name, points: round1(i.startOver.afPoints) },
        aStarting: false,
        lean: i.startOver.delta > 0 ? 'a' : 'b',
        margin: round1(Math.abs(i.startOver.delta)),
      })
    }
  }
  return out.sort((x, y) => x.margin - y.margin).slice(0, MAX_COIN_FLIPS)
}
