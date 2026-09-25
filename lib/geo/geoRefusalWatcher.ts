/**
 * Sends the person to the right block page when a VPN is switched on (or a
 * Washington lock lands) MID-SESSION.
 *
 * The middleware already redirects a PAGE load to /vpn-blocked or /geo-blocked.
 * What it cannot redirect is the page that is already open: from then on the
 * app talks to /api/*, those calls come back `403 VPN_BLOCKED` / `GEO_BLOCKED`,
 * and every screen rendered its own generic "something went wrong" instead of
 * saying why. Found in the 2026-09-24 geo/VPN handoff as gap 3.
 *
 * ⚠ THE BROWSER DOES NOT DECIDE WHICH PAGES ARE BLOCKED — IT ASKS. The homepage
 * and the legal pages stay open over a VPN and still call APIs, so "an API said
 * VPN_BLOCKED" does not mean "leave this page". Copying the middleware's
 * public-page list into client code would be a second copy of a rule that
 * already drifts. Instead, on a page-level refusal we re-request the CURRENT
 * page with `redirect: "manual"`: if the middleware would redirect it, we
 * navigate to it and let the server choose the destination (and its `from`);
 * if not, the page is public and nothing happens.
 *
 * Only 403 refusals count. `PAID_GEO_BLOCKED` (451) and checkout's own
 * `VPN_BLOCKED` (451) refuse one feature, not the page, and their callers
 * already show a message for them.
 */

/** Refusal codes whose meaning is "this person may not use the app from here". */
const PAGE_LEVEL_REFUSAL_CODES = new Set(["VPN_BLOCKED", "GEO_BLOCKED"])

/** Pages that are the destination of a refusal; never probe from one. */
const BLOCK_PAGE_PREFIXES = ["/vpn-blocked", "/geo-blocked", "/paid-restricted", "/restricted"]

export function isPageLevelGeoRefusal(status: number, body: unknown): boolean {
  if (status !== 403) return false
  if (!body || typeof body !== "object") return false
  const code = (body as { error?: unknown }).error
  return typeof code === "string" && PAGE_LEVEL_REFUSAL_CODES.has(code)
}

/** The request's URL when it is one of OUR API routes, else null. */
export function sameOriginApiUrl(input: RequestInfo | URL, pageHref: string): URL | null {
  let raw: string
  if (typeof input === "string") raw = input
  else if (input instanceof URL) raw = input.href
  else if (input && typeof (input as Request).url === "string") raw = (input as Request).url
  else return null
  let url: URL
  let page: URL
  try {
    page = new URL(pageHref)
    url = new URL(raw, page)
  } catch {
    return null
  }
  if (url.origin !== page.origin) return null
  return url.pathname === "/api" || url.pathname.startsWith("/api/") ? url : null
}

function isBlockPage(pathname: string): boolean {
  return BLOCK_PAGE_PREFIXES.some((p) => pathname === p || pathname.startsWith(`${p}/`))
}

type WatcherWindow = Pick<Window, "fetch" | "location"> & { __afGeoRefusalWatcher?: true }

/**
 * Wraps `win.fetch` once. Returns false when it was already installed.
 *
 * Never uninstalled: it lives in the root providers for the life of the tab, and
 * unwrapping is unsafe once anything else (Sentry, PostHog) has wrapped fetch on
 * top of it. Installation is idempotent so React's double-effect in dev is fine.
 */
export function installGeoRefusalWatcher(win: WatcherWindow): boolean {
  if (win.__afGeoRefusalWatcher) return false
  win.__afGeoRefusalWatcher = true

  const originalFetch = win.fetch.bind(win)
  /** Pathnames the server has already said are public; one probe each per tab. */
  const publicPaths = new Set<string>()
  let probing = false
  let leaving = false

  async function probeCurrentPage(): Promise<void> {
    const path = win.location.pathname
    if (leaving || probing || publicPaths.has(path) || isBlockPage(path)) return
    probing = true
    try {
      const res = await originalFetch(win.location.href, {
        method: "GET",
        redirect: "manual",
        credentials: "same-origin",
        cache: "no-store",
      })
      // A cross-origin-safe manual redirect surfaces as an opaque response.
      const redirected = res.type === "opaqueredirect" || (res.status >= 300 && res.status < 400)
      if (!redirected) {
        publicPaths.add(path)
        return
      }
      leaving = true
      // A full navigation, so the middleware picks the block page and its `from`.
      win.location.assign(win.location.href)
    } catch {
      // Fails open like every geo check: a failed probe leaves the page alone.
    } finally {
      probing = false
    }
  }

  async function inspect(res: Response): Promise<void> {
    const type = res.headers.get("content-type") ?? ""
    if (!type.includes("json")) return
    let body: unknown
    try {
      body = await res.json()
    } catch {
      return
    }
    if (isPageLevelGeoRefusal(res.status, body)) await probeCurrentPage()
  }

  const watchedFetch: typeof fetch = async (input, init) => {
    const res = await originalFetch(input, init)
    if (res.status === 403 && !leaving && sameOriginApiUrl(input, win.location.href)) {
      // A clone, so the caller still gets an unread body.
      void inspect(res.clone())
    }
    return res
  }
  win.fetch = watchedFetch
  return true
}
