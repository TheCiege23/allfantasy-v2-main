'use client'

import { useEffect, useState, useSyncExternalStore } from 'react'
import DraftRoomMusicBar from '@/components/app/draft-room/DraftRoomMusicBar'
import { musicBus, placeYouTube, type MusicActions } from '@/components/app-music/musicBus'
import '@/components/app-music/af-app-music.css'

/**
 * Stands in for AppMusicDock's YouTube box: the same class, attributes and placement rule (placeYouTube), with a
 * grey square where the iframe would be, so the spec can measure where the player sits without loading YouTube.
 */
function StandInPlayer() {
  const snap = useSyncExternalStore(musicBus.subscribe, musicBus.getSnapshot, musicBus.getServerSnapshot)
  const screen = useSyncExternalStore(musicBus.subscribe, musicBus.getScreen, musicBus.getServerScreen)
  const slot = useSyncExternalStore(musicBus.subscribe, musicBus.getSlot, musicBus.getServerSlot)
  if (!snap.yt) return null
  const place = placeYouTube(screen, slot)
  const rect = place.rect
  return (
    <div
      className="af-amd-yt"
      data-testid="stand-in-player"
      data-where={place.where}
      data-in-chat={place.where === 'chat' ? 'true' : undefined}
      data-in-slot={place.where === 'slot' ? 'true' : undefined}
      style={rect ? { left: rect.left, top: rect.top, width: rect.width, height: rect.height } : undefined}
    >
      {rect ? null : <div className="af-amd-yt-head"><span className="af-amd-yt-title">{snap.yt.label}</span></div>}
      <iframe title="stand-in player" srcDoc="<body style='margin:0;background:#555'></body>" />
    </div>
  )
}

/**
 * The draft room's music bar (2026-11-17) with a STAND-IN music engine: the real bar, but the engine only records
 * what it was asked to do and reports it back as playing, so the page plays no audio. The spec stubs the playlist
 * route (GET/PUT /api/leagues/e2e-league/draft/playlist). The /e2e layout blocks this route in production.
 */
export default function DraftRoomMusicHarness() {
  const [log, setLog] = useState<string[]>([])
  const [status, setStatus] = useState('in_progress')
  useEffect(() => {
    const note = (line: string) => setLog((prev) => [...prev, line])
    const actions = {
      playYouTube: (next: { key: string; label: string; source: unknown }) => {
        note(`play ${next.key} — ${next.label}`)
        musicBus.publish({ ...musicBus.getSnapshot(), yt: next as never })
      },
      stop: () => {
        note('stop')
        musicBus.publish({ ...musicBus.getSnapshot(), yt: null })
      },
      startApple: () => undefined,
      connectApple: () => undefined,
      disconnectApple: () => undefined,
      search: () => undefined,
      playApple: () => undefined,
      appleToggle: () => undefined,
    } as unknown as MusicActions
    musicBus.setActions(actions)
    musicBus.publish({ ...musicBus.getSnapshot(), ready: true })
    return () => musicBus.setActions(null)
  }, [])
  return (
    <main className="min-h-screen bg-[#07111f] p-3 sm:p-6">
      <div className="mx-auto flex max-w-4xl flex-col gap-2 text-sm text-white/80">
        <div className="rounded-xl border border-white/10 bg-white/[0.04] px-3 py-2 text-xs text-white/60">
          Draft room top bar · Round 3, pick 5 · You are on the clock in 2 picks
        </div>
        <DraftRoomMusicBar leagueId="e2e-league" draftStatus={status} />
        <StandInPlayer />
        <div className="grid h-40 grid-cols-6 gap-1 rounded-xl border border-white/10 p-2" aria-hidden data-testid="harness-board">
          {Array.from({ length: 18 }, (_, i) => (
            <div key={i} className="rounded bg-white/[0.06]" />
          ))}
        </div>
        <div className="flex gap-2 text-xs">
          <button type="button" className="rounded border border-white/20 px-2 py-1" onClick={() => setStatus('completed')} data-testid="harness-complete">
            Finish the draft
          </button>
          <span data-testid="harness-status">{status}</span>
        </div>
        <ol className="mt-2 text-xs text-white/50" data-testid="music-engine-log">
          {log.map((l, i) => (
            <li key={i}>{l}</li>
          ))}
        </ol>
      </div>
    </main>
  )
}
