/**
 * A commish's stat correction for ONE league.
 *
 * 🛑 `PlayerWeeklyScore` IS SHARED BY EVERY LEAGUE. It is keyed on (player, week, season, sport) with no
 * league, and every league scores from its `stats`. The commish "apply correction" action used to write
 * the corrected stats there — so one league's commish changed that player's points in every league on
 * AllFantasy, and the next stat sync could overwrite the change silently.
 *
 * A commish correction now lives on the league (`League.settings.stat_overrides`) and the two engines
 * that score matchups read through it (lib/redraft/scoringEngine.ts and the NFL live-scoring runtime):
 * the shared row stays the provider's, and this league scores the commish's numbers.
 *
 * Keyed by the player id the ROSTER uses (`RedraftRosterPlayer.playerId`), which is the id both engines
 * hold when they look a player up — no Sleeper-id translation is involved.
 */

export const STAT_OVERRIDES_SETTINGS_KEY = 'stat_overrides'

export type StatOverrideEntry = {
  stats: Record<string, number>
  /** The commish's word is final: a corrected line counts as a finished game. */
  final: boolean
  by: string | null
  at: string
  reason: string | null
}

type Store = Record<string, Record<string, StatOverrideEntry>>

export function statOverrideWeekKey(season: number, week: number): string {
  return `${season}:${week}`
}

function storeOf(settings: unknown): Store {
  const s = settings && typeof settings === 'object' && !Array.isArray(settings) ? (settings as Record<string, unknown>) : {}
  const raw = s[STAT_OVERRIDES_SETTINGS_KEY]
  return raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Store) : {}
}

function numericStats(raw: unknown): Record<string, number> {
  const out: Record<string, number> = {}
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return out
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    const n = Number(v)
    if (Number.isFinite(n)) out[k] = n
  }
  return out
}

/** This league's corrected stat lines for one week, by roster player id. */
export function readStatOverrides(settings: unknown, season: number, week: number): Map<string, StatOverrideEntry> {
  const week_ = storeOf(settings)[statOverrideWeekKey(season, week)]
  const out = new Map<string, StatOverrideEntry>()
  if (!week_ || typeof week_ !== 'object') return out
  for (const [playerId, entry] of Object.entries(week_)) {
    if (!entry || typeof entry !== 'object') continue
    out.set(playerId, {
      stats: numericStats(entry.stats),
      final: entry.final !== false,
      by: typeof entry.by === 'string' ? entry.by : null,
      at: typeof entry.at === 'string' ? entry.at : '',
      reason: typeof entry.reason === 'string' ? entry.reason : null,
    })
  }
  return out
}

/** The league's settings with one corrected line set (or replaced). */
export function withStatOverride(
  settings: unknown,
  input: { season: number; week: number; playerId: string; entry: StatOverrideEntry },
): Record<string, unknown> {
  const base = settings && typeof settings === 'object' && !Array.isArray(settings) ? (settings as Record<string, unknown>) : {}
  const store = storeOf(base)
  const key = statOverrideWeekKey(input.season, input.week)
  return {
    ...base,
    [STAT_OVERRIDES_SETTINGS_KEY]: {
      ...store,
      [key]: { ...(store[key] ?? {}), [input.playerId]: { ...input.entry, stats: numericStats(input.entry.stats) } },
    },
  }
}
