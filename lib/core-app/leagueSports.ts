import { SUPPORTED_SPORTS, normalizeToSupportedSport } from '@/lib/sport-scope'

/**
 * Sport grouping for league lists. Pure, so the My Leagues screen and its tests share one rule.
 *
 * ⚠ A LEAGUE WITH NO SPORT IS NOT NFL. `normalizeToSupportedSport` defaults an empty value to
 * NFL, which is right for a form default and wrong for a list: it would file an unknown league
 * under NFL and inflate that tab. Empty stays `null` here and is shown as "Other".
 */
export function leagueSportKey(sport: string | null | undefined): string | null {
  const raw = sport?.trim()
  if (!raw) return null
  return normalizeToSupportedSport(raw)
}

const SPORT_LABELS: Record<string, string> = {
  NFL: 'NFL',
  NBA: 'NBA',
  NHL: 'NHL',
  MLB: 'MLB',
  NCAAF: 'College Football',
  NCAAB: 'College Basketball',
  SOCCER: 'Soccer',
}

/** Short form for a card's meta line, where the long college names would truncate the format. */
const SPORT_SHORT: Record<string, string> = { NCAAF: 'CFB', NCAAB: 'CBB' }

export function leagueSportLabel(key: string | null, opts: { short?: boolean } = {}): string {
  if (!key) return 'Other'
  if (opts.short && SPORT_SHORT[key]) return SPORT_SHORT[key]!
  return SPORT_LABELS[key] ?? key
}

export type LeagueSportCount = { key: string | null; count: number }

/**
 * The sports present in `leagues`, in product order (SUPPORTED_SPORTS), with "Other" last.
 * Only sports that actually have a league appear; a tab for a sport you do not play is noise.
 */
export function leagueSportCounts(leagues: ReadonlyArray<{ sport?: string | null }>): LeagueSportCount[] {
  const counts = new Map<string | null, number>()
  for (const l of leagues) {
    const key = leagueSportKey(l.sport)
    counts.set(key, (counts.get(key) ?? 0) + 1)
  }
  const order = (key: string | null) => {
    if (key == null) return Number.MAX_SAFE_INTEGER
    const i = (SUPPORTED_SPORTS as readonly string[]).indexOf(key)
    return i === -1 ? SUPPORTED_SPORTS.length : i
  }
  return [...counts.entries()]
    .map(([key, count]) => ({ key, count }))
    .sort((a, b) => order(a.key) - order(b.key) || String(a.key).localeCompare(String(b.key)))
}
