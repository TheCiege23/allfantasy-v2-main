import type { SlotOrderEntry } from '@/lib/live-draft-engine/types'

/**
 * The managers who pick before your next turn, in the LIVE draft — the pure half of
 * ./liveDraftManagers.ts. (2026-11-14: the owner, mid-draft in a 16-team tournament, wanted to know
 * what the managers ahead were doing; Draft HQ's Competitive Edge only showed it before the draft.)
 *
 * 🛑 THE COMPETITIVE EDGE CONTRACT (./draftEdge.ts, ./tradeEdge.ts) HOLDS HERE TOO:
 *   - FACTS, NEVER LABELS: "has taken RB, RB, WR — no QB yet", never "RB-heavy" or "panicking".
 *   - NO PREDICTIONS: nothing says what anyone will take next. The facts sit beside the engine's
 *     pick; the reader draws the conclusion.
 * What a manager has taken in THIS draft is on the public board already, so it is shown to everyone.
 * Their history in the league's PAST drafts is Competitive Edge, shown only to a plan that has it.
 */

/** The positions a "no X yet" line names: the ones every lineup starts. */
const CORE_POSITIONS = ['QB', 'RB', 'WR', 'TE'] as const

/** The draft's slot order, as stored on DraftSession.slotOrder. Malformed entries are dropped. */
export function parseSlotOrder(value: unknown): SlotOrderEntry[] {
  if (!Array.isArray(value)) return []
  const out: SlotOrderEntry[] = []
  for (const raw of value) {
    if (!raw || typeof raw !== 'object') continue
    const { slot, rosterId, displayName, platformUserId } = raw as Record<string, unknown>
    if (typeof slot !== 'number' || typeof rosterId !== 'string') continue
    out.push({
      slot,
      rosterId,
      displayName: typeof displayName === 'string' ? displayName : rosterId,
      ...(typeof platformUserId === 'string' && platformUserId.trim() ? { platformUserId: platformUserId.trim() } : {}),
    })
  }
  return out
}

export type UpcomingOwner = { slot: number; rosterId: string; displayName: string }

/**
 * The managers on the clock before the viewer's slot comes up again, in pick order, each once.
 * `upcoming` is DraftOrderService's own order (getUpcomingPickOwners) — never re-derived here.
 * Empty when the viewer is on the clock now.
 */
export function managersBeforeNextPick(upcoming: readonly UpcomingOwner[], viewerSlot: number): UpcomingOwner[] {
  const out: UpcomingOwner[] = []
  const seen = new Set<number>()
  for (const o of upcoming) {
    if (o.slot === viewerSlot) break
    if (seen.has(o.slot)) continue
    seen.add(o.slot)
    out.push(o)
  }
  return out
}

/** What a manager has taken so far in this draft, in pick order. A fact, never a read on them. */
export function thisDraftFact(positions: readonly string[]): string {
  const taken = positions.map((p) => String(p ?? '').trim().toUpperCase()).filter(Boolean)
  if (taken.length === 0) return "Hasn't picked yet in this draft."
  const missing = CORE_POSITIONS.filter((p) => !taken.includes(p))
  const list = taken.join(', ')
  const count = `${taken.length} ${taken.length === 1 ? 'pick' : 'picks'}`
  return missing.length > 0
    ? `This draft: ${list} (${count}) — no ${missing.join(' or ')} yet.`
    : `This draft: ${list} (${count}).`
}

/**
 * The history lines shown for one manager, from draftEdge's facts: the pattern lines when there are
 * enough drafts, otherwise only the record line (which says how many drafts are on file).
 */
export function historyLines(history: { facts: Array<{ key: string; text: string }>; sufficient: boolean }): string[] {
  if (!history.sufficient) {
    const record = history.facts.find((f) => f.key === 'draft.record')
    return record ? [`${record.text} Not enough drafts to show a pattern.`] : []
  }
  return history.facts.filter((f) => f.key !== 'draft.record').slice(0, 3).map((f) => f.text)
}
