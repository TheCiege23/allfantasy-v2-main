/**
 * Keeps BACKGROUND route refreshes from turning into full page reloads.
 *
 * 🛑 A `router.refresh()` THAT LANDS AFTER A DEPLOY IS A HARD RELOAD, NOT A REFRESH.
 * Next.js compares the build id in the RSC response with the one the page booted with,
 * and on a mismatch it gives up on the soft update and navigates the browser to the
 * same URL (`doMpaNavigation` in `fetch-server-response`). A non-2xx RSC response
 * (a container swap mid-deploy) does the same. `main` deploys dozens of times a day,
 * and /core refreshes on a timer and again the moment a tab becomes visible — so a
 * tab left open for a few minutes reliably came back to a white flash and a full
 * reload, usually in the middle of the reader's next tap.
 *
 * So every timer-, focus- or visibility-driven refresh asks `canRefreshInBackground()`
 * first. It reads the cheap `/api/af-debug/sha` marker and compares it with the one
 * seen when this page booted:
 *
 *   same deployment                    → refresh in place, exactly as before
 *   new deployment, SAME build id      → refresh in place, and flag the new version
 *   new deployment, different build id → skip, and flag it
 *   marker unreadable                  → skip this tick (mid-swap; the next tick retries)
 *
 * ⚠ THE SECOND ROW IS WHAT KEEPS A LONG-OPEN TAB CURRENT. `next.config.js` pins
 * `generateBuildId` to a constant, so a new deployment normally reports the build id the
 * page booted with and Next has nothing to mismatch on — the refresh stays soft and the
 * page keeps updating across deploys with no reload at all. The marker reports the
 * server's real build id (read from the built `BUILD_ID` file) rather than this module
 * assuming the pin took effect: if it ever does not match, the third row applies and the
 * behaviour is exactly what it was before the pin.
 *
 * The flag is raised on ANY new deployment, so `NewVersionReload` still moves the tab
 * onto the new JavaScript the next time nobody is looking.
 *
 * A refresh the reader ASKS for (a ↻ button, a save) does not go through here — if a
 * deploy has landed, reloading on their own tap is expected and gets them the new build.
 */

const MARKER_URL = '/api/af-debug/sha'
/** Several pollers tick together; one marker read serves all of them. */
const CHECK_TTL_MS = 10_000

type MarkerRead = { ok: true; marker: string | null; buildId: string | null } | { ok: false }

let baseline: string | null | undefined
/** The Next build id the server reported at boot; null when it could not say. */
let baselineBuildId: string | null = null
/** A deployment with a DIFFERENT build id has been seen: every refresh from here would reload. */
let refreshWouldReload = false
let baselineRead: Promise<void> | null = null
let lastCheck: { at: number; result: Promise<boolean> } | null = null
let newVersionReady = false
const listeners = new Set<() => void>()

async function readMarker(): Promise<MarkerRead> {
  try {
    const res = await fetch(MARKER_URL, { cache: 'no-store', credentials: 'same-origin' })
    if (!res.ok) return { ok: false }
    const json = (await res.json()) as { deploymentId?: unknown; sha?: unknown; buildId?: unknown }
    const id = typeof json.deploymentId === 'string' && json.deploymentId ? json.deploymentId : null
    const sha = typeof json.sha === 'string' && json.sha ? json.sha : null
    const buildId = typeof json.buildId === 'string' && json.buildId ? json.buildId : null
    return { ok: true, marker: id ?? sha, buildId }
  } catch {
    return { ok: false }
  }
}

/**
 * Record which deployment this page booted on. Call from the mount of any surface that
 * refreshes in the background — the earlier it runs, the smaller the window in which a
 * deploy could land unnoticed before the baseline is taken.
 */
export function primeDeployBaseline(): Promise<void> {
  if (typeof window === 'undefined') return Promise.resolve()
  if (baseline !== undefined) return Promise.resolve()
  if (!baselineRead) {
    baselineRead = readMarker().then((read) => {
      // A failed read leaves the baseline unset so the next check can take it.
      if (read.ok && baseline === undefined) {
        baseline = read.marker
        baselineBuildId = read.buildId
      }
      baselineRead = null
    })
  }
  return baselineRead
}

function markNewVersionReady() {
  if (newVersionReady) return
  newVersionReady = true
  for (const listener of listeners) listener()
}

async function check(): Promise<boolean> {
  await primeDeployBaseline()
  const read = await readMarker()
  if (!read.ok) return false
  if (baseline === undefined) {
    // Never got a boot reading: adopt this one. At worst this is the old behaviour once.
    baseline = read.marker
    baselineBuildId = read.buildId
    return true
  }
  // No marker at all (local dev, unknown host): nothing to compare, keep refreshing.
  if (baseline === null || read.marker === null) return true
  if (read.marker !== baseline) {
    markNewVersionReady()
    // Same build id on both sides, and both KNOWN: Next will not mismatch, so the refresh is soft.
    // An unknown id on either side proves nothing and is treated as a different build.
    if (baselineBuildId !== null && read.buildId === baselineBuildId) return true
    refreshWouldReload = true
    return false
  }
  return true
}

/** True when a background `router.refresh()` will update in place rather than reload. */
export function canRefreshInBackground(): Promise<boolean> {
  if (typeof window === 'undefined') return Promise.resolve(false)
  if (refreshWouldReload) return Promise.resolve(false)
  const now = Date.now()
  if (lastCheck && now - lastCheck.at < CHECK_TTL_MS) return lastCheck.result
  const result = check()
  lastCheck = { at: now, result }
  return result
}

/** Run `refresh` only if it is safe to do so without reloading the page. */
export async function refreshInBackground(refresh: () => void): Promise<void> {
  if (await canRefreshInBackground()) refresh()
}

export function isNewVersionReady(): boolean {
  return newVersionReady
}

export function subscribeNewVersionReady(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

const RELOAD_STAMP_KEY = 'af:new-version-reload-at'
const RELOAD_COOLDOWN_MS = 60_000

/**
 * Something on the page just broke. If a newer build is out, load it — at most once a minute.
 *
 * With the build id pinned, a tab can run old JavaScript against a new server; when that pairing
 * fails, the new build is the fix. Resolves true when a reload was started.
 *
 * ⚠ THE COOLDOWN IS WHAT STOPS A LOOP. If the new build is broken too, the reload lands on the
 * same error; without the stamp that would reload forever. It lives in sessionStorage so it
 * survives the reload it guards, and if storage is unavailable NOTHING reloads — an error panel
 * is better than a loop that cannot be stopped.
 *
 * `canInterrupt` is asked last, so a caller can refuse for whatever a reload would destroy.
 */
export async function reloadOntoNewVersion(opts: { canInterrupt: () => boolean }): Promise<boolean> {
  if (typeof window === 'undefined') return false
  // No poller may have looked since the deploy; a failed or skipped check simply leaves the flag down.
  if (!newVersionReady) await canRefreshInBackground()
  if (!newVersionReady) return false
  if (!opts.canInterrupt()) return false
  try {
    const last = Number(window.sessionStorage.getItem(RELOAD_STAMP_KEY) ?? 0)
    if (Number.isFinite(last) && Date.now() - last < RELOAD_COOLDOWN_MS) return false
    window.sessionStorage.setItem(RELOAD_STAMP_KEY, String(Date.now()))
  } catch {
    return false
  }
  window.location.reload()
  return true
}

/** Test seam: forget everything this module has learned. */
export function __resetDeployGuardForTests(): void {
  baseline = undefined
  baselineBuildId = null
  refreshWouldReload = false
  baselineRead = null
  lastCheck = null
  newVersionReady = false
  listeners.clear()
}
