import { createHash } from 'node:crypto'
import { isApiSportsImageUrl } from '@/lib/player-assets/imageUrlHygiene'

/**
 * api-sports answers "we have no photo of this player" with HTTP 200 and a stock
 * image, so the URL passes every null and validity check and renders as a fake
 * headshot. Only the bytes can tell. Measured 2026-10-01: 78 of 750 sampled
 * stored headshots were one identical file, and 58 of 60 sampled NCAAF
 * api-sports headshots were that placeholder.
 *
 * Each hash was verified by eye, not inferred from frequency:
 *  - `68ac0d57…` american-football, 29,416 bytes — grey camera, "image not available".
 *  - `430d67fd…` football (soccer), 5,192 bytes — grey silhouette.
 */
export const API_SPORTS_PLACEHOLDER_MD5: ReadonlySet<string> = new Set([
  '68ac0d5773da5ee81444ade70d89533d',
  '430d67fd79ad0a355b212d5780886e34',
])

/** True when these bytes are a known api-sports placeholder. */
export function isApiSportsPlaceholderBytes(bytes: Uint8Array): boolean {
  return API_SPORTS_PLACEHOLDER_MD5.has(createHash('md5').update(bytes).digest('hex'))
}

/**
 * Three-valued on purpose: `true` placeholder, `false` a real image or not an
 * api-sports URL, `null` could not tell (network error, non-200). Treat `null`
 * as "do not act" — a timeout is not evidence the photo is fake, and dropping a
 * real photo on a blip is the wrong-direction failure this exists to prevent.
 *
 * Non-api-sports URLs return `false` without a request: the placeholder is an
 * api-sports artefact, and fetching every image to prove a negative is waste.
 */
export async function isPlaceholderHeadshot(
  url: string,
  fetchImpl: typeof fetch = fetch,
  timeoutMs = 10_000,
): Promise<boolean | null> {
  if (!isApiSportsImageUrl(url)) return false
  try {
    const res = await fetchImpl(url, { signal: AbortSignal.timeout(timeoutMs) })
    if (!res.ok) return null
    return isApiSportsPlaceholderBytes(new Uint8Array(await res.arrayBuffer()))
  } catch {
    return null
  }
}
