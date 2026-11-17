'use client'

import type { YouTubeSource } from '@/lib/draft-music/youtube'
import type { AppleSearchResult } from '@/lib/apple-music/musicKitClient'

/**
 * The line between the music ENGINE and the music CONTROLS.
 *
 * ⚠ WHY THEY ARE SPLIT. The engine (the YouTube iframe, MusicKit) lives in
 * AppMusicDock, mounted once in the ROOT layout, because that is the only place
 * that survives a client-side navigation — music keeps playing from the lineup
 * to a trade. The controls live in the chat panel's Music tab, and the chat
 * panel is REMOUNTED on every /core screen change (CommsDrawer says so in its own
 * comments). A player inside the chat panel would restart on every click.
 *
 * So the chat tab never owns audio. It reads the engine's state from here,
 * calls the engine's actions from here, and reports where its "screen" is so
 * the engine can position the one YouTube iframe over it. Moving an iframe to a
 * new DOM parent reloads it; moving it with CSS does not.
 *
 * A module-level store rather than React context: the dock and the chat panel
 * sit in different branches of the root layout with no shared provider above
 * them, and both are client modules, so they share this one instance.
 */

export type YouTubePlaying = { key: string; label: string; source: YouTubeSource }

export type AppleStatus =
  | 'idle'
  | 'checking'
  | 'unavailable'
  | 'error'
  | 'signed-out'
  | 'connecting'
  | 'ready'

export type AppleNow = { title: string; artist: string; art: string | null; playing: boolean }

/**
 * What the engine has to say about Apple — a CODE, never a sentence. The Music
 * tab words it in the viewer's language (lib/i18n/app-music-copy.ts), so a
 * message already on screen follows a language switch.
 */
export type AppleMsg =
  | { code: 'connect-failed' }
  | { code: 'nothing-found'; term: string }
  | { code: 'search-failed' }
  | { code: 'play-failed' }

export type MusicSnapshot = {
  /** The engine is mounted and allowed to play here (signed in, not on a sign-in page). */
  ready: boolean
  yt: YouTubePlaying | null
  appleStatus: AppleStatus
  appleNow: AppleNow | null
  appleMsg: AppleMsg | null
  results: AppleSearchResult[]
  searching: boolean
}

export type MusicActions = {
  playYouTube(next: YouTubePlaying): void
  stop(): void
  startApple(): void
  connectApple(): void
  disconnectApple(): void
  search(term: string): void
  playApple(item: AppleSearchResult): void
  appleToggle(): void
  appleNext(): void
  applePrev(): void
}

/** Where the chat tab's YouTube "screen" is on the page, in viewport pixels. */
export type ScreenRect = { left: number; top: number; width: number; height: number }

const INITIAL: MusicSnapshot = {
  ready: false,
  yt: null,
  appleStatus: 'idle',
  appleNow: null,
  appleMsg: null,
  results: [],
  searching: false,
}

let snapshot: MusicSnapshot = INITIAL
let screen: ScreenRect | null = null
/** A page's own place for the player — today only the draft room's music row on a phone (2026-11-17). */
let slot: ScreenRect | null = null
let actions: MusicActions | null = null
const listeners = new Set<() => void>()

function emit() {
  for (const l of listeners) l()
}

function sameRect(a: ScreenRect | null, b: ScreenRect | null): boolean {
  if (a === b) return true
  if (!a || !b) return false
  return a.left === b.left && a.top === b.top && a.width === b.width && a.height === b.height
}

export const musicBus = {
  subscribe(listener: () => void): () => void {
    listeners.add(listener)
    return () => listeners.delete(listener)
  },
  getSnapshot: (): MusicSnapshot => snapshot,
  getServerSnapshot: (): MusicSnapshot => INITIAL,
  getScreen: (): ScreenRect | null => screen,
  getServerScreen: (): ScreenRect | null => null,
  getSlot: (): ScreenRect | null => slot,
  getServerSlot: (): ScreenRect | null => null,

  /** Engine only. */
  publish(next: MusicSnapshot): void {
    snapshot = next
    emit()
  },
  /**
   * Engine only. ⚠ It must notify too: the engine publishes state and registers
   * actions in separate effects, so a chat tab that rendered between the two
   * would otherwise sit on "not available" until some unrelated state changed.
   */
  setActions(next: MusicActions | null): void {
    actions = next
    emit()
  },
  actions(): MusicActions | null {
    return actions
  },

  /** Chat tab only: where to draw YouTube, or null when the tab is not showing. */
  setScreen(next: ScreenRect | null): void {
    if (sameRect(screen, next)) return
    screen = next
    emit()
  },

  /**
   * A page's own place for the player, or null. The draft room's music row reports one on a phone so the player
   * sits IN the row instead of floating over the board. The chat's Music tab still wins while it is showing.
   */
  setSlot(next: ScreenRect | null): void {
    if (sameRect(slot, next)) return
    slot = next
    emit()
  },
}

export type YouTubePlacement =
  | { where: 'chat'; rect: ScreenRect }
  | { where: 'slot'; rect: ScreenRect }
  | { where: 'corner'; rect: null }

/**
 * Where the one YouTube player goes: the chat's Music tab when it is showing, else a page's slot, else the corner box.
 * ⚠ A slot smaller than 200×200 is refused: YouTube's embed rules want a playing player visible at that size at least.
 */
export function placeYouTube(chatScreen: ScreenRect | null, pageSlot: ScreenRect | null): YouTubePlacement {
  if (chatScreen) return { where: 'chat', rect: chatScreen }
  if (pageSlot && pageSlot.width >= 200 && pageSlot.height >= 200) return { where: 'slot', rect: pageSlot }
  return { where: 'corner', rect: null }
}
