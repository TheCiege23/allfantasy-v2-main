'use client'

import { useCallback, useEffect, useState, useSyncExternalStore } from 'react'
import { ChevronDown, Lock, Music2 } from 'lucide-react'
import { musicBus } from '@/components/app-music/musicBus'
import { YOUTUBE_STATIONS } from '@/lib/draft-music/youtube'
import { findStation } from '@/lib/chimmy/musicCards'
import { draftPlaylistOffered, draftPlaylistPlayKey, type DraftPlaylist } from '@/lib/draft-room/draftPlaylist'

/**
 * Music in the live draft room (2026-11-17). ONE slim row under the top bar, in normal flow — never over the board.
 * The room is a fixed full-height screen, so every pixel this takes comes out of the board on a phone: the row holds
 * a title, one button and "More"; choosing a station and the commissioner's setting live behind "More".
 *
 *  - Everyone: play one of the AllFantasy stations (the same ones Chimmy offers). It plays on THEIR device only.
 *  - If the commissioner set a draft playlist (AF Commissioner / AF Supreme), the row leads with it while the draft
 *    runs, one tap to play. When the draft finishes, the playlist stops if it is what is playing.
 *  - The commissioner sets or clears it under "More"; without the plan it says which plans include it.
 *
 * 🛑 NOTHING PLAYS WITHOUT A TAP, and nothing is broadcast. See lib/draft-room/draftPlaylist.ts.
 * The player is the app-wide one (AppMusicDock, through musicBus), so music keeps playing after the room.
 */

type Info = { playlist: DraftPlaylist | null; isCommissioner: boolean; canSet: boolean; planRequired: boolean }

const btn = 'inline-flex min-h-[36px] shrink-0 items-center justify-center gap-1 rounded-lg px-3 text-xs font-semibold disabled:cursor-not-allowed disabled:opacity-50'
const primary = `${btn} bg-cyan-500 text-slate-950 hover:bg-cyan-400`
const quiet = `${btn} border border-white/15 bg-white/[0.04] text-white/85 hover:bg-white/10`
const select = 'min-h-[36px] min-w-0 flex-1 rounded-lg border border-white/15 bg-slate-900 px-2 text-xs text-white sm:flex-none'

export default function DraftRoomMusicBar({ leagueId, draftStatus }: { leagueId: string; draftStatus: string | null | undefined }) {
  const snap = useSyncExternalStore(musicBus.subscribe, musicBus.getSnapshot, musicBus.getServerSnapshot)
  const available = Boolean(snap.ready && musicBus.actions())
  const [info, setInfo] = useState<Info | null>(null)
  const [open, setOpen] = useState(false)
  const [pick, setPick] = useState(YOUTUBE_STATIONS[0]?.id ?? '')
  const [choice, setChoice] = useState('')
  const [saving, setSaving] = useState(false)
  const [note, setNote] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/leagues/${encodeURIComponent(leagueId)}/draft/playlist`, { cache: 'no-store' })
      if (!res.ok) return
      const next = (await res.json()) as Info
      setInfo(next)
      setChoice(next.playlist?.stationId ?? '')
    } catch {
      /* the bar still offers stations without it */
    }
  }, [leagueId])

  useEffect(() => {
    void load()
  }, [load, draftStatus])

  const playlist = info?.playlist && draftPlaylistOffered(draftStatus) ? info.playlist : null
  const playlistKey = playlist ? draftPlaylistPlayKey(playlist.stationId) : null
  const playing = snap.yt

  // The draft is over: the background playlist ends with it. Music a member chose themselves keeps going.
  useEffect(() => {
    if (draftStatus !== 'completed') return
    if (playing?.key.startsWith('draft-playlist:')) musicBus.actions()?.stop()
  }, [draftStatus, playing?.key])

  function play(stationId: string, key: string, label: string) {
    const station = findStation(stationId)
    if (station) musicBus.actions()?.playYouTube({ key, label, source: station.source })
  }
  const playPlaylist = () => playlist && play(playlist.stationId, playlistKey!, `${playlist.label} · draft playlist`)
  const playPick = () => play(pick, pick, findStation(pick)?.label ?? 'Music')

  async function save() {
    setSaving(true)
    setNote(null)
    try {
      const res = await fetch(`/api/leagues/${encodeURIComponent(leagueId)}/draft/playlist`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ stationId: choice || null }),
      })
      const body = (await res.json().catch(() => ({}))) as { playlist?: DraftPlaylist | null; error?: string }
      if (!res.ok) {
        setNote(body.error ?? 'Could not save the playlist.')
        return
      }
      setInfo((prev) => (prev ? { ...prev, playlist: body.playlist ?? null } : prev))
      setNote(body.playlist ? `Draft playlist set to ${body.playlist.label}.` : 'Draft playlist removed.')
    } catch {
      setNote('Could not save the playlist.')
    } finally {
      setSaving(false)
    }
  }

  const title = playlist ? `Draft playlist: ${playlist.label}` : 'Music for the draft'
  const sub = !available
    ? 'Music is not available on this page.'
    : playing
      ? `Playing ${playing.label}. Only you hear it.`
      : playlist
        ? 'Picked by your commissioner. Only you hear it.'
        : 'Only you hear it.'

  return (
    <section
      className="shrink-0 border-b border-white/10 bg-cyan-500/[0.05] px-3 py-1.5 text-white"
      aria-label="Draft room music"
      data-testid="draft-room-music"
    >
      <div className="flex items-center gap-2">
        <Music2 className="h-4 w-4 shrink-0 text-cyan-300" aria-hidden />
        <div className="min-w-0 flex-1 leading-tight">
          <p className="truncate text-xs font-semibold" data-testid="draft-room-music-title">{title}</p>
          <p className="truncate text-[11px] text-white/60" data-testid="draft-room-music-sub">{sub}</p>
        </div>
        {playing ? (
          <button type="button" className={quiet} onClick={() => musicBus.actions()?.stop()} data-testid="draft-room-music-stop">
            Stop
          </button>
        ) : playlist ? (
          <button type="button" className={primary} disabled={!available} onClick={playPlaylist} data-testid="draft-room-music-play-playlist">
            Play
          </button>
        ) : (
          <button type="button" className={primary} disabled={!available || !pick} onClick={playPick} data-testid="draft-room-music-play-station">
            Play
          </button>
        )}
        <button
          type="button"
          className={quiet}
          aria-expanded={open}
          aria-controls="draft-room-music-more"
          onClick={() => {
            setOpen((v) => !v)
            setNote(null)
          }}
          data-testid="draft-room-music-more"
        >
          More
          <ChevronDown className={`h-3.5 w-3.5 transition-transform ${open ? 'rotate-180' : ''}`} aria-hidden />
        </button>
      </div>

      {open ? (
        <div id="draft-room-music-more" className="mt-1.5 flex flex-col gap-2 border-t border-white/10 pt-2 pb-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <label className="w-full text-[11px] text-white/65 sm:w-auto" htmlFor="draft-room-music-station">
              {playlist ? 'Or play something else' : 'Station'}
            </label>
            <select id="draft-room-music-station" className={select} value={pick} onChange={(e) => setPick(e.target.value)} disabled={!available}>
              {YOUTUBE_STATIONS.map((s) => (
                <option key={s.id} value={s.id}>{s.label}</option>
              ))}
            </select>
            <button type="button" className={quiet} disabled={!available || !pick} onClick={playPick} data-testid="draft-room-music-play-pick">
              Play this
            </button>
          </div>

          {info?.isCommissioner ? (
            info.canSet ? (
              <div className="flex flex-wrap items-center gap-1.5" data-testid="draft-room-music-editor">
                <label className="w-full text-[11px] text-white/65" htmlFor="draft-room-music-playlist">
                  Draft playlist — offered to every member while the draft runs. It plays only for those who tap Play.
                </label>
                <select id="draft-room-music-playlist" className={select} value={choice} onChange={(e) => setChoice(e.target.value)}>
                  <option value="">No playlist</option>
                  {YOUTUBE_STATIONS.map((s) => (
                    <option key={s.id} value={s.id}>{s.label}</option>
                  ))}
                </select>
                <button type="button" className={primary} disabled={saving} onClick={() => void save()} data-testid="draft-room-music-save">
                  {saving ? 'Saving…' : 'Save'}
                </button>
              </div>
            ) : (
              <p className="flex flex-wrap items-center gap-2 text-[12px] text-white/75" data-testid="draft-room-music-locked">
                <Lock className="h-3.5 w-3.5 text-amber-300" aria-hidden />
                A draft playlist for the whole room comes with AF Commissioner or AF Supreme.
                <a href="/commissioner-upgrade" className="font-semibold text-cyan-300 underline-offset-2 hover:underline">
                  See plans
                </a>
              </p>
            )
          ) : null}
        </div>
      ) : null}
      {note ? <p className="pb-1 text-[11px] text-white/70" role="status" data-testid="draft-room-music-note">{note}</p> : null}
    </section>
  )
}
