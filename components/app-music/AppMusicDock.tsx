'use client'

import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react'
import { usePathname } from 'next/navigation'
import { useSession } from 'next-auth/react'
import './af-app-music.css'
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
 * App-wide music — YouTube for everyone, Apple Music for subscribers.
 *
 * Mounted ONCE in the root layout, so it survives every client-side navigation:
 * music started in the draft room keeps playing on lineups, trades, standings.
 * A full page reload or signing out stops it; nothing can survive those.
 *
 * Three sizes, by design (the user's brief, 2026-11-15):
 *   choosing  — a full-screen sheet on a phone, a large panel on desktop
 *   playing   — Apple Music tucks into a small tab on the RIGHT EDGE; YouTube
 *               shrinks to a 200×200 box
 *   idle      — just the side tab
 *
 * ⚠ YOUTUBE CANNOT BE HIDDEN. YouTube's embed rules require the player to stay
 * visible and at least 200×200 while it plays, and forbid making it audio-only.
 * So its "small" is the box, never the tab, and the box sits ABOVE the picker
 * sheet rather than under it. Apple Music has no such rule and hides fully.
 *
 * ⚠ POSITIONS ARE CHOSEN AROUND WHAT IS ALREADY THERE. The bottom-right corner
 * is a stack (comms launcher, theme toggle, back-to-top — af-core.css
 * `--af-fab-*`), and the desktop nav rail owns the left edge. So: the tab sits
 * mid-height on the right edge; the YouTube box sits beside the stack on
 * desktop and above the tab bar on the LEFT on a phone.
 *
 * ⚠ NOTHING PLAYS UNTIL SOMEONE CHOOSES. Apple's script is not loaded until the
 * Apple Music tab of the picker is opened.
 */

const OPEN_EVENT = 'af:app-music:open'

/** Opens the music picker from anywhere (the draft room's button uses it). */
export function openAppMusicPicker(): void {
  window.dispatchEvent(new Event(OPEN_EVENT))
}

const HIDDEN_PREFIXES = ['/login', '/signup', '/signin', '/logout', '/auth']

type Source = 'youtube' | 'apple'
type YouTubePlaying = { key: string; label: string; source: YouTubeSource }
type AppleStatus = 'idle' | 'checking' | 'unavailable' | 'error' | 'signed-out' | 'connecting' | 'ready'
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

export type AppMusicDockProps = {
  /** Show even when signed out. Dev previews only; the app gates on a session. */
  alwaysShow?: boolean
}

export function AppMusicDock({ alwaysShow = false }: AppMusicDockProps) {
  const { status } = useSession()
  const pathname = usePathname()
  const visible =
    alwaysShow ||
    (status === 'authenticated' && !HIDDEN_PREFIXES.some((p) => pathname?.startsWith(p)))

  const [sheetOpen, setSheetOpen] = useState(false)
  const [source, setSource] = useState<Source>('youtube')

  const [yt, setYt] = useState<YouTubePlaying | null>(null)
  const [link, setLink] = useState('')
  const [linkError, setLinkError] = useState<string | null>(null)

  const musicRef = useRef<MusicKitInstance | null>(null)
  const mountedRef = useRef(true)
  const closeRef = useRef<HTMLButtonElement | null>(null)
  const [appleStatus, setAppleStatus] = useState<AppleStatus>('idle')
  const [appleNow, setAppleNow] = useState<AppleNow | null>(null)
  const [appleExpanded, setAppleExpanded] = useState(false)
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
      try {
        musicRef.current?.stop()
      } catch {
        /* already stopped */
      }
    }
  }, [])

  const stopAll = useCallback(() => {
    setYt(null)
    try {
      musicRef.current?.stop()
    } catch {
      /* already stopped */
    }
    setAppleNow(null)
    setAppleExpanded(false)
  }, [])

  // Signed out, or on a sign-in page: no music, and nothing left playing.
  useEffect(() => {
    if (!visible) {
      stopAll()
      setSheetOpen(false)
    }
  }, [visible, stopAll])

  // Anything can ask for the picker (the draft room's "Play music" button).
  useEffect(() => {
    if (!visible) return
    const open = () => setSheetOpen(true)
    window.addEventListener(OPEN_EVENT, open)
    return () => window.removeEventListener(OPEN_EVENT, open)
  }, [visible])

  // The picker is a dialog: Escape closes it, focus starts on Close, the page
  // behind does not scroll.
  useEffect(() => {
    if (!sheetOpen) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setSheetOpen(false)
    }
    window.addEventListener('keydown', onKey)
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    closeRef.current?.focus()
    return () => {
      window.removeEventListener('keydown', onKey)
      document.body.style.overflow = previousOverflow
    }
  }, [sheetOpen])

  const chooseSource = (next: Source) => {
    setSource(next)
    try {
      window.localStorage.setItem(SOURCE_KEY, next)
    } catch {
      /* not remembered — fine */
    }
  }

  /* ── Apple Music ─────────────────────────────────────────────────────── */

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
    if (sheetOpen && source === 'apple' && appleStatus === 'idle') void startApple()
  }, [sheetOpen, source, appleStatus, startApple])

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
      // Apple's error code only — never the error object, which can carry token material.
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
    setAppleExpanded(false)
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
      if (mountedRef.current) {
        setSheetOpen(false) // tuck away into the side tab
        setAppleExpanded(false)
      }
    } catch {
      if (mountedRef.current) setAppleMsg(`That didn’t play. ${SUBSCRIPTION_NOTE}`)
    }
  }

  const toggleApplePlay = () => {
    const music = musicRef.current
    if (!music) return
    if (music.isPlaying) music.pause()
    else void music.play().catch(() => setAppleMsg(`That didn’t play. ${SUBSCRIPTION_NOTE}`))
  }

  /* ── YouTube ─────────────────────────────────────────────────────────── */

  const playYouTube = (next: YouTubePlaying) => {
    try {
      if (musicRef.current?.isPlaying) musicRef.current.pause()
    } catch {
      /* nothing to pause */
    }
    setAppleExpanded(false)
    setYt(next)
    setLinkError(null)
    setSheetOpen(false) // shrink to the small box
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

  if (!visible) return null

  const tabLabel = appleNow
    ? `Now playing: ${appleNow.title}${appleNow.artist ? ` by ${appleNow.artist}` : ''}. Show controls`
    : 'Music'

  return (
    <>
      {/* ── The side tab: idle, or Apple Music tucked away ─────────────── */}
      {!yt ? (
        <button
          type="button"
          className="af-amd-tab"
          data-playing={appleNow?.playing ? 'true' : undefined}
          aria-label={tabLabel}
          aria-expanded={appleNow ? appleExpanded : sheetOpen}
          onClick={() => (appleNow ? setAppleExpanded((v) => !v) : setSheetOpen(true))}
        >
          {appleNow?.art ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={appleNow.art} alt="" width={28} height={28} />
          ) : (
            <span className="af-amd-note" aria-hidden="true">
              ♫
            </span>
          )}
          {appleNow?.playing ? (
            <span className="af-amd-eq" aria-hidden="true">
              <i />
              <i />
              <i />
            </span>
          ) : null}
        </button>
      ) : null}

      {/* ── Apple Music controls, slid out from the tab ────────────────── */}
      {appleNow && appleExpanded && !yt ? (
        <div className="af-amd-mini" role="region" aria-label="Now playing">
          <div className="af-amd-mini-top">
            {appleNow.art ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={appleNow.art} alt="" width={48} height={48} />
            ) : (
              <span className="af-amd-mini-art" aria-hidden="true">
                ♫
              </span>
            )}
            <span className="af-amd-mini-text">
              <span className="af-amd-mini-title">{appleNow.title}</span>
              <span className="af-amd-mini-artist">{appleNow.artist}</span>
            </span>
          </div>
          <div className="af-amd-transport">
            <button
              type="button"
              className="af-amd-icon"
              aria-label="Previous track"
              onClick={() => void musicRef.current?.skipToPreviousItem().catch(() => undefined)}
            >
              ⏮
            </button>
            <button
              type="button"
              className="af-amd-icon af-amd-icon--main"
              aria-label={appleNow.playing ? 'Pause' : 'Play'}
              onClick={toggleApplePlay}
            >
              {appleNow.playing ? '❚❚' : '▶'}
            </button>
            <button
              type="button"
              className="af-amd-icon"
              aria-label="Next track"
              onClick={() => void musicRef.current?.skipToNextItem().catch(() => undefined)}
            >
              ⏭
            </button>
          </div>
          <div className="af-amd-mini-actions">
            <button type="button" className="af-amd-chip" onClick={() => setSheetOpen(true)}>
              Change
            </button>
            <button type="button" className="af-amd-chip" onClick={stopAll}>
              Stop
            </button>
            <button
              type="button"
              className="af-amd-chip af-amd-chip--quiet"
              onClick={() => setAppleExpanded(false)}
            >
              Hide ›
            </button>
          </div>
          {appleMsg ? <p className="af-amd-error">{appleMsg}</p> : null}
        </div>
      ) : null}

      {/* ── YouTube: a small box, never hidden while it plays ─────────── */}
      {yt ? (
        <div
          className="af-amd-yt"
          role="region"
          aria-label="YouTube music player"
          data-raised={sheetOpen ? 'true' : undefined}
        >
          <div className="af-amd-yt-head">
            <span className="af-amd-yt-title">{yt.label}</span>
            <button type="button" className="af-amd-yt-btn" onClick={() => setSheetOpen(true)}>
              Change
            </button>
            <button type="button" className="af-amd-yt-btn" aria-label="Stop music" onClick={stopAll}>
              ✕
            </button>
          </div>
          <iframe
            key={yt.key}
            src={youTubeEmbedUrl(yt.source, { autoplay: true })}
            title={`${yt.label} on YouTube`}
            width={200}
            height={200}
            allow="autoplay; encrypted-media; picture-in-picture"
            allowFullScreen
            referrerPolicy="strict-origin-when-cross-origin"
          />
        </div>
      ) : null}

      {/* ── The picker: full screen on a phone, a large panel on desktop ─ */}
      {sheetOpen ? (
        <div
          className="af-amd-backdrop"
          data-yt={yt ? 'true' : undefined}
          onClick={() => setSheetOpen(false)}
        >
          <div
            className="af-amd-sheet"
            role="dialog"
            aria-modal="true"
            aria-labelledby="af-amd-title"
            onClick={(e) => e.stopPropagation()}
          >
            <header className="af-amd-sheet-head">
              <h2 id="af-amd-title" className="af-amd-sheet-title">
                Music
              </h2>
              <button
                ref={closeRef}
                type="button"
                className="af-amd-chip"
                aria-label="Close music picker"
                onClick={() => setSheetOpen(false)}
              >
                Close
              </button>
            </header>

            <div className="af-amd-tabs" role="tablist" aria-label="Music source">
              <button
                type="button"
                role="tab"
                aria-selected={source === 'youtube'}
                className="af-amd-tabbtn"
                onClick={() => chooseSource('youtube')}
              >
                YouTube
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={source === 'apple'}
                className="af-amd-tabbtn"
                onClick={() => chooseSource('apple')}
              >
                Apple Music
              </button>
            </div>

            {source === 'youtube' ? (
              <div role="tabpanel" aria-label="YouTube" className="af-amd-panel">
                <div className="af-amd-stations">
                  {YOUTUBE_STATIONS.map((station) => (
                    <button
                      key={station.id}
                      type="button"
                      className="af-amd-station"
                      data-active={yt?.key === station.id ? 'true' : undefined}
                      onClick={() =>
                        playYouTube({ key: station.id, label: station.label, source: station.source })
                      }
                    >
                      <span className="af-amd-station-title">{station.label}</span>
                      <span className="af-amd-station-sub">{station.channel}</span>
                    </button>
                  ))}
                </div>

                <form className="af-amd-link" onSubmit={submitLink}>
                  <label className="af-amd-label" htmlFor="af-amd-link-input">
                    Or paste any YouTube video or playlist link
                  </label>
                  <div className="af-amd-row">
                    <input
                      id="af-amd-link-input"
                      className="af-amd-input"
                      type="url"
                      inputMode="url"
                      placeholder="youtube.com/playlist?list=…"
                      value={link}
                      onChange={(e) => {
                        setLink(e.target.value)
                        setLinkError(null)
                      }}
                    />
                    <button type="submit" className="af-amd-btn" disabled={!link.trim()}>
                      Play
                    </button>
                  </div>
                  {linkError ? (
                    <p className="af-amd-error" role="alert">
                      {linkError}
                    </p>
                  ) : null}
                </form>
              </div>
            ) : (
              <div role="tabpanel" aria-label="Apple Music" className="af-amd-panel">
                {appleStatus === 'idle' || appleStatus === 'checking' ? (
                  <p className="af-amd-msg">Checking Apple Music…</p>
                ) : null}

                {appleStatus === 'unavailable' ? (
                  <p className="af-amd-msg">Apple Music isn’t set up yet. YouTube works for everyone.</p>
                ) : null}

                {appleStatus === 'error' ? (
                  <div className="af-amd-row">
                    <p className="af-amd-msg">Apple Music didn’t load.</p>
                    <button type="button" className="af-amd-chip" onClick={() => void startApple()}>
                      Try again
                    </button>
                  </div>
                ) : null}

                {appleStatus === 'signed-out' || appleStatus === 'connecting' ? (
                  <div className="af-amd-connect">
                    {/*
                      ⚠ NEVER DISABLED WHILE CONNECTING. Apple's sign-in runs in its
                      own window, and authorize() can stay pending forever if that
                      window is closed or left on a later step (Allow, a 2FA code, a
                      subscription offer). Observed 2026-11-15. A second press
                      re-opens Apple's window.
                    */}
                    <button type="button" className="af-amd-btn af-amd-btn--apple" onClick={() => void connectApple()}>
                      {appleStatus === 'connecting' ? 'Open Apple sign-in again' : 'Connect Apple Music'}
                    </button>
                    <p className="af-amd-msg">
                      {appleStatus === 'connecting'
                        ? 'Finish signing in on Apple’s window, including any “Allow” step. Closed it? Press the button again.'
                        : SUBSCRIPTION_NOTE}
                    </p>
                  </div>
                ) : null}

                {appleStatus === 'ready' ? (
                  <>
                    <form
                      className="af-amd-row"
                      onSubmit={(e) => {
                        e.preventDefault()
                        void runSearch(query)
                      }}
                    >
                      <input
                        className="af-amd-input"
                        type="search"
                        aria-label="Search Apple Music"
                        placeholder="Search songs or playlists"
                        value={query}
                        onChange={(e) => setQuery(e.target.value)}
                      />
                      <button type="submit" className="af-amd-btn" disabled={!query.trim() || searching}>
                        {searching ? 'Searching…' : 'Search'}
                      </button>
                    </form>

                    {results.length === 0 ? (
                      <div className="af-amd-quick">
                        {APPLE_QUICK_SEARCHES.map((term) => (
                          <button key={term} type="button" className="af-amd-chip" onClick={() => void runSearch(term)}>
                            {term}
                          </button>
                        ))}
                      </div>
                    ) : (
                      <ul className="af-amd-results">
                        {results.map((item) => (
                          <li key={`${item.kind}:${item.id}`}>
                            <button type="button" className="af-amd-result" onClick={() => void playApple(item)}>
                              {item.art ? (
                                // eslint-disable-next-line @next/next/no-img-element
                                <img src={item.art} alt="" width={40} height={40} />
                              ) : (
                                <span className="af-amd-result-art" aria-hidden="true">
                                  ♫
                                </span>
                              )}
                              <span className="af-amd-result-text">
                                <span className="af-amd-result-title">{item.title}</span>
                                <span className="af-amd-result-sub">
                                  {item.kind === 'playlist' ? 'Playlist' : 'Song'}
                                  {item.subtitle ? ` · ${item.subtitle}` : ''}
                                </span>
                              </span>
                            </button>
                          </li>
                        ))}
                      </ul>
                    )}

                    <button type="button" className="af-amd-linkbtn" onClick={() => void disconnectApple()}>
                      Disconnect Apple Music
                    </button>
                  </>
                ) : null}

                {appleMsg ? (
                  <p className="af-amd-error" role="status">
                    {appleMsg}
                  </p>
                ) : null}
              </div>
            )}

            <p className="af-amd-note-line">
              Keeps playing while you move around AllFantasy. Plays on your device only.
            </p>
          </div>
        </div>
      ) : null}
    </>
  )
}

/**
 * The draft room's way in: a slim bar in normal flow above the board that opens
 * the same app-wide picker. Never over the board, never autoplays.
 */
export function AppMusicLauncher({ label = 'Music while you draft' }: { label?: string }) {
  return (
    <div className="af-amd-launch">
      <span className="af-amd-launch-mark" aria-hidden="true">
        ♫
      </span>
      <span className="af-amd-launch-text">{label}</span>
      <button type="button" className="af-amd-launch-btn" onClick={openAppMusicPicker}>
        Play music
      </button>
    </div>
  )
}

export default AppMusicDock
