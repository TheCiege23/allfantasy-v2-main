/**
 * One Rolling Insights MLB box line -> the engine's MLB category keys (lib/sportConfig/configs/mlb.ts).
 *
 * The scheduled multi-sport ingest (`rollingInsightsGameLogs.ts`) writes one `player_game_stats` row
 * per player per game PER GROUP — `gameId:batting` and `gameId:pitching` — with
 * `normalizedStatMap = { group, stats: { <vendor field>: number }, … }`. Field names are the vendor's
 * (contracts/rolling-insights/ENDPOINTS.yaml -> MLB live `batting` / `pitching`).
 *
 * 🛑 THE TWO GROUPS SHARE FIELD NAMES AND MEAN OPPOSITE THINGS. `H`, `HR`, `BB`, `R`, `HBP`, `1B`,
 * `2B`, `3B` are hits/homers/walks a BATTER earned in `batting` and ones a PITCHER allowed in
 * `pitching`. So the group decides the key: pitching lands on `p_*` keys (and `so`, pitcher
 * strikeouts, is the vendor's `K`), batting on the plain keys (batter strikeouts, the vendor's `SO`,
 * land on `bat_so`). Read without the group, a pitcher would score his hits allowed as hits.
 *
 * 🛑 INNINGS ARE BASEBALL NOTATION. `IP: 5.2` is five and TWO THIRDS innings, not 5.2 — the fixture's
 * values are 0, 0.1, 0.2, 1, 1.1 … 7. Converted per game, BEFORE anything sums: 6.2 + 5.1 is 12
 * innings, not 11.3.
 *
 * Derived, per game: total bases (1B + 2·2B + 3·3B + 4·HR), outs recorded (innings × 3), and a quality
 * start (6+ innings, 3 or fewer earned runs). Rate stats (AVG, ERA) are never emitted — a ratio
 * summed game by game into a weekly points total is meaningless.
 *
 * Every other numeric field is either listed as non-scoring or reported as unmapped, so a vendor
 * rename shows up as a warning instead of a quiet week of zeros.
 */
import type { NormalizedGameStats } from './dailySportStatNormalization'

const BATTING: Readonly<Record<string, string>> = {
  R: 'r',
  HR: 'hr',
  RBI: 'rbi',
  SB: 'sb',
  CS: 'cs',
  BB: 'bb',
  IBB: 'ibb',
  HBP: 'hbp',
  SO: 'bat_so',
  '1B': 'single',
  '2B': 'double',
  '3B': 'triple',
}
/** Batting fields that score nothing (hits are scored by type or as total bases). */
const BATTING_NON_SCORING = new Set(['AB', 'H', 'E', 'PO', 'Outs', 'BAT_ORD', 'player_id'])

const PITCHING: Readonly<Record<string, string>> = {
  K: 'so',
  W: 'w',
  L: 'l',
  S: 'sv',
  HLD: 'hld',
  BS: 'bs',
  ER: 'er',
  R: 'p_r',
  H: 'p_h',
  HR: 'p_hr',
  BB: 'p_bb',
  HBP: 'p_hbp',
  WP: 'wp',
  BK: 'bk',
}
/** Pitching fields that score nothing. `IP` is handled separately (converted, then ip + outs). */
// `player_id` rides in the stored stats as a number (measured on production's 2026 rows) — an id, not a stat.
const PITCHING_NON_SCORING = new Set(['IBB', 'SB', 'CS', '1B', '2B', '3B', 'E', 'PO', 'pitches', 'strikes', 'player_id'])

function isRecord(v: unknown): v is Record<string, unknown> {
  return v != null && typeof v === 'object' && !Array.isArray(v)
}

function asNumber(v: unknown): number | undefined {
  if (typeof v === 'number') return Number.isFinite(v) ? v : undefined
  if (typeof v === 'string' && v.trim() !== '') {
    const n = Number(v)
    return Number.isFinite(n) ? n : undefined
  }
  return undefined
}

/** Baseball innings notation -> true innings: 5.2 -> 5.667. The tenths digit counts OUTS (0, 1 or 2). */
export function inningsFromBaseballNotation(value: number): number {
  const whole = Math.trunc(value)
  const outs = Math.round((value - whole) * 10)
  // Anything but .0/.1/.2 is not baseball notation; take it at face value rather than invent outs.
  if (outs < 0 || outs > 2) return value
  return whole + outs / 3
}

export function normalizeMlbGameStats(raw: unknown): NormalizedGameStats {
  const record = isRecord(raw) ? raw : {}
  const group = typeof record.group === 'string' ? record.group : null
  const source = isRecord(record.stats) ? record.stats : null
  if (!source || (group !== 'batting' && group !== 'pitching')) {
    // A line whose group we cannot tell must not be guessed: scoring it as either side is wrong half the time.
    return { stats: {}, unmappedKeys: group ? [`group:${group}`] : source ? ['group:(missing)'] : [] }
  }

  const map = group === 'batting' ? BATTING : PITCHING
  const nonScoring = group === 'batting' ? BATTING_NON_SCORING : PITCHING_NON_SCORING
  const stats: Record<string, number> = {}
  const unmappedKeys: string[] = []

  for (const [field, value] of Object.entries(source)) {
    const n = asNumber(value)
    if (n === undefined) continue
    if (group === 'pitching' && field === 'IP') continue
    const key = map[field]
    if (key) {
      stats[key] = n
      continue
    }
    if (!nonScoring.has(field)) unmappedKeys.push(`${group}.${field}`)
  }

  if (group === 'batting') {
    stats.tb = (stats.single ?? 0) + 2 * (stats.double ?? 0) + 3 * (stats.triple ?? 0) + 4 * (stats.hr ?? 0)
  } else {
    const ipRaw = asNumber(source.IP)
    if (ipRaw !== undefined) {
      const ip = inningsFromBaseballNotation(ipRaw)
      stats.ip = ip
      stats.outs = Math.round(ip * 3)
      stats.qs = ip >= 6 && (stats.er ?? 0) <= 3 ? 1 : 0
    }
  }

  return { stats, unmappedKeys }
}
