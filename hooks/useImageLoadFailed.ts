'use client'

import { useEffect, useRef, useState } from 'react'

/**
 * Track whether an `<img>` failed to load — including a failure that happened BEFORE React hydrated.
 *
 * An `onError` prop alone is NOT sufficient on a server-rendered page. The browser starts fetching
 * the image while parsing the SSR'd HTML, so a 404/DNS failure can fire its error event before React
 * attaches the handler; the event is then gone forever and a broken-image glyph stays on screen.
 *
 * This was verified in a real browser against the dashboard, not reasoned about: a league whose
 * logoUrl pointed at a non-resolving host rendered a broken glyph with `complete === true` and
 * `naturalWidth === 0`, and the initials fallback never appeared — yet re-triggering the same load
 * post-hydration fired `onError` correctly and swapped the fallback in. The handler was fine; it
 * simply never saw the first error.
 *
 * The post-mount `complete && naturalWidth === 0` probe recovers exactly that missed error, because
 * a decoded image always reports a non-zero natural width.
 *
 * Usage: spread `ref` and `onError` onto the `<img>`, and render the fallback when `failed`.
 */
export function useImageLoadFailed(src: string | null | undefined) {
  const ref = useRef<HTMLImageElement>(null)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    // A new src deserves a fresh chance; re-running on src change also resets a prior failure.
    setFailed(false)
    const img = ref.current
    if (img && img.complete && img.naturalWidth === 0) setFailed(true)
  }, [src])

  return { ref, failed, onError: () => setFailed(true) }
}
