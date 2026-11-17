'use client'

import { useEffect, useState } from 'react'
import ChimmyMusicCard from '@/components/chimmy/ChimmyMusicCard'
import { musicBus, type MusicActions } from '@/components/app-music/musicBus'

/**
 * Chimmy's music cards (2026-11-16) with a STAND-IN music engine: the real cards, but the engine's
 * actions only record what they were asked to do, so the page plays no audio. The /e2e layout blocks
 * this route in production; the spec stubs the YouTube search route.
 */
export default function ChimmyMusicCardHarness() {
  const [log, setLog] = useState<string[]>([])
  useEffect(() => {
    const note = (line: string) => setLog((prev) => [...prev, line])
    const actions = {
      playYouTube: (next: { key: string; label: string }) => note(`play ${next.key} — ${next.label}`),
      stop: () => note('stop'),
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
    <main className="min-h-screen bg-[#07111f] p-4 sm:p-8">
      <div className="mx-auto flex max-w-md flex-col gap-1 text-sm text-white/80">
        <p className="rounded-2xl bg-white/[0.06] p-3">A Game day hype card is ready — tap Play to start it.</p>
        <ChimmyMusicCard card={{ kind: 'station', stationId: 'game-day', label: 'Game day hype' }} />
        <p className="mt-4 rounded-2xl bg-white/[0.06] p-3">One tap finds Drake on YouTube and plays it.</p>
        <ChimmyMusicCard card={{ kind: 'search', term: 'Drake' }} />
        <p className="mt-4 rounded-2xl bg-white/[0.06] p-3">Tap Stop to end the music.</p>
        <ChimmyMusicCard card={{ kind: 'stop' }} />
        <ol className="mt-6 text-xs text-white/50" data-testid="music-engine-log">
          {log.map((l, i) => (
            <li key={i}>{l}</li>
          ))}
        </ol>
      </div>
    </main>
  )
}
