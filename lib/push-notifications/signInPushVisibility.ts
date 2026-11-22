'use client'

import { useEffect, useSyncExternalStore } from 'react'

const visibleSheets = new Set<symbol>()
const listeners = new Set<() => void>()
const notify = () => listeners.forEach(listener => listener())
const subscribe = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener) } }

/** The welcome guide waits until the sign-in permission flow has been dismissed. */
export function usePublishSignInPushVisibility(open: boolean) {
  useEffect(() => {
    if (!open) return
    const sheet = Symbol('sign-in-push')
    visibleSheets.add(sheet); notify()
    return () => { visibleSheets.delete(sheet); notify() }
  }, [open])
}

export function useSignInPushVisible(): boolean {
  return useSyncExternalStore(subscribe, () => visibleSheets.size > 0, () => false)
}
