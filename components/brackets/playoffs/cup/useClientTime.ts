"use client"

import { useSyncExternalStore } from "react"

const subscribe = () => () => {}
const clientSnapshot = () => true
const serverSnapshot = () => false

/** Use a stable server rendering, then show dates in the viewer's timezone. */
export function useClientTime(): boolean {
  return useSyncExternalStore(subscribe, clientSnapshot, serverSnapshot)
}

