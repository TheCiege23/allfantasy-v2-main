/**
 * Puts an MLB projection board on ONE scale — per TEAM game — before anything is compared. PURE.
 *
 * MLB projection rates are per APPEARANCE (`lib/af-projections/core.ts` `mlbPerGameRates`): a hitter's
 * line is per game he played, but a starter's is per START, about one team game in five, and a reliever's
 * per outing. Every other daily sport multiplies a per-game value by the team games left, which for a
 * starter would count him five times over. So each pitcher's line is scaled to his share of team games —
 * the appearances behind his projection over the team games in that season — and from then on he is
 * compared, replaced and multiplied exactly like everyone else.
 *
 * Hitters are NOT scaled, the same as a basketball or hockey player: the grade values a healthy season,
 * and a hitter who missed time is not projected to miss it again. A pitcher's share is different in kind —
 * it is his ROLE (a starter takes every fifth turn), not his health.
 *
 * Two more things the board needs, both read from the line itself rather than guessed:
 *   - ROLE. The projection files every pitcher as `P`, and no lineup slot takes a `P`: a starter fills SP,
 *     a reliever RP. A pitcher averaging three or more innings an appearance is a starter.
 *   - GROUP. In a category league hitters are measured against hitters and pitchers against pitchers —
 *     a pitcher's zero home runs would otherwise drag the hitting average down and make every hitter look
 *     better than he is. A two-way player (at-bats AND innings) is in both.
 */

import type { CategoryDefinition } from '@/lib/category-scoring/types'

/** MLB's regular season, for a season whose schedule is not posted yet (the offseason). */
export const MLB_REGULAR_SEASON_GAMES = 162

/** Innings an appearance at or above which a pitcher is a starter. */
export const STARTER_INNINGS_PER_APPEARANCE = 3

/*
 * Who bats and who pitches, per appearance — never "any at-bat at all". A starter who batted twice in
 * interleague play would otherwise count as a hitter, keep a share of 1 and be worth five times his
 * season; a position player who mopped up one inning would join the pitching pool. Measured lines sit far
 * from both bars: everyday hitters ~3.5 AB a game, pitchers ~0; a reliever ~3 outs an outing, a starter
 * ~16, Ohtani 0.9 over his 158 games, a mop-up position player ~0.02.
 */
const HITTER_AB_PER_APPEARANCE = 0.5
const PITCHER_OUTS_PER_APPEARANCE = 0.5

/*
 * The sample a baseball projection needs before it is a price — at-bats or innings, never games. Ten games
 * is the bar the other sports share, and in baseball it is a hot weekend: measured 2026-10-09, a call-up
 * with 11 games and 31 at-bats ranked among the five best hitters on the board. A two-way player needs
 * either one.
 */
export const MIN_AT_BATS = 100
export const MIN_INNINGS = 30

/** Engine stat keys that only a pitcher records (the `p_` keys, pitcher strikeouts `so`, …). */
export const MLB_PITCHING_STAT_KEYS: ReadonlySet<string> = new Set([
  'ip', 'outs', 'so', 'w', 'l', 'sv', 'hld', 'bs', 'er', 'qs', 'wp', 'bk', 'p_r', 'p_h', 'p_hr', 'p_bb', 'p_hbp',
])

export type MlbLine = {
  id: string
  position: string
  /** Appearances behind the projection (its own confidence reasons). */
  sampleGames: number | null
  sourceSeason?: number | null
  /** Per-APPEARANCE stat line in the engine's keys. */
  stats: Record<string, number>
}

export type MlbTeamGameLine<T extends MlbLine> = T & {
  /** Per-TEAM-game stat line. */
  stats: Record<string, number>
  /** SP or RP for a pure pitcher, OF for any outfielder, DH for a two-way player; otherwise as filed. */
  position: string
  hitter: boolean
  pitcher: boolean
  /** Share of team games this line counts for (1 for anyone who bats). */
  share: number
  /** At-bats or innings behind the projection, against `MIN_AT_BATS` / `MIN_INNINGS`. Absent when unknown. */
  sampleBar?: { ok: boolean; has: string; needs: string }
}

function sampleBarFor(l: MlbLine, hitter: boolean): MlbTeamGameLine<MlbLine>['sampleBar'] {
  if (l.sampleGames == null) return undefined
  const atBats = Math.round((l.stats.ab ?? 0) * l.sampleGames)
  const innings = Math.round((l.stats.ip ?? 0) * l.sampleGames * 10) / 10
  return {
    ok: atBats >= MIN_AT_BATS || innings >= MIN_INNINGS,
    has: hitter ? `${atBats} at-bat${atBats === 1 ? '' : 's'}` : `${innings} inning${innings === 1 ? '' : 's'}`,
    needs: `${MIN_AT_BATS} at-bats or ${MIN_INNINGS} innings`,
  }
}

/**
 * Every line on the team-game scale, or dropped when it cannot be put there: a line with neither at-bats
 * nor innings has nothing to value, and a pitcher whose appearances are unknown has no share — scaling him
 * by a guess would be off by as much as the five-fold error this exists to prevent.
 */
export function toTeamGameLines<T extends MlbLine>(lines: readonly T[]): Array<MlbTeamGameLine<T>> {
  // Team games in a season, read off the board: the most games any hitter played that season. Complete
  // seasons read ~162; a season in progress reads how far it has got, which a constant could not.
  const teamGames = new Map<number | null, number>()
  for (const l of lines) {
    if (!bats(l) || l.sampleGames == null) continue
    const key = l.sourceSeason ?? null
    teamGames.set(key, Math.max(teamGames.get(key) ?? 0, l.sampleGames))
  }

  const out: Array<MlbTeamGameLine<T>> = []
  for (const l of lines) {
    const hitter = bats(l)
    const pitcher = (l.stats.outs ?? 0) >= PITCHER_OUTS_PER_APPEARANCE
    if (!hitter && !pitcher) continue
    const sampleBar = sampleBarFor(l, hitter)
    if (hitter) {
      /*
       * A two-way player is filed TWP, which no lineup slot names and no free agent shares, so he had no
       * replacement level at all. He bats every day: his lineup home is the utility slot, as a DH.
       */
      const position = hitterPosition(l.position)
      out.push({ ...l, stats: { ...l.stats }, position, hitter, pitcher, share: 1, ...(sampleBar ? { sampleBar } : {}) })
      continue
    }
    const season = teamGames.get(l.sourceSeason ?? null) ?? MLB_REGULAR_SEASON_GAMES
    if (l.sampleGames == null || l.sampleGames <= 0 || season <= 0) continue
    const share = Math.min(1, l.sampleGames / season)
    const stats: Record<string, number> = {}
    for (const [k, v] of Object.entries(l.stats)) stats[k] = v * share
    const role = (l.stats.ip ?? 0) >= STARTER_INNINGS_PER_APPEARANCE ? 'SP' : 'RP'
    const filed = l.position.trim().toUpperCase()
    out.push({ ...l, stats, position: filed === 'SP' || filed === 'RP' ? filed : role, hitter, pitcher, share, ...(sampleBar ? { sampleBar } : {}) })
  }
  return out
}

/*
 * Where a hitter is replaced from. Every MLB outfield slot takes LF, CF, RF and OF alike, so they are one
 * position: filed apart, the 28 players filed plain "OF" formed their own waiver wire, whose best free agent
 * sat a third below the LF/CF/RF ones (measured 2026-10-09) and inflated every one of them.
 */
function hitterPosition(filed: string): string {
  const pos = filed.trim().toUpperCase()
  if (pos === 'TWP') return 'DH'
  if (pos === 'LF' || pos === 'CF' || pos === 'RF') return 'OF'
  return pos
}

function bats(l: MlbLine): boolean {
  return (l.stats.ab ?? 0) >= HITTER_AB_PER_APPEARANCE
}

/** Whether a category is won by pitchers (W, SV, K, ERA, WHIP, holds) rather than hitters. */
export function isPitchingCategory(category: CategoryDefinition): boolean {
  const c = category.computation
  const keys = c.kind === 'sum' ? [c.statKey] : [c.numeratorStatKey, c.denominatorStatKey, ...(c.additionalNumeratorStatKeys ?? [])]
  return keys.some((k) => MLB_PITCHING_STAT_KEYS.has(k))
}

/** Whether a lineup slot holds pitchers only. */
export function isPitchingSlot(eligible: readonly string[]): boolean {
  return eligible.length > 0 && eligible.every((p) => ['SP', 'RP', 'P'].includes(p.trim().toUpperCase()))
}
