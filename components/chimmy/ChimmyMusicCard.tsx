'use client'

import { useState, useSyncExternalStore } from 'react'
import { Music2, Square, Loader2 } from 'lucide-react'
import { musicBus } from '@/components/app-music/musicBus'
import { findStation, type MusicCard } from '@/lib/chimmy/musicCards'

/**
 * A music card under a Chimmy answer (2026-11-16): "play some hype music" → one tap plays it.
 *
 * 🛑 NOTHING PLAYS WITHOUT THE TAP. The card only calls the app's music engine (AppMusicDock, through
 * musicBus) from the button's click — the same engine and the same calls as the Music tab. A search
 * runs the Music tab's own YouTube search route (its daily limits apply) and plays the top result.
 */

type YtHit = { videoId: string; title: string; channel: string; thumb: string | null }
type Phase = { kind: 'idle' } | { kind: 'busy' } | { kind: 'done'; note: string } | { kind: 'failed'; note: string }

async function topYouTubeHit(term: string): Promise<{ hit: YtHit | null; note: string | null }> {
  try {
    const res = await fetch(`/api/music/youtube-search?q=${encodeURIComponent(term)}`, { cache: 'no-store' })
    if (res.status === 401) return { hit: null, note: 'Sign in to search for music.' }
    const body = (await res.json()) as { status: string; results?: YtHit[]; scope?: string }
    if (body.status === 'ok') return body.results?.[0] ? { hit: body.results[0], note: null } : { hit: null, note: `Nothing found for "${term}".` }
    if (body.status === 'limit') return { hit: null, note: body.scope === 'user' ? "You've used today's music searches. Stations still work." : 'Music search is resting for today. Stations still work.' }
  } catch {
    /* fall through */
  }
  return { hit: null, note: 'Music search is unavailable right now. Stations still work.' }
}

export default function ChimmyMusicCard({ card }: { card: MusicCard }) {
  const snap = useSyncExternalStore(musicBus.subscribe, musicBus.getSnapshot, musicBus.getServerSnapshot)
  const [phase, setPhase] = useState<Phase>({ kind: 'idle' })
  const act = musicBus.actions()
  const available = Boolean(snap.ready && act)

  const title = card.kind === 'station' ? card.label : card.kind === 'search' ? `"${card.term}"` : 'Stop the music'
  const sub = card.kind === 'station' ? 'AllFantasy station' : card.kind === 'search' ? 'Top result on YouTube' : 'Whatever is playing now'
  const buttonLabel = card.kind === 'stop' ? 'Stop' : 'Play'

  async function onTap() {
    const a = musicBus.actions()
    if (!a || phase.kind === 'busy') return
    if (card.kind === 'stop') {
      a.stop()
      setPhase({ kind: 'done', note: 'Stopped.' })
      return
    }
    if (card.kind === 'station') {
      const station = findStation(card.stationId)
      if (!station) return setPhase({ kind: 'failed', note: 'That station is no longer available.' })
      a.playYouTube({ key: station.id, label: station.label, source: station.source })
      setPhase({ kind: 'done', note: 'Playing in the music player.' })
      return
    }
    setPhase({ kind: 'busy' })
    const { hit, note } = await topYouTubeHit(card.term)
    if (!hit) return setPhase({ kind: 'failed', note: note ?? 'Nothing to play.' })
    a.playYouTube({ key: `search:${hit.videoId}`, label: hit.title, source: { kind: 'video', videoId: hit.videoId } })
    setPhase({ kind: 'done', note: `Playing ${hit.title}.` })
  }

  return (
    <div className="mt-2 flex items-center gap-3 rounded-2xl border border-cyan-400/30 bg-cyan-500/[0.06] p-3 text-sm text-white/90" data-testid="chimmy-music-card" data-music-kind={card.kind}>
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-cyan-400/15 text-cyan-200" aria-hidden>
        {card.kind === 'stop' ? <Square className="h-4 w-4" /> : <Music2 className="h-4 w-4" />}
      </span>
      <div className="min-w-0 flex-1">
        <p className="truncate font-semibold text-white">{title}</p>
        <p className="truncate text-xs text-white/55" data-testid="chimmy-music-note">
          {!available ? 'Music is not available on this page.' : phase.kind === 'done' || phase.kind === 'failed' ? phase.note : sub}
        </p>
      </div>
      <button
        type="button"
        onClick={() => void onTap()}
        disabled={!available || phase.kind === 'busy'}
        data-testid="chimmy-music-play"
        className="inline-flex min-h-[40px] shrink-0 items-center gap-1.5 rounded-lg bg-cyan-500 px-4 py-2 text-sm font-semibold text-slate-950 hover:bg-cyan-400 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {phase.kind === 'busy' ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : null}
        {buttonLabel}
      </button>
    </div>
  )
}
