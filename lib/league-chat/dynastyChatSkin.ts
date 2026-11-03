import { dynastySeasonClock as leagueSeasonClock, type DynastySeasonClockSource } from '@/lib/league-media/dynastySeasonClock'

/**
 * The dynasty league chat look (Dynasty Era, step 2): the pure parts — the season clock, the
 * pick-chip tone, and which chat messages are draft-order announcements.
 *
 * ⚠ ONLY WHAT A ROW ALREADY CARRIES. A trade card stores how many picks moved each way
 * (`picksGave` / `picksGot`), not which ones — the writers know the season and round at write
 * time and do not persist them. So a trade card's chips say "Pick" in the plain outline, never a
 * guessed round. The gold R1 outline is drawn only where a round is genuinely known: a draft
 * order's slots are, by definition, round 1.
 */

export type DynastySeasonClock = { year: number; season: number }

/**
 * "Year N · YYYY" for the chat header. Same rule as the league header — see
 * lib/league-media/dynastySeasonClock.ts, the one place the arithmetic lives. Chat draws nothing
 * rather than a bare season, so a clock without a year is null here.
 */
export function dynastySeasonClock(league: DynastySeasonClockSource): DynastySeasonClock | null {
  const clock = leagueSeasonClock(league)
  return clock && clock.year != null ? { year: clock.year, season: clock.season } : null
}

/** R1 gold, later rounds the line outline, unknown the line outline too (never a guessed R1). */
export type PickChipTone = 'first' | 'later' | 'unknown'

export function pickChipTone(round: number | null | undefined): PickChipTone {
  if (typeof round !== 'number' || !Number.isInteger(round) || round < 1) return 'unknown'
  return round === 1 ? 'first' : 'later'
}

/** "1.04" — round and slot, the slot zero-padded to two digits. */
export function pickSlotLabel(round: number, slot: number): string {
  return `${round}.${String(slot).padStart(2, '0')}`
}

export type DynastyDraftOrderNotice =
  /** The commissioner randomized the draft order (`/api/leagues/[id]/draft/randomize-order`). */
  | { kind: 'randomized'; order: string[] }
  /**
   * The live rookie order locked picks or went final (`lib/rookie-order/roundNoticeService.ts`).
   * Its stored `season` is the season the order was BUILT FROM, not the draft's, so the card does
   * not show it — the notice's own words name the draft.
   */
  | { kind: 'rookie'; final: boolean }

/**
 * A draft-order announcement in league chat, read from the server-written metadata only.
 *
 * ⚠ `contentType` ALONE IS NOT SERVER-OWNED. `sanitizeClientMessageMetadata` keeps a client's
 * `contentType` (it labels uploads), so a member could post `contentType: 'rookie_order_update'`
 * and wear the gold card. The rookie notice is therefore also required to be a
 * `host_announcement` row with `senderIsHost` — a type and a key no client can write. The
 * randomized notice's `category` / `isSystemMessage` are not client-writable at all.
 */
export function readDynastyDraftOrderNotice(metadata: unknown, messageType?: string | null): DynastyDraftOrderNotice | null {
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) return null
  const m = metadata as Record<string, unknown>
  if (m.contentType === 'rookie_order_update' && messageType === 'host_announcement' && m.senderIsHost === true) {
    return { kind: 'rookie', final: m.final === true }
  }
  if (m.category === 'Draft order' && m.isSystemMessage === true && Array.isArray(m.order)) {
    const order = (m.order as unknown[])
      .map((n) => (typeof n === 'string' ? n.trim() : ''))
      .slice(0, 32)
    if (order.length === 0 || order.every((n) => !n)) return null
    return { kind: 'randomized', order }
  }
  return null
}
