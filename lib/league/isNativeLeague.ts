/**
 * Is a league AllFantasy-hosted, or imported from an external platform?
 *
 * This is the one predicate that answers it. It is an ALLOWLIST of native platform strings, and
 * that direction matters: anything unrecognised is treated as IMPORTED, which is the read-only,
 * we-do-not-write-there answer. A denylist (`platform === 'sleeper'`) fails the other way — every
 * provider added later would silently be classified as ours and become writable.
 *
 * ⚠ DO NOT INLINE A `platform === 'sleeper'` CHECK ANYWHERE. Imported leagues are shadow leagues;
 * writes to them have to go through Write Authority, and a bare per-file platform comparison is
 * exactly how that boundary gets bypassed. This repo has already been bitten by a guard constant
 * copied per-file — 23 copies of `PROD_HOST_MARKER` all named the wrong database and every one of
 * them failed open. One exported predicate, imported everywhere.
 */

/** Platform strings that identify a NATIVE AllFantasy league (a real DB `League` row, not an import). */
export const NATIVE_PLATFORMS: ReadonlySet<string> = new Set([
  'allfantasy',
  'af',
  'manual',
  'native',
  '',
])

/**
 * True when the league is AllFantasy-hosted. Null/undefined platform counts as native — legacy
 * rows predate the column and are AF-created.
 */
export function isNativePlatform(platform: string | null | undefined): boolean {
  return NATIVE_PLATFORMS.has(String(platform ?? '').toLowerCase())
}

/** True when the league came from an external provider and its chat/roster live there, not here. */
export function isImportedPlatform(platform: string | null | undefined): boolean {
  return !isNativePlatform(platform)
}
