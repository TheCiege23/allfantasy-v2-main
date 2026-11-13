'use client'

import Image from 'next/image'
import { ListMusic, Pause, Play, SkipBack, SkipForward, Volume2, VolumeX, X } from 'lucide-react'

export type PlayerBarPlayback = {
  trackName: string
  artistName: string
  albumArt: string
  paused: boolean
}

type Props = {
  playback: PlayerBarPlayback | null
  muted: boolean
  pickerOpen: boolean
  onTogglePicker: () => void
  onOpenPicker: () => void
  onPrev: () => void
  onTogglePlay: () => void
  onNext: () => void
  onToggleMute: () => void
  onClose: () => void
}

/** The mini player's bottom bar. Presentational — SpotifyMiniPlayer owns the SDK. */
export function SpotifyPlayerBar({
  playback,
  muted,
  pickerOpen,
  onTogglePicker,
  onOpenPicker,
  onPrev,
  onTogglePlay,
  onNext,
  onToggleMute,
  onClose,
}: Props) {
  return (
    <div className="border-t border-white/10 bg-[#0a1220]/95 backdrop-blur-md">
      <div className="mx-auto flex max-w-screen-xl items-center gap-3 px-4 py-2">
        {playback?.albumArt && (
          <Image
            src={playback.albumArt}
            alt="Album art"
            width={40}
            height={40}
            unoptimized
            className="h-10 w-10 shrink-0 rounded"
          />
        )}
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium text-white">
            {playback?.trackName ?? 'No track playing'}
          </p>
          {playback ? (
            <p className="truncate text-xs text-white/50">{playback.artistName}</p>
          ) : (
            <button
              type="button"
              onClick={onOpenPicker}
              className="max-w-full truncate text-xs text-[#1DB954] hover:underline"
            >
              Pick one of your playlists to start
            </button>
          )}
        </div>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={onTogglePicker}
            aria-label="Your playlists"
            aria-expanded={pickerOpen}
            className={`rounded p-1.5 hover:text-white ${pickerOpen ? 'text-[#1DB954]' : 'text-white/60'}`}
          >
            <ListMusic className="h-4 w-4" />
          </button>
          <button type="button" onClick={onPrev} aria-label="Previous track" className="p-1.5 text-white/60 hover:text-white">
            <SkipBack className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={onTogglePlay}
            aria-label={playback?.paused === false ? 'Pause' : 'Play'}
            className="rounded-full bg-white/10 p-2 text-white hover:bg-white/20"
          >
            {playback?.paused !== false ? <Play className="h-4 w-4" /> : <Pause className="h-4 w-4" />}
          </button>
          <button type="button" onClick={onNext} aria-label="Next track" className="p-1.5 text-white/60 hover:text-white">
            <SkipForward className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={onToggleMute}
            aria-label={muted ? 'Unmute' : 'Mute'}
            className="p-1.5 text-white/60 hover:text-white"
          >
            {muted ? <VolumeX className="h-4 w-4" /> : <Volume2 className="h-4 w-4" />}
          </button>
          <button type="button" onClick={onClose} aria-label="Close player" className="p-1.5 text-white/40 hover:text-white">
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>
    </div>
  )
}
