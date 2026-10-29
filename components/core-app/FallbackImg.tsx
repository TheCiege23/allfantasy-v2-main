'use client'

import { useEffect, useRef, useState, type ImgHTMLAttributes, type ReactNode } from 'react'

/**
 * An `<img>` that becomes its own fallback when the image fails to load.
 *
 * ⚠ A URL ON FILE IS NOT AN IMAGE THAT LOADS. Sleeper's CDN refuses ~10% of current
 * NFL player ids and ~23% of old ones, and a guessed logo path 404s — every `url ? <img>
 * : initials` site handled the missing URL and showed a broken-image glyph for the dead
 * one. Pass the same node you render when there is no URL, and a dead URL lands there too.
 *
 * ⚠ THE ERROR CAN FIRE BEFORE REACT IS LISTENING. A server-rendered `<img>` that fails
 * before hydration never calls `onError`, so mount also checks `complete` with no
 * `naturalWidth` — the browser's own record that the load already failed.
 *
 * Client-only by necessity, but its `fallback` is plain JSX, so server components use it.
 *
 * Lazy and async-decoded by default: most callers are rows of headshots and logos, and only 28
 * of /core's ~99 `<img>`s opted into `loading="lazy"`, so a long roster fetched every image on
 * first paint on a phone. Pass `loading="eager"` for an image that must arrive with the page.
 */
export function FallbackImg({
  src,
  fallback,
  loading = 'lazy',
  decoding = 'async',
  ...img
}: Omit<ImgHTMLAttributes<HTMLImageElement>, 'src' | 'onError'> & {
  src: string
  fallback: ReactNode
}) {
  const [failedSrc, setFailedSrc] = useState<string | null>(null)
  const ref = useRef<HTMLImageElement | null>(null)

  useEffect(() => {
    const el = ref.current
    if (!el || !el.complete || el.naturalWidth !== 0) return
    if (el.loading !== 'lazy') {
      setFailedSrc(src)
      return
    }
    /*
     * ⚠ A LAZY `complete` WITH NO `naturalWidth` IS AMBIGUOUS. One still deferred off-screen has
     * not been requested, and some engines report it that way — reading it as a failure would pin
     * initials on every row below the fold. But a lazy image that IS on screen loads at parse time
     * and can fail before React is listening, leaving a broken-image glyph. A probe settles it:
     * it errors only for a URL that is really dead. (Where an engine reports deferred images this
     * way, the probe fetches them early — correctness over laziness, in those engines only.)
     */
    let live = true
    const probe = new Image()
    probe.onerror = () => {
      if (live) setFailedSrc(src)
    }
    probe.src = src
    return () => {
      live = false
      probe.onerror = null
    }
  }, [src])

  if (failedSrc === src) return <>{fallback}</>
  // eslint-disable-next-line @next/next/no-img-element, jsx-a11y/alt-text
  return <img {...img} loading={loading} decoding={decoding} ref={ref} src={src} onError={() => setFailedSrc(src)} />
}

export default FallbackImg
