/**
 * Logo URLs we BUILD by guessing that the CDN is known never to serve.
 *
 * ESPN keys college and soccer crests by NUMERIC id (`teamlogos/ncaa/500/333.png`,
 * `teamlogos/soccer/500/359.png`). The static registry builds them from an abbreviation or name
 * instead — `teamlogos/ncaaf/500/ala.png`, `teamlogos/ncaab/500/duke.png`,
 * `teamlogos/soccer/500/mia.png` — and every one 404s. Measured 2026-10-01 against the CDN:
 * ala, osu (ncaaf), duke, unc (ncaab), atl, lafc, mia, sea (soccer, including MLS clubs the
 * registry itself lists) all 404 with a 1-byte body; the numeric `ncaa/500/333.png` is 200.
 *
 * Treating these as "no logo" is what lets a real crest (stored, or passed by the caller) win, and
 * otherwise lets the UI fall back to initials instead of firing a request that cannot succeed.
 *
 * Pure: no imports. Safe in client components.
 */
const DEAD_GUESS = /^https?:\/\/a\.espncdn\.com\/i\/teamlogos\/(ncaaf|ncaab|soccer)\/500\/[^/]*[a-z][^/]*\.png$/i

/** True when `url` is a guessed ESPN college/soccer path built from a name rather than an id. */
export function isKnownDeadLogoGuess(url: string | null | undefined): boolean {
  if (!url) return false
  return DEAD_GUESS.test(url.trim())
}

/** `url` unless it is a known-dead guess. */
export function liveLogoOrNull(url: string | null | undefined): string | null {
  const u = url?.trim()
  return u && !isKnownDeadLogoGuess(u) ? u : null
}
