'use client'

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { usePathname } from 'next/navigation'
import { useSession } from 'next-auth/react'
import './af-app-music.css'
import { youTubeEmbedUrl } from '@/lib/draft-music/youtube'
import {
  artworkUrl,
  searchCatalog,
  setUpMusicKit,
  type AppleSearchResult,
  type MusicKitInstance,
} from '@/lib/apple-music/musicKitClient'
import { COMMS_OPEN_EVENT, type CommsOpenDetail } from '@/components/core-app/comms/commsEvents'
import { useOptionalLanguage } from '@/components/i18n/LanguageProviderClient'
import { appMusicCopy, appMusicLang } from '@/lib/i18n/app-music-copy'
import {
  musicBus,
  placeYouTube,
  type AppleMsg,
  type AppleNow,
  type AppleStatus,
  type MusicActions,
  type YouTubePlaying,
} from './musicBus'

/**
 * App-wide music ENGINE — YouTube for everyone, Apple Music for subscribers.
 *
 * Mounted ONCE in the root layout, so it survives every client-side navigation:
 * music started in the draft room keeps playing on lineups, trades, standings.
 * A full page reload or signing out stops it; nothing can survive those.
 *
 * ⚠ THE CONTROLS ARE NOT HERE. They are the Music tab of the chat panel
 * (components/app-music/MusicPanel.tsx inside CommsDrawer) — the user's call on
 * 2026-11-15, after the first version's right-edge "♫" tab proved too easy to
 * miss. See musicBus.ts for why the chat panel cannot own the audio itself.
 *
 * What this renders, and nothing else:
 *   - YouTube, while the chat's Music tab is open: the one iframe, positioned
 *     over the tab's "screen" so it reads as playing inside the chat.
 *   - YouTube, where a page reports its own slot (musicBus.setSlot — the draft room's music row):
 *     laid over that slot, so it sits in the page instead of over the board.
 *   - YouTube, once the chat is minimized or closed: a 200×200 box in the corner.
 *     ⚠ NEVER HIDDEN. YouTube's embed rules forbid hiding a playing player or
 *     using it as background audio — the user chose "small box (allowed)" when
 *     offered the alternative.
 *   - Apple Music: nothing. Apple has no such rule, so minimized means hidden.
 *
 * ⚠ ONE IFRAME, MOVED WITH CSS. Re-parenting an iframe reloads it, which would
 * restart the song every time the chat opened or closed. It stays in this
 * component; only its position and size change.
 */

const HIDDEN_PREFIXES = ['/login', '/signup', '/signin', '/logout', '/auth']

/** Opens the chat panel on its Music tab, from anywhere (the draft room's button uses it). */
export function openAppMusicPicker(): void {
  const detail: CommsOpenDetail = { tab: 'music' }
  window.dispatchEvent(new CustomEvent(COMMS_OPEN_EVENT, { detail }))
}


export type AppMusicDockProps = {
  /** Play even when signed out. Dev previews only; the app gates on a session. */
  alwaysShow?: boolean
}

export function AppMusicDock({ alwaysShow = false }: AppMusicDockProps) {
  const { status } = useSession()
  const pathname = usePathname()
  const lang = appMusicLang(useOptionalLanguage().language)
  const visible =
    alwaysShow ||
    (status === 'authenticated' && !HIDDEN_PREFIXES.some((p) => pathname?.startsWith(p)))

  const [yt, setYt] = useState<YouTubePlaying | null>(null)
  const musicRef = useRef<MusicKitInstance | null>(null)
  const mountedRef = useRef(true)
  const [appleStatus, setAppleStatus] = useState<AppleStatus>('idle')
  const [appleNow, setAppleNow] = useState<AppleNow | null>(null)
  const [appleMsg, setAppleMsg] = useState<AppleMsg | null>(null)
  const [results, setResults] = useState<AppleSearchResult[]>([])
  const [searching, setSearching] = useState(false)

  /** Where the chat tab's screen is — null whenever the Music tab is not showing. */
  const screen = useSyncExternalStore(musicBus.subscribe, musicBus.getScreen, musicBus.getServerScreen)
  /** A page's own place for the player (the draft room's music row) — null almost everywhere. */
  const slot = useSyncExternalStore(musicBus.subscribe, musicBus.getSlot, musicBus.getServerSlot)

  /**
   * "Change" only makes sense where there is a chat bubble to open. ⚠ Re-checked when the chat
   * CLOSES as well: the bubble is not on the page while the chat is open, so a check made then
   * found nothing and the minimized box came up with no Change button (seen in the preview).
   */
  const [hasChat, setHasChat] = useState(false)
  const chatShowing = screen != null
  useEffect(() => {
    const check = () => setHasChat(!!document.querySelector('.af-cm-launch'))
    check()
    const t = window.setTimeout(check, 800)
    return () => window.clearTimeout(t)
  }, [pathname, yt, chatShowing])

  useEffect(() => {
    mountedRef.current = true
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
  }, [])

  // Signed out, or on a sign-in page: no music, and nothing left playing.
  useEffect(() => {
    if (!visible) stopAll()
  }, [visible, stopAll])

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
    const music = musicRef.current
    if (!music || appleStatus !== 'ready') return
    const sync = () => {
      const item = music.nowPlayingItem
      if (!item) {
        setAppleNow(null)
        return
      }
      setAppleNow({
        title: item.title ?? item.attributes?.name ?? '', // the Music tab words a missing title
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

  const connectApple = useCallback(async () => {
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
      // ⚠ THE COMMON CAUSE IS NOT A FAILED SIGN-IN. An Apple ID with no Apple Music
      // subscription signs in fine, then Apple opens its own upsell page
      // (music.apple.com/deeplink?p=subscribe&source=webPlayerUpsell) and authorize()
      // rejects. "Try again" sent people round that loop (reported 2026-11-15), so
      // name the real reason and point at what works without a subscription.
      if (mountedRef.current) {
        setAppleMsg({ code: 'connect-failed' })
      }
    }
    if (mountedRef.current) setAppleStatus(music.isAuthorized ? 'ready' : 'signed-out')
  }, [])

  const disconnectApple = useCallback(async () => {
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
  }, [])

  const search = useCallback(async (term: string) => {
    const music = musicRef.current
    const trimmed = term.trim()
    if (!music || !trimmed) return
    setSearching(true)
    setAppleMsg(null)
    try {
      const found = await searchCatalog(music, trimmed)
      if (!mountedRef.current) return
      setResults(found)
      if (found.length === 0) setAppleMsg({ code: 'nothing-found', term: trimmed })
    } catch {
      if (mountedRef.current) setAppleMsg({ code: 'search-failed' })
    } finally {
      if (mountedRef.current) setSearching(false)
    }
  }, [])

  const playApple = useCallback(async (item: AppleSearchResult) => {
    const music = musicRef.current
    if (!music) return
    setAppleMsg(null)
    // Search works signed out; playing does not. Ask for the sign-in at the moment
    // it is needed, and play the chosen item as soon as it succeeds.
    if (!music.isAuthorized) {
      await connectApple()
      if (!music.isAuthorized) return // connectApple has already said why
    }
    setYt(null) // one source at a time
    try {
      await music.setQueue(
        item.kind === 'song' ? { song: item.id, startPlaying: true } : { playlist: item.id, startPlaying: true },
      )
    } catch {
      if (mountedRef.current) setAppleMsg({ code: 'play-failed' })
    }
  }, [connectApple])

  const appleToggle = useCallback(() => {
    const music = musicRef.current
    if (!music) return
    if (music.isPlaying) music.pause()
    else void music.play().catch(() => setAppleMsg({ code: 'play-failed' }))
  }, [])

  /* ── YouTube ─────────────────────────────────────────────────────────── */

  const playYouTube = useCallback((next: YouTubePlaying) => {
    try {
      if (musicRef.current?.isPlaying) musicRef.current.pause()
    } catch {
      /* nothing to pause */
    }
    setYt(next)
  }, [])

  /* ── Publish to the chat tab ─────────────────────────────────────────── */

  /*
   * ⚠ ONLY AN ACTIVE ENGINE SPEAKS FOR THE BUS. An inactive one (signed out, or a
   * sign-in page) touches nothing: found 2026-11-15 when a page with two engines —
   * the root layout's, inactive, and a dev preview's — had the inactive one publish
   * "not ready" over the active one's state, and the chat tab said "Music isn't
   * available". Going inactive withdraws once, here; declared FIRST so a remount's
   * re-publish below lands after it.
   */
  useEffect(() => {
    if (!visible) return
    return () => {
      musicBus.setActions(null)
      musicBus.publish({ ...musicBus.getSnapshot(), ready: false })
    }
  }, [visible])

  useEffect(() => {
    if (!visible) return
    musicBus.publish({ ready: true, yt, appleStatus, appleNow, appleMsg, results, searching })
  }, [visible, yt, appleStatus, appleNow, appleMsg, results, searching])

  useEffect(() => {
    if (!visible) return
    const registered: MusicActions = {
      playYouTube,
      stop: stopAll,
      startApple: () => void startApple(),
      connectApple: () => void connectApple(),
      disconnectApple: () => void disconnectApple(),
      search: (term) => void search(term),
      playApple: (item) => void playApple(item),
      appleToggle,
      appleNext: () => void musicRef.current?.skipToNextItem().catch(() => undefined),
      applePrev: () => void musicRef.current?.skipToPreviousItem().catch(() => undefined),
    }
    musicBus.setActions(registered)
    return () => musicBus.setActions(null)
  }, [visible, playYouTube, stopAll, startApple, connectApple, disconnectApple, search, playApple, appleToggle])

  if (!visible || !yt) return null

  const place = placeYouTube(screen, slot)
  const rect = place.rect

  return (
    <div
      className="af-amd-yt"
      role="region"
      aria-label={appMusicCopy(lang, 'playerRegion')}
      data-in-chat={place.where === 'chat' ? 'true' : undefined}
      data-in-slot={place.where === 'slot' ? 'true' : undefined}
      style={rect ? { left: rect.left, top: rect.top, width: rect.width, height: rect.height } : undefined}
    >
      {/* In the chat, the Music tab draws its own title and Stop; in a page's slot, that page's row does.
          Kept as a null slot so the iframe below never changes position and never reloads. */}
      {rect ? null : (
        <div className="af-amd-yt-head">
          <span className="af-amd-yt-title">{yt.label}</span>
          {hasChat ? (
            <button type="button" className="af-amd-yt-btn" onClick={openAppMusicPicker}>
              {appMusicCopy(lang, 'change')}
            </button>
          ) : null}
          <button type="button" className="af-amd-yt-btn" aria-label={appMusicCopy(lang, 'stopMusic')} onClick={stopAll}>
            ✕
          </button>
        </div>
      )}
      <iframe
        key={yt.key}
        src={youTubeEmbedUrl(yt.source, { autoplay: true })}
        title={appMusicCopy(lang, 'onYouTube', { label: yt.label })}
        allow="autoplay; encrypted-media; picture-in-picture"
        allowFullScreen
        referrerPolicy="strict-origin-when-cross-origin"
      />
    </div>
  )
}

/**
 * The draft room's way in: a slim bar in normal flow above the board that opens
 * the chat on its Music tab. Never over the board, never autoplays.
 */
export function AppMusicLauncher({ label }: { label?: string }) {
  const lang = appMusicLang(useOptionalLanguage().language)
  return (
    <div className="af-amd-launch">
      <span className="af-amd-launch-mark" aria-hidden="true">
        ♫
      </span>
      <span className="af-amd-launch-text">{label ?? appMusicCopy(lang, 'launcherLabel')}</span>
      <button type="button" className="af-amd-launch-btn" onClick={openAppMusicPicker}>
        {appMusicCopy(lang, 'playMusic')}
      </button>
    </div>
  )
}

export default AppMusicDock
