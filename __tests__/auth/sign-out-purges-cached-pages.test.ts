import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Signing out must take the cached copy of the signed-in app with it.
 *
 * WHAT WAS MEASURED (origin/main, 2026-09-18)
 * `public/sw.js`'s `networkFirstWithOfflineFallback` caches every OK same-origin NAVIGATION
 * response into `AllFantasy-pages-*`, including the authenticated `/core` home. Nothing purged it:
 * `grep -rn "CLEAR_CACHE" app components lib` matched nothing outside `sw.js` itself, and none of
 * the eleven `signOut(` call sites touched `caches`. Online that is invisible — the network wins and
 * a signed-out visitor is redirected to `/login`. Offline, `caches.match()` hands the next person on
 * the device the previous user's rendered page.
 *
 * ⚠ THE ORDER IS THE CORRECTNESS, NOT THE CALL COUNT. next-auth 4's `signOut({ callbackUrl })` ends
 * in `window.location.href = …`; a purge still in flight when it returns is cancelled by the
 * navigation. A test asserting only "both were called" passes just as happily on the broken version
 * that fires them in parallel, so the assertions below pin the sequence.
 */

const signOut = vi.fn(async () => ({ url: '/login' }))
vi.mock('next-auth/react', () => ({ signOut: (...args: unknown[]) => signOut(...(args as [])) }))

type FakeCaches = {
  keys: () => Promise<string[]>
  delete: (key: string) => Promise<boolean>
}

/** The three caches `sw.js` really creates, plus one belonging to somebody else's app. */
const REAL_KEYS = [
  'AllFantasy-static-v1.0.6',
  'AllFantasy-pages-v1.0.6',
  'AllFantasy-images-v1.0.6',
  'some-other-app-cache',
]

let deleted: string[] = []
let order: string[] = []

function installCaches(over: Partial<FakeCaches> = {}, keys: string[] = REAL_KEYS) {
  const fake: FakeCaches = {
    keys: async () => keys,
    delete: async (key: string) => {
      deleted.push(key)
      order.push(`delete:${key}`)
      return true
    },
    ...over,
  }
  Object.defineProperty(globalThis, 'caches', { value: fake, configurable: true, writable: true })
}

beforeEach(() => {
  deleted = []
  order = []
  signOut.mockClear()
  signOut.mockImplementation(async () => {
    order.push('signOut')
    return { url: '/login' }
  })
})

afterEach(() => {
  Reflect.deleteProperty(globalThis as object, 'caches')
  vi.useRealTimers()
})

describe('purgePrivateCaches', () => {
  it('deletes the caches that can hold a signed-in reader, and only those', async () => {
    installCaches()
    const { purgePrivateCaches } = await import('@/lib/pwa/signOutAndPurge')
    const count = await purgePrivateCaches()
    expect(deleted.sort()).toEqual(['AllFantasy-images-v1.0.6', 'AllFantasy-pages-v1.0.6'])
    expect(count).toBe(2)
  })

  /*
   * 🛑 THE APP SHELL SURVIVES. `-static-` holds `/`, `/login`, `/offline` and the manifest — the
   * same bytes for everyone, and what makes an offline launch land somewhere useful. Deleting it
   * would trade a privacy fix for a worse offline experience for the next person, who is usually
   * the same person signing back in.
   */
  it('leaves the static app shell alone', async () => {
    installCaches()
    const { purgePrivateCaches } = await import('@/lib/pwa/signOutAndPurge')
    await purgePrivateCaches()
    expect(deleted).not.toContain('AllFantasy-static-v1.0.6')
  })

  it("does not touch another app's caches on the same origin", async () => {
    installCaches()
    const { purgePrivateCaches } = await import('@/lib/pwa/signOutAndPurge')
    await purgePrivateCaches()
    expect(deleted).not.toContain('some-other-app-cache')
  })

  it('reports 0 rather than throwing where the Cache API does not exist', async () => {
    Reflect.deleteProperty(globalThis as object, 'caches')
    const { purgePrivateCaches } = await import('@/lib/pwa/signOutAndPurge')
    await expect(purgePrivateCaches()).resolves.toBe(0)
  })

  it('reports 0 rather than throwing when the Cache API rejects', async () => {
    installCaches({
      keys: async () => {
        throw new Error('storage blocked by a privacy setting')
      },
    })
    const { purgePrivateCaches } = await import('@/lib/pwa/signOutAndPurge')
    await expect(purgePrivateCaches()).resolves.toBe(0)
  })
})

describe('signOutAndPurge', () => {
  /*
   * 🛑 THE ONE ASSERTION THAT MATTERS. Swap the two statements in the implementation and every other
   * test in this file still passes.
   */
  it('purges BEFORE signing out, because the sign-out navigation cancels anything still in flight', async () => {
    installCaches()
    const { signOutAndPurge } = await import('@/lib/pwa/signOutAndPurge')
    await signOutAndPurge({ callbackUrl: '/' })
    expect(order[order.length - 1]).toBe('signOut')
    expect(order.filter((o) => o.startsWith('delete:'))).toHaveLength(2)
    expect(order.indexOf('signOut')).toBeGreaterThan(order.findIndex((o) => o.startsWith('delete:')))
  })

  it("passes the caller's options through untouched", async () => {
    installCaches()
    const { signOutAndPurge } = await import('@/lib/pwa/signOutAndPurge')
    await signOutAndPurge({ callbackUrl: '/login', redirect: false })
    expect(signOut).toHaveBeenCalledWith({ callbackUrl: '/login', redirect: false })
  })

  /*
   * ⚠ SIGNING OUT MUST NEVER BE THE THING THAT HANGS. A Cache API that never settles — storage
   * pressure, a blocked origin — must not strand somebody signed in on a shared machine, which is
   * the exact situation this whole fix is about.
   */
  it('still signs out when the purge never settles', async () => {
    installCaches({ keys: () => new Promise<string[]>(() => {}) })
    const { signOutAndPurge } = await import('@/lib/pwa/signOutAndPurge')
    await expect(signOutAndPurge({ callbackUrl: '/' })).resolves.toBeDefined()
    expect(signOut).toHaveBeenCalledTimes(1)
  }, 10_000)

  it('still signs out where the Cache API does not exist at all', async () => {
    Reflect.deleteProperty(globalThis as object, 'caches')
    const { signOutAndPurge } = await import('@/lib/pwa/signOutAndPurge')
    await signOutAndPurge()
    expect(signOut).toHaveBeenCalledTimes(1)
  })
})
