'use client'

import { useEffect, useRef, type ReactNode } from 'react'

/**
 * A `<details>` that is OPEN where there is room and FOLDED where there is not.
 *
 * ⚠ OPEN ON THE SERVER, FOLDED BY THE CLIENT — NOT THE OTHER WAY ROUND. Reference content (the
 * Waivers rules) belongs expanded in a two-column layout and folded to one line on a phone, and
 * CSS cannot set `open`. Rendering it closed and opening it on desktop would jump the right
 * column on every load, in plain view. Rendering it open and folding it on a phone moves only
 * content that sits BELOW the actions there, out of view. And a reader with scripts off gets
 * everything.
 *
 * The width measured is the nearest `[data-details-scope]` ancestor's, not the viewport's: the
 * core shell's rail takes a slice of the window, so a 1000px viewport is a ~760px page.
 */
export function ResponsiveDetails({
  summary,
  children,
  className,
  foldBelow = 900,
  testId,
}: {
  summary: ReactNode
  children: ReactNode
  className?: string
  /** Fold when the scope is narrower than this many px. */
  foldBelow?: number
  testId?: string
}) {
  const ref = useRef<HTMLDetailsElement>(null)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const scope = (el.closest('[data-details-scope]') as HTMLElement | null) ?? document.documentElement
    if (scope.clientWidth < foldBelow) el.open = false
  }, [foldBelow])
  return (
    <details ref={ref} open className={className} data-testid={testId}>
      <summary>{summary}</summary>
      {children}
    </details>
  )
}

export default ResponsiveDetails
