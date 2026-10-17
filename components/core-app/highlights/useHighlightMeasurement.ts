'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { sendProductAnalyticsBeacon } from '@/lib/analytics/client'
import { HIGHLIGHTS, HIGHLIGHTS_PREFIX } from '@/lib/analytics/highlights'
import type { HighlightAction, HighlightOutcome, HighlightSurface } from '@/lib/analytics/highlights'
import type { XPost } from '@/lib/highlights/x-types'

/** One exposure per mounted request. Visibility is a small header, not an entire tall feed. */
export function useHighlightMeasurement(surface: HighlightSurface, outcome: HighlightOutcome | null) {
  const header = useRef<HTMLElement>(null)
  const [viewId] = useState(() => globalThis.crypto?.randomUUID?.() ?? '10000000-1000-4000-8000-100000000000'.replace(/[018]/g, c => (Number(c) ^ Math.floor(Math.random() * 16) >> Number(c) / 4).toString(16)))
  const viewed = useRef(false)
  const sent = useRef(new Set<string>())
  const markView = useCallback((visibility: 'header' | 'interaction') => {
    if (!outcome || viewed.current) return
    viewed.current = true
    sendProductAnalyticsBeacon(HIGHLIGHTS.VIEW, { surface, viewId, ...outcome, visibility })
  }, [outcome, surface, viewId])

  useEffect(() => {
    if (!outcome || viewed.current || !header.current || typeof IntersectionObserver === 'undefined') return
    let visible = false
    let timer: ReturnType<typeof setTimeout> | undefined
    const reset = () => { clearTimeout(timer); timer = undefined }
    const update = () => {
      reset()
      if (visible && document.visibilityState === 'visible') timer = setTimeout(() => markView('header'), 1000)
    }
    const observer = new IntersectionObserver(entries => {
      visible = entries.some(e => e.isIntersecting && e.intersectionRatio >= 0.5)
      update()
    }, { threshold: [0, 0.5] })
    observer.observe(header.current)
    document.addEventListener('visibilitychange', update)
    return () => { reset(); observer.disconnect(); document.removeEventListener('visibilitychange', update) }
  }, [outcome, markView])

  const onPostEvent = useCallback((action: HighlightAction, post: XPost) => {
    const dedupKey = post.id + ':' + action
    if (sent.current.has(dedupKey)) return
    sent.current.add(dedupKey)
    // An explicit action also establishes exposure, even before the one-second dwell.
    markView('interaction')
    sendProductAnalyticsBeacon(HIGHLIGHTS_PREFIX + action, { surface, viewId, kind: post.kind })
  }, [markView, surface, viewId])
  return { header, onPostEvent }
}
