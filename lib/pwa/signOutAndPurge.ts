import { signOut } from 'next-auth/react'

/**
 * Sign out, and take the cached copy of the signed-in app with you.
 *
 * 🛑 WHY THIS EXISTS. `public/sw.js` caches every OK same-origin NAVIGATION response into
 * `AllFantasy-pages-*` — `networkFirstWithOfflineFallback` runs for all of them, not only the paths
 * in `NETWORK_FIRST_PATTERNS`. That includes the authenticated `/core` home, which renders the
 * reader's leagues, lineups and flagged starters. Nothing purged it on sign-out, so on a shared
 * device the NEXT person, OFFLINE, was served the previous user's page out of `caches.match()`.
 * Online it never showed: the network wins and a signed-out visitor is redirected to `/login`.
 * Offline there is no network to win.
 *
 * ⚠ IT DELETES THE CACHES DIRECTLY RATHER THAN MESSAGING THE SERVICE WORKER, and that is a
 * deliberate change of plan. `sw.js` has a `CLEAR_CACHE` message handler that does exactly this —
 * it has never had a sender — but reaching it needs `navigator.serviceWorker.controller`, which is
 * **null on the first page load after registration** (an unclaimed worker controls nothing yet).
 * A purge that silently no-ops on exactly the session where the worker was installed is the kind of
 * guard this repo keeps paying for. The Cache API belongs to the page's origin, so the page can do
 * it itself, with no controller, no handshake and no reply to race against unload. The same idiom
 * already runs in `components/shell/SafeGlobalChrome.tsx` when the PWA flag is off.
 *
 * ⚠ THE APP SHELL IS KEPT ON PURPOSE. Only `-pages-` (rendered HTML and RSC payloads, the ones
 * that carry a signed-in reader's data) and `-images-` (avatars and crests fetched while signed in)
 * are dropped. `-static-` holds the precache — `/`, `/login`, `/offline`, the manifest — which is
 * the same for everyone and is what makes an offline launch land somewhere useful. Nuking it would
 * trade a privacy fix for a worse offline experience for the next person, who is usually the same
 * person signing back in.
 */

/** Cache-name prefixes that can hold something about the person who was signed in. */
export const PRIVATE_CACHE_PREFIXES = ['AllFantasy-pages-', 'AllFantasy-images-'] as const

/**
 * How long the purge may hold up the sign-out.
 *
 * ⚠ SIGNING OUT MUST NEVER BE THE THING THAT HANGS. If the Cache API is slow, blocked by storage
 * pressure, or unavailable behind a privacy setting, the user still has to be able to leave. The
 * bound is short and the sign-out proceeds regardless — a purge that fails leaves the old
 * behaviour, while a purge that blocks leaves someone stuck signed in.
 */
export const PURGE_TIMEOUT_MS = 1_500

function withTimeout<T>(work: Promise<T>, ms: number, fallback: T): Promise<T> {
  return Promise.race([
    work.catch(() => fallback),
    new Promise<T>((resolve) => setTimeout(() => resolve(fallback), ms)),
  ])
}

/**
 * Delete every cache that can hold the signed-in reader's data. Returns how many were deleted, which
 * is what the tests assert on — a purge that quietly matched nothing is indistinguishable from one
 * that worked if you only check that it did not throw.
 *
 * Never throws: every failure path resolves to 0.
 */
export async function purgePrivateCaches(timeoutMs: number = PURGE_TIMEOUT_MS): Promise<number> {
  if (typeof caches === 'undefined') return 0
  return withTimeout(
    (async () => {
      const keys = await caches.keys()
      const mine = keys.filter((key) => PRIVATE_CACHE_PREFIXES.some((p) => key.startsWith(p)))
      const results = await Promise.all(mine.map((key) => caches.delete(key).catch(() => false)))
      return results.filter(Boolean).length
    })(),
    timeoutMs,
    0,
  )
}

/**
 * The ONE way this app signs a user out.
 *
 * ⚠ THE PURGE IS AWAITED BEFORE `signOut`, NOT AFTER, AND NOT IN PARALLEL. next-auth 4's
 * `signOut({ callbackUrl })` ends in `window.location.href = …`, so anything still in flight when it
 * returns is cancelled by the navigation. Ordering is the whole correctness of this function, which
 * is why the test asserts the order rather than merely that both were called.
 *
 * ⚠ IT DOES NOT TOUCH THE CALLER'S OPTIONS. Several call sites pass `callbackUrl: '/'` or
 * `'/login'`, which `lib/auth.ts`'s redirect callback rewrites to `/core` — see the memory note
 * `signout-callbackurl-rewritten-to-core`. That is a real and separate bug; fixing it here would
 * change where eleven buttons land in a change that is about cached data, so the options are passed
 * through exactly as given.
 */
export async function signOutAndPurge(options?: Parameters<typeof signOut>[0]): Promise<unknown> {
  await purgePrivateCaches()
  return signOut(options)
}
