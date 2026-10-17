'use client'

import type { CommsTab } from './CommsDrawer'

/**
 * Where the chat was — open or closed, which tab, which league — kept for the browser session.
 *
 * 🛑 THE CHAT DOES NOT SURVIVE A /core SCREEN CHANGE ON ITS OWN. AfCoreShell — and CommsDock in it —
 * is rendered by `app/core/(shell)/[[...screen]]/page.tsx`, and Next keys that segment's React tree
 * on its param (layout-router's `stateKey`, built by createRouterCacheKey: `screen|trades|oc` vs
 * `screen|waivers|oc`). So every screen change builds a NEW shell and the chat starts over: closed,
 * on its default tab (owner report 2026-09-25: "the chat bubble closes … and doesn't come back").
 * Moving `loading.tsx` above the `(shell)` group (bc722a4bd) stopped the whole-app skeleton between
 * tabs; it did NOT stop this remount, because the key is the page segment's, not the boundary's.
 * A league switch is a query change only and keeps the same key, so it never lost the chat.
 * The drawer's own comment once claimed it "stays mounted across navigations"; it does not.
 *
 * Remembered per signed-in user, so one account's chat state never opens for another. sessionStorage,
 * not localStorage: a new tab or tomorrow starts closed, which is what a chat bubble should do.
 * Every access is guarded — private windows and blocked storage throw, and the chat must still work.
 */

const PREFIX = 'af:comms:ui:v1:'

export type CommsUiMemory = {
  open?: boolean
  tab?: CommsTab
  scopeId?: string | null
  /** The page's league when `scopeId` was chosen — a scope is only restored on the same page league. */
  pageLeagueId?: string | null
}

export function readCommsUi(userId: string | undefined): CommsUiMemory | null {
  if (!userId || typeof window === 'undefined') return null
  try {
    const raw = window.sessionStorage.getItem(PREFIX + userId)
    if (!raw) return null
    const parsed = JSON.parse(raw) as unknown
    return parsed && typeof parsed === 'object' ? (parsed as CommsUiMemory) : null
  } catch {
    return null
  }
}

export function writeCommsUi(userId: string | undefined, patch: CommsUiMemory): void {
  if (!userId || typeof window === 'undefined') return
  try {
    const next = { ...(readCommsUi(userId) ?? {}), ...patch }
    window.sessionStorage.setItem(PREFIX + userId, JSON.stringify(next))
  } catch {
    /* storage unavailable: the chat simply starts fresh after a navigation */
  }
}
