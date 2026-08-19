/**
 * Display labels for the platform a league came from.
 *
 * Client-safe by design: the closest existing union (`lib/platform-identity.ts`'s `Platform`)
 * cannot be reused here because that module imports `@/lib/prisma`, and it is also incomplete —
 * it omits `cbs`, `fleaflicker`, and the whole native family.
 *
 * `League.platform` is a plain `String` in Prisma with no DB-level enum, so runtime values are
 * whatever writers happen to store. Treat the input as untrusted text, not a known union.
 */

/**
 * The four interchangeable spellings that all mean "this league lives on AllFantasy itself, not an
 * external platform". Mirrors the predicate in `lib/dashboard/get-dashboard-league-list.ts`, which
 * is the source of truth for what counts as native vs. imported.
 */
const NATIVE_PLATFORMS = new Set(['allfantasy', 'af', 'manual', 'native'])

export function isNativePlatform(platform: string | null | undefined): boolean {
  return NATIVE_PLATFORMS.has((platform ?? 'allfantasy').trim().toLowerCase())
}

/** Platforms whose correct casing is not simple title-case. */
const EXACT_LABELS: Record<string, string> = {
  espn: 'ESPN',
  mfl: 'MFL',
  cbs: 'CBS',
}

/**
 * Label for the external platform a league was imported from, or null for native AF leagues —
 * which have no external platform to name.
 *
 * Unknown platforms title-case rather than collapsing to a catch-all. The previous hand-written map
 * (`components/league/LeagueSidebarCard.tsx`) returned `'AF'` for anything unlisted, which is
 * actively wrong for an imported league: `ConnectPlatformsModal` already offers **Fleaflicker**
 * imports and no map covered it, so a Fleaflicker league would have read "Going Deep League - AF".
 * Title-casing means any platform added to the import flow labels itself correctly by default
 * instead of silently mislabelling as AllFantasy.
 */
export function importedPlatformLabel(platform: string | null | undefined): string | null {
  const p = (platform ?? '').trim().toLowerCase()
  if (!p || isNativePlatform(p)) return null
  return EXACT_LABELS[p] ?? p.charAt(0).toUpperCase() + p.slice(1)
}

/**
 * League name suffixed with its source platform for imported leagues ("Going Deep League - Yahoo"),
 * or the bare name for native AF leagues. Lets a manager tell two same-named leagues on different
 * platforms apart in the selector.
 */
export function leagueDisplayName(name: string, platform: string | null | undefined): string {
  const label = importedPlatformLabel(platform)
  return label ? `${name} - ${label}` : name
}
