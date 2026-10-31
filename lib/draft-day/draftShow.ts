/**
 * Draft-day kit (docs/AF_COMMISSIONER_SETTINGS_SPEC.md §3, idea 9) — the draft order reveal and the
 * lottery show, as one synced "show".
 *
 * Before this, randomizing the order flashed a toast, and the lottery reveal (`LotteryReveal`) played
 * only on the commissioner's own screen after they pressed Run. The managers — the audience — saw a
 * finished list.
 *
 * ⚠ THE SHOW IS A TIMELINE, NOT A STREAM. The commissioner starts it and the server stores one start
 * time and the reveal sequence; every client works out "how many cards are face-up" from the clock.
 * So a manager who joins halfway sees exactly what everyone else sees, a refresh does not restart it,
 * and nothing has to be pushed per card. `progress` takes the server's `now` (sent with the state) so
 * a phone with a wrong clock still stays in step.
 *
 * ⚠ THE SHOW NEVER DECIDES THE ORDER. It reveals `DraftSession.slotOrder` as already saved — by the
 * randomizer, the lottery or the commissioner. If the order changes after the show starts, the show is
 * stale and is not shown (`isShowCurrent`), rather than revealing an order the draft will not use.
 */

export type ShowKind = 'order' | 'lottery'
export type ShowPace = 'quick' | 'standard' | 'dramatic'

export const DRAFT_SHOW_KEY = 'draft_day_show'
export const PACE_MS: Record<ShowPace, number> = { quick: 2000, standard: 4000, dramatic: 7000 }
/** Countdown before the first card. */
export const INTRO_MS = 5000
/** How long the finished order stays up before the show closes itself. */
export const HOLD_MS = 45_000

export type ShowEntry = {
  slot: number
  rosterId: string
  displayName: string
  /** Lottery only: pre-draw odds at the #1 pick, 0–100. */
  oddsPct: number | null
  /** Lottery only, drawn teams only: its rank by pre-draw odds (best odds = 1). */
  preLotterySlot: number | null
}

export type DraftShow = {
  v: 1
  sessionId: string
  kind: ShowKind
  pace: ShowPace
  startedAt: string
  startedBy: string
  /** Reveal sequence: last pick first, #1 last. */
  entries: ShowEntry[]
}

export type SlotRow = { slot: number; rosterId: string; displayName?: string | null }

export type LotteryShowSource = {
  slotOrder: SlotRow[]
  lotteryDraws: Array<{ pickSlot: number; rosterId: string }>
  oddsSnapshot: Array<{ rosterId: string; oddsPercent: number }>
}

/** A saved order is showable when it is a full 1..n with every slot filled. */
export function isCompleteOrder(order: readonly SlotRow[], teamCount: number): boolean {
  if (order.length !== teamCount || teamCount < 2) return false
  const slots = new Set(order.map((o) => o.slot))
  const rosters = new Set(order.map((o) => o.rosterId).filter(Boolean))
  return slots.size === teamCount && rosters.size === teamCount && [...slots].every((s) => s >= 1 && s <= teamCount)
}

const sameOrder = (a: readonly SlotRow[], b: readonly SlotRow[]) => {
  if (a.length !== b.length) return false
  const byA = new Map(a.map((x) => [x.slot, x.rosterId]))
  return b.every((x) => byA.get(x.slot) === x.rosterId)
}

export type BuildShowResult = { ok: true; show: DraftShow } | { ok: false; reason: 'order_incomplete' | 'no_lottery' | 'lottery_stale' }

export function buildShow(args: {
  sessionId: string
  kind: ShowKind
  pace: ShowPace
  order: readonly SlotRow[]
  teamCount: number
  lottery?: LotteryShowSource | null
  startedBy: string
  now: Date
}): BuildShowResult {
  if (!isCompleteOrder(args.order, args.teamCount)) return { ok: false, reason: 'order_incomplete' }
  let odds = new Map<string, number>()
  let preSlot = new Map<string, number>()
  if (args.kind === 'lottery') {
    const l = args.lottery
    if (!l || l.lotteryDraws.length === 0) return { ok: false, reason: 'no_lottery' }
    // The draw being shown must be the order the draft will use.
    if (!sameOrder(l.slotOrder, args.order)) return { ok: false, reason: 'lottery_stale' }
    odds = new Map(l.oddsSnapshot.map((o) => [o.rosterId, o.oddsPercent]))
    // "Where it would have picked" = its rank by pre-draw odds (best odds = 1). Read from the odds the
    // draw used rather than the engine's pool index, whose ordering is not part of its contract.
    const byOdds = [...l.oddsSnapshot].sort((a, b) => b.oddsPercent - a.oddsPercent)
    const rankByOdds = new Map(byOdds.map((o, i) => [o.rosterId, i + 1]))
    preSlot = new Map(l.lotteryDraws.flatMap((d) => (rankByOdds.has(d.rosterId) ? [[d.rosterId, rankByOdds.get(d.rosterId)!] as const] : [])))
  }
  const entries = [...args.order]
    .sort((a, b) => b.slot - a.slot)
    .map((o) => ({
      slot: o.slot,
      rosterId: o.rosterId,
      displayName: String(o.displayName ?? '').trim() || `Team ${o.slot}`,
      oddsPct: args.kind === 'lottery' ? odds.get(o.rosterId) ?? null : null,
      preLotterySlot: args.kind === 'lottery' ? preSlot.get(o.rosterId) ?? null : null,
    }))
  return { ok: true, show: { v: 1, sessionId: args.sessionId, kind: args.kind, pace: args.pace, startedAt: args.now.toISOString(), startedBy: args.startedBy, entries } }
}

export function readShow(settings: unknown): DraftShow | null {
  const s = settings && typeof settings === 'object' ? (settings as Record<string, unknown>)[DRAFT_SHOW_KEY] : null
  if (!s || typeof s !== 'object') return null
  const x = s as Partial<DraftShow>
  if (x.v !== 1 || typeof x.sessionId !== 'string' || typeof x.startedAt !== 'string' || !Array.isArray(x.entries)) return null
  if (x.kind !== 'order' && x.kind !== 'lottery') return null
  return { ...(x as DraftShow), pace: x.pace && x.pace in PACE_MS ? x.pace : 'standard' }
}

/** The show reveals the order the draft will actually use, for the draft that is about to run. */
export function isShowCurrent(show: DraftShow, session: { id: string; slotOrder: readonly SlotRow[] }): boolean {
  return show.sessionId === session.id && sameOrder(show.entries, session.slotOrder)
}

export type ShowProgress = {
  /** Before the first card: ms left in the countdown. */
  introLeftMs: number
  /** Cards face-up, in reveal order (last pick first). */
  revealed: number
  /** Every card is up. */
  complete: boolean
  /** Past the hold: the show has closed itself. */
  over: boolean
  /** ms until the next card turns (null once complete). */
  nextInMs: number | null
}

export function progress(show: DraftShow, now: number): ShowProgress {
  const step = PACE_MS[show.pace]
  const n = show.entries.length
  const elapsed = now - Date.parse(show.startedAt)
  if (!Number.isFinite(elapsed)) return { introLeftMs: 0, revealed: n, complete: true, over: true, nextInMs: null }
  if (elapsed < INTRO_MS) return { introLeftMs: INTRO_MS - elapsed, revealed: 0, complete: false, over: false, nextInMs: INTRO_MS - elapsed }
  const inShow = elapsed - INTRO_MS
  const revealed = Math.min(n, Math.floor(inShow / step) + 1)
  const complete = revealed >= n
  const endAt = (n - 1) * step
  return {
    introLeftMs: 0,
    revealed,
    complete,
    over: complete && inShow - endAt >= HOLD_MS,
    nextInMs: complete ? null : step - (inShow % step),
  }
}

/** Plain-words line for one card, used by the show and the chat post. */
export function describeEntry(e: ShowEntry, kind: ShowKind): string {
  if (kind !== 'lottery' || e.preLotterySlot == null || e.preLotterySlot === e.slot) return `Pick ${e.slot}: ${e.displayName}`
  const moved = e.preLotterySlot - e.slot
  return `Pick ${e.slot}: ${e.displayName} (${moved > 0 ? `jumped ${moved}` : `fell ${-moved}`} from odds rank ${e.preLotterySlot})`
}
