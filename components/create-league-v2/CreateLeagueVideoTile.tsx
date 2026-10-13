'use client'

import { useEffect, useRef, useState, type ReactNode } from 'react'
import { CheckCircle2, Pause, Play } from 'lucide-react'

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

type NetworkInformationLike = {
  saveData?: boolean
  effectiveType?: string
  type?: string
  addEventListener?: (type: 'change', listener: () => void) => void
  removeEventListener?: (type: 'change', listener: () => void) => void
}

/**
 * Whether tile videos should stay as still images until the manager presses Play.
 *
 * A create flow on a phone holds ~20 of these tiles, and each one used to fetch its video's
 * metadata on load and stream the clip on every tap. So: always on a touch-only device (iOS does
 * not expose whether it is on cellular, so "phone" is the honest proxy), and on any device that
 * reports Save-Data, a cellular link, or a 2G/3G-class connection. Desktop hover previews are
 * unchanged.
 */
export function isDataSaver(connection: NetworkInformationLike | undefined, touchOnly: boolean): boolean {
  if (touchOnly) return true
  if (!connection) return false
  if (connection.saveData === true || connection.type === 'cellular') return true
  return ['slow-2g', '2g', '3g'].includes(connection.effectiveType ?? '')
}

function useDataSaver(): boolean {
  const [saver, setSaver] = useState(false)

  useEffect(() => {
    if (typeof window === 'undefined') return
    const connection = (navigator as Navigator & { connection?: NetworkInformationLike }).connection
    const touchQuery = typeof window.matchMedia === 'function' ? window.matchMedia('(hover: none)') : null
    const evaluate = () => setSaver(isDataSaver(connection, touchQuery?.matches === true))
    evaluate()
    connection?.addEventListener?.('change', evaluate)
    touchQuery?.addEventListener?.('change', evaluate)
    return () => {
      connection?.removeEventListener?.('change', evaluate)
      touchQuery?.removeEventListener?.('change', evaluate)
    }
  }, [])

  return saver
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
  const dataSaver = useDataSaver()
  const [previewing, setPreviewing] = useState(false)
  const [playingByChoice, setPlayingByChoice] = useState(false)
  const [activeSrc, setActiveSrc] = useState(media?.video?.trim() || '')
  const [videoFailed, setVideoFailed] = useState(false)
  // Reduced motion and data saver both mean: no automatic preview; the Play button still works.
  const videoDisabled = disabled || locked || videoFailed || !activeSrc || ((prefersReducedMotion || dataSaver) && !playingByChoice)

  useEffect(() => {
    setActiveSrc(media?.video?.trim() || '')
    setVideoFailed(false)
    setPreviewing(false)
    setPlayingByChoice(false)
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

  const startPreview = (withSound = false) => {
    if (disabled || locked || videoFailed || !activeSrc || ((prefersReducedMotion || dataSaver) && !withSound)) return
    if (playingByChoice && !withSound) return
    const video = videoRef.current
    if (!video) return
    video.muted = !withSound
    video.playsInline = true
    setPreviewing(true)
    void video.play().catch(() => {
      setPreviewing(false)
      setPlayingByChoice(false)
    })
  }

  const stopPreview = () => {
    if (playingByChoice) return
    setPreviewing(false)
    resetVideo()
  }

  const togglePlayback = () => {
    if (playingByChoice) {
      setPlayingByChoice(false)
      setPreviewing(false)
      resetVideo()
      return
    }
    setPlayingByChoice(true)
    startPreview(true)
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
    setPlayingByChoice(false)
  }

  return (
    <div className="relative h-full">
    <button
      type="button"
      onClick={onSelect}
      onMouseEnter={() => startPreview()}
      onMouseLeave={stopPreview}
      onFocus={() => startPreview()}
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
        /*
         * Phone first: two tiles to a row at 375px, so the padding and type step down below `sm`.
         * `touch-manipulation` drops the double-tap-to-zoom wait on iOS and Android, and the lift
         * on hover is scoped to pointers that can hover — on a phone a tap leaves `:hover` stuck
         * on the last tile touched, which read as a second selection.
         */
        'group relative isolate h-full min-h-[5.5rem] w-full touch-manipulation select-none overflow-hidden rounded-2xl border p-3 text-left shadow-sm outline-none transition duration-200 [-webkit-tap-highlight-color:transparent] motion-reduce:transition-none sm:min-h-24 sm:p-4',
        'focus-visible:ring-2 focus-visible:ring-violet-500 focus-visible:ring-offset-2 focus-visible:ring-offset-[color:var(--surface-app)]',
        disabled
          ? 'cursor-not-allowed opacity-60'
          : 'active:scale-[0.98] [@media(hover:hover)]:hover:-translate-y-0.5 [@media(hover:hover)]:hover:scale-[1.012] [@media(hover:hover)]:hover:shadow-xl [@media(hover:hover)]:hover:shadow-violet-600/10 focus-visible:-translate-y-0.5 focus-visible:scale-[1.012]',
        selected
          ? 'border-violet-500 bg-violet-600 text-[#ffffff] shadow-lg shadow-violet-600/20'
          : 'border-[color:var(--border-subtle)] bg-[color:var(--surface-card-soft)] [@media(hover:hover)]:hover:border-violet-400',
        'motion-reduce:active:scale-100 motion-reduce:hover:translate-y-0 motion-reduce:hover:scale-100 motion-reduce:focus-visible:translate-y-0 motion-reduce:focus-visible:scale-100',
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
          preload={dataSaver ? 'none' : 'metadata'}
          aria-hidden="true"
          data-testid={testId ? `${testId}-video` : undefined}
          onError={handleVideoError}
          className={cx(
            'pointer-events-none absolute inset-0 -z-10 h-full w-full object-cover opacity-0 transition-opacity duration-200',
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
          className="absolute right-2.5 top-2.5 z-10 h-5 w-5 text-[#ffffff] drop-shadow sm:right-3 sm:top-3"
          strokeWidth={2.5}
        />
      ) : null}

      {/* The right 40px column is reserved for the check (top) and the play control (bottom), so
          neither can sit on top of the hint text however many lines it wraps to. */}
      <span className="relative z-10 block pr-9 sm:pr-10">
        {eyebrow ? (
          <span className={cx('mb-1 block text-[11px] font-black uppercase tracking-[0.16em]', selected ? 'text-[rgba(255,255,255,0.7)]' : 'text-violet-600 dark:text-violet-300')}>
            {eyebrow}
          </span>
        ) : null}
        <span className="block text-base font-black leading-tight sm:text-lg">{title}</span>
        {hint ? (
          <span className={cx('mt-1.5 block text-[11px] leading-4 sm:mt-2 sm:text-xs sm:leading-5', selected ? 'text-[rgba(255,255,255,0.78)]' : 'text-[color:var(--text-tertiary)]')}>
            {hint}
          </span>
        ) : null}
        {children}
      </span>
    </button>
    {!disabled && !locked && !videoFailed && activeSrc ? (
      <button
        type="button"
        onClick={togglePlayback}
        aria-label={`${playingByChoice ? 'Pause' : 'Play'} ${title} video`}
        aria-pressed={playingByChoice}
        title={playingByChoice ? 'Pause video' : 'Play video'}
        className="absolute bottom-2 right-2 z-20 grid h-8 w-8 touch-manipulation place-items-center rounded-full bg-[rgba(0,0,0,0.62)] text-[#ffffff] ring-1 ring-[rgba(255,255,255,0.15)] backdrop-blur-sm transition hover:bg-[rgba(0,0,0,0.82)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet-500 before:absolute before:-inset-1.5 before:content-['']"
      >
        {playingByChoice
          ? <Pause aria-hidden="true" className="h-3.5 w-3.5" fill="currentColor" strokeWidth={0} />
          : <Play aria-hidden="true" className="ml-0.5 h-3.5 w-3.5" fill="currentColor" strokeWidth={0} />}
      </button>
    ) : null}
    </div>
  )
}
