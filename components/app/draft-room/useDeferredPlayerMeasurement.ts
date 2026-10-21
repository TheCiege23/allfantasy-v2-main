'use client'

import { useCallback, useEffect, useRef } from 'react'

/** Keep virtualizer updates outside React's ref commit and cancel detached rows. */
export function useDeferredPlayerMeasurement(measure: (node: Element | null) => void) {
  const latest = useRef(measure)
  latest.current = measure
  const pending = useRef(new Map<Element, number>())
  useEffect(() => () => {
    for (const frame of pending.current.values()) cancelAnimationFrame(frame)
    pending.current.clear()
  }, [])
  return useCallback((node: Element | null) => {
    if (!node) return
    if (pending.current.has(node)) return
    const frame = requestAnimationFrame(() => {
      pending.current.delete(node)
      if (node.isConnected) latest.current(node)
    })
    pending.current.set(node, frame)
  }, [])
}

/** Use one CSS-pixel measurement for ref and ResizeObserver paths at fractional zoom. */
export function measurePlayerRow(node: Element): number {
  return Math.round(node.getBoundingClientRect().height)
}
