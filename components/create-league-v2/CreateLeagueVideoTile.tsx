'use client'

import { useEffect, useRef, useState, type ReactNode } from 'react'
import { CheckCircle2 } from 'lucide-react'

function cx(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(' ')
}

function usePrefersReducedMotion(): boolean {
  const [prefersReducedMotion, setPrefersReducedMotion] = useState(false)

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return

    const query = window.matchMedia('(prefers-reduced-motion: reduce)')
    setPrefersReducedMotion(query.matches)

    const onChange = (event: MediaQueryListEvent) => setPrefersReducedMotion(event.matches)
    query.addEventListener?.('change', onChange)
    return () => query.removeEventListener?.('change', onChange)
  }, [])

  return prefersReducedMotion
}

export type CreateLeagueVideoTileMedia = {
  video?: string | null
  poster?: string | null
  fallback?: string | null
}

export type CreateLeagueVideoTileProps = {
  title: string
  hint?: string
  eyebrow?: string
  selected: boolean
  onSelect: () => void
  media?: CreateLeagueVideoTileMedia
  disabled?: boolean
  locked?: boolean
  className?: string
  testId?: string
  children?: ReactNode
}

export function CreateLeagueVideoTile({
  title,
  hint,
  eyebrow,
  selected,
  onSelect,
  media,
  disabled = false,
  locked = false,
  className,
  testId,
  children,
}: CreateLeagueVideoTileProps) {
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const prefersReducedMotion = usePrefersReducedMotion()
  const [previewing, setPreviewing] = useState(false)
  const [activeSrc, setActiveSrc] = useState(media?.video?.trim() || '')
  const [videoFailed, setVideoFailed] = useState(false)
  const videoDisabled = disabled || locked || prefersReducedMotion || videoFailed || !activeSrc

  useEffect(() => {
    setActiveSrc(media?.video?.trim() || '')
    setVideoFailed(false)
    setPreviewing(false)
  }, [media?.video])

  const resetVideo = () => {
    const video = videoRef.current
    if (!video) return
    video.pause()
    try {
      video.currentTime = 0
    } catch {
      // Some browsers reject currentTime before metadata is ready; pausing is enough.
    }
  }

  const startPreview = () => {
    if (videoDisabled) return
    const video = videoRef.current
    if (!video) return
    video.muted = true
    video.playsInline = true
    setPreviewing(true)
    void video.play().catch(() => {
      setPreviewing(false)
    })
  }

  const stopPreview = () => {
    setPreviewing(false)
    resetVideo()
  }

  const handleVideoError = () => {
    const fallback = media?.fallback?.trim()
    if (fallback && fallback !== activeSrc) {
      setActiveSrc(fallback)
      setVideoFailed(false)
      requestAnimationFrame(() => videoRef.current?.load())
      return
    }
    setVideoFailed(true)
    setPreviewing(false)
  }

  return (
    <button
      type="button"
      onClick={onSelect}
      onMouseEnter={startPreview}
      onMouseLeave={stopPreview}
      onFocus={startPreview}
      onBlur={stopPreview}
      onPointerDown={(event) => {
        if (event.pointerType !== 'mouse') startPreview()
      }}
      disabled={disabled}
      aria-pressed={selected}
      data-testid={testId}
      data-video-preview={previewing && !videoDisabled ? 'playing' : 'paused'}
      data-video-disabled={videoDisabled ? 'true' : 'false'}
      className={cx(
        'group relative isolate min-h-24 overflow-hidden rounded-2xl border p-4 text-left shadow-sm outline-none transition duration-200 motion-reduce:transition-none',
        'focus-visible:ring-2 focus-visible:ring-violet-500 focus-visible:ring-offset-2 focus-visible:ring-offset-[color:var(--surface-app)]',
        disabled
          ? 'cursor-not-allowed opacity-60'
          : 'hover:-translate-y-0.5 hover:scale-[1.012] hover:shadow-xl hover:shadow-violet-600/10 focus-visible:-translate-y-0.5 focus-visible:scale-[1.012]',
        selected
          ? 'border-violet-500 bg-violet-600 text-white shadow-lg shadow-violet-600/20'
          : 'border-[color:var(--border-subtle)] bg-[color:var(--surface-card-soft)] hover:border-violet-400',
        'motion-reduce:hover:translate-y-0 motion-reduce:hover:scale-100 motion-reduce:focus-visible:translate-y-0 motion-reduce:focus-visible:scale-100',
        className,
      )}
    >
      {media?.poster ? (
        <img
          src={media.poster}
          alt=""
          loading="lazy"
          decoding="async"
          className={cx(
            'pointer-events-none absolute inset-0 -z-20 h-full w-full object-cover opacity-20 transition-opacity duration-200',
            selected ? 'opacity-25' : 'group-hover:opacity-30 group-focus-visible:opacity-30',
          )}
        />
      ) : null}

      {activeSrc ? (
        <video
          ref={videoRef}
          src={activeSrc}
          poster={media?.poster ?? undefined}
          muted
          loop
          playsInline
          preload="metadata"
          aria-hidden="true"
          data-testid={testId ? `${testId}-video` : undefined}
          onError={handleVideoError}
          className={cx(
            'pointer-events-none absolute inset-0 -z-10 h-full w-full object-cover opacity-0 transition-opacity duration-200 motion-reduce:hidden',
            previewing && !videoDisabled ? 'opacity-45' : 'opacity-0',
            selected && previewing && !videoDisabled ? 'opacity-30' : false,
          )}
        />
      ) : null}

      <span
        className={cx(
          'pointer-events-none absolute inset-0 -z-10 bg-gradient-to-br',
          selected
            ? 'from-violet-950/30 via-violet-700/18 to-black/20'
            : 'from-[color:var(--surface-card-soft)]/90 via-[color:var(--surface-card-soft)]/76 to-black/10 dark:from-slate-950/80 dark:via-slate-950/55 dark:to-black/25',
        )}
        aria-hidden="true"
      />

      {selected ? (
        <CheckCircle2
          aria-hidden="true"
          className="absolute right-3 top-3 z-10 h-5 w-5 text-white drop-shadow"
          strokeWidth={2.5}
        />
      ) : null}

      <span className="relative z-10 block pr-8">
        {eyebrow ? (
          <span className={cx('mb-1 block text-[10px] font-black uppercase tracking-[0.16em]', selected ? 'text-white/70' : 'text-violet-600 dark:text-violet-300')}>
            {eyebrow}
          </span>
        ) : null}
        <span className="block text-lg font-black leading-tight">{title}</span>
        {hint ? (
          <span className={cx('mt-2 block text-xs leading-5', selected ? 'text-white/78' : 'text-[color:var(--text-tertiary)]')}>
            {hint}
          </span>
        ) : null}
        {children}
      </span>
    </button>
  )
}
