'use client'

import { useEffect, useRef, useState, useSyncExternalStore, type FormEvent } from 'react'
import './af-app-music.css'
import { YOUTUBE_STATIONS, describeYouTubeLinkProblem, parseYouTubeLink } from '@/lib/draft-music/youtube'
import { SUBSCRIPTION_NOTE, musicBus } from './musicBus'

/**
 * The chat panel's Music tab — the CONTROLS for the app-wide music engine.
 *
 * ⚠ IT OWNS NO AUDIO. The chat panel is remounted on every /core screen change,
 * so anything that played from here would restart on every click. The engine
 * lives in AppMusicDock (root layout); this tab reads its state and calls its
 * actions through musicBus.
 *
 * ⚠ THE SCREEN IS AN EMPTY BOX ON PURPOSE. While YouTube plays, this tab reports
 * the box's position every animation frame and the engine lays the one iframe
 * exactly over it — so the video looks and behaves as if it plays inside the chat,
 * and closing the chat only moves it (to the 200×200 corner box), never reloads it.
 * The screen sits ABOVE the scrolling list, so the video can never scroll out from
 * under the overlay.
 *
 * Styled with the chat panel's own tokens (--accent, --surface…), so it looks like
 * the other chat tabs rather than like a separate widget.
 */

type Source = 'youtube' | 'apple'
const SOURCE_KEY = 'af:draft-music:source'
const APPLE_QUICK_SEARCHES = ['Game day', 'Hip-hop hits', 'Rock anthems', 'Lo-fi']

export function MusicPanel() {
  const snap = useSyncExternalStore(musicBus.subscribe, musicBus.getSnapshot, musicBus.getServerSnapshot)
  const act = musicBus.actions()

  const [source, setSource] = useState<Source>('youtube')
  const [link, setLink] = useState('')
  const [linkError, setLinkError] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const screenRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    try {
      const saved = window.localStorage.getItem(SOURCE_KEY)
      if (saved === 'apple' || saved === 'youtube') setSource(saved)
    } catch {
      /* storage blocked — default to YouTube */
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

  // Apple's script loads only when someone actually opens the Apple side.
  useEffect(() => {
    if (source === 'apple' && snap.appleStatus === 'idle') act?.startApple()
  }, [source, snap.appleStatus, act])

  // Report where the screen is, so the engine can lay YouTube over it.
  // Every frame, not on resize alone: the chat panel slides in and the page can
  // scroll, and both move the box without resizing it.
  const ytKey = snap.yt?.key ?? null
  useEffect(() => {
    if (!ytKey) {
      musicBus.setScreen(null)
      return
    }
    let raf = 0
    const tick = () => {
      const el = screenRef.current
      if (el) {
        const r = el.getBoundingClientRect()
        musicBus.setScreen({
          left: Math.round(r.left),
          top: Math.round(r.top),
          width: Math.round(r.width),
          height: Math.round(r.height),
        })
      }
      raf = window.requestAnimationFrame(tick)
    }
    tick()
    return () => {
      window.cancelAnimationFrame(raf)
      musicBus.setScreen(null) // chat closed or tab changed: the engine shrinks to the corner box
    }
  }, [ytKey])

  const submitLink = (e: FormEvent) => {
    e.preventDefault()
    const parsed = parseYouTubeLink(link)
    if (!parsed) {
      setLinkError(describeYouTubeLinkProblem(link))
      return
    }
    act?.playYouTube({ key: `link:${link}`, label: 'Your YouTube link', source: parsed })
    setLink('')
    setLinkError(null)
  }

  if (!snap.ready || !act) {
    return (
      <div className="af-cm-panel af-amp">
        <p className="af-amp-msg af-amp-pad">Music isn’t available on this page.</p>
      </div>
    )
  }

  return (
    <div className="af-cm-panel af-amp" data-testid="comms-music-panel">
      {/* ── Now playing: fixed above the list ─────────────────────────── */}
      {snap.yt ? (
        <section className="af-amp-now" aria-label="Now playing">
          <div ref={screenRef} className="af-amp-screen" />
          <div className="af-amp-nowrow">
            <span className="af-amp-nowtext">
              <b>{snap.yt.label}</b>
              <span>YouTube</span>
            </span>
            <button type="button" className="af-amp-chip" onClick={act.stop}>
              Stop
            </button>
          </div>
        </section>
      ) : snap.appleNow ? (
        <section className="af-amp-now" aria-label="Now playing">
          <div className="af-amp-apple">
            {snap.appleNow.art ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={snap.appleNow.art} alt="" width={56} height={56} />
            ) : (
              <span className="af-amp-art" aria-hidden="true">
                ♫
              </span>
            )}
            <span className="af-amp-nowtext">
              <b>{snap.appleNow.title}</b>
              <span>{snap.appleNow.artist || 'Apple Music'}</span>
            </span>
          </div>
          <div className="af-amp-transport">
            <button type="button" className="af-amp-icon" aria-label="Previous track" onClick={act.applePrev}>
              ⏮
            </button>
            <button
              type="button"
              className="af-amp-icon af-amp-icon--main"
              aria-label={snap.appleNow.playing ? 'Pause' : 'Play'}
              onClick={act.appleToggle}
            >
              {snap.appleNow.playing ? '❚❚' : '▶'}
            </button>
            <button type="button" className="af-amp-icon" aria-label="Next track" onClick={act.appleNext}>
              ⏭
            </button>
            <button type="button" className="af-amp-chip" onClick={act.stop}>
              Stop
            </button>
          </div>
        </section>
      ) : null}

      {/* ── Picker: the part that scrolls ─────────────────────────────── */}
      <div className="af-amp-scroll">
        <div className="af-amp-switch" role="tablist" aria-label="Music source">
          <button
            type="button"
            role="tab"
            aria-selected={source === 'youtube'}
            className="af-amp-switchbtn"
            onClick={() => chooseSource('youtube')}
          >
            YouTube
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={source === 'apple'}
            className="af-amp-switchbtn"
            onClick={() => chooseSource('apple')}
          >
            Apple Music
          </button>
        </div>

        {source === 'youtube' ? (
          <div role="tabpanel" aria-label="YouTube" className="af-amp-section">
            <div className="af-amp-stations">
              {YOUTUBE_STATIONS.map((station) => (
                <button
                  key={station.id}
                  type="button"
                  className="af-amp-station"
                  data-active={snap.yt?.key === station.id ? 'true' : undefined}
                  onClick={() => act.playYouTube({ key: station.id, label: station.label, source: station.source })}
                >
                  <span className="af-amp-station-title">{station.label}</span>
                  <span className="af-amp-station-sub">{station.channel}</span>
                </button>
              ))}
            </div>

            <form className="af-amp-link" onSubmit={submitLink}>
              <label className="af-amp-label" htmlFor="af-amp-link-input">
                Or paste any YouTube song or playlist link
              </label>
              <div className="af-amp-row">
                <input
                  id="af-amp-link-input"
                  className="af-amp-input"
                  type="url"
                  inputMode="url"
                  placeholder="youtube.com/playlist?list=…"
                  value={link}
                  onChange={(e) => {
                    setLink(e.target.value)
                    setLinkError(null)
                  }}
                />
                <button type="submit" className="af-amp-btn" disabled={!link.trim()}>
                  Play
                </button>
              </div>
              {linkError ? (
                <p className="af-amp-error" role="alert">
                  {linkError}
                </p>
              ) : null}
            </form>
          </div>
        ) : (
          <div role="tabpanel" aria-label="Apple Music" className="af-amp-section">
            {snap.appleStatus === 'idle' || snap.appleStatus === 'checking' ? (
              <p className="af-amp-msg">Checking Apple Music…</p>
            ) : null}

            {snap.appleStatus === 'unavailable' ? (
              <p className="af-amp-msg">Apple Music isn’t set up yet. YouTube works for everyone.</p>
            ) : null}

            {snap.appleStatus === 'error' ? (
              <div className="af-amp-row">
                <p className="af-amp-msg">Apple Music didn’t load.</p>
                <button type="button" className="af-amp-chip" onClick={act.startApple}>
                  Try again
                </button>
              </div>
            ) : null}

            {snap.appleStatus === 'signed-out' || snap.appleStatus === 'connecting' ? (
              <div className="af-amp-connect">
                {/* Never disabled while connecting: Apple's window can be closed half-way, and a
                    second press re-opens it (observed 2026-11-15). */}
                <button type="button" className="af-amp-btn af-amp-btn--apple" onClick={act.connectApple}>
                  {snap.appleStatus === 'connecting' ? 'Open Apple sign-in again' : 'Connect Apple Music'}
                </button>
                <p className="af-amp-msg">
                  {snap.appleStatus === 'connecting'
                    ? 'Finish signing in on Apple’s window, including any “Allow” step. Closed it? Press the button again.'
                    : SUBSCRIPTION_NOTE}
                </p>
              </div>
            ) : null}

            {snap.appleStatus === 'ready' ? (
              <>
                <form
                  className="af-amp-row"
                  onSubmit={(e) => {
                    e.preventDefault()
                    act.search(query)
                  }}
                >
                  <input
                    className="af-amp-input"
                    type="search"
                    aria-label="Search Apple Music"
                    placeholder="Search songs or playlists"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                  />
                  <button type="submit" className="af-amp-btn" disabled={!query.trim() || snap.searching}>
                    {snap.searching ? 'Searching…' : 'Search'}
                  </button>
                </form>

                {snap.results.length === 0 ? (
                  <div className="af-amp-quick">
                    {APPLE_QUICK_SEARCHES.map((term) => (
                      <button
                        key={term}
                        type="button"
                        className="af-amp-chip"
                        onClick={() => {
                          setQuery(term)
                          act.search(term)
                        }}
                      >
                        {term}
                      </button>
                    ))}
                  </div>
                ) : (
                  <ul className="af-amp-results">
                    {snap.results.map((item) => (
                      <li key={`${item.kind}:${item.id}`}>
                        <button type="button" className="af-amp-result" onClick={() => act.playApple(item)}>
                          {item.art ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img src={item.art} alt="" width={40} height={40} />
                          ) : (
                            <span className="af-amp-art af-amp-art--sm" aria-hidden="true">
                              ♫
                            </span>
                          )}
                          <span className="af-amp-nowtext">
                            <b>{item.title}</b>
                            <span>
                              {item.kind === 'playlist' ? 'Playlist' : 'Song'}
                              {item.subtitle ? ` · ${item.subtitle}` : ''}
                            </span>
                          </span>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}

                <button type="button" className="af-amp-linkbtn" onClick={act.disconnectApple}>
                  Disconnect Apple Music
                </button>
              </>
            ) : null}

            {snap.appleMsg ? (
              <p className="af-amp-error" role="status">
                {snap.appleMsg}
              </p>
            ) : null}
          </div>
        )}

        <p className="af-amp-note">
          Keeps playing when you close chat or change pages. YouTube shrinks to a small box; Apple Music plays
          hidden.
        </p>
      </div>
    </div>
  )
}

export default MusicPanel
