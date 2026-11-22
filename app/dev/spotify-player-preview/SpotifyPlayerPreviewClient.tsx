'use client'

import { useEffect, useState } from 'react'
import { SpotifyPlayerBar, type PlayerBarPlayback } from '@/components/spotify/SpotifyPlayerBar'
import {
  SpotifyPlaylistPicker,
  type PickerPlaylist,
  type PickerState,
} from '@/components/spotify/SpotifyPlaylistPicker'

function cover(a: string, b: string): string {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="80" height="80"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${a}"/><stop offset="1" stop-color="${b}"/></linearGradient></defs><rect width="80" height="80" fill="url(#g)"/></svg>`
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`
}

const PLAYLISTS: PickerPlaylist[] = [
  { id: 'a1', name: 'Draft Night Hype', uri: 'spotify:playlist:a1', imageUrl: cover('#1DB954', '#0b3d2e'), trackCount: 48, ownerName: 'You' },
  { id: 'a2', name: 'Sunday Gameday', uri: 'spotify:playlist:a2', imageUrl: cover('#f97316', '#7c2d12'), trackCount: 112, ownerName: 'You' },
  { id: 'a3', name: 'Waiver Wire Focus', uri: 'spotify:playlist:a3', imageUrl: cover('#6366f1', '#1e1b4b'), trackCount: 31, ownerName: 'You' },
  { id: 'a4', name: 'League Chat Vibes (collab)', uri: 'spotify:playlist:a4', imageUrl: cover('#ec4899', '#500724'), trackCount: 67, ownerName: 'commish_mike' },
  { id: 'a5', name: 'Late Night Lineup Tweaks', uri: 'spotify:playlist:a5', imageUrl: null, trackCount: 1, ownerName: 'You' },
  { id: 'a6', name: "Today's Top Hits", uri: 'spotify:playlist:a6', imageUrl: cover('#eab308', '#422006'), trackCount: null, ownerName: 'Spotify' },
]

const PLAYING: PlayerBarPlayback = {
  trackName: 'Fourth Quarter Comeback',
  artistName: 'The Waiver Claims',
  albumArt: cover('#1DB954', '#0b3d2e'),
  paused: false,
}

type Scenario = {
  key: string
  label: string
  picker: PickerState | null
  playback: PlayerBarPlayback | null
  pendingUri?: string | null
  playError?: { message: string; reconnect?: boolean } | null
}

const SCENARIOS: Scenario[] = [
  { key: 'idle', label: 'Bar, nothing playing', picker: null, playback: null },
  { key: 'list', label: 'Picker open', picker: { status: 'ready', playlists: PLAYLISTS, notice: null, truncated: false }, playback: null },
  {
    key: 'old-grant',
    label: 'Old connection (public only)',
    picker: {
      status: 'ready',
      playlists: PLAYLISTS.slice(0, 2),
      notice: 'Showing public playlists only. Reconnect Spotify to include your private and collaborative ones.',
      truncated: false,
    },
    playback: null,
  },
  { key: 'starting', label: 'Starting a playlist', picker: { status: 'ready', playlists: PLAYLISTS, notice: null, truncated: false }, playback: null, pendingUri: 'spotify:playlist:a2' },
  {
    key: 'premium',
    label: 'Play refused: free account',
    picker: { status: 'ready', playlists: PLAYLISTS, notice: null, truncated: false },
    playback: null,
    playError: { message: 'In-browser playback needs Spotify Premium. Your account is connected and everything else works.' },
  },
  { key: 'loading', label: 'Loading', picker: { status: 'loading' }, playback: null },
  { key: 'error', label: 'Load failed', picker: { status: 'error', message: 'Could not load your Spotify playlists.' }, playback: null },
  { key: 'expired', label: 'Connection expired', picker: { status: 'error', message: 'Spotify connection expired. Reconnect Spotify.', reconnect: true }, playback: null },
  { key: 'empty', label: 'No playlists', picker: { status: 'ready', playlists: [], notice: null, truncated: false }, playback: null },
  { key: 'playing', label: 'Playing (picker closed)', picker: null, playback: PLAYING },
]

export function SpotifyPlayerPreviewClient() {
  const [key, setKey] = useState('list')
  // Read ?s= after mount so server and client render the same first frame.
  useEffect(() => {
    const s = new URLSearchParams(window.location.search).get('s')
    if (s) setKey(s)
  }, [])
  const scenario = SCENARIOS.find((s) => s.key === key) ?? SCENARIOS[1]
  const noop = () => {}

  return (
    <div className="min-h-screen bg-[#060b14] text-white">
      <div className="mx-auto max-w-screen-xl px-4 py-6">
        <h1 className="text-lg font-semibold">Spotify player preview</h1>
        <p className="mt-1 text-sm text-white/50">
          Real player bar and playlist picker with fixture data. Dev only.
        </p>
        <div className="mt-4 flex flex-wrap gap-2">
          {SCENARIOS.map((s) => (
            <button
              key={s.key}
              type="button"
              onClick={() => setKey(s.key)}
              className={`rounded-full px-3 py-1 text-xs ${s.key === scenario.key ? 'bg-[#1DB954] text-black' : 'bg-white/10 text-white/80 hover:bg-white/20'}`}
            >
              {s.label}
            </button>
          ))}
        </div>
      </div>

      <div className="fixed bottom-0 inset-x-0 z-50 pb-[env(safe-area-inset-bottom)]">
        {scenario.picker && (
          <SpotifyPlaylistPicker
            state={scenario.picker}
            pendingUri={scenario.pendingUri ?? null}
            playError={scenario.playError ?? null}
            onPick={noop}
            onClose={() => setKey('idle')}
            onRetry={noop}
          />
        )}
        <SpotifyPlayerBar
          playback={scenario.playback}
          muted={false}
          pickerOpen={scenario.picker !== null}
          onTogglePicker={() => setKey(scenario.picker ? 'idle' : 'list')}
          onOpenPicker={() => setKey('list')}
          onPrev={noop}
          onTogglePlay={noop}
          onNext={noop}
          onToggleMute={noop}
          onClose={noop}
        />
      </div>
    </div>
  )
}
