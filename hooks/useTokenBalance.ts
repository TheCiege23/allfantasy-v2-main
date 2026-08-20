'use client'

/**
 * PROMPT 253 — Frontend hook for token balance. Refetch after spend/purchase.
 * PROMPT 268 — Refetch on window focus (throttled) to avoid stale balance after buying in another tab.
 * PROMPT 280 — Uses fetchWithRetry, getErrorMessage, logError for clean error handling.
 *
 * ⚠ ONE SHARED STORE, NOT ONE FETCH PER MOUNT. Every component calling this used
 * to own its own state and its own request, so a page mounting it several times
 * asked the API the same question several times. Measured on /pricing:
 * MonetizationPurchaseSurface reaches it through BOTH usePostPurchaseSync and
 * TokenBalanceWidget, and the console showed repeated identical calls from
 * useTokenBalance.ts on a single load. Eight components use this hook; any screen
 * combining two of them paid for it twice.
 *
 * It also multiplied failures. Signed out, each instance logged its own 401, so
 * one broken request became N console errors — which is how this was found.
 *
 * ⚠ useSyncExternalStore, NOT A useState MIRROR. With several subscribers reading
 * one external value, a hand-rolled subscribe/setState can tear: two components
 * rendering in the same pass from different snapshots, showing different balances
 * on screen at once. This is the primitive React provides for exactly that, and a
 * balance is the wrong thing to be inconsistent about.
 *
 * ⚠ THE WINDOW LISTENERS ARE ALSO SHARED. They used to be per-instance, so a
 * window focus fired N refetches with an N-times-per-instance throttle that could
 * not see the others. They now attach once while anything is subscribed and
 * detach when the last consumer unmounts.
 */

import { useCallback, useEffect, useSyncExternalStore } from 'react'
import { FOCUS_REFETCH_THROTTLE_MS } from '@/lib/state-consistency/refresh-triggers'
import { POST_PURCHASE_SYNC_EVENT } from '@/lib/state-consistency/post-purchase-sync-events'
import { addStateRefreshListener } from '@/lib/state-consistency/state-events'
import { fetchWithRetry, getErrorMessage, logError } from '@/lib/error-handling'

export interface TokenBalanceState {
  balance: number
  updatedAt: string
  /** True when this account's balance is synthetic (dev-admin bypass). AI spend is not written to the ledger. */
  isAdminBypassAccount: boolean
  lifetimePurchased: number
  lifetimeSpent: number
  lifetimeRefunded: number
}

type Snapshot = {
  data: TokenBalanceState | null
  loading: boolean
  error: string | null
}

/*
 * Replaced wholesale on every change rather than mutated, because
 * useSyncExternalStore compares snapshots by reference — mutating in place would
 * leave subscribers convinced nothing had happened.
 */
let snapshot: Snapshot = { data: null, loading: true, error: null }

const SERVER_SNAPSHOT: Snapshot = { data: null, loading: true, error: null }

const listeners = new Set<() => void>()

/** The single in-flight request, so concurrent callers share one round trip. */
let inFlight: Promise<void> | null = null

let lastFocusRefetch = 0
let detachGlobal: (() => void) | null = null

/**
 * When the last completed fetch finished. Used to collapse a burst of mounts.
 *
 * ⚠ THE IN-FLIGHT GUARD ALONE DID NOT WORK, AND MEASURING IS THE ONLY REASON I
 * KNOW. It collapses CONCURRENT callers, but components do not mount
 * simultaneously — they mount in sequence, and a fast response finishes before
 * the next effect runs, so each one found `inFlight` already cleared and started
 * another request. Signed out the API answers 401 in about a millisecond, which
 * makes the race trivially easy to lose: the network panel still showed five
 * requests after the store was shared.
 *
 * A short freshness window is what actually collapses a mount burst. It is
 * deliberately small — this is for "several components mounted on one screen",
 * not a cache with a lifetime.
 */
let lastCompletedAt = 0
const FRESH_WINDOW_MS = 3000

function emit() {
  for (const listener of listeners) listener()
}

function setSnapshot(patch: Partial<Snapshot>) {
  snapshot = { ...snapshot, ...patch }
  emit()
}

async function loadBalance(options?: { force?: boolean }): Promise<void> {
  /*
   * Returning the existing promise collapses genuinely concurrent callers.
   */
  if (inFlight) return inFlight

  /*
   * ⚠ AND THIS COLLAPSES THE SEQUENTIAL CASE, WHICH IS THE ONE THAT ACTUALLY
   * HAPPENS. Mount effects run one after another; without this each finds the
   * previous request already settled and starts its own. `force` exists so an
   * explicit refetch() — after a purchase or a spend — is never silently skipped
   * for being too soon. Only automatic, incidental calls are collapsed.
   */
  if (!options?.force && lastCompletedAt > 0 && Date.now() - lastCompletedAt < FRESH_WINDOW_MS) {
    return
  }

  setSnapshot({ loading: true, error: null })

  inFlight = (async () => {
    try {
      const res = await fetchWithRetry('/api/tokens/balance', undefined, { context: 'token-balance' })
      const json = await res.json()
      // The API contract guarantees a numeric `balance` on 200. If that's ever violated, treat it as
      // a failure rather than silently coercing to a fabricated 0 that looks like a verified balance.
      if (typeof json.balance !== 'number' || !Number.isFinite(json.balance)) {
        throw new Error('Token balance response missing a valid balance field')
      }
      setSnapshot({
        data: {
          balance: json.balance,
          updatedAt: json.updatedAt ?? '',
          isAdminBypassAccount: Boolean(json.isAdminBypassAccount),
          lifetimePurchased: Number(json.lifetimePurchased ?? 0),
          lifetimeSpent: Number(json.lifetimeSpent ?? 0),
          lifetimeRefunded: Number(json.lifetimeRefunded ?? 0),
        },
        loading: false,
        error: null,
      })
    } catch (e) {
      const err = e as Error & { status?: number }
      /*
       * ⚠ 401 IS NOT AN ERROR STATE HERE, AND MUST NOT CLEAR EXISTING DATA. It
       * means signed out, which callers render as "sign in" rather than as a
       * failure. Preserved exactly from the previous implementation: no error
       * set, data left alone, loading cleared.
       */
      if (err.status === 401) {
        setSnapshot({ loading: false })
        return
      }
      setSnapshot({
        error: getErrorMessage(e, { context: 'token-balance' }),
        data: null,
        loading: false,
      })
      logError(e, { context: 'useTokenBalance' })
    } finally {
      inFlight = null
      lastCompletedAt = Date.now()
    }
  })()

  return inFlight
}

/**
 * Attach the refresh triggers once, for as long as anything is subscribed.
 *
 * Previously each instance attached its own, so one window focus produced N
 * refetches — and the throttle lived in a per-instance ref that could not see
 * the other instances it was supposed to be throttling against.
 */
function attachGlobalListeners(): () => void {
  const onForeground = () => {
    const now = Date.now()
    if (now - lastFocusRefetch < FOCUS_REFETCH_THROTTLE_MS) return
    lastFocusRefetch = now
    void loadBalance()
  }
  const onVisibilityChange = () => {
    if (document.visibilityState !== 'visible') return
    onForeground()
  }
  const onPostPurchaseSync = () => {
    // An actual purchase settled — never serve this one from the freshness window.
    void loadBalance({ force: true })
  }

  window.addEventListener('focus', onForeground)
  window.addEventListener('visibilitychange', onVisibilityChange)
  window.addEventListener(POST_PURCHASE_SYNC_EVENT, onPostPurchaseSync as EventListener)
  const removeStateListener = addStateRefreshListener(['tokens', 'all'], () => void loadBalance({ force: true }))

  return () => {
    window.removeEventListener('focus', onForeground)
    window.removeEventListener('visibilitychange', onVisibilityChange)
    window.removeEventListener(POST_PURCHASE_SYNC_EVENT, onPostPurchaseSync as EventListener)
    removeStateListener?.()
  }
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  if (listeners.size === 1 && typeof window !== 'undefined') {
    detachGlobal = attachGlobalListeners()
  }
  return () => {
    listeners.delete(listener)
    if (listeners.size === 0 && detachGlobal) {
      detachGlobal()
      detachGlobal = null
      /*
       * Reset the throttle on the way out so a fresh mount after a gap fetches
       * immediately rather than inheriting a stale timestamp from a previous
       * page and silently skipping its first refresh.
       */
      lastFocusRefetch = 0
    }
  }
}

function getSnapshot(): Snapshot {
  return snapshot
}

function getServerSnapshot(): Snapshot {
  return SERVER_SNAPSHOT
}

export function useTokenBalance() {
  const state = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot)

  useEffect(() => {
    /*
     * Every mount asks; the dedupe decides whether that becomes a request. A
     * second component mounting a moment later joins the in-flight promise
     * instead of starting its own.
     */
    void loadBalance()
  }, [])

  /*
   * An explicit refetch always goes to the network. A caller reaching for this
   * has just changed the balance — spent, bought, or returned from Stripe — and
   * serving them a three-second-old number would defeat the reason they asked.
   */
  const refetch = useCallback(() => loadBalance({ force: true }), [])

  return {
    // null (not 0) when data hasn't loaded or the fetch failed, so a genuine fetch failure is
    // never indistinguishable from a real, verified zero balance. Callers must handle null.
    balance: state.data ? state.data.balance : null,
    updatedAt: state.data?.updatedAt ?? '',
    isAdminBypassAccount: state.data?.isAdminBypassAccount ?? false,
    lifetimePurchased: state.data?.lifetimePurchased ?? 0,
    lifetimeSpent: state.data?.lifetimeSpent ?? 0,
    lifetimeRefunded: state.data?.lifetimeRefunded ?? 0,
    loading: state.loading,
    error: state.error,
    refetch,
  }
}

/**
 * Test-only reset. Module state outlives a component tree, so a suite that
 * mounted this hook once would leak a populated balance into every later test.
 */
export function __resetTokenBalanceStoreForTests() {
  snapshot = { data: null, loading: true, error: null }
  inFlight = null
  lastFocusRefetch = 0
  lastCompletedAt = 0
  listeners.clear()
  if (detachGlobal) {
    detachGlobal()
    detachGlobal = null
  }
}
