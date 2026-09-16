'use client'

import { useState } from 'react'

/**
 * A league's (or manager's) artwork, degrading to a letter rather than to a
 * broken-image glyph.
 *
 * ⚠ ONE IMPLEMENTATION, TWO CALLERS, AND THAT IS THE WHOLE REASON IT IS ITS OWN
 * MODULE. This logic was `RailMark`, private to `AfCoreShell`, when the league
 * header needed the same behaviour at a different size. Copying four lines would
 * have been quicker and would have given the rail and the header two different
 * opinions about what happens when artwork 404s — the class of drift this
 * codebase already carries several notes about. `RailMark` now delegates here.
 *
 * ⚠ `alt` IS EMPTY ON PURPOSE. Every caller wraps this in something that already
 * carries the accessible name — a link, or a header that prints the league name
 * beside it — and a non-empty alt reads the name twice.
 */
export function LeagueMark({
  src,
  letter,
  className = 'af-rail-tile-img',
}: {
  src: string | null | undefined
  letter: string
  className?: string
}) {
  const [failed, setFailed] = useState(false)
  if (!src || failed) return <>{letter}</>
  return (
    <img
      src={src}
      alt=""
      className={className}
      onError={() => setFailed(true)}
      loading="lazy"
    />
  )
}

export default LeagueMark
