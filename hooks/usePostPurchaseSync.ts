'use client'

/**
 * PROMPT 265 — Post-purchase sync: entitlement + token balance refresh and success/cancel handling.
 * PROMPT 267 — Monetization analytics: purchase_return_success when user returns from checkout with success.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { toast } from 'sonner'
import { useEntitlement } from '@/hooks/useEntitlement'
import { useTokenBalance } from '@/hooks/useTokenBalance'
import {
  resolvePlanTierFromSku,
  trackPurchaseReturnSuccess,
  trackSubscriptionPurchaseSuccess,
  trackTokenPurchaseSuccess,
} from '@/lib/monetization-analytics'
import { trackMetaEventsFromResponse } from '@/lib/meta-client'
import { dispatchPostPurchaseSyncEvent } from '@/lib/state-consistency/post-purchase-sync-events'
import { dispatchStateRefreshEvent } from '@/lib/state-consistency/state-events'

/** Query param keys that indicate success (subscription or token purchase). */
const SUCCESS_PARAMS = ['checkout', 'success', 'tokens', 'purchased'] as const
/** Values that indicate success. */
const SUCCESS_VALUES = ['success', 'sub', '1', 'true', 'complete', 'completed', 'paid', 'purchased'] as const
/** Param that indicates cancelled checkout. */
const CANCEL_PARAM = 'checkout'
const CANCEL_VALUES = ['cancelled', 'canceled', 'cancel'] as const
/** Values that indicate return failure. */
const FAILURE_VALUES = ['failed', 'failure', 'error'] as const

const SYNC_RETRY_MS = 1200
const AUTO_SYNC_MAX_ATTEMPTS = 4

type SearchParamsLike = Pick<URLSearchParams, 'get' | 'has' | 'toString'>

const EMPTY_SEARCH_PARAMS: SearchParamsLike = {
  get: () => null,
  has: () => false,
  toString: () => '',
}

type PurchaseReturnIntent = 'none' | 'success' | 'cancelled' | 'failed'

type PostPurchaseSyncApiResponse = {
  syncStatus?: 'synced' | 'pending' | 'no_session'
  syncMessage?: string
  sessionId?: string | null
  syncEvidence?: {
    subscription?: boolean
    tokens?: boolean
  }
  entitlement?: {
    plans?: string[]
  }
  tokenBalance?: {
    balance?: number
  }
  metaEvent?: unknown
  metaEvents?: unknown
}

export type PostPurchaseSyncPhase =
  | 'idle'
  | 'syncing'
  | 'success'
  | 'pending'
  | 'cancelled'
  | 'failed'

function isSuccess(searchParams: SearchParamsLike): boolean {
  if (getSessionId(searchParams)) return true
  for (const key of SUCCESS_PARAMS) {
    const v = searchParams.get(key)
    if (!v) continue
    if (SUCCESS_VALUES.includes(v.toLowerCase() as (typeof SUCCESS_VALUES)[number])) return true
  }
  return false
}

function isCancel(searchParams: SearchParamsLike): boolean {
  const checkout = searchParams.get(CANCEL_PARAM)
  return checkout
    ? CANCEL_VALUES.includes(checkout.toLowerCase() as (typeof CANCEL_VALUES)[number])
    : false
}

function isFailure(searchParams: SearchParamsLike): boolean {
  const checkout = searchParams.get(CANCEL_PARAM)
  if (checkout && FAILURE_VALUES.includes(checkout.toLowerCase() as (typeof FAILURE_VALUES)[number])) {
    return true
  }
  const status = searchParams.get('status')
  if (status && FAILURE_VALUES.includes(status.toLowerCase() as (typeof FAILURE_VALUES)[number])) {
    return true
  }
  const error = searchParams.get('error')
  return Boolean(error && error.trim())
}

function resolveIntent(searchParams: SearchParamsLike): PurchaseReturnIntent {
  if (isCancel(searchParams)) return 'cancelled'
  if (isFailure(searchParams)) return 'failed'
  if (isSuccess(searchParams)) return 'success'
  return 'none'
}

function getSessionId(searchParams: SearchParamsLike): string | null {
  const raw = searchParams.get('session_id') ?? searchParams.get('sessionId')
  if (!raw) return null
  const value = raw.trim()
  return value.length ? value : null
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/** Remove success/cancel query params from URL without reload. */
function clearPurchaseParams(): void {
  if (typeof window === 'undefined') return
  const url = new URL(window.location.href)
  let changed = false
  const keys = [
    ...SUCCESS_PARAMS,
    'session_id',
    'sessionId',
    'status',
    'error',
    'cancel',
    'purchase',
    'payment',
  ]
  keys.forEach((k) => {
    if (url.searchParams.has(k)) {
      url.searchParams.delete(k)
      changed = true
    }
  })
  const checkout = url.searchParams.get(CANCEL_PARAM)?.toLowerCase()
  if (
    checkout &&
    [...CANCEL_VALUES, ...FAILURE_VALUES, ...SUCCESS_VALUES].includes(
      checkout as (typeof CANCEL_VALUES)[number]
    )
  ) {
    url.searchParams.delete(CANCEL_PARAM)
    changed = true
  }
  if (changed) {
    window.history.replaceState({}, '', url.pathname + (url.search || ''))
  }
}

export interface UsePostPurchaseSyncOptions {
  /** Show toast on success. Default true. */
  showSuccessToast?: boolean
  /** Show toast on cancel. Default true. */
  showCancelToast?: boolean
  /** Show toast on failure. Default true. */
  showFailureToast?: boolean
  /** Custom success message (subscription). */
  successMessage?: string
  /** Custom success message for token purchase. */
  tokenSuccessMessage?: string
  /** Message for pending sync while webhook finalizes. */
  pendingMessage?: string
  /** Message for cancelled return. */
  cancelMessage?: string
  /** Message for failed return. */
  failureMessage?: string
  /** Auto-retry pending session sync. Default true. */
  autoRetryPending?: boolean
  /** Called when success params are processed (for showing a banner). */
  onSuccess?: () => void
  /** Called when cancel params are processed. */
  onCancel?: () => void
  /** Called when failure params are processed. */
  onFailure?: () => void
}

export type PostPurchaseSyncState = {
  phase: PostPurchaseSyncPhase
  message: string | null
  sessionId: string | null
  syncEvidence: {
    subscription: boolean
    tokens: boolean
  }
}

export type UsePostPurchaseSyncResult = {
  state: PostPurchaseSyncState
  retrySync: () => Promise<void>
  isSyncing: boolean
}

/**
 * Call from pricing or tokens page. On mount, if URL has success or cancel params:
 * - Success: refetch entitlement + token balance, optional toast, clear params.
 * - Cancel: optional toast, clear params.
 * Idempotent: clearing params prevents double-toast on re-render.
 */
export function usePostPurchaseSync(options: UsePostPurchaseSyncOptions = {}): UsePostPurchaseSyncResult {
  const searchParams = useSearchParams() ?? EMPTY_SEARCH_PARAMS
  const { refetch: refetchEntitlement } = useEntitlement()
  const { refetch: refetchTokens } = useTokenBalance()
  const {
    showSuccessToast = true,
    showCancelToast = true,
    showFailureToast = true,
    successMessage = 'Purchase complete. Your plan and balance are updated.',
    tokenSuccessMessage = 'Tokens added. Your balance is updated.',
    pendingMessage = 'Purchase is still finalizing. Try sync again in a moment.',
    cancelMessage = 'Checkout cancelled.',
    failureMessage = 'Purchase could not be completed. Please retry checkout.',
    autoRetryPending = true,
    onSuccess,
    onCancel,
    onFailure,
  } = options

  const [state, setState] = useState<PostPurchaseSyncState>({
    phase: 'idle',
    message: null,
    sessionId: null,
    syncEvidence: { subscription: false, tokens: false },
  })
  const handledKeysRef = useRef<Set<string>>(new Set())
  const latestIntentRef = useRef<PurchaseReturnIntent>('none')
  const latestSessionIdRef = useRef<string | null>(null)
  const successToastShownRef = useRef(false)
  const cancelToastShownRef = useRef(false)
  const failureToastShownRef = useRef(false)

  const performServerSync = useCallback(
    async (sessionId: string | null): Promise<PostPurchaseSyncApiResponse | null> => {
      const query = sessionId ? `?session_id=${encodeURIComponent(sessionId)}` : ''
      try {
        const res = await fetch(`/api/monetization/post-purchase-sync${query}`, {
          method: 'GET',
          cache: 'no-store',
        })
        if (!res.ok) return null
        return (await res.json().catch(() => null)) as PostPurchaseSyncApiResponse | null
      } catch {
        return null
      }
    },
    []
  )

  const executeSuccessSync = useCallback(
    async (sessionId: string | null) => {
      setState({
        phase: 'syncing',
        message: 'Refreshing your access state...',
        sessionId,
        syncEvidence: { subscription: false, tokens: false },
      })

      const attempts = sessionId && autoRetryPending ? AUTO_SYNC_MAX_ATTEMPTS : 1
      let lastResponse: PostPurchaseSyncApiResponse | null = null

      for (let attempt = 1; attempt <= attempts; attempt += 1) {
        const response = await performServerSync(sessionId)
        lastResponse = response
        await Promise.all([refetchEntitlement(), refetchTokens()])

        const syncStatus = response?.syncStatus ?? (sessionId ? 'pending' : 'no_session')
        const evidence = {
          subscription: Boolean(response?.syncEvidence?.subscription),
          tokens: Boolean(response?.syncEvidence?.tokens),
        }

        // `no_session` means no Stripe checkout session id was ever provided to verify — there is
        // no specific purchase to confirm, so this must never be shown or tracked as a success.
        // Refresh state honestly and stop, without a success toast or purchase-tracking events.
        if (syncStatus === 'no_session') {
          setState({
            phase: 'idle',
            message: '',
            sessionId,
            syncEvidence: evidence,
          })
          clearPurchaseParams()
          dispatchStateRefreshEvent({
            domain: 'subscriptions',
            reason: 'checkout_return_no_session',
            source: 'usePostPurchaseSync',
          })
          dispatchStateRefreshEvent({
            domain: 'tokens',
            reason: 'checkout_return_no_session',
            source: 'usePostPurchaseSync',
          })
          return
        }

        if (syncStatus === 'synced') {
          if (response) {
            trackMetaEventsFromResponse(response)
          }
          const successCopy = evidence.tokens && !evidence.subscription
            ? tokenSuccessMessage
            : successMessage
          const returnPath = typeof window !== 'undefined' ? window.location.pathname : ''
          const effectivePlanTiers = (response?.entitlement?.plans ?? []).map((plan) =>
            resolvePlanTierFromSku(plan)
          )

          setState({
            phase: 'success',
            message: successCopy,
            sessionId,
            syncEvidence: evidence,
          })

          if (syncStatus === 'synced') {
            if (evidence.subscription) {
              trackSubscriptionPurchaseSuccess({
                returnPath,
                sessionId,
                effectivePlanTiers,
              })
            }
            if (evidence.tokens) {
              trackTokenPurchaseSuccess({
                returnPath,
                sessionId,
                balanceAfter: response?.tokenBalance?.balance ?? null,
              })
            }
          }

          if (showSuccessToast && !successToastShownRef.current) {
            toast.success(successCopy)
            successToastShownRef.current = true
          }

          onSuccess?.()
          clearPurchaseParams()
          dispatchPostPurchaseSyncEvent({
            phase: 'success',
            sessionId,
          })
          dispatchStateRefreshEvent({
            domain: 'subscriptions',
            reason: 'checkout_return_success',
            source: 'usePostPurchaseSync',
          })
          dispatchStateRefreshEvent({
            domain: 'tokens',
            reason: 'checkout_return_success',
            source: 'usePostPurchaseSync',
          })
          return
        }

        if (attempt < attempts) {
          await sleep(SYNC_RETRY_MS)
        }
      }

      setState({
        phase: 'pending',
        message: lastResponse?.syncMessage ?? pendingMessage,
        sessionId,
        syncEvidence: {
          subscription: Boolean(lastResponse?.syncEvidence?.subscription),
          tokens: Boolean(lastResponse?.syncEvidence?.tokens),
        },
      })
      clearPurchaseParams()
      dispatchPostPurchaseSyncEvent({
        phase: 'pending',
        sessionId,
      })
      dispatchStateRefreshEvent({
        domain: 'subscriptions',
        reason: 'checkout_return_pending',
        source: 'usePostPurchaseSync',
      })
      dispatchStateRefreshEvent({
        domain: 'tokens',
        reason: 'checkout_return_pending',
        source: 'usePostPurchaseSync',
      })
    },
    [
      autoRetryPending,
      onSuccess,
      pendingMessage,
      performServerSync,
      refetchEntitlement,
      refetchTokens,
      showSuccessToast,
      successMessage,
      tokenSuccessMessage,
    ]
  )

  const executeIntent = useCallback(
    async (intent: PurchaseReturnIntent, sessionId: string | null) => {
      latestIntentRef.current = intent
      latestSessionIdRef.current = sessionId

      if (intent === 'success') {
        const returnPath = typeof window !== 'undefined' ? window.location.pathname : ''
        trackPurchaseReturnSuccess({ returnPath })
        await executeSuccessSync(sessionId)
        return
      }

      if (intent === 'cancelled') {
        setState({
          phase: 'cancelled',
          message: cancelMessage,
          sessionId,
          syncEvidence: { subscription: false, tokens: false },
        })
        if (showCancelToast && !cancelToastShownRef.current) {
          toast.info(cancelMessage)
          cancelToastShownRef.current = true
        }
        onCancel?.()
        clearPurchaseParams()
        dispatchPostPurchaseSyncEvent({
          phase: 'cancelled',
          sessionId,
        })
        return
      }

      if (intent === 'failed') {
        setState({
          phase: 'failed',
          message: failureMessage,
          sessionId,
          syncEvidence: { subscription: false, tokens: false },
        })
        if (showFailureToast && !failureToastShownRef.current) {
          toast.error(failureMessage)
          failureToastShownRef.current = true
        }
        onFailure?.()
        clearPurchaseParams()
        dispatchPostPurchaseSyncEvent({
          phase: 'failed',
          sessionId,
        })
      }
    },
    [
      cancelMessage,
      executeSuccessSync,
      failureMessage,
      onCancel,
      onFailure,
      showCancelToast,
      showFailureToast,
    ]
  )

  const retrySync = useCallback(async () => {
    const sessionId = latestSessionIdRef.current ?? state.sessionId
    if (!sessionId) {
      await Promise.all([refetchEntitlement(), refetchTokens()])
      setState((prev) => ({
        ...prev,
        phase: 'failed',
        message: 'Unable to retry without a checkout session id. Please start checkout again.',
      }))
      return
    }
    await executeSuccessSync(sessionId)
  }, [executeSuccessSync, refetchEntitlement, refetchTokens, state.sessionId])

  const intentKey = useMemo(() => {
    const intent = resolveIntent(searchParams)
    const sessionId = getSessionId(searchParams)
    return `${intent}:${sessionId ?? ''}:${searchParams.toString()}`
  }, [searchParams])

  useEffect(() => {
    const intent = resolveIntent(searchParams)
    const sessionId = getSessionId(searchParams)
    if (intent === 'none') return
    if (handledKeysRef.current.has(intentKey)) return
    handledKeysRef.current.add(intentKey)
    void executeIntent(intent, sessionId)
  }, [executeIntent, intentKey, searchParams])

  return {
    state,
    retrySync,
    isSyncing: state.phase === 'syncing',
  }
}

/**
 * Returns true if current URL has success params (for showing a success banner).
 */
export function useIsPurchaseSuccess(): boolean {
  const searchParams = useSearchParams() ?? EMPTY_SEARCH_PARAMS
  return isSuccess(searchParams)
}
