/**
 * The Sleeper username a visitor typed, made safe to put in a provider path and a cache key.
 *
 * ⚠ PERMISSIVE ON PURPOSE. Nothing in this repo pins Sleeper's username alphabet
 * (`lib/sleeper/user-lookup.ts` only trims and strips `@`), and guessing a stricter one would turn
 * real accounts away at an ad landing. So this refuses only what can never be a username and can
 * hurt us: whitespace, path and query characters, control characters, and absurd lengths.
 *
 * ⚠ `SleeperCacheLayer.resolveSleeperUser` interpolates its argument into the URL AND the cache key
 * without encoding, so callers pass `encodeURIComponent(normalized)` — never the raw input.
 *
 * Client-safe: the form uses it to refuse before a round trip.
 */
export const SLEEPER_USERNAME_MAX = 40

export function normalizeSleeperUsername(raw: unknown): string | null {
  if (typeof raw !== 'string') return null
  const v = raw.trim().replace(/^@+/, '')
  if (v.length < 1 || v.length > SLEEPER_USERNAME_MAX) return null
  // eslint-disable-next-line no-control-regex
  if (/[\s/\\?#%&\u0000-\u001f\u007f]/.test(v)) return null
  return v
}
