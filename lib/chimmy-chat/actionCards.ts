/**
 * Chimmy action cards on the CLIENT: the parser that reads them off an answer's `meta`, and a tiny
 * in-page store that lets any surface render them without the chat shell having to know about them.
 *
 * Client-safe: no server imports. The card shape comes from `lib/chimmy/actions/types` (also pure).
 *
 * ⚠ A CARD IS DISPLAY DATA PLUS ONE OPAQUE TOKEN. Nothing here decides what executes — the confirm
 * route re-derives everything from the signed token — so a malformed or edited card can at worst
 * render oddly; it cannot change a move. The parser still drops anything that is not a card, so a
 * bad payload renders nothing rather than a half-card with a live Confirm button.
 */

import type { ActionCardPlayer, ChimmyActionCard, ChimmyActionConfirmResult } from '@/lib/chimmy/actions/types'

export type { ChimmyActionCard, ChimmyActionConfirmResult } from '@/lib/chimmy/actions/types'

const MAX_CARDS = 3

function str(v: unknown, max = 200): string | null {
  return typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : null
}

function player(v: unknown): ActionCardPlayer | null {
  if (!v || typeof v !== 'object') return null
  const o = v as Record<string, unknown>
  const name = str(o.name, 80)
  if (!name) return null
  return { name, position: str(o.position, 8), team: str(o.team, 8) }
}

function players(v: unknown): ActionCardPlayer[] {
  return Array.isArray(v) ? v.map(player).filter((p): p is ActionCardPlayer => p !== null).slice(0, 10) : []
}

export function readActionCard(v: unknown): ChimmyActionCard | null {
  if (!v || typeof v !== 'object') return null
  const o = v as Record<string, unknown>
  const kind = o.kind === 'lineup' || o.kind === 'trade' ? o.kind : null
  const actionId = str(o.actionId, 80)
  const token = typeof o.token === 'string' && o.token.length > 10 && o.token.length < 16_000 ? o.token : null
  const title = str(o.title, 120)
  const league = o.league && typeof o.league === 'object' ? (o.league as Record<string, unknown>) : null
  const expiresAt = str(o.expiresAt, 40)
  if (!kind || !actionId || !token || !title || !league || !str(league.id) || !expiresAt) return null
  const week = typeof o.week === 'number' ? o.week : 0
  const season = typeof o.season === 'number' ? o.season : 0
  const warnings = Array.isArray(o.warnings) ? o.warnings.map((w) => str(w, 240)).filter((w): w is string => Boolean(w)).slice(0, 8) : []
  const base: ChimmyActionCard = {
    actionId,
    kind,
    token,
    title,
    league: { id: str(league.id)!, name: str(league.name, 120), sport: str(league.sport, 12) ?? '' },
    week,
    season,
    expiresAt,
    warnings,
  }
  if (kind === 'lineup') {
    const l = o.lineup && typeof o.lineup === 'object' ? (o.lineup as Record<string, unknown>) : null
    if (!l) return null
    const moveIn = Array.isArray(l.moveIn)
      ? l.moveIn
          .map((m) => {
            const p = player(m)
            return p ? { ...p, slot: str((m as Record<string, unknown>).slot, 12) } : null
          })
          .filter((m): m is ActionCardPlayer & { slot: string | null } => m !== null)
      : []
    const moveOut = players(l.moveOut)
    if (moveIn.length === 0 && moveOut.length === 0) return null
    return { ...base, lineup: { moveIn, moveOut } }
  }
  const t = o.trade && typeof o.trade === 'object' ? (o.trade as Record<string, unknown>) : null
  if (!t) return null
  const youGive = players(t.youGive)
  const youGet = players(t.youGet)
  if (youGive.length === 0 || youGet.length === 0) return null
  return {
    ...base,
    trade: { partnerTeamName: str(t.partnerTeamName, 80) ?? 'their team', youGive, youGet, reviewNote: str(t.reviewNote, 200) },
  }
}

/** Cards on an answer's meta, validated. Empty when there are none. */
export function readActionCards(meta: unknown): ChimmyActionCard[] {
  if (!meta || typeof meta !== 'object') return []
  const raw = (meta as Record<string, unknown>).actionCards
  if (!Array.isArray(raw)) return []
  return raw.map(readActionCard).filter((c): c is ChimmyActionCard => c !== null).slice(0, MAX_CARDS)
}

/* ── In-page store ─────────────────────────────────────────────────────────────────────────────── */

type Listener = (cards: ChimmyActionCard[]) => void
const listeners = new Set<Listener>()
let current: ChimmyActionCard[] = []

/** Newest first; a card already shown is not added twice. */
export function publishChimmyActionCards(cards: ChimmyActionCard[]): void {
  if (cards.length === 0) return
  const known = new Set(current.map((c) => c.actionId))
  current = [...cards.filter((c) => !known.has(c.actionId)), ...current].slice(0, 6)
  for (const l of listeners) l(current)
}

export function dismissChimmyActionCard(actionId: string): void {
  current = current.filter((c) => c.actionId !== actionId)
  for (const l of listeners) l(current)
}

export function subscribeChimmyActionCards(listener: Listener): () => void {
  listeners.add(listener)
  listener(current)
  return () => {
    listeners.delete(listener)
  }
}

/** Test seam. */
export function resetChimmyActionCardsForTest(): void {
  current = []
  listeners.clear()
}

/** POST the card's token. The ONLY request a Confirm tap makes. */
export async function confirmChimmyActionCard(
  card: Pick<ChimmyActionCard, 'token'>,
  fetchImpl: typeof fetch = fetch,
): Promise<ChimmyActionConfirmResult> {
  try {
    const res = await fetchImpl('/api/chimmy/actions/confirm', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ token: card.token }),
    })
    const data = (await res.json().catch(() => null)) as ChimmyActionConfirmResult | null
    if (data && typeof data.message === 'string' && typeof data.status === 'string') return data
    /*
     * ⚠ NOT "NOTHING WAS CHANGED". A lost response is not a refused one — the server may have made
     * the move before the connection dropped. Tapping again is safe (the action id is claimed once),
     * and the retry reports the recorded outcome.
     */
    return { ok: false, status: 'refused', retryable: true, message: 'No answer from AllFantasy. Tap Confirm again to check — it will never run twice.' }
  } catch {
    return { ok: false, status: 'refused', retryable: true, message: "Couldn't reach AllFantasy. Tap Confirm again to check — it will never run twice." }
  }
}
