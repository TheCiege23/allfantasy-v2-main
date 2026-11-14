"use client"

import { useEffect } from "react"
import { isNewVersionReady, subscribeNewVersionReady } from "@/lib/core-app/deployGuard"

/**
 * Picks up a new deploy WITHOUT asking — the reader's side of `lib/core-app/deployGuard`.
 *
 * When a deploy lands while a page is open, background refreshes stop (each would have been a full
 * reload under the reader's next tap). This used to show a "New version ready · Refresh" pill.
 * The product call (2026-11-14) was that nobody should have to press anything for that, so the page
 * now reloads itself at a moment the reader cannot see or is not using:
 *
 *   - the tab or app goes into the background — it reloads there, fresh when they come back;
 *   - or the page stays visible but untouched (no pointer, key, wheel or scroll) for IDLE_RELOAD_MS,
 *     so a game-day screen left open does not sit on a frozen build for hours.
 *
 * Any in-app link they click in the meantime already loads the new build (Next.js navigates by a
 * full load when the build id changed), so between those moments the page simply keeps working.
 *
 * 🛑 NEVER WHILE SOMETHING IS BEING TYPED. A field the reader typed into that still holds text, or
 * the focused editable element, blocks the reload: a reload would throw that text away. Then the
 * next navigation picks the build up instead, which is a click they chose.
 */

export const IDLE_RELOAD_MS = 3 * 60_000

const ACTIVITY_EVENTS = ["pointerdown", "keydown", "wheel", "touchstart", "scroll"] as const

function isEditable(el: Element | null): boolean {
  if (!el) return false
  if (el instanceof HTMLTextAreaElement) return true
  if (el instanceof HTMLInputElement) {
    return !["hidden", "checkbox", "radio", "button", "submit", "reset", "file", "range", "color", "image"].includes(el.type)
  }
  return el instanceof HTMLElement && el.isContentEditable
}

function holdsText(el: Element): boolean {
  if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) return el.value.trim().length > 0
  return el instanceof HTMLElement && (el.textContent ?? "").trim().length > 0
}

/**
 * True when reloading now could lose something the reader wrote. `typed` holds the fields they have
 * typed into on this page; one that is still on the page and still holds text counts — a chat box
 * that was sent and cleared does not.
 */
export function wouldLoseTyping(typed: Iterable<Element>, doc: Document = document): boolean {
  const active = doc.activeElement
  if (active && isEditable(active) && holdsText(active)) return true
  for (const el of typed) {
    if (el.isConnected && holdsText(el)) return true
  }
  return false
}

export function NewVersionReload() {
  useEffect(() => {
    const typed = new Set<Element>()
    let lastActivity = Date.now()
    let idleTimer: number | undefined
    let reloading = false

    const reloadIfSafe = () => {
      if (reloading || !isNewVersionReady()) return
      for (const el of typed) if (!el.isConnected) typed.delete(el)
      if (wouldLoseTyping(typed)) return
      reloading = true
      window.location.reload()
    }

    const scheduleIdle = () => {
      window.clearTimeout(idleTimer)
      if (!isNewVersionReady()) return
      const wait = Math.max(0, lastActivity + IDLE_RELOAD_MS - Date.now())
      idleTimer = window.setTimeout(() => {
        if (document.visibilityState === "visible" && Date.now() - lastActivity < IDLE_RELOAD_MS) {
          scheduleIdle()
          return
        }
        reloadIfSafe()
      }, wait)
    }

    const onActivity = () => {
      lastActivity = Date.now()
      if (isNewVersionReady()) scheduleIdle()
    }
    const onInput = (event: Event) => {
      const target = event.target
      if (target instanceof Element && isEditable(target)) typed.add(target)
      onActivity()
    }
    const onVisibility = () => {
      if (document.visibilityState === "hidden") reloadIfSafe()
    }

    for (const type of ACTIVITY_EVENTS) window.addEventListener(type, onActivity, { capture: true, passive: true })
    document.addEventListener("input", onInput, true)
    document.addEventListener("visibilitychange", onVisibility)
    const unsubscribe = subscribeNewVersionReady(() => {
      if (document.visibilityState === "hidden") reloadIfSafe()
      else scheduleIdle()
    })
    if (isNewVersionReady()) scheduleIdle()

    return () => {
      unsubscribe()
      window.clearTimeout(idleTimer)
      for (const type of ACTIVITY_EVENTS) window.removeEventListener(type, onActivity, { capture: true })
      document.removeEventListener("input", onInput, true)
      document.removeEventListener("visibilitychange", onVisibility)
    }
  }, [])

  return null
}

export default NewVersionReload
