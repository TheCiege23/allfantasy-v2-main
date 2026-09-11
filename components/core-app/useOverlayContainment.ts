'use client'

import { useEffect, useRef, type RefObject } from 'react'

/**
 * Modal-overlay hygiene, in one place, for every /core overlay.
 *
 * Focus containment, Escape, focus restoration, background inertness and a
 * background scroll lock are five rules that every dialog needs and that every
 * dialog here implemented separately — or, mostly, did not implement at all.
 * Before this hook:
 *
 *   - the league tray had all five, and was the only one that did.
 *   - the player card sheet had Escape, initial focus, restoration and a scroll
 *     lock, but NO containment: Tab walked straight out of the sheet into the
 *     roster behind the scrim, and nothing behind it was inert.
 *   - the Comms drawer had Escape, initial focus and a scroll lock, no
 *     containment, and NO focus restoration at all — closing it dropped focus on
 *     <body>, which puts a keyboard user back at the top of a 16-row roster.
 *   - the support modal had Escape only.
 *
 * 🛑 EACH WAS DEFENSIBLE ALONE AND THE SET WAS NOT. Every failure below needs
 * TWO overlays open, which is reachable in one gesture on My Team — tap a player
 * name, then Ask Chimmy — and is therefore not an exotic case.
 *
 * 1. THE SCROLL LOCK INVERTED. The sheet opens and saves `overflow: ''`; the
 *    drawer opens and saves `overflow: 'hidden'`. Close the SHEET first and its
 *    cleanup restores the value IT captured — `''` — unlocking the page while the
 *    drawer is still open and modal. Close the drawer after and it writes back
 *    `'hidden'`, locking a page with no overlay on it at all. "The previous
 *    value" is not a property any single overlay can own, so the lock is
 *    REFERENCE COUNTED at module scope: the first acquire captures the real
 *    previous value, the last release restores it, every acquire between is a
 *    no-op.
 *
 * 2. ONE ESCAPE CLOSED EVERY OPEN OVERLAY, because each listener was bound to
 *    `document`/`window` independently and all of them fired. A module-level
 *    STACK makes only the TOPMOST overlay answer, so Escape peels one layer at a
 *    time the way a user expects.
 *
 * 3. A DIALOG COULD SIT INSIDE AN INERT SUBTREE — the tray marked every sibling
 *    of `.af-rail` inert, and both `.af-main` (which contains the player card)
 *    and `CommsDock` (which contains the Comms drawer) are siblings of it. Open
 *    the tray over an open card and the card became unfocusable and unclickable
 *    while still painted. Inertness therefore cannot be decided by one overlay
 *    about its own siblings; it is recomputed here for whichever overlay is
 *    topmost, by walking that overlay's ANCESTOR CHAIN and inerting only the
 *    siblings alongside it. No ancestor of the active dialog is ever inert, so
 *    the active dialog is never inside an inert subtree — by construction rather
 *    than by a list of exceptions.
 *
 * 4. FOCUS WENT TO THE OPENER EVEN WHEN ANOTHER MODAL WAS STILL OPEN. Closing
 *    the topmost overlay now hands focus to the overlay revealed beneath it, and
 *    only the LAST one to close returns focus to the original opener. Closing a
 *    NON-topmost overlay moves focus nowhere: something above it owns focus and
 *    stealing it is the bug, not the fix.
 */

type OverlayEntry = {
  containerRef: RefObject<HTMLElement | null>
  initialFocusRef?: RefObject<HTMLElement | null>
  /** Controls outside the container that stay live AND stay in the Tab cycle. */
  keepRefs: ReadonlyArray<RefObject<HTMLElement | null>>
  /** Outside the container, exempt from inert, but NOT in the Tab cycle. */
  clickableRefs: ReadonlyArray<RefObject<HTMLElement | null>>
  onClose: () => void
  /** Where focus sat when this overlay activated. May be unmounted by close. */
  restoreTo: HTMLElement | null
  /** Used when `restoreTo` survives but is no longer focusable. See the hook option. */
  restoreFallbackRef: RefObject<HTMLElement | null> | null
}

/** Bottom-to-top. The last entry is the only one that answers Escape and Tab. */
const overlayStack: OverlayEntry[] = []

// ── Background scroll lock ───────────────────────────────────────────────

let lockCount = 0
let previousOverflow: string | null = null

function acquireScrollLock(): void {
  if (lockCount === 0) {
    previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
  }
  lockCount += 1
}

function releaseScrollLock(): void {
  lockCount = Math.max(0, lockCount - 1)
  if (lockCount === 0) {
    document.body.style.overflow = previousOverflow ?? ''
    previousOverflow = null
  }
}

// ── Background inertness ─────────────────────────────────────────────────

/**
 * Every node this module has marked, against the value it had first.
 *
 * ⚠ THE ORIGINAL VALUE IS CAPTURED ONCE, ON THE FIRST MARK ONLY. Recomputing on
 * a later push would otherwise capture `true` — the value WE wrote a moment ago —
 * and the node would stay inert forever after the last overlay closed.
 */
const inertOriginals = new Map<HTMLElement, boolean>()

function markInert(el: HTMLElement): void {
  if (!inertOriginals.has(el)) inertOriginals.set(el, el.inert)
  el.inert = true
}

function clearAllInert(): void {
  inertOriginals.forEach((original, el) => {
    el.inert = original
  })
  inertOriginals.clear()
}

/**
 * Everything the inert sweep must leave alone.
 *
 * ⚠ BOTH REF LISTS COUNT HERE, AND ONLY ONE OF THEM COUNTS FOR FOCUS. A backdrop
 * has to survive the sweep or its click handler dies, but putting it in the Tab
 * cycle means tabbing off the last control lands on an invisible full-viewport
 * button with no focus ring — focus looks like it vanished. Inertness and
 * tabbability are separate questions and this is the one that asks about inert.
 */
function liveNodes(entry: OverlayEntry): HTMLElement[] {
  const container = entry.containerRef.current
  const outside = [...entry.keepRefs, ...entry.clickableRefs]
    .map((r) => r.current)
    .filter((n): n is HTMLElement => n != null)
  return container ? [container, ...outside] : outside
}

/**
 * Recompute inertness for whichever overlay is on top.
 *
 * Called on every push and pop rather than diffed, because the correct answer
 * depends only on the current topmost entry — and a diff between two ancestor
 * chains is more code than restoring and reapplying.
 */
function applyInertForTopmost(): void {
  clearAllInert()
  const top = overlayStack[overlayStack.length - 1]
  if (!top) return
  const container = top.containerRef.current
  if (!container || !container.isConnected) return
  const live = liveNodes(top)

  let node: HTMLElement = container
  while (node !== document.body && node.parentElement) {
    const parent = node.parentElement
    for (const sibling of Array.from(parent.children)) {
      if (sibling === node) continue
      if (!(sibling instanceof HTMLElement)) continue
      // A sibling holding a live control (the tray's external handle) stays live.
      if (live.some((n) => sibling === n || sibling.contains(n))) continue
      markInert(sibling)
    }
    node = parent
  }
}

// ── Focus ────────────────────────────────────────────────────────────────

const FOCUSABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled]):not([type="hidden"])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',')

/**
 * ⚠ `closest('[inert]')` RATHER THAN A `:not([inert] *)` SELECTOR. An element
 * inside an inert subtree is not focusable, and offering it in the Tab cycle
 * makes the trap look broken — focus simply refuses to move. `closest` is used
 * instead of folding the condition into the selector string because a complex
 * `:not()` argument throws a SyntaxError on older WebKit, which would take out
 * the whole trap rather than one candidate; this has to hold in WebKit too.
 */
function isFocusable(el: HTMLElement): boolean {
  if (el.hasAttribute('inert')) return false
  if (el.closest('[inert]')) return false
  // getClientRects() is empty for display:none and for a detached node, and is
  // cheaper than getComputedStyle on every candidate.
  return el.getClientRects().length > 0
}

function focusCycle(entry: OverlayEntry): HTMLElement[] {
  const container = entry.containerRef.current
  const inside = container
    ? Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter(isFocusable)
    : []
  const keep = entry.keepRefs
    .map((r) => r.current)
    .filter((n): n is HTMLElement => n != null && isFocusable(n))
  return [...inside, ...keep]
}

function focusEntry(entry: OverlayEntry): void {
  const target = entry.initialFocusRef?.current ?? entry.containerRef.current
  if (target && target.isConnected) target.focus()
}

// ── The hook ─────────────────────────────────────────────────────────────

export type OverlayContainmentOptions = {
  /** False leaves the page completely untouched — a docked panel is not modal. */
  active: boolean
  containerRef: RefObject<HTMLElement | null>
  onClose: () => void
  /** Where focus goes on open. Falls back to the container itself. */
  initialFocusRef?: RefObject<HTMLElement | null>
  /**
   * Controls that live OUTSIDE the container but belong to it, and that a
   * keyboard user should reach. They are exempt from the inert sweep AND sit at
   * the end of the Tab cycle.
   *
   * The league tray's handle is the case: it is rendered beside the tray and is
   * its close control, so it must be both clickable and tabbable.
   */
  keepInteractiveRefs?: ReadonlyArray<RefObject<HTMLElement | null>>
  /**
   * Exempt from the inert sweep, but deliberately NOT in the Tab cycle.
   *
   * 🛑 YOUR SCRIM BELONGS HERE IF IT IS A SIBLING OF THE PANEL, AND OMITTING IT
   * SILENTLY KILLS BACKDROP-CLOSE. `applyInertForTopmost` inerts every sibling
   * along the container's ancestor chain, and inert removes hit testing — so a
   * sibling scrim keeps rendering, keeps looking clickable, and its `onClick`
   * never fires again. Nothing throws. Measured on `CommsDrawer` in Chromium at
   * 1100×900: `inert` present on `.af-cm-scrim`, and a click at (8,8) left the
   * drawer open.
   *
   * Two markup shapes exist and only one is safe by default:
   *   - scrim WRAPS the panel (`PlayerCardSheet`) — an ancestor, and ancestors
   *     are never inerted. Nothing to declare.
   *   - scrim is a SIBLING of the panel (`CommsDrawer`, `SupportModal`) — in the
   *     sweep, and it must be listed here.
   *
   * ⚠ AND IT IS A SEPARATE LIST FROM `keepInteractiveRefs` FOR A MEASURED
   * REASON. Declaring the scrims as "interactive" fixed the click and broke the
   * trap: the browser proof reported `escaped: outside after 16 Tab presses`,
   * because tabbing off the last panel control landed on a transparent
   * full-viewport button with no focus ring — focus appearing to vanish. A
   * backdrop should be clickable and not tabbable; the panel already carries an
   * explicit close button for keyboard users.
   */
  keepClickableRefs?: ReadonlyArray<RefObject<HTMLElement | null>>
  /**
   * Where focus goes if the opener is still mounted but can no longer take it.
   *
   * Only needed by an overlay whose opener can VANISH while the overlay is open
   * — which in practice means a breakpoint crossing, not an unmount. The league
   * tray is the case: its opener `.af-rail-handle` is `display: none` above
   * 720px, so widening the viewport with the tray open leaves a perfectly
   * attached button that cannot be focused, and focus lands on <body>.
   *
   * Omit it for an overlay whose opener is either present or gone: the
   * `isConnected`/`isFocusable` check handles that on its own.
   */
  restoreFallbackRef?: RefObject<HTMLElement | null>
}

export function useOverlayContainment({
  active,
  containerRef,
  onClose,
  initialFocusRef,
  keepInteractiveRefs,
  keepClickableRefs,
  restoreFallbackRef,
}: OverlayContainmentOptions): void {
  /*
   * ⚠ THE CALLBACK GOES THROUGH A REF AND IS NOT AN EFFECT DEPENDENCY, AND THAT
   * IS DELIBERATE. An inline `onClose={() => setOpen(false)}` changes identity
   * every render; as a dependency it would tear down and rebuild the whole
   * containment on each one — releasing and re-acquiring the scroll lock,
   * re-entering the stack (which reorders it, so the wrong overlay would answer
   * Escape) and yanking focus back to the initial target mid-interaction. The
   * effect depends on `active` alone, so an overlay is set up exactly once per
   * opening and callers are not required to memoise anything.
   */
  const onCloseRef = useRef(onClose)
  onCloseRef.current = onClose
  const keepRef = useRef(keepInteractiveRefs)
  keepRef.current = keepInteractiveRefs
  const clickableRef = useRef(keepClickableRefs)
  clickableRef.current = keepClickableRefs

  useEffect(() => {
    if (!active) return
    const container = containerRef.current
    if (!container) return

    const entry: OverlayEntry = {
      containerRef,
      initialFocusRef,
      keepRefs: keepRef.current ?? [],
      clickableRefs: clickableRef.current ?? [],
      onClose: () => onCloseRef.current(),
      /*
       * Captured BEFORE focus moves into the overlay, and re-checked on cleanup
       * rather than trusted: the opener can be unmounted by the time the overlay
       * closes (a roster row re-rendered underneath it, or a route change), and
       * focusing a detached node silently sends focus to <body> — the exact
       * failure restoration exists to prevent.
       */
      restoreTo: document.activeElement instanceof HTMLElement ? document.activeElement : null,
      restoreFallbackRef: restoreFallbackRef ?? null,
    }

    overlayStack.push(entry)
    acquireScrollLock()
    applyInertForTopmost()
    focusEntry(entry)

    const isTopmost = () => overlayStack[overlayStack.length - 1] === entry

    const onKeyDown = (event: KeyboardEvent) => {
      if (!isTopmost()) return

      if (event.key === 'Escape') {
        event.preventDefault()
        /*
         * Stops the same keypress reaching any listener still bound by an
         * overlay lower down. One Escape, one overlay.
         */
        event.stopPropagation()
        entry.onClose()
        return
      }

      if (event.key !== 'Tab') return
      const node = containerRef.current
      if (!node) return

      const items = focusCycle(entry)
      if (items.length === 0) {
        // Nothing to land on, but focus must still not escape.
        event.preventDefault()
        node.focus()
        return
      }

      /*
       * 🛑 EVERY Tab IS DRIVEN HERE — THE WRAP IS NOT LEFT TO THE BROWSER, AND
       * WEBKIT IS WHY. The obvious trap intervenes only at the edges: preventDefault
       * when focus is on the last item (or the first, going backwards) and let the
       * browser walk the middle. That assumes both engines agree on which elements
       * are tabbable, and they do not — WebKit leaves `<a href>` out of the tab
       * order entirely (Safari's "press Tab to highlight each item on a webpage" is
       * off by default). So the last item in this cycle was an anchor WebKit would
       * never focus, the edge condition never became true, and focus walked straight
       * out of a dialog marked `aria-modal="true"`.
       *
       * Measured at 390×844 with the Comms drawer over the player card: a 15-item
       * cycle ending in `.af-cm-footlink`, focus on `.af-cm-input` at Tab 14 and
       * `document.body` at Tab 15. Chromium wrapped correctly on identical code,
       * which is exactly how an engine-dependent trap passes review.
       *
       * Driving the whole cycle costs nothing, makes the behaviour identical
       * everywhere, and is what dedicated focus-trap libraries do.
       */
      event.preventDefault()
      const current = document.activeElement
      const index = current instanceof HTMLElement ? items.indexOf(current) : -1
      if (index === -1) {
        // Outside the cycle (or on the container shell): re-enter at the edge.
        ;(event.shiftKey ? items[items.length - 1] : items[0]).focus()
        return
      }
      const step = event.shiftKey ? -1 : 1
      items[(index + step + items.length) % items.length].focus()
    }

    // Capture phase: the overlay's own children may stop propagation.
    document.addEventListener('keydown', onKeyDown, true)

    return () => {
      document.removeEventListener('keydown', onKeyDown, true)

      const at = overlayStack.indexOf(entry)
      const wasTopmost = at === overlayStack.length - 1
      if (at >= 0) overlayStack.splice(at, 1)

      releaseScrollLock()
      applyInertForTopmost()

      /*
       * Only the overlay that HELD focus hands it on. Closing a layer beneath an
       * open modal (a route change unmounting the sheet under the drawer) must
       * leave focus where it is — moving it would pull the user out of the dialog
       * they are actually using.
       */
      if (!wasTopmost) return

      const revealed = overlayStack[overlayStack.length - 1]
      if (revealed) {
        focusEntry(revealed)
        return
      }
      /*
       * 🛑 `isConnected` IS NOT ENOUGH, AND THE COMMENT ON `restoreTo` ABOVE
       * ALREADY NAMES WHY WITHOUT COVERING THIS HALF: focusing a node that
       * cannot take focus silently sends focus to <body>. A DETACHED opener was
       * guarded. A still-attached but `display: none` one was not, and it
       * reaches the same <body>.
       *
       * The live case is a breakpoint crossing, not an unmount. `.af-rail-handle`
       * is the phone tray's opener and is `display: none` above 720px, so
       * resizing phone → desktop with the tray open deactivates this overlay,
       * restores to a hidden button, and drops focus off the page entirely.
       * Measured in Chromium: activeElement was BODY, while `.af-rail-toggle` —
       * the desktop control that replaces the handle — sat right there, visible.
       *
       * `isFocusable` is the existing test and already covers it: getClientRects()
       * is empty for display:none. The fallback is supplied by the caller because
       * only the caller knows which control REPLACES the vanished one.
       */
      const restoreTo = entry.restoreTo
      if (restoreTo && isFocusable(restoreTo)) {
        restoreTo.focus()
        return
      }
      const fallback = entry.restoreFallbackRef?.current
      if (fallback && isFocusable(fallback)) fallback.focus()
    }
  }, [active, containerRef, initialFocusRef])
}

/** Test seam: live lock depth, so a proof can assert the nested case. */
export function __overlayLockDepthForTests(): number {
  return lockCount
}

/** Test seam: live stack depth. */
export function __overlayStackDepthForTests(): number {
  return overlayStack.length
}
