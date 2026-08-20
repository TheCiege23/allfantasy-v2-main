'use client'

import { useState } from 'react'

/**
 * An `<img>` that removes itself — and its frame — when the source 404s.
 *
 * ⚠ THE FRAME IS THE POINT. A bare `<img>` whose src is missing renders the
 * browser's broken-image glyph; wrapping it in a bordered container and hiding
 * only the image leaves an empty bordered box, which looks just as broken. Both
 * go, so a missing asset degrades to nothing at all rather than to visible
 * damage.
 *
 * ⚠ ONLY FOR SUPPLEMENTARY IMAGERY. Use this where the surrounding content
 * still makes sense without the picture — a screenshot beside written steps, a
 * decorative panel. If an image IS the content, hiding it silently is worse
 * than showing it broken, because nobody finds out the asset is gone.
 *
 * Most image layers in this codebase already handle their own failure
 * (AllFantasyBracketBoard passes onError on its decorative layers,
 * WorldCupHeroMedia falls back to a poster and fires an analytics event). This
 * exists for the plain `<img>` tags that do not.
 */
export function GracefulImage({
  src,
  alt,
  className,
  wrapperClassName,
  width,
  height,
}: {
  src: string
  alt: string
  className?: string
  /** Applied to the frame, which is removed along with the image on failure. */
  wrapperClassName?: string
  width?: number
  height?: number
}) {
  const [failed, setFailed] = useState(false)
  if (failed) return null

  return (
    <div className={wrapperClassName}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={src}
        alt={alt}
        className={className}
        width={width}
        height={height}
        onError={() => setFailed(true)}
      />
    </div>
  )
}

export default GracefulImage
