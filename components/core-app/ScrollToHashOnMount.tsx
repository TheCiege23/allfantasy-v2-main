'use client'

import { useEffect } from 'react'

/**
 * Scrolls the element with `id` into view when the URL's hash names it — once, on mount.
 *
 * 🛑 FOR A TARGET THAT STREAMS IN. The browser's own fragment scroll, and Next's after a
 * client navigation, both look for the element when the page commits; a section behind its
 * own Suspense boundary is not in the DOM yet, so both land on the top of the page and the
 * link looks like it did nothing. Mounting inside the target means this runs exactly when
 * the target exists.
 *
 * ⚠ ONLY WHEN THE HASH MATCHES, AND ONLY ON MOUNT. A section that scrolled itself into view
 * on every render — a game-day refresh re-renders every 20 seconds — would drag the page
 * back under someone reading elsewhere.
 */
export function ScrollToHashOnMount({ id }: { id: string }) {
  useEffect(() => {
    if (window.location.hash !== `#${id}`) return
    document.getElementById(id)?.scrollIntoView({ block: 'start' })
  }, [id])
  return null
}

export default ScrollToHashOnMount
