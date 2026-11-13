/**
 * Global client event emitted after post-purchase sync runs.
 * Consumers (entitlement, token balance, monetization context) refetch when fired.
 */
export const POST_PURCHASE_SYNC_EVENT = 'af:post-purchase-sync'

type PostPurchaseSyncEventDetail = {
  phase: 'success' | 'pending' | 'failed' | 'cancelled'
  sessionId: string | null
}

export function dispatchPostPurchaseSyncEvent(detail: PostPurchaseSyncEventDetail): void {
  if (typeof window === 'undefined') return
  window.dispatchEvent(new CustomEvent(POST_PURCHASE_SYNC_EVENT, { detail }))
}
