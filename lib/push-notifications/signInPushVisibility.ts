'use client'

import { useLayoutEffect, useSyncExternalStore } from 'react'

const visibleSheets = new Set<symbol>()
const listeners = new Set<() => void>()
const notify = () => listeners.forEach(listener => listener())
const subscribe = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener) } }

/**
 * The welcome guide waits until the sign-in permission flow has been dismissed.
 *
 * A LAYOUT effect, not a passive one (2026-11-23). A passive effect runs after the sheet is already in the DOM,
 * so for a frame both the sheet and the guide were painted — on a slow phone a visible double prompt, and in CI
 * a flaky signin-push-sheet test on PRs that never touched it. A layout effect publishes in the same commit, and
 * useSyncExternalStore re-renders the guide synchronously, so they are never on screen together.
 */
export function usePublishSignInPushVisibility(open: boolean) {
  useLayoutEffect(() => {
    if (!open) return
    const sheet = Symbol('sign-in-push')
    visibleSheets.add(sheet); notify()
    return () => { visibleSheets.delete(sheet); notify() }
  }, [open])
}

export function useSignInPushVisible(): boolean {
  return useSyncExternalStore(subscribe, () => visibleSheets.size > 0, () => false)
}
