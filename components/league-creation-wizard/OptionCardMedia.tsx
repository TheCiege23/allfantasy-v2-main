'use client'

import { useEffect, useRef, useState } from 'react'
import { cn } from '@/lib/utils'
import { shouldAttemptVideo } from '@/lib/league-media/resolveOptionMedia'

type OptionCardMediaProps = {
  /** Relative or absolute URL to MP4/WebM; if missing or unloadable, poster/fallback image is used. */
  videoSrc?: string | null
  posterSrc: string
  fallbackSrc: string
  /** Frame around media (height / aspect). */
  frameClassName?: string
  className?: string
  /** Extra classes on video + image layers (object-fit, etc.). */
  mediaClassName?: string
  /** Dark gradient on top for label readability. */
  gradientOverlay?: boolean
  /** Disable video attempt (image only). */
  enableVideo?: boolean
  /** `preload` on video — default `none` for lighter first paint. */
  preload?: 'none' | 'metadata' | 'auto'
}

/**
 * Premium card background: optional muted looping MP4 with poster/fallback image, object-cover, no controls.
 */
export function OptionCardMedia({
  videoSrc,
  posterSrc,
  fallbackSrc,
  frameClassName = 'relative aspect-[16/9] min-h-[8rem] w-full overflow-hidden bg-black/40 sm:min-h-[7.5rem]',
  className,
  mediaClassName = 'object-cover object-center',
  gradientOverlay = true,
  enableVideo = true,
  preload = 'none',
}: OptionCardMediaProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const videoRef = useRef<HTMLVideoElement>(null)
  const [videoFailed, setVideoFailed] = useState(false)
  const tryVideo = Boolean(enableVideo && videoSrc && shouldAttemptVideo(videoSrc) && !videoFailed)

  useEffect(() => {
    setVideoFailed(false)
  }, [videoSrc])

  useEffect(() => {
    const root = containerRef.current
    const vid = videoRef.current
    if (!tryVideo || !root || !vid) return

    const io = new IntersectionObserver(
      (entries) => {
        entries.forEach((e) => {
          if (e.isIntersecting) {
            void vid.play().catch(() => {})
          } else {
            vid.pause()
          }
        })
      },
      { rootMargin: '100px', threshold: 0.08 }
    )
    io.observe(root)
    return () => io.disconnect()
  }, [tryVideo, videoSrc])

  return (
    <div
      ref={containerRef}
      className={cn(frameClassName, className)}
      aria-hidden
      data-testid="option-card-media"
    >
      {/* eslint-disable-next-line @next/next/no-img-element -- dynamic poster/fallback; small tiles */}
      <img
        src={posterSrc}
        alt=""
        loading="lazy"
        decoding="async"
        className={cn('pointer-events-none absolute inset-0 z-0 h-full w-full', mediaClassName)}
        onError={(e) => {
          e.currentTarget.src = fallbackSrc
        }}
      />
      {tryVideo ? (
        <video
          ref={videoRef}
          className={cn('absolute inset-0 z-[1] h-full w-full', mediaClassName)}
          src={videoSrc!}
          poster={posterSrc}
          muted
          loop
          playsInline
          preload={preload}
          autoPlay
          controls={false}
          disablePictureInPicture
          onError={() => setVideoFailed(true)}
          aria-hidden
        />
      ) : null}
      {gradientOverlay ? (
        <div
          className="pointer-events-none absolute inset-0 z-[2] bg-gradient-to-t from-black/75 via-black/30 to-black/10"
          aria-hidden
        />
      ) : null}
    </div>
  )
}

type LeagueStepPreviewVideoProps = {
  videoSrc?: string | null
  posterSrc: string
  fallbackSrc: string
  description: string
  className?: string
  enableVideo?: boolean
}

/**
 * Larger preview strip (selected option) — no controls, same fallback behavior as card media.
 */
export function LeagueStepPreviewVideo({
  videoSrc,
  posterSrc,
  fallbackSrc,
  description,
  className,
  enableVideo = true,
}: LeagueStepPreviewVideoProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const videoRef = useRef<HTMLVideoElement>(null)
  const [videoFailed, setVideoFailed] = useState(false)
  const tryVideo = Boolean(enableVideo && videoSrc && shouldAttemptVideo(videoSrc) && !videoFailed)

  useEffect(() => {
    setVideoFailed(false)
  }, [videoSrc])

  useEffect(() => {
    const root = containerRef.current
    const vid = videoRef.current
    if (!tryVideo || !root || !vid) return
    const io = new IntersectionObserver(
      (entries) => {
        entries.forEach((e) => {
          if (e.isIntersecting) void vid.play().catch(() => {})
          else vid.pause()
        })
      },
      { rootMargin: '120px', threshold: 0.1 }
    )
    io.observe(root)
    return () => io.disconnect()
  }, [tryVideo, videoSrc])

  return (
    <div
      ref={containerRef}
      className={cn(
        'relative mt-3 h-44 w-full overflow-hidden rounded-xl border border-white/15 bg-black',
        className
      )}
      role="img"
      aria-label={description}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={posterSrc}
        alt=""
        loading="lazy"
        decoding="async"
        className="absolute inset-0 z-0 h-full w-full object-cover object-center"
        onError={(e) => {
          e.currentTarget.src = fallbackSrc
        }}
      />
      {tryVideo ? (
        <video
          ref={videoRef}
          className="absolute inset-0 z-[1] h-full w-full object-cover object-center"
          src={videoSrc!}
          poster={posterSrc}
          muted
          loop
          playsInline
          preload="none"
          autoPlay
          controls={false}
          disablePictureInPicture
          onError={() => setVideoFailed(true)}
        />
      ) : null}
      <div
        className="pointer-events-none absolute inset-0 z-[2] bg-gradient-to-t from-black/50 via-transparent to-transparent"
        aria-hidden
      />
    </div>
  )
}
