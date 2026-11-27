import type { PlayerCardRef } from './PlayerCardProvider'

/**
 * "Swipe between players" — the list the card moves through (2026-11-27).
 *
 * Losing the swipe between players was one of the specific complaints about Yahoo's late-2026
 * redesign. The card opens from ~34 surfaces, so rather than threading a list through every one of
 * them, the list is READ OFF THE PAGE: every openable name is a `PlayerName` button carrying its
 * ref in `data-af-pc-ref`, and the siblings of the one tapped are the other such buttons in the same
 * scope, in document (= on-screen) order.
 *
 * Scope, nearest first:
 *   1. `[data-af-pc-list]` — a surface that wants a tighter list marks its container;
 *   2. `<main>` — the screen (a roster, a waiver list, a matchup);
 *   3. the document body.
 *
 * Names INSIDE the card (comps, trade rows) are never siblings, and a card opened FROM inside the
 * card has no list: a comp is a side trip, not a step through the roster.
 *
 * ⚠ A SURFACE CAN RENDER THE SAME PLAYER TWICE (a desktop and a phone layout, a name in a row and
 * again in its expanded detail). Refs are de-duplicated by player key, first occurrence wins, and
 * where the page has real layout, a name the reader cannot see (display:none) is skipped.
 */

export const PC_REF_ATTR = 'data-af-pc-ref'
export const PC_PANEL_ATTR = 'data-af-pc-panel'
export const PC_LIST_ATTR = 'data-af-pc-list'

export type PlayerCardList = { refs: PlayerCardRef[]; index: number }

export function playerRefKey(r: Pick<PlayerCardRef, 'sport' | 'externalId' | 'sleeperId'>): string {
  return `${String(r.sport ?? '').toUpperCase()}|${r.externalId ?? ''}|${r.sleeperId ?? ''}`
}

export function encodePlayerRef(r: PlayerCardRef): string {
  return JSON.stringify({
    sport: r.sport,
    externalId: r.externalId ?? null,
    sleeperId: r.sleeperId ?? null,
    name: r.name,
    position: r.position ?? null,
    team: r.team ?? null,
    imageUrl: r.imageUrl ?? null,
    leagueId: r.leagueId ?? null,
  })
}

function decodePlayerRef(raw: string | null): PlayerCardRef | null {
  if (!raw) return null
  try {
    const o = JSON.parse(raw) as Partial<PlayerCardRef>
    if (typeof o.sport !== 'string' || typeof o.name !== 'string') return null
    if (!o.externalId && !o.sleeperId) return null
    return o as PlayerCardRef
  } catch {
    return null
  }
}

/** Whether the page has real layout (a browser), as opposed to a DOM without one (jsdom). */
function hasLayout(doc: Document): boolean {
  return doc.documentElement.getClientRects().length > 0
}

export function collectPlayerCardList(origin: Element | null | undefined, current: PlayerCardRef): PlayerCardList | null {
  if (!origin || typeof origin.closest !== 'function') return null
  if (origin.closest(`[${PC_PANEL_ATTR}]`)) return null
  const doc = origin.ownerDocument
  const scope = origin.closest(`[${PC_LIST_ATTR}]`) ?? origin.closest('main') ?? doc.body
  const layout = hasLayout(doc)

  const seen = new Set<string>()
  const refs: PlayerCardRef[] = []
  for (const el of Array.from(scope.querySelectorAll(`[${PC_REF_ATTR}]`))) {
    if (el.closest(`[${PC_PANEL_ATTR}]`)) continue
    if (layout && el !== origin && el.getClientRects().length === 0) continue
    const ref = decodePlayerRef(el.getAttribute(PC_REF_ATTR))
    if (!ref) continue
    const key = playerRefKey(ref)
    if (seen.has(key)) continue
    seen.add(key)
    refs.push(ref)
  }
  const index = refs.findIndex((r) => playerRefKey(r) === playerRefKey(current))
  if (index < 0 || refs.length < 2) return null
  return { refs, index }
}

/**
 * Whether a touch that starts on `target` belongs to something that scrolls sideways (the game log
 * table, a stat strip). A horizontal drag there is that element's scroll, never a swipe to the next
 * player.
 */
export function startsInHorizontalScroller(target: EventTarget | null, stopAt: Element | null): boolean {
  let el = target instanceof Element ? target : null
  while (el && el !== stopAt) {
    if (el instanceof HTMLElement && el.scrollWidth > el.clientWidth + 1) {
      const ox = el.ownerDocument.defaultView?.getComputedStyle(el).overflowX
      if (ox === 'auto' || ox === 'scroll') return true
    }
    el = el.parentElement
  }
  return false
}
