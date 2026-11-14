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
 * first. It reads the cheap `/api/af-debug/sha` marker and compares the deployment id
 * with the one seen when this page booted:
 *
 *   same deployment     → refresh in place, exactly as before
 *   new deployment      → skip, and raise "a new version is ready" (`NewVersionPill`)
 *   marker unreadable   → skip this tick (the server is mid-swap; the next tick retries)
 *
 * A refresh the reader ASKS for (a ↻ button, a save) does not go through here — if a
 * deploy has landed, reloading on their own tap is expected and gets them the new build.
 */

const MARKER_URL = '/api/af-debug/sha'
/** Several pollers tick together; one marker read serves all of them. */
const CHECK_TTL_MS = 10_000

type MarkerRead = { ok: true; marker: string | null } | { ok: false }

let baseline: string | null | undefined
let baselineRead: Promise<void> | null = null
let lastCheck: { at: number; result: Promise<boolean> } | null = null
let newVersionReady = false
const listeners = new Set<() => void>()

async function readMarker(): Promise<MarkerRead> {
  try {
    const res = await fetch(MARKER_URL, { cache: 'no-store', credentials: 'same-origin' })
    if (!res.ok) return { ok: false }
    const json = (await res.json()) as { deploymentId?: unknown; sha?: unknown }
    const id = typeof json.deploymentId === 'string' && json.deploymentId ? json.deploymentId : null
    const sha = typeof json.sha === 'string' && json.sha ? json.sha : null
    return { ok: true, marker: id ?? sha }
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
      if (read.ok && baseline === undefined) baseline = read.marker
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
    return true
  }
  // No marker at all (local dev, unknown host): nothing to compare, keep refreshing.
  if (baseline === null || read.marker === null) return true
  if (read.marker !== baseline) {
    markNewVersionReady()
    return false
  }
  return true
}

/** True when a background `router.refresh()` will update in place rather than reload. */
export function canRefreshInBackground(): Promise<boolean> {
  if (typeof window === 'undefined') return Promise.resolve(false)
  if (newVersionReady) return Promise.resolve(false)
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

/** Test seam: forget everything this module has learned. */
export function __resetDeployGuardForTests(): void {
  baseline = undefined
  baselineRead = null
  lastCheck = null
  newVersionReady = false
  listeners.clear()
}
