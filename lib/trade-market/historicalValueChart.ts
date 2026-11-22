import fs from 'fs'
import path from 'path'

import { normalizePlayerName } from '@/lib/player-identity/playerIdentityResolution'

/**
 * THE CHART OF AN OLDER TRADE'S OWN DAY (owner's call, 2026-11-22 — trade learning: values for 2018–2025).
 *
 * The learners price each completed trade on the chart of its own day (`datedMarketLearner.ts`), and daily FantasyCalc
 * captures only began in 2026 — so roughly 20,000 older trades could not be measured at all. The repo already holds a
 * daily DYNASTY value series for 1QB and superflex from 2020-04-01 to 2026-02-05 (`data/historical-values/`, read by
 * `lib/historical-values.ts`): 464 players a day, keyed by NAME. This turns a day of it into a chart the learners read
 * exactly like a captured one.
 *
 * ⚠ NAMES, MATCHED EXACTLY. A day's names go through the shared `normalizePlayerName` and must equal the trade player's
 *   normalized name — no substring or fuzzy fallback (`historical-values.ts` has one; a wrong match prices the wrong
 *   player, which is worse than leaving the trade unpriced). A player who does not match leaves his trade unpriced, as a
 *   player missing from a FantasyCalc capture always has.
 * ⚠ THE SERIES IS NOT KNOWN TO BE IN FANTASYCALC UNITS. Ratios do not care (the dated market's whole measure is a
 *   ratio), but picks and FAAB are priced in FantasyCalc units. So the series is SCALED to FantasyCalc by the median
 *   ratio of the two on the nearest pair of days they both cover — {@link measureHistoricalScale} — and when no such pair
 *   exists, or the ratio is too scattered to be one number, the series is not used at all.
 * ⚠ DYNASTY ONLY, and nothing before April 2020. Redraft trades and 2018–2019 trades stay unpriced, and say so.
 */

export type HistoricalSeries = {
  /** UTC-midnight ms of every day the series covers, ascending. */
  days: number[]
  /** That day's values by normalized player name. */
  valuesOn: (day: number) => Map<string, number>
}

type SeriesFile = { playerValuesByDate: Record<string, Record<string, number>> }

const DATA_DIR = path.join(process.cwd(), 'data', 'historical-values')
const cache = new Map<string, HistoricalSeries | null>()

/** A series from its file's parsed contents. PURE. */
export function seriesFromFile(file: SeriesFile): HistoricalSeries | null {
  const byDate = file?.playerValuesByDate
  if (!byDate || typeof byDate !== 'object') return null
  const entries = Object.entries(byDate)
    .map(([d, v]) => [Date.parse(`${d}T00:00:00Z`), v] as const)
    .filter(([ms, v]) => Number.isFinite(ms) && v && typeof v === 'object')
    .sort((a, b) => a[0] - b[0])
  if (entries.length === 0) return null
  const raw = new Map(entries)
  const built = new Map<number, Map<string, number>>()
  return {
    days: entries.map(([ms]) => ms),
    valuesOn: (day) => {
      const hit = built.get(day)
      if (hit) return hit
      const m = new Map<string, number>()
      for (const [name, value] of Object.entries(raw.get(day) ?? {})) {
        const v = Number(value)
        if (Number.isFinite(v) && v > 0) m.set(normalizePlayerName(name), v)
      }
      built.set(day, m)
      return m
    },
  }
}

/** The dynasty series for a QB format, read once per process. Null when the file is absent or unreadable. */
export function loadHistoricalSeries(qbFormat: 'ONE_QB' | 'SUPERFLEX', dir = DATA_DIR): HistoricalSeries | null {
  const file = path.join(dir, qbFormat === 'SUPERFLEX' ? 'sf-historical.json' : '1qb-historical.json')
  if (cache.has(file)) return cache.get(file)!
  let series: HistoricalSeries | null = null
  try {
    series = fs.existsSync(file) ? seriesFromFile(JSON.parse(fs.readFileSync(file, 'utf-8')) as SeriesFile) : null
  } catch {
    series = null
  }
  cache.set(file, series)
  return series
}

/** A day of the series as a chart over these Sleeper ids, in FantasyCalc units. PURE. */
export function historicalChart(
  series: HistoricalSeries,
  day: number,
  ids: Iterable<string>,
  nameOf: (id: string) => string | null | undefined,
  scale: number,
): Map<string, number> {
  const values = series.valuesOn(day)
  const out = new Map<string, number>()
  for (const id of ids) {
    const name = nameOf(id)
    const v = name ? values.get(normalizePlayerName(name)) : undefined
    if (v != null) out.set(id, Math.round(v * scale))
  }
  return out
}

/** Below this many players on both charts, the scale is not measured. */
export const HISTORY_SCALE_MIN_PLAYERS = 30
/** The ratio's interquartile range over its median, above which it is not one number. */
export const HISTORY_SCALE_MAX_SPREAD = 0.3
/** The furthest apart the two days compared may be. */
export const HISTORY_SCALE_MAX_GAP_DAYS = 45
/** Values below this on either chart are too noisy to set a scale with. */
const SCALE_MIN_VALUE = 500

export type HistoryScale = { scale: number | null; players: number; spread: number | null; note: string }

/** FantasyCalc ÷ history, as one number, from players priced on both. PURE. */
export function measureHistoricalScale(pairs: ReadonlyArray<{ fc: number; hist: number }>): HistoryScale {
  const ratios = pairs
    .filter((p) => p.fc >= SCALE_MIN_VALUE && p.hist >= SCALE_MIN_VALUE)
    .map((p) => p.fc / p.hist)
    .sort((a, b) => a - b)
  const n = ratios.length
  if (n < HISTORY_SCALE_MIN_PLAYERS) {
    return { scale: null, players: n, spread: null, note: `only ${n} players on both charts (need ${HISTORY_SCALE_MIN_PLAYERS})` }
  }
  const q = (f: number) => ratios[Math.min(n - 1, Math.max(0, Math.round(f * (n - 1))))]!
  const median = q(0.5)
  const spread = Math.round(((q(0.75) - q(0.25)) / median) * 1000) / 1000
  if (spread > HISTORY_SCALE_MAX_SPREAD) {
    return { scale: null, players: n, spread, note: `the two charts disagree too much to be one scale (spread ${spread})` }
  }
  return { scale: Math.round(median * 10000) / 10000, players: n, spread, note: `scaled ×${Math.round(median * 1000) / 1000} from ${n} players` }
}
