"use client"

import { useEffect, useRef } from "react"
import { usePathname } from "next/navigation"
import { isNewVersionReady, subscribeNewVersionReady } from "@/lib/core-app/deployGuard"
import { musicBus } from "@/components/app-music/musicBus"
import { hasUnsavedWork } from "@/lib/core-app/unsavedWork"

/**
 * Picks up a new deploy WITHOUT asking — the reader's side of `lib/core-app/deployGuard`.
 *
 * When a deploy lands while a page is open, background refreshes stop (each would have been a full
 * reload under the reader's next tap). This used to show a "New version ready · Refresh" pill.
 * The product call (2026-11-14) was that nobody should have to press anything for that, so the page
 * reloads itself — but ONLY where the reader cannot see it: when the tab or app goes into the
 * background, it reloads there and is fresh when they come back.
 *
 * Any in-app link they click in the meantime already loads the new build (Next.js navigates by a
 * full load when the build id changed), so until then the page simply keeps working.
 *
 * 🛑 A PAGE THE READER CAN SEE IS NEVER RELOADED. There used to be a second rule: visible but
 * untouched for three minutes also reloaded. With dozens of deploys a day that was a full-page
 * flash every few minutes for anyone reading, watching or listening rather than clicking, and it
 * was reported as exactly that (2026-11-18): "the page keeps refreshing over and over". Untouched
 * is not away. Do not bring an idle timer back.
 *
 * 🛑 NEVER WHILE MUSIC IS LOADED — NOT EVEN IN THE BACKGROUND. The player (AppMusicDock) survives
 * every in-app navigation and nothing survives a reload; the same report was a YouTube track cut
 * off mid-song. Putting the tab in the background is what people DO while listening, so the
 * hidden-tab reload was hitting the one moment it could not be allowed to.
 *
 * 🛑 NEVER WHILE SOMETHING IS BEING TYPED. A field the reader typed into that still holds text, or
 * the focused editable element, blocks the reload: a reload would throw that text away. Then the
 * next navigation picks the build up instead, which is a click they chose.
 */

/*
 * A draft — a live room, a mock, or Draft HQ's own board and clock — is never reloaded by this,
 * not even in the background: a reload there drops the room for the seconds it takes to rejoin,
 * which can be the seconds someone is on the clock. The next link they click picks the build up.
 */
export const NEVER_AUTO_RELOAD = /^\/(core\/draft-hq|draft|drafts|mock-draft|mock-draft-simulator|league\/[^/]+\/(draft|dispersal-draft))(\/|$)/

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

/**
 * True when a reload would cut off music. ⚠ LOADED, not "audibly playing": the YouTube player is a
 * cross-origin iframe and does not report pause, and a paused Apple track is still a queue and a
 * position the listener would lose. Pressing Stop in the Music tab is what clears it.
 */
export function wouldStopMusic(): boolean {
  const { yt, appleNow } = musicBus.getSnapshot()
  return yt != null || appleNow != null
}

export function NewVersionReload() {
  const pathname = usePathname()
  const pathRef = useRef(pathname ?? "")
  pathRef.current = pathname ?? ""

  useEffect(() => {
    const typed = new Set<Element>()
    let reloading = false

    const reloadIfUnseen = () => {
      if (reloading || !isNewVersionReady()) return
      if (document.visibilityState !== "hidden") return
      if (NEVER_AUTO_RELOAD.test(pathRef.current)) return
      if (wouldStopMusic()) return
      // A trade being built by tapping, or any other work a screen registered (lib/core-app/unsavedWork).
      if (hasUnsavedWork()) return
      for (const el of typed) if (!el.isConnected) typed.delete(el)
      if (wouldLoseTyping(typed)) return
      reloading = true
      window.location.reload()
    }

    const onInput = (event: Event) => {
      const target = event.target
      if (target instanceof Element && isEditable(target)) typed.add(target)
    }

    document.addEventListener("input", onInput, true)
    document.addEventListener("visibilitychange", reloadIfUnseen)
    const unsubscribe = subscribeNewVersionReady(reloadIfUnseen)

    return () => {
      unsubscribe()
      document.removeEventListener("input", onInput, true)
      document.removeEventListener("visibilitychange", reloadIfUnseen)
    }
  }, [])

  return null
}

export default NewVersionReload
