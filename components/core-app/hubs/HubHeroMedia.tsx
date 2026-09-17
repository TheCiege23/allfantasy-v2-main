'use client'

import { useEffect, useRef, useState } from 'react'

/**
 * The key-art layer behind a hub's hero band: a muted looping clip over its poster,
 * or the poster alone when there is no clip (redraft, and the all-leagues robot king).
 *
 * Ambient motion is decoration, so a reduced-motion preference holds the poster
 * frame, and a clip that fails to load falls back to the still.
 */
export function HubHeroMedia({ video, poster }: { video: string | null; poster: string }) {
  const ref = useRef<HTMLVideoElement | null>(null)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    const el = ref.current
    if (!el || typeof window === 'undefined' || typeof window.matchMedia !== 'function') return
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)')
    const apply = () => {
      if (mq.matches) {
        el.pause?.()
        return
      }
      // Older engines return undefined rather than a promise; a blocked autoplay just keeps the poster.
      const played = el.play?.() as Promise<void> | undefined
      if (played && typeof played.catch === 'function') played.catch(() => {})
    }
    apply()
    mq.addEventListener('change', apply)
    return () => mq.removeEventListener('change', apply)
  }, [video])

  if (!video || failed) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img className="afh-hero-media" src={poster} alt="" aria-hidden />
  }
  return (
    <video
      ref={ref}
      key={video}
      className="afh-hero-media"
      src={video}
      poster={poster}
      autoPlay
      loop
      muted
      playsInline
      preload="metadata"
      aria-hidden
      onError={() => setFailed(true)}
    />
  )
}
