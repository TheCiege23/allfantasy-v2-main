'use client'

import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react'
import '@/components/core-app/af-draft-room-music.css'
import {
  YOUTUBE_STATIONS,
  parseYouTubeLink,
  youTubeEmbedUrl,
  type YouTubeSource,
} from '@/lib/draft-music/youtube'
import {
  artworkUrl,
  searchCatalog,
  setUpMusicKit,
  type AppleSearchResult,
  type MusicKitInstance,
} from '@/lib/apple-music/musicKitClient'

/**
 * Draft room music — YouTube for everyone, Apple Music for subscribers.
 *
 * ⚠ NOTHING PLAYS UNTIL SOMEONE PRESSES PLAY. A draft room that starts making
 * noise by itself during a pick is a bug. Apple's script is not even loaded
 * until the Apple Music tab is opened.
 *
 * ⚠ NORMAL FLOW, NEVER OVER THE BOARD. Closed, this is one 44px bar.
 *
 * ⚠ THE YOUTUBE PLAYER STAYS VISIBLE WHILE IT PLAYS. YouTube's rules forbid
 * hiding it to make it audio-only, so "Close" folds the picker, not the player.
 *
 * ⚠ AUDIO IS PER PERSON. Each listener plays on their own device; nothing is
 * broadcast to the room, and the panel says so.
 */

type Source = 'youtube' | 'apple'

type YouTubePlaying = { key: string; label: string; source: YouTubeSource }

type AppleStatus =
  | 'idle'
  | 'checking'
  | 'unavailable'
  | 'error'
  | 'signed-out'
  | 'connecting'
  | 'ready'

type AppleNow = { title: string; artist: string; art: string | null; playing: boolean }

const SOURCE_KEY = 'af:draft-music:source'
const APPLE_QUICK_SEARCHES = ['Game day', 'Hip-hop hits', 'Rock anthems', 'Lo-fi']
/*
 * ⚠ SAY IT BEFORE THE CLICK. Measured 2026-11-15 with an Apple ID that has no
 * subscription: Connect does not sign in at all — Apple sends the person to its
 * own "subscribe" page (music.apple.com/deeplink?p=subscribe) and authorize()
 * never succeeds. So the note must make clear this tab is for subscribers.
 */
const SUBSCRIPTION_NOTE =
  'For Apple Music subscribers. Without a subscription, Apple will offer you one instead of playing. That’s Apple’s rule, not ours.'

export type DraftRoomMusicProps = {
  /** Open the picker on first render. Previews only — the room default is closed. */
  defaultOpen?: boolean
}

export function DraftRoomMusic({ defaultOpen = false }: DraftRoomMusicProps) {
  const [open, setOpen] = useState(defaultOpen)
  const [source, setSource] = useState<Source>('youtube')

  const [yt, setYt] = useState<YouTubePlaying | null>(null)
  const [link, setLink] = useState('')
  const [linkError, setLinkError] = useState<string | null>(null)

  const musicRef = useRef<MusicKitInstance | null>(null)
  const mountedRef = useRef(true)
  const [appleStatus, setAppleStatus] = useState<AppleStatus>('idle')
  const [appleNow, setAppleNow] = useState<AppleNow | null>(null)
  const [appleMsg, setAppleMsg] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<AppleSearchResult[]>([])
  const [searching, setSearching] = useState(false)

  useEffect(() => {
    mountedRef.current = true
    try {
      const saved = window.localStorage.getItem(SOURCE_KEY)
      if (saved === 'apple' || saved === 'youtube') setSource(saved)
    } catch {
      /* storage blocked — default to YouTube */
    }
    return () => {
      mountedRef.current = false
      // Leaving the draft room must not leave music playing with no controls.
      try {
        musicRef.current?.stop()
      } catch {
        /* already stopped */
      }
    }
  }, [])

  const chooseSource = (next: Source) => {
    setSource(next)
    try {
      window.localStorage.setItem(SOURCE_KEY, next)
    } catch {
      /* not remembered — fine */
    }
  }

  /* ── Apple Music setup, only once the tab is actually opened ─────────── */

  const startApple = useCallback(async () => {
    setAppleStatus('checking')
    setAppleMsg(null)
    const setup = await setUpMusicKit()
    if (!mountedRef.current) return
    if (setup.kind === 'unavailable') return setAppleStatus('unavailable')
    if (setup.kind === 'error') return setAppleStatus('error')
    musicRef.current = setup.music
    setAppleStatus(setup.music.isAuthorized ? 'ready' : 'signed-out')
  }, [])

  useEffect(() => {
    if (open && source === 'apple' && appleStatus === 'idle') void startApple()
  }, [open, source, appleStatus, startApple])

  useEffect(() => {
    const music = musicRef.current
    if (!music || appleStatus !== 'ready') return
    const sync = () => {
      const item = music.nowPlayingItem
      if (!item) {
        setAppleNow(null)
        return
      }
      setAppleNow({
        title: item.title ?? item.attributes?.name ?? 'Unknown track',
        artist: item.artistName ?? item.attributes?.artistName ?? '',
        art: artworkUrl(item.artwork?.url ?? item.attributes?.artwork?.url, 96),
        playing: music.isPlaying,
      })
    }
    sync()
    music.addEventListener('playbackStateDidChange', sync)
    music.addEventListener('nowPlayingItemDidChange', sync)
    return () => {
      music.removeEventListener('playbackStateDidChange', sync)
      music.removeEventListener('nowPlayingItemDidChange', sync)
    }
  }, [appleStatus])

  // Apple can finish sign-in without resolving our authorize() call, so also
  // follow its own sign-in event in both directions.
  useEffect(() => {
    const music = musicRef.current
    if (!music || (appleStatus !== 'signed-out' && appleStatus !== 'connecting' && appleStatus !== 'ready')) return
    const onAuthChange = () => {
      if (!mountedRef.current) return
      setAppleStatus(music.isAuthorized ? 'ready' : 'signed-out')
    }
    music.addEventListener('authorizationStatusDidChange', onAuthChange)
    return () => music.removeEventListener('authorizationStatusDidChange', onAuthChange)
  }, [appleStatus])

  const connectApple = async () => {
    const music = musicRef.current
    if (!music) return
    setAppleStatus('connecting')
    setAppleMsg(null)
    try {
      await music.authorize()
    } catch (err) {
      // Apple's error code only (e.g. AUTHORIZATION_ERROR, SUBSCRIPTION_ERROR) —
      // never the error object, which can carry token material.
      const code = (err as { errorCode?: string; name?: string } | null)?.errorCode ?? (err as Error | null)?.name
      console.warn('[apple-music] sign-in did not finish:', code ?? 'unknown')
      if (mountedRef.current) setAppleMsg('Apple Music sign-in didn’t finish. Try again.')
    }
    if (mountedRef.current) setAppleStatus(music.isAuthorized ? 'ready' : 'signed-out')
  }

  const disconnectApple = async () => {
    const music = musicRef.current
    if (!music) return
    try {
      music.stop()
      await music.unauthorize()
    } catch {
      /* Apple's session is gone either way */
    }
    setAppleNow(null)
    setResults([])
    setAppleStatus('signed-out')
  }

  const runSearch = async (term: string) => {
    const music = musicRef.current
    const trimmed = term.trim()
    if (!music || !trimmed) return
    setQuery(trimmed)
    setSearching(true)
    setAppleMsg(null)
    try {
      const found = await searchCatalog(music, trimmed)
      if (!mountedRef.current) return
      setResults(found)
      if (found.length === 0) setAppleMsg(`Nothing found for “${trimmed}”.`)
    } catch {
      if (mountedRef.current) setAppleMsg('Search didn’t work. Try again.')
    } finally {
      if (mountedRef.current) setSearching(false)
    }
  }

  const playApple = async (item: AppleSearchResult) => {
    const music = musicRef.current
    if (!music) return
    setYt(null) // one source at a time
    setAppleMsg(null)
    try {
      await music.setQueue(
        item.kind === 'song' ? { song: item.id, startPlaying: true } : { playlist: item.id, startPlaying: true },
      )
      if (mountedRef.current) setOpen(false)
    } catch {
      if (mountedRef.current) setAppleMsg(`That didn’t play. ${SUBSCRIPTION_NOTE}`)
    }
  }

  /* ── YouTube ─────────────────────────────────────────────────────────── */

  const playYouTube = (next: YouTubePlaying) => {
    try {
      if (musicRef.current?.isPlaying) musicRef.current.pause()
    } catch {
      /* nothing to pause */
    }
    setYt(next)
    setLinkError(null)
    setOpen(false)
  }

  const submitLink = (e: FormEvent) => {
    e.preventDefault()
    const parsed = parseYouTubeLink(link)
    if (!parsed) {
      setLinkError('That isn’t a YouTube video or playlist link.')
      return
    }
    playYouTube({ key: `link:${link}`, label: 'Your YouTube link', source: parsed })
    setLink('')
  }

  const stopAll = () => {
    setYt(null)
    try {
      musicRef.current?.stop()
    } catch {
      /* already stopped */
    }
    setAppleNow(null)
  }

  /* ── Render ──────────────────────────────────────────────────────────── */

  const playingText = yt
    ? `${yt.label} · YouTube`
    : appleNow
      ? `${appleNow.title}${appleNow.artist ? ` · ${appleNow.artist}` : ''}`
      : null

  return (
    <section className="af-drm" aria-label="Draft room music" data-open={open ? 'true' : undefined}>
      <div className="af-drm-bar">
        {appleNow?.art && !yt ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img className="af-drm-thumb" src={appleNow.art} alt="" width={28} height={28} />
        ) : (
          <span className="af-drm-mark" aria-hidden="true">
            ♫
          </span>
        )}
        <span className="af-drm-bar-text" data-idle={playingText ? undefined : 'true'}>
          {playingText ?? 'Music for the draft'}
        </span>

        {appleNow && !yt ? (
          <span className="af-drm-transport">
            <button
              type="button"
              className="af-drm-icon"
              aria-label="Previous track"
              onClick={() => void musicRef.current?.skipToPreviousItem().catch(() => undefined)}
            >
              ⏮
            </button>
            <button
              type="button"
              className="af-drm-icon af-drm-icon--main"
              aria-label={appleNow.playing ? 'Pause' : 'Play'}
              onClick={() => {
                const music = musicRef.current
                if (!music) return
                if (music.isPlaying) music.pause()
                else void music.play().catch(() => setAppleMsg(`That didn’t play. ${SUBSCRIPTION_NOTE}`))
              }}
            >
              {appleNow.playing ? '❚❚' : '▶'}
            </button>
            <button
              type="button"
              className="af-drm-icon"
              aria-label="Next track"
              onClick={() => void musicRef.current?.skipToNextItem().catch(() => undefined)}
            >
              ⏭
            </button>
          </span>
        ) : null}

        {playingText ? (
          <button type="button" className="af-drm-chip" onClick={stopAll}>
            Stop
          </button>
        ) : null}
        <button
          type="button"
          className="af-drm-chip af-drm-chip--primary"
          aria-expanded={open}
          onClick={() => setOpen((v) => !v)}
        >
          {open ? 'Close' : playingText ? 'Change' : 'Play music'}
        </button>
      </div>

      {open ? (
        <div className="af-drm-picker">
          <div className="af-drm-tabs" role="tablist" aria-label="Music source">
            <button
              type="button"
              role="tab"
              aria-selected={source === 'youtube'}
              className="af-drm-tab"
              onClick={() => chooseSource('youtube')}
            >
              YouTube
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={source === 'apple'}
              className="af-drm-tab"
              onClick={() => chooseSource('apple')}
            >
              Apple Music
            </button>
          </div>

          {source === 'youtube' ? (
            <div role="tabpanel" aria-label="YouTube" className="af-drm-panel">
              <div className="af-drm-stations">
                {YOUTUBE_STATIONS.map((station) => (
                  <button
                    key={station.id}
                    type="button"
                    className="af-drm-station"
                    data-active={yt?.key === station.id ? 'true' : undefined}
                    onClick={() =>
                      playYouTube({ key: station.id, label: station.label, source: station.source })
                    }
                  >
                    <span className="af-drm-station-title">{station.label}</span>
                    <span className="af-drm-station-sub">{station.channel}</span>
                  </button>
                ))}
              </div>

              <form className="af-drm-link" onSubmit={submitLink}>
                <label className="af-drm-label" htmlFor="af-drm-link-input">
                  Or paste any YouTube video or playlist link
                </label>
                <div className="af-drm-row">
                  <input
                    id="af-drm-link-input"
                    className="af-drm-input"
                    type="url"
                    inputMode="url"
                    placeholder="youtube.com/playlist?list=…"
                    value={link}
                    onChange={(e) => {
                      setLink(e.target.value)
                      setLinkError(null)
                    }}
                  />
                  <button type="submit" className="af-drm-btn" disabled={!link.trim()}>
                    Play
                  </button>
                </div>
                {linkError ? (
                  <p className="af-drm-error" role="alert">
                    {linkError}
                  </p>
                ) : null}
              </form>
            </div>
          ) : (
            <div role="tabpanel" aria-label="Apple Music" className="af-drm-panel">
              {appleStatus === 'idle' || appleStatus === 'checking' ? (
                <p className="af-drm-msg">Checking Apple Music…</p>
              ) : null}

              {appleStatus === 'unavailable' ? (
                <p className="af-drm-msg">Apple Music isn’t set up yet. YouTube works for everyone.</p>
              ) : null}

              {appleStatus === 'error' ? (
                <div className="af-drm-row">
                  <p className="af-drm-msg">Apple Music didn’t load.</p>
                  <button type="button" className="af-drm-chip" onClick={() => void startApple()}>
                    Try again
                  </button>
                </div>
              ) : null}

              {appleStatus === 'signed-out' || appleStatus === 'connecting' ? (
                <div className="af-drm-connect">
                  {/*
                    ⚠ NEVER DISABLED WHILE CONNECTING. Apple's sign-in runs in its
                    own window, and authorize() can stay pending forever if that
                    window is closed or left on a later step (Allow, a 2FA code, a
                    subscription offer). Observed 2026-11-15. The button stays
                    clickable so a second press re-opens Apple's window.
                  */}
                  <button
                    type="button"
                    className="af-drm-btn af-drm-btn--apple"
                    onClick={() => void connectApple()}
                  >
                    {appleStatus === 'connecting' ? 'Open Apple sign-in again' : 'Connect Apple Music'}
                  </button>
                  <p className="af-drm-msg">
                    {appleStatus === 'connecting'
                      ? 'Finish signing in on Apple’s window, including any “Allow” step. Closed it? Press the button again.'
                      : SUBSCRIPTION_NOTE}
                  </p>
                </div>
              ) : null}

              {appleStatus === 'ready' ? (
                <>
                  <form
                    className="af-drm-row"
                    onSubmit={(e) => {
                      e.preventDefault()
                      void runSearch(query)
                    }}
                  >
                    <input
                      className="af-drm-input"
                      type="search"
                      aria-label="Search Apple Music"
                      placeholder="Search songs or playlists"
                      value={query}
                      onChange={(e) => setQuery(e.target.value)}
                    />
                    <button type="submit" className="af-drm-btn" disabled={!query.trim() || searching}>
                      {searching ? 'Searching…' : 'Search'}
                    </button>
                  </form>

                  {results.length === 0 ? (
                    <div className="af-drm-quick">
                      {APPLE_QUICK_SEARCHES.map((term) => (
                        <button
                          key={term}
                          type="button"
                          className="af-drm-chip"
                          onClick={() => void runSearch(term)}
                        >
                          {term}
                        </button>
                      ))}
                    </div>
                  ) : (
                    <ul className="af-drm-results">
                      {results.map((item) => (
                        <li key={`${item.kind}:${item.id}`}>
                          <button type="button" className="af-drm-result" onClick={() => void playApple(item)}>
                            {item.art ? (
                              // eslint-disable-next-line @next/next/no-img-element
                              <img src={item.art} alt="" width={40} height={40} />
                            ) : (
                              <span className="af-drm-result-art" aria-hidden="true">
                                ♫
                              </span>
                            )}
                            <span className="af-drm-result-text">
                              <span className="af-drm-result-title">{item.title}</span>
                              <span className="af-drm-result-sub">
                                {item.kind === 'playlist' ? 'Playlist' : 'Song'}
                                {item.subtitle ? ` · ${item.subtitle}` : ''}
                              </span>
                            </span>
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}

                  <button type="button" className="af-drm-linkbtn" onClick={() => void disconnectApple()}>
                    Disconnect Apple Music
                  </button>
                </>
              ) : null}

              {appleMsg ? (
                <p className="af-drm-error" role="status">
                  {appleMsg}
                </p>
              ) : null}
            </div>
          )}

          <p className="af-drm-note">Plays on your device only. Everyone in the room picks their own music.</p>
        </div>
      ) : null}

      {yt ? (
        <div className="af-drm-player">
          <iframe
            key={yt.key}
            src={youTubeEmbedUrl(yt.source, { autoplay: true })}
            title={`${yt.label} on YouTube`}
            allow="autoplay; encrypted-media; picture-in-picture"
            allowFullScreen
            referrerPolicy="strict-origin-when-cross-origin"
          />
        </div>
      ) : null}
    </section>
  )
}

export default DraftRoomMusic
