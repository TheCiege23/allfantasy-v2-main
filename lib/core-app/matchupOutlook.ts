/**
 * How hard his next games are: for each upcoming opponent, what that defense has allowed to his
 * position this season, ranked among every defense — shown beside the finder's upcoming weeks.
 *
 * Pure, client-safe. The loader is matchupOutlookLoader.ts.
 *
 * ⚠ RANKS, NOT POINTS. The allowed number is every player at the position summed per game (all the
 * WRs who faced that defense that week), so it is a statement about the DEFENSE, not a projection for
 * him; turning it into "+2.1 points for him" would be inventing a model. A rank among the 32 defenses
 * is the honest unit, and it is the unit managers already read DvP in.
 *
 * ⚠ THIRDS, NOT A TUNED THRESHOLD. Soft is the third of defenses that allow the most, tough the
 * third that allow the least. No constant to calibrate, and it cannot drift as scoring shifts.
 *
 * ⚠ AND THE SAMPLE IS ALWAYS SHOWN. Measured 2026-09-28 after three weeks: every defense had faced
 * each position 2–3 times, and TE points allowed ranged from 5.1 to 33.4 a game. That is an early,
 * noisy read, and the card says how many games it rests on rather than letting a rank look settled.
 */

export const MATCHUP_POSITIONS = ['QB', 'RB', 'WR', 'TE'] as const
/** Fewer defenses than this with data at the position and the ranking is not shown at all. */
export const MIN_DEFENSES_RANKED = 24
/** Below this many games per defense the footer calls the read early. */
export const SETTLED_GAMES = 5

export type DefenseCell = { defense: string; position: string; games: number; allowedPerGame: number }

export type MatchupTier = 'soft' | 'neutral' | 'tough'

export type MatchupRead = {
  week: number
  opponent: string
  tier: MatchupTier
  /** 1 = allows the most to the position (softest). */
  rank: number
  of: number
  allowedPerGame: number
  games: number
}

export type MatchupOutlook = {
  position: string
  season: number
  leagueAverage: number
  /** The fewest games any ranked defense has played — the sample the whole ranking rests on. */
  minGames: number
  /** Week → read. Weeks with a bye or an opponent we cannot rank are absent. */
  reads: Record<number, MatchupRead>
}

type Week = { week: number; opponent: string | null; bye: boolean }

export function ordinal(n: number): string {
  const s = n % 100
  if (s >= 11 && s <= 13) return `${n}th`
  return `${n}${n % 10 === 1 ? 'st' : n % 10 === 2 ? 'nd' : n % 10 === 3 ? 'rd' : 'th'}`
}

export function buildMatchupOutlook(args: {
  position: string
  season: number
  weeks: readonly Week[]
  cells: readonly DefenseCell[]
  /** Folds a club code to its canonical token; the schedule and the stats table spell some differently. */
  fold: (code: string) => string | null
}): MatchupOutlook | null {
  const position = args.position.toUpperCase()
  if (!(MATCHUP_POSITIONS as readonly string[]).includes(position)) return null
  const ranked = args.cells
    .filter((c) => c.position === position && c.games > 0 && Number.isFinite(c.allowedPerGame))
    .sort((a, b) => b.allowedPerGame - a.allowedPerGame || a.defense.localeCompare(b.defense))
  if (ranked.length < MIN_DEFENSES_RANKED) return null

  const of = ranked.length
  const third = Math.ceil(of / 3)
  const byDefense = new Map(ranked.map((c, i) => [c.defense, { cell: c, rank: i + 1 }]))
  const reads: Record<number, MatchupRead> = {}
  for (const w of args.weeks) {
    if (w.bye || !w.opponent) continue
    const code = args.fold(w.opponent)
    const hit = code ? byDefense.get(code) : undefined
    if (!hit) continue
    const tier: MatchupTier = hit.rank <= third ? 'soft' : hit.rank > of - third ? 'tough' : 'neutral'
    reads[w.week] = { week: w.week, opponent: code!, tier, rank: hit.rank, of, allowedPerGame: hit.cell.allowedPerGame, games: hit.cell.games }
  }
  return {
    position,
    season: args.season,
    leagueAverage: ranked.reduce((s, c) => s + c.allowedPerGame, 0) / of,
    minGames: Math.min(...ranked.map((c) => c.games)),
    reads,
  }
}

/** "3rd-softest vs WRs" / "8th-toughest vs WRs" / "middle of the pack vs WRs". */
export function rankPhrase(r: MatchupRead, position: string): string {
  const pos = `${position}s`
  const nth = (n: number, word: string) => (n === 1 ? `the ${word}` : `${ordinal(n)}-${word}`)
  if (r.tier === 'soft') return `${nth(r.rank, 'softest')} vs ${pos}`
  if (r.tier === 'tough') return `${nth(r.of - r.rank + 1, 'toughest')} vs ${pos}`
  return `middle of the pack vs ${pos}`
}
