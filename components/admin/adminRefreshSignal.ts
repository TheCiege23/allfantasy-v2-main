'use client'

import { useEffect, useRef } from 'react'

/**
 * One signal for "the Command Center just refreshed".
 *
 * `router.refresh()` re-runs the server half of /admin, but it does NOT remount
 * client components — so every panel that fetched its own data on mount would
 * keep showing the numbers from whenever the tab was opened, beside a header
 * stamp that says the page is current. `AdminLiveRefresh` emits this event each
 * time a refresh completes, and each self-fetching panel reloads on it.
 */
export const ADMIN_REFRESH_EVENT = 'af-admin-refresh'

export function emitAdminRefresh() {
  window.dispatchEvent(new Event(ADMIN_REFRESH_EVENT))
}

/**
 * Calls `reload` on every Command Center refresh. The callback is held in a ref
 * so a panel can pass an inline closure over its current filters without
 * re-subscribing on every render.
 */
export function useAdminRefresh(reload: () => void) {
  const ref = useRef(reload)
  ref.current = reload
  useEffect(() => {
    const handler = () => ref.current()
    window.addEventListener(ADMIN_REFRESH_EVENT, handler)
    return () => window.removeEventListener(ADMIN_REFRESH_EVENT, handler)
  }, [])
}
