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
 */
export function FallbackImg({
  src,
  fallback,
  ...img
}: Omit<ImgHTMLAttributes<HTMLImageElement>, 'src' | 'onError'> & {
  src: string
  fallback: ReactNode
}) {
  const [failedSrc, setFailedSrc] = useState<string | null>(null)
  const ref = useRef<HTMLImageElement | null>(null)

  useEffect(() => {
    const el = ref.current
    /*
     * ⚠ NOT FOR A LAZY IMAGE. One still deferred off-screen has not been requested, and some
     * engines report it `complete` with no `naturalWidth` — reading that as a failure would
     * pin initials on every row below the fold. A lazy image loads after hydration anyway,
     * so its `onError` is already listening.
     */
    if (el && el.loading !== 'lazy' && el.complete && el.naturalWidth === 0) setFailedSrc(src)
  }, [src])

  if (failedSrc === src) return <>{fallback}</>
  // eslint-disable-next-line @next/next/no-img-element, jsx-a11y/alt-text
  return <img {...img} ref={ref} src={src} onError={() => setFailedSrc(src)} />
}

export default FallbackImg
