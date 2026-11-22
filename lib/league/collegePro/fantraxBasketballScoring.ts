/**
 * A Fantrax basketball league's OWN scoring, applied to a Rolling Insights box line.
 *
 * Why not the shared scorer: the import keeps only the categories the native NBA/NCAAB configs
 * define (points, rebounds, assists, steals, blocks, turnovers), and records the rest as
 * `fantrax_settings.scoringGaps`. Road To Glory NCAA Basketball scores 18 categories — free throws
 * made and missed, minutes, fouls, threes, double- and triple-doubles among them — so the shared
 * scorer was off by those every game. The RI box carries every one of those counts, so they are
 * read straight from the stored line (`normalized_stat_map.stats`, RI's own field names).
 *
 * Read from `fantrax_settings.scoringSystem.scoringCategories.PLAYER`, the short-code map Fantrax
 * returns for every basketball league (`{ FTM: { Default: 'points1' } }`). The longer
 * `scoringCategorySettings` list is not present on every league (Road To Glory NBA has none).
 *
 * Pure: no prisma, so it can be tested on the stored settings directly.
 */

/** Categories ≥ 10 that make a double-double: points, rebounds, assists, steals, blocks. */
const DOUBLE_STATS = ['points', 'total_rebounds', 'assists', 'steals', 'blocks'] as const

const num = (v: unknown): number => {
  const n = typeof v === 'number' ? v : typeof v === 'string' ? Number(v) : NaN
  return Number.isFinite(n) ? n : 0
}

/** Fantrax short code → how to read it off one RI box line. */
const READERS: Readonly<Record<string, (s: Record<string, unknown>) => number>> = {
  PTS: (s) => num(s.points),
  REB: (s) => num(s.total_rebounds),
  OREB: (s) => num(s.offensive_rebounds),
  DREB: (s) => num(s.defensive_rebounds),
  AST: (s) => num(s.assists),
  ST: (s) => num(s.steals),
  BLK: (s) => num(s.blocks),
  TO: (s) => num(s.turnovers),
  PF: (s) => num(s.fouls),
  MIN: (s) => num(s.minutes),
  FGM: (s) => num(s.field_goals_made),
  'FG-': (s) => num(s.field_goals_attempted) - num(s.field_goals_made),
  FTM: (s) => num(s.free_throws_made),
  'FT-': (s) => num(s.free_throws_attempted) - num(s.free_throws_made),
  '2PTM': (s) => num(s.two_points_made),
  '2PT-': (s) => num(s.two_points_attempted) - num(s.two_points_made),
  '3PTM': (s) => num(s.three_points_made),
  '3PT-': (s) => num(s.three_points_attempted) - num(s.three_points_made),
  // Fantrax's NCAAB category is "DOUBLE_DOUBLES_PLUS_TRIPLE_DOUBLES": a triple-double also counts here.
  '2D': (s) => (doubles(s) >= 2 ? 1 : 0),
  '3D': (s) => (doubles(s) >= 3 ? 1 : 0),
  '4D': (s) => (doubles(s) >= 4 ? 1 : 0),
}

function doubles(s: Record<string, unknown>): number {
  return DOUBLE_STATS.filter((k) => num(s[k]) >= 10).length
}

/** What Fantrax scores that a box line cannot show, in words for the page. */
const UNSCORABLE_LABELS: Readonly<Record<string, string>> = {
  W: 'wins', L: 'losses', EJ: 'ejections', FF: 'flagrant fouls', TF: 'technical fouls',
  GWBB: 'buzzer-beaters', PFD: 'fouls drawn',
}

export type FantraxBasketballScoring = {
  weights: Record<string, number>
  /** Categories the league scores that no box line carries, as words ("wins", "ejections"). */
  unscored: string[]
}

/** "points1.5" / "points-1" → number; anything else → null. */
function parsePoints(v: unknown): number | null {
  const m = typeof v === 'string' ? /^points(-?\d+(?:\.\d+)?)$/.exec(v.trim()) : null
  return m ? Number(m[1]) : null
}

/**
 * The league's basketball scoring, or null when the league is not a Fantrax points league with a
 * readable category map — callers then fall back to the shared scorer.
 */
export function readFantraxBasketballScoring(settings: unknown): FantraxBasketballScoring | null {
  const root = settings && typeof settings === 'object' ? (settings as Record<string, unknown>) : null
  const fantrax = root?.fantrax_settings as { scoringSystem?: { type?: unknown; scoringCategories?: { PLAYER?: unknown } } } | undefined
  const system = fantrax?.scoringSystem
  if (!system || String(system.type ?? '') !== 'HEAD_TO_HEAD_POINTS_BASED') return null
  const player = system.scoringCategories?.PLAYER
  if (!player || typeof player !== 'object') return null
  const weights: Record<string, number> = {}
  const unscored: string[] = []
  for (const [code, byPosition] of Object.entries(player as Record<string, unknown>)) {
    const value = parsePoints((byPosition as Record<string, unknown> | null)?.Default)
    if (value == null || value === 0) continue
    if (READERS[code]) weights[code] = value
    else unscored.push(UNSCORABLE_LABELS[code] ?? code)
  }
  return Object.keys(weights).length ? { weights, unscored } : null
}

/** One game's points under the league's scoring. */
export function scoreFantraxBasketballGame(stats: Record<string, unknown>, scoring: FantraxBasketballScoring): number {
  let total = 0
  for (const [code, weight] of Object.entries(scoring.weights)) total += READERS[code]!(stats) * weight
  return total
}
