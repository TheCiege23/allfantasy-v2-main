/**
 * Is this URL actually serving an image? One HEAD request, and three conditions.
 *
 * A 404 from ESPN's CDN still returns a body — 1 byte of `text/html` — so status alone is
 * one CDN change from lying. Requiring a real image content-type AND a plausible size is
 * what separates a photo from an error page.
 *
 * A network failure returns `false` like a miss. Callers must leave the row as it was in
 * that case (NULL stays NULL and is retried); a transient blip is not evidence that a
 * player has no photo.
 *
 * Shared by the college football (`lib/devy/devyHeadshotRefresh.ts`) and college
 * basketball (`lib/espn/ncaabEspnIngest.ts`) ESPN headshot writers.
 */

export const MIN_IMAGE_BYTES = 2_000
const DEFAULT_TIMEOUT_MS = 10_000

export async function isServedImage(
  url: string,
  opts: { timeoutMs?: number; fetchImpl?: typeof fetch } = {},
): Promise<boolean> {
  try {
    const res = await (opts.fetchImpl ?? fetch)(url, {
      method: 'HEAD',
      signal: AbortSignal.timeout(opts.timeoutMs ?? DEFAULT_TIMEOUT_MS),
    })
    if (!res.ok) return false
    const type = res.headers.get('content-type') ?? ''
    if (!type.startsWith('image/')) return false
    const length = Number(res.headers.get('content-length') ?? '0')
    return Number.isFinite(length) && length >= MIN_IMAGE_BYTES
  } catch {
    return false
  }
}
