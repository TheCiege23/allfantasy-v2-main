'use client'

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { ChevronDown, Lock, Music2 } from 'lucide-react'
import { musicBus } from '@/components/app-music/musicBus'
import { YOUTUBE_STATIONS } from '@/lib/draft-music/youtube'
import { findStation } from '@/lib/chimmy/musicCards'
import {
  draftPlaylistOffered,
  draftPlaylistOptOutKey,
  draftPlaylistPlayKey,
  followPlaylistChange,
  optOutStillHolds,
  shouldAutoplayDraftPlaylist,
  type DraftPlaylist,
} from '@/lib/draft-room/draftPlaylist'

/**
 * Music in the live draft room (2026-11-17). ONE slim row under the top bar, in normal flow — never over the board.
 * The room is a fixed full-height screen, so every pixel this takes comes out of the board, most of all on a phone: the row holds
 * a title, one button and "More"; choosing a station and the commissioner's setting live behind "More".
 *
 *  - Everyone: play one of the AllFantasy stations (the same ones Chimmy offers). It plays on THEIR device only.
 *  - If the commissioner set a draft playlist (AF Commissioner / AF Supreme), it PLAYS BY ITSELF for every member
 *    (2026-11-17): at once if they tapped their way into the room, otherwise on their first tap in it — browsers allow
 *    no sound before that. It never replaces music a member chose, and once they stop it, it stays stopped for this
 *    league until they tap Play. When the draft finishes, the playlist stops if it is what is playing.
 *  - The commissioner sets or clears it under "More"; without the plan it says which plans include it.
 *  - A change reaches every open room on its next draft settings poll (6–24 s; `livePlaylist`). Someone already
 *    playing the room playlist is switched to the new one, or stopped when it is removed; nobody else hears a thing.
 *
 * 🛑 Nothing is broadcast: each member's own device plays it. See lib/draft-room/draftPlaylist.ts.
 * The player is the app-wide one (AppMusicDock, through musicBus), so music keeps playing after the room.
 *
 * ⚠ THE PLAYER SITS IN THIS ROW, AT EVERY WIDTH (phones 2026-11-17, desktop the same day). The corner box covered
 * part of the board — about three columns by three rows on a phone, the bottom-right cells on desktop — and with the
 * playlist autoplaying, every member got it. While YouTube plays, the row holds a 200×200 slot with the title and
 * buttons beside it and reports the slot through musicBus.setSlot; the one iframe is laid over it (never moved into
 * it — that would restart the song). 200×200 is YouTube's floor for a playing player, so the slot cannot be smaller.
 */


/**
 * Has the person tapped, clicked or typed on this page yet? Browsers allow sound only after that. Where the browser
 * cannot say (no navigator.userActivation), treat it as "not yet" and wait for a tap — starting a player the browser
 * then silences would show "Playing" over silence.
 */
function pageHasBeenTapped(): boolean {
  const ua = (navigator as Navigator & { userActivation?: { hasBeenActive: boolean } }).userActivation
  return Boolean(ua?.hasBeenActive)
}

type Info = { playlist: DraftPlaylist | null; isCommissioner: boolean; canSet: boolean; planRequired: boolean }

const btn = 'inline-flex min-h-[36px] shrink-0 items-center justify-center gap-1 rounded-lg px-3 text-xs font-semibold disabled:cursor-not-allowed disabled:opacity-50'
const primary = `${btn} bg-cyan-500 text-slate-950 hover:bg-cyan-400`
const quiet = `${btn} border border-white/15 bg-white/[0.04] text-white/85 hover:bg-white/10`
const select = 'min-h-[36px] min-w-0 flex-1 rounded-lg border border-white/15 bg-slate-900 px-2 text-xs text-white sm:flex-none'

/** How long after this viewer's own save a poll may still carry the value it replaced. */
const OWN_SAVE_GRACE_MS = 30_000

type Props = {
  leagueId: string
  draftStatus: string | null | undefined
  /** The playlist from the room's draft settings poll; undefined until the room has read it. */
  livePlaylist?: DraftPlaylist | null
}

export default function DraftRoomMusicBar({ leagueId, draftStatus, livePlaylist }: Props) {
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
  const inRow = Boolean(playing && available)
  const slotRef = useRef<HTMLDivElement | null>(null)

  // Report where the slot is, every frame, as the chat's Music tab does: the room can still shift (the top bar wraps,
  // "More" opens) without the slot resizing. Leaving the room or stopping hands the player back to the corner.
  useEffect(() => {
    if (!inRow) return
    let raf = 0
    const tick = () => {
      const el = slotRef.current
      if (el) {
        const r = el.getBoundingClientRect()
        musicBus.setSlot({ left: Math.round(r.left), top: Math.round(r.top), width: Math.round(r.width), height: Math.round(r.height) })
      }
      raf = window.requestAnimationFrame(tick)
    }
    tick()
    return () => {
      window.cancelAnimationFrame(raf)
      musicBus.setSlot(null)
    }
  }, [inRow])

  // A change the commissioner made, from the room's settings poll (every 6–24 s). Right after this viewer's own
  // save, a poll that left before it can still bring back the value just replaced — that one value is ignored.
  const replacedRef = useRef<{ stationId: string | null; at: number } | null>(null)
  const liveStationId = livePlaylist === undefined ? undefined : (livePlaylist?.stationId ?? null)
  useEffect(() => {
    if (liveStationId === undefined) return
    const replaced = replacedRef.current
    if (replaced && replaced.stationId === liveStationId && Date.now() - replaced.at < OWN_SAVE_GRACE_MS) return
    const current = info ? (info.playlist?.stationId ?? null) : undefined
    if (current === liveStationId) return
    if (current !== undefined) setNote(livePlaylist ? `The draft playlist is now ${livePlaylist.label}.` : 'The draft playlist was turned off.')
    setInfo((prev) => ({ ...(prev ?? { isCommissioner: false, canSet: false, planRequired: false }), playlist: livePlaylist ?? null }))
    if (!open) setChoice(liveStationId ?? '')
    // eslint-disable-next-line react-hooks/exhaustive-deps -- keyed on the station, not the object
  }, [liveStationId])

  // Someone already playing the room playlist follows it: switched when it changes, stopped when it is removed or
  // the draft finishes. Music a member chose themselves is never touched, and nothing starts in a quiet room.
  // Only once the playlist is KNOWN — before that, music carried in from another page must not be stopped.
  const known = info !== null
  useEffect(() => {
    if (!known) return
    const next = followPlaylistChange(playing?.key, playlist)
    if (next.action === 'stop') musicBus.actions()?.stop()
    else if (next.action === 'play' && playlist) play(playlist.stationId, draftPlaylistPlayKey(playlist.stationId), `${playlist.label} · draft playlist`)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- play() reads only the station it is given
  }, [known, playlist?.stationId, playing?.key])

  // ── Autoplay (2026-11-17) ──────────────────────────────────────────────────────────────────────────────────────
  // A Stop is remembered for this league (browser storage, DRAFT_PLAYLIST_OPT_OUT_MS), so the room does not restart
  // music the member just turned off. null until storage is read: nothing autoplays before then.
  const optOutKey = draftPlaylistOptOutKey(leagueId)
  const [optedOut, setOptedOut] = useState<boolean | null>(null)
  // ⚠ Also kept in a ref: a Stop and the autoplay check land in the SAME commit, and the state would still read
  // "not stopped" there — restarting the music the member had just stopped.
  const optedOutRef = useRef<boolean | null>(null)
  useEffect(() => {
    let stored: string | null = null
    try {
      stored = window.localStorage.getItem(optOutKey)
    } catch {
      /* storage blocked: no opt-out on record */
    }
    const off = optOutStillHolds(stored, Date.now())
    optedOutRef.current = off
    setOptedOut(off)
  }, [optOutKey])
  const rememberOptOut = useCallback(
    (off: boolean) => {
      optedOutRef.current = off
      setOptedOut(off)
      try {
        if (off) window.localStorage.setItem(optOutKey, String(Date.now()))
        else window.localStorage.removeItem(optOutKey)
      } catch {
        /* this visit still honours it */
      }
    },
    [optOutKey],
  )

  // Music stopping while the playlist is still on offer means the member stopped it — here, in the chat's Music tab,
  // or on the corner player — so it stays off. A stop because the playlist was removed or the draft finished happens
  // with no playlist on offer, and is not theirs.
  const prevKeyRef = useRef<string | null>(null)
  useEffect(() => {
    const key = playing?.key ?? null
    if (prevKeyRef.current && !key && playlist) rememberOptOut(true)
    prevKeyRef.current = key
    // eslint-disable-next-line react-hooks/exhaustive-deps -- runs on the playing key alone, reading this render's playlist
  }, [playing?.key])

  // Start the playlist in a quiet room. Browsers allow sound only after the person has tapped or clicked something
  // on the site: if they have (they tapped their way here), it starts now; otherwise on their first tap in the room.
  // 'click' and not 'pointerdown': on a touch screen only the end of a tap counts as one.
  const [waitingForTap, setWaitingForTap] = useState(false)
  useEffect(() => {
    setWaitingForTap(false)
    if (!known || optedOutRef.current !== false || !playlist) return
    if (!shouldAutoplayDraftPlaylist({ offered: playlist, playingKey: playing?.key, optedOut: false, available })) return
    const start = () => {
      if (optedOutRef.current !== false) return
      play(playlist.stationId, draftPlaylistPlayKey(playlist.stationId), `${playlist.label} · draft playlist`)
    }
    if (pageHasBeenTapped()) {
      start()
      return
    }
    setWaitingForTap(true)
    // ⚠ Started just AFTER the tap, never during it. Starting during it re-renders the row before React delivers the
    // same click to its button — and on desktop React reuses that <button> node with Stop's handler, so a tap on Play
    // started the playlist and stopped it again (caught by e2e). The page stays tapped, so the browser still allows it.
    let timer = 0
    const onTap = () => {
      remove()
      timer = window.setTimeout(start, 0)
    }
    const remove = () => {
      document.removeEventListener('click', onTap, true)
      document.removeEventListener('keydown', onTap, true)
    }
    document.addEventListener('click', onTap, true)
    document.addEventListener('keydown', onTap, true)
    return () => {
      remove()
      window.clearTimeout(timer)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- play() reads only the station it is given
  }, [known, optedOut, available, playlist?.stationId, playing?.key])

  function play(stationId: string, key: string, label: string) {
    // Already playing it: a tap on Play also reaches the tap-to-start listener above, and must not start it twice.
    if (musicBus.getSnapshot().yt?.key === key) return
    const station = findStation(stationId)
    if (station) musicBus.actions()?.playYouTube({ key, label, source: station.source })
  }
  /** The Play button: also lifts a Stop, since tapping Play is the member asking for it back. */
  const playPlaylist = () => {
    if (!playlist) return
    rememberOptOut(false)
    play(playlist.stationId, playlistKey!, `${playlist.label} · draft playlist`)
  }
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
      replacedRef.current = { stationId: info?.playlist?.stationId ?? null, at: Date.now() }
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
      : playlist && waitingForTap
        ? 'Picked by your commissioner. It starts when you tap anywhere in the room.'
        : playlist && optedOut
          ? 'Picked by your commissioner. You stopped it — tap Play to turn it back on.'
          : playlist
            ? 'Picked by your commissioner. Only you hear it.'
            : 'Only you hear it.'

  const stopButton = (
    <button key="stop" type="button" className={quiet} onClick={() => musicBus.actions()?.stop()} data-testid="draft-room-music-stop">
      Stop
    </button>
  )
  const moreButton = (
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
  )

  return (
    <section
      className="shrink-0 border-b border-white/10 bg-cyan-500/[0.05] px-3 py-1.5 text-white"
      aria-label="Draft room music"
      data-testid="draft-room-music"
    >
      {inRow ? (
        <div className="flex items-stretch gap-2" data-testid="draft-room-music-in-row">
          {/* The player is laid over this box by AppMusicDock; the box itself is only its place. */}
          <div ref={slotRef} className="h-[200px] w-[200px] shrink-0 rounded-[10px] bg-black" aria-hidden data-testid="draft-room-music-slot" />
          <div className="flex min-w-0 flex-1 flex-col justify-between gap-2 py-0.5">
            <div className="leading-tight">
              <p className="flex items-center gap-1.5 text-xs font-semibold" data-testid="draft-room-music-title">
                <Music2 className="h-3.5 w-3.5 shrink-0 text-cyan-300" aria-hidden />
                <span className="line-clamp-2">{title}</span>
              </p>
              <p className="mt-1 line-clamp-3 text-[11px] text-white/60" data-testid="draft-room-music-sub">{sub}</p>
            </div>
            {/* Stacked beside the slot on a phone; side by side under the title where there is room. */}
            <div className="flex flex-col gap-1.5 sm:flex-row sm:items-center">
              {stopButton}
              {moreButton}
            </div>
          </div>
        </div>
      ) : (
      <div className="flex items-center gap-2">
        <Music2 className="h-4 w-4 shrink-0 text-cyan-300" aria-hidden />
        <div className="min-w-0 flex-1 leading-tight">
          <p className="truncate text-xs font-semibold" data-testid="draft-room-music-title">{title}</p>
          <p className="truncate text-[11px] text-white/60" data-testid="draft-room-music-sub">{sub}</p>
        </div>
        {playing ? (
          stopButton
        ) : playlist ? (
          <button key="play-playlist" type="button" className={primary} disabled={!available} onClick={playPlaylist} data-testid="draft-room-music-play-playlist">
            Play
          </button>
        ) : (
          <button key="play-station" type="button" className={primary} disabled={!available || !pick} onClick={playPick} data-testid="draft-room-music-play-station">
            Play
          </button>
        )}
        {moreButton}
      </div>
      )}

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
