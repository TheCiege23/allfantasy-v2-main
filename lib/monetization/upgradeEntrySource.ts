/**
 * Which surface sent a buyer to /upgrade (2026-11-15). The lock card on a /core depth feature was a
 * bare link (`/upgrade?plan=pro`), so nothing could say which locked feature a purchase came from —
 * every lock looked the same in the numbers.
 *
 * The path carries `from=<source>`; the checkout client reads it off the page it is running on (so it
 * survives a sign-in detour, which returns to the same URL); the checkout route stores it on the Stripe
 * session's metadata; and the webhook reads it back when the payment confirms. Both ends emit a funnel
 * event with `entry_source`, and the admin funnel groups by it.
 *
 * PURE. A source is a short lowercase token (letters, digits, `_` and `-` — Chimmy's card already sends `chimmy-drawer`), never free text: it lands in Stripe metadata and in an
 * analytics row, so anything else is dropped rather than stored.
 */

const SOURCE = /^[a-z0-9_-]{1,48}$/

export function normalizeEntrySource(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const v = value.trim().toLowerCase()
  return SOURCE.test(v) ? v : null
}

/** `/upgrade?plan=pro` + `lock_player_depth` → `/upgrade?plan=pro&from=lock_player_depth`. An existing `from` wins. */
export function withEntrySource(path: string, source: string): string {
  const s = normalizeEntrySource(source)
  // A caller (or a test fixture) can hand over an access object with no upgrade path at all: pass it
  // through untouched rather than throwing inside a render — the lock card must never be the crash.
  if (!s || typeof path !== 'string' || !path.startsWith('/')) return path
  const [base, hash] = path.split('#', 2)
  const [pathname, query = ''] = base!.split('?', 2)
  const params = new URLSearchParams(query)
  if (!params.has('from')) params.set('from', s)
  const q = params.toString()
  return `${pathname}${q ? `?${q}` : ''}${hash ? `#${hash}` : ''}`
}

/** The `from` of a query string (`window.location.search`), normalized; null when absent or malformed. */
export function entrySourceFromSearch(search: string | null | undefined): string | null {
  if (!search) return null
  try {
    return normalizeEntrySource(new URLSearchParams(search).get('from'))
  } catch {
    return null
  }
}
