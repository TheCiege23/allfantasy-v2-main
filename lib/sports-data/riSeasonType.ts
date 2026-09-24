import { resolveDailySportSeasonStart } from '@/lib/season-week/dailySportSeasonStarts'

/**
 * Which part of a season a Rolling Insights `/live` game belongs to.
 *
 * WHY THIS EXISTS. `/live/{date}/{SPORT}` returns preseason, regular-season and playoff games
 * alike, and every one of them carries a game-level `season_type`. Until 2026-09-24 the ingest
 * read the game and dropped that field, so `player_game_stats` had no way to tell them apart —
 * and `SportsGame.seasonType` is NULL for MLB and NHL, so there was no second source either.
 * Measured on production that day: 619 NHL rows dated 2026-09-21..23, every one a PRESEASON
 * game, sitting in season 2026 beside the regular season that opens 09-29. MLB's postseason
 * (from ~09-29) would have followed into the same season with nothing marking it.
 *
 * ⚠ ONLY ONE LABEL IS MEASURED FOR MLB / NBA / NHL: `"Regular Season"` (every game in the three
 * committed fixtures). The contract documents the preseason and playoff labels for NFL only
 * (`Preseason`, `WILD CARD`, `DIV RD`, `CONF CHAMP`, `SUPER BOWL`). The patterns below cover
 * those plus the obvious spellings, and ANYTHING ELSE CLASSIFIES AS `null` — never as regular.
 * The raw label is stored beside the class, and the ingest reports unrecognised labels, so a new
 * spelling shows up in the run summary instead of being guessed. See GAPS.md `N-13`.
 */
export type RiSeasonType = 'regular' | 'pre' | 'post'

const PRE = /\b(pre[\s-]?season|spring training|exhibition)\b/i
const REGULAR = /^\s*regular(\s+season)?\s*$/i
const POST =
  /\b(post[\s-]?season|playoffs?|wild\s*card|div(ision(al)?)?\s*(rd|round|series)|conf(erence)?\s*(champ|finals?)|championship|super bowl|world series|stanley cup|finals?|play[\s-]?in|alcs|nlcs|alds|nlds)\b/i

export function classifyRiSeasonType(raw: unknown): RiSeasonType | null {
  if (typeof raw !== 'string') return null
  const label = raw.trim()
  if (!label) return null
  if (PRE.test(label)) return 'pre'
  if (REGULAR.test(label)) return 'regular'
  if (POST.test(label)) return 'post'
  return null
}

/**
 * The season type of one stored `player_game_stats` row.
 *
 * Rows written since this module landed carry `normalizedStatMap.seasonType`. Rows written
 * before it do not, and for those the only honest signal is the recorded regular-season start
 * (`lib/season-week/dailySportSeasonStarts.ts`): a game before it is preseason. A row that is
 * after the start, or whose sport has no recorded start, is UNKNOWN (`null`), not regular —
 * callers decide what unknown means for them.
 */
export function resolveStoredSeasonType(row: {
  normalizedStatMap: unknown
  sport: string
  season: number | null | undefined
  gameDate: Date | null | undefined
}): RiSeasonType | null {
  const map = row.normalizedStatMap
  if (map && typeof map === 'object' && !Array.isArray(map)) {
    const stored = (map as Record<string, unknown>).seasonType
    if (stored === 'regular' || stored === 'pre' || stored === 'post') return stored
  }
  if (!row.gameDate) return null
  const start = resolveDailySportSeasonStart(row.sport, row.season)
  if (!start) return null
  return row.gameDate.getTime() < new Date(start).getTime() ? 'pre' : null
}
