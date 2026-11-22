import { getAuctionMaxBid } from '@/lib/mock-draft/draft-engine'

/**
 * Real bidding for the mock auction draft. Pure: every function takes the state and a context and
 * returns a new state, so the room component only owns timing (a short interval) and the picks list.
 *
 * How a lot runs:
 *   1. The team whose turn it is nominates a player and opens at the minimum bid (it leads).
 *   2. Each AI team decided, when the lot opened, the most it will pay for that player
 *      (`aiCeiling`). AI teams take turns raising, one bid at a time, until nobody will go higher.
 *   3. Every bid resets the bid clock. When it runs out the leader wins and pays their bid.
 *
 * The user bids with the same rule the live server uses: never more than `getAuctionMaxBid`, which
 * keeps the minimum bid in reserve for every open roster spot after this one.
 */

export type MockAuctionLot = {
  playerId: string
  nominatorSlot: number
  bid: number
  leaderSlot: number
  /** When the bid clock runs out and the leader wins. */
  endsAtMs: number
  /** When the next AI bid is tried; null once no AI team will go higher. */
  nextAiBidAtMs: number | null
  /** The most each AI team will pay for this player, fixed when the lot opened. */
  ceilings: Record<number, number>
  history: { slot: number; amount: number }[]
}

export type MockAuctionSale = { playerId: string; winnerSlot: number; price: number; nominatorSlot: number }

export type MockAuctionState = {
  budgetPerTeam: number
  minBid: number
  rosterSize: number
  /** Budget left per team slot. */
  budgets: Record<number, number>
  /** Index into the nomination order of the team nominating now (or that nominated the live lot). */
  nominationIndex: number
  /** The user's nomination clock; null when untimed or when it is not the user's turn. */
  nominationDeadlineMs: number | null
  /** When the AI team on turn nominates; null when it is the user's turn. */
  nextAiNominationAtMs: number | null
  lot: MockAuctionLot | null
  lastSale: MockAuctionSale | null
}

export type MockAuctionTiming = {
  /** Bid clock: every bid resets the lot to end this long after it. */
  bidWindowMs: number
  /** Range for the pause before an AI team raises, so bids are readable rather than instant. */
  aiBidDelayMs: [number, number]
  aiNominateDelayMs: number
  /** The user's nomination clock; null means wait for the user. */
  userNominateMs: number | null
  /** With no AI interest and a user who cannot (or need not) bid, close the lot this soon. */
  quietCloseMs: number
}

export type MockAuctionContext = {
  now: number
  rand: () => number
  userSlot: number
  /** Team slots in nomination order. */
  order: number[]
  /** Open roster spots per slot. */
  spotsLeft: Record<number, number>
  /** Positions each team still needs. */
  needs: Record<number, string[]>
  /** Auction dollar value per player id (`auctionValues`). */
  values: Record<string, number>
  /** Players still available, best first. */
  available: { id: string; position: string }[]
  /** What the user's clock nominates if it runs out: the top of their queue, else best available. */
  autoNominateId: string | null
  timing: MockAuctionTiming
}

/** Bid clock and pacing for a mock speed setting (seconds per pick; 0 = auto). */
export function mockAuctionTiming(speed: number): MockAuctionTiming {
  if (speed === 0) {
    return { bidWindowMs: 5000, aiBidDelayMs: [250, 550], aiNominateDelayMs: 400, userNominateMs: null, quietCloseMs: 600 }
  }
  const bidWindowSec = speed >= 30 ? 12 : speed >= 15 ? 8 : 5
  const fast = speed <= 5
  return {
    bidWindowMs: bidWindowSec * 1000,
    aiBidDelayMs: fast ? [300, 650] : [500, 1100],
    aiNominateDelayMs: fast ? 600 : 1200,
    userNominateMs: speed * 1000,
    quietCloseMs: fast ? 700 : 1200,
  }
}

/**
 * Dollar values from draft rank. The league's whole budget is spent across every roster spot:
 * each spot costs at least the minimum bid and the money above that is shared out on a steep
 * curve (rank weight `(N - r)^4`), so the top player costs about a quarter of one team's budget
 * and the last starters go for a dollar or two.
 */
export function auctionValues(
  players: { id: string; adp: number | null; projectedPts: number }[],
  input: { teamCount: number; rosterSize: number; budgetPerTeam: number; minBid?: number },
): Record<string, number> {
  const minBid = input.minBid ?? 1
  const ranked = [...players].sort((a, b) => {
    const aAdp = a.adp ?? Number.POSITIVE_INFINITY
    const bAdp = b.adp ?? Number.POSITIVE_INFINITY
    if (aAdp !== bAdp) return aAdp - bAdp
    return b.projectedPts - a.projectedPts
  })
  const draftable = Math.max(1, input.teamCount * input.rosterSize)
  const surplus = Math.max(0, input.teamCount * input.budgetPerTeam - draftable * minBid)
  let weightSum = 0
  for (let r = 0; r < Math.min(draftable, ranked.length); r += 1) weightSum += (draftable - r) ** 4
  const values: Record<string, number> = {}
  ranked.forEach((player, r) => {
    const weight = r < draftable && weightSum > 0 ? (draftable - r) ** 4 / weightSum : 0
    values[player.id] = Math.max(minBid, Math.round(minBid + surplus * weight))
  })
  return values
}

export function createMockAuction(input: {
  teamSlots: number[]
  order: number[]
  budgetPerTeam: number
  rosterSize: number
  minBid?: number
  userSlot: number
  now: number
  timing: MockAuctionTiming
}): MockAuctionState {
  const budgets: Record<number, number> = {}
  for (const slot of input.teamSlots) budgets[slot] = input.budgetPerTeam
  const userFirst = input.order[0] === input.userSlot
  return {
    budgetPerTeam: input.budgetPerTeam,
    minBid: input.minBid ?? 1,
    rosterSize: input.rosterSize,
    budgets,
    nominationIndex: 0,
    nominationDeadlineMs: userFirst && input.timing.userNominateMs != null ? input.now + input.timing.userNominateMs : null,
    nextAiNominationAtMs: userFirst ? null : input.now + input.timing.aiNominateDelayMs,
    lot: null,
    lastSale: null,
  }
}

/** The most a team may bid now (the server's rule); 0 for a full roster. */
export function mockMaxBid(state: MockAuctionState, slot: number, spotsLeft: number): number {
  if (spotsLeft <= 0) return 0
  return getAuctionMaxBid({ budget: state.budgets[slot] ?? 0, rosterSlotsRemaining: spotsLeft, minimumBid: state.minBid })
}

/**
 * The index (into `order`) of the next team with an open spot, starting at `from`. Null when every
 * roster is full.
 */
export function nextNominatorIndex(order: number[], from: number, spotsLeft: Record<number, number>): number | null {
  const n = order.length
  for (let step = 0; step < n; step += 1) {
    const index = (((from + step) % n) + n) % n
    if ((spotsLeft[order[index]!] ?? 0) > 0) return index
  }
  return null
}

/**
 * The most an AI team will pay: the player's value, raised for a position it needs and lowered for
 * one it does not, scaled by how much cash it has per open spot compared with an even split, with a
 * little noise so teams disagree. Never above the team's max bid.
 */
export function aiCeiling(input: {
  value: number
  needsPosition: boolean
  budget: number
  spotsLeft: number
  budgetPerTeam: number
  rosterSize: number
  minBid: number
  rand: () => number
}): number {
  if (input.spotsLeft <= 0) return 0
  const maxBid = getAuctionMaxBid({ budget: input.budget, rosterSlotsRemaining: input.spotsLeft, minimumBid: input.minBid })
  const evenSplit = input.budgetPerTeam / Math.max(1, input.rosterSize)
  const pressure = Math.min(1.35, Math.max(0.75, input.budget / input.spotsLeft / evenSplit))
  const needFactor = input.needsPosition ? 1.05 : 0.85
  const noise = 0.88 + input.rand() * 0.2
  return Math.max(0, Math.min(maxBid, Math.floor(input.value * needFactor * pressure * noise)))
}

/** The next AI raise for a lot, or null when no AI team will go higher. */
export function pickAiBid(lot: MockAuctionLot, ctx: Pick<MockAuctionContext, 'rand' | 'spotsLeft' | 'userSlot'>): { slot: number; amount: number } | null {
  const minNext = lot.bid + 1
  const candidates = Object.entries(lot.ceilings)
    .map(([slot, ceiling]) => ({ slot: Number(slot), ceiling }))
    .filter((c) => c.slot !== lot.leaderSlot && c.slot !== ctx.userSlot && c.ceiling >= minNext && (ctx.spotsLeft[c.slot] ?? 0) > 0)
  if (candidates.length === 0) return null
  const total = candidates.reduce((sum, c) => sum + (c.ceiling - lot.bid), 0)
  let roll = ctx.rand() * total
  let chosen = candidates[candidates.length - 1]!
  for (const c of candidates) {
    roll -= c.ceiling - lot.bid
    if (roll <= 0) { chosen = c; break }
  }
  // Big gaps close in a few jumps rather than dozens of $1 raises.
  const gap = chosen.ceiling - minNext
  const jump = gap > 3 ? Math.floor(gap * ctx.rand() * 0.6) : 0
  return { slot: chosen.slot, amount: minNext + jump }
}

function aiDelay(ctx: MockAuctionContext): number {
  const [lo, hi] = ctx.timing.aiBidDelayMs
  return lo + Math.round((hi - lo) * ctx.rand())
}

/** Whether the user could still raise this lot. */
function userCanRaise(state: MockAuctionState, lot: MockAuctionLot, ctx: MockAuctionContext): boolean {
  if (lot.leaderSlot === ctx.userSlot) return false
  return mockMaxBid(state, ctx.userSlot, ctx.spotsLeft[ctx.userSlot] ?? 0) >= lot.bid + 1
}

/** Puts a player on the block for `slot`, opening at the minimum bid with the nominator leading. */
export function openLot(state: MockAuctionState, ctx: MockAuctionContext, playerId: string, slot: number): MockAuctionState {
  if (state.lot) return state
  const player = ctx.available.find((p) => p.id === playerId)
  if (!player) return state
  const value = ctx.values[playerId] ?? state.minBid
  const ceilings: Record<number, number> = {}
  for (const teamSlot of ctx.order) {
    if (teamSlot === ctx.userSlot) continue
    ceilings[teamSlot] = aiCeiling({
      value,
      needsPosition: (ctx.needs[teamSlot] ?? []).includes(player.position),
      budget: state.budgets[teamSlot] ?? 0,
      spotsLeft: ctx.spotsLeft[teamSlot] ?? 0,
      budgetPerTeam: state.budgetPerTeam,
      rosterSize: state.rosterSize,
      minBid: state.minBid,
      rand: ctx.rand,
    })
  }
  return {
    ...state,
    nominationDeadlineMs: null,
    nextAiNominationAtMs: null,
    lot: {
      playerId,
      nominatorSlot: slot,
      bid: state.minBid,
      leaderSlot: slot,
      endsAtMs: ctx.now + ctx.timing.bidWindowMs,
      nextAiBidAtMs: ctx.now + aiDelay(ctx),
      ceilings,
      history: [{ slot, amount: state.minBid }],
    },
  }
}

export type MockBidResult = { ok: true; state: MockAuctionState } | { ok: false; reason: 'no-lot' | 'too-low' | 'over-max' | 'leading' }

/** The user's bid. Same limits as the live server: above the current bid, within their max bid. */
export function placeUserBid(state: MockAuctionState, ctx: MockAuctionContext, amount: number): MockBidResult {
  const lot = state.lot
  if (!lot) return { ok: false, reason: 'no-lot' }
  if (lot.leaderSlot === ctx.userSlot) return { ok: false, reason: 'leading' }
  const bid = Math.floor(amount)
  if (bid < lot.bid + 1) return { ok: false, reason: 'too-low' }
  if (bid > mockMaxBid(state, ctx.userSlot, ctx.spotsLeft[ctx.userSlot] ?? 0)) return { ok: false, reason: 'over-max' }
  return {
    ok: true,
    state: {
      ...state,
      lot: {
        ...lot,
        bid,
        leaderSlot: ctx.userSlot,
        endsAtMs: ctx.now + ctx.timing.bidWindowMs,
        nextAiBidAtMs: ctx.now + aiDelay(ctx),
        history: [...lot.history, { slot: ctx.userSlot, amount: bid }],
      },
    },
  }
}

/**
 * Ends the lot now: the leader wins at their bid. The nomination turn passes to the next team with
 * an open spot (counting the winner's new player), and that team's clock starts.
 */
export function sellLot(state: MockAuctionState, ctx: MockAuctionContext): { state: MockAuctionState; sale: MockAuctionSale | null } {
  const lot = state.lot
  if (!lot) return { state, sale: null }
  const sale: MockAuctionSale = { playerId: lot.playerId, winnerSlot: lot.leaderSlot, price: lot.bid, nominatorSlot: lot.nominatorSlot }
  const spotsAfter = { ...ctx.spotsLeft, [lot.leaderSlot]: Math.max(0, (ctx.spotsLeft[lot.leaderSlot] ?? 0) - 1) }
  const nextIndex = nextNominatorIndex(ctx.order, state.nominationIndex + 1, spotsAfter)
  const nextSlot = nextIndex == null ? null : ctx.order[nextIndex]!
  const userNext = nextSlot === ctx.userSlot
  return {
    sale,
    state: {
      ...state,
      budgets: { ...state.budgets, [lot.leaderSlot]: (state.budgets[lot.leaderSlot] ?? 0) - lot.bid },
      nominationIndex: nextIndex ?? state.nominationIndex,
      nominationDeadlineMs: userNext && ctx.timing.userNominateMs != null ? ctx.now + ctx.timing.userNominateMs : null,
      nextAiNominationAtMs: nextSlot != null && !userNext ? ctx.now + ctx.timing.aiNominateDelayMs : null,
      lot: null,
      lastSale: sale,
    },
  }
}

/** The AI nominator's choice: usually the best player left, sometimes one of the next few. */
export function pickAiNomination(ctx: Pick<MockAuctionContext, 'available' | 'rand'>): string | null {
  const top = ctx.available.slice(0, 4)
  if (top.length === 0) return null
  const roll = ctx.rand()
  const index = roll < 0.55 ? 0 : roll < 0.8 ? 1 : roll < 0.93 ? 2 : 3
  return top[Math.min(index, top.length - 1)]!.id
}

export type MockAuctionTick = {
  state: MockAuctionState
  sale: MockAuctionSale | null
  /** True once no team has an open spot or no player is left. */
  complete: boolean
}

/**
 * Advances the auction by at most one event: a sale, an AI raise, or a nomination. Call it on a
 * short interval; with nothing due it returns the same state object.
 */
export function tickMockAuction(state: MockAuctionState, ctx: MockAuctionContext): MockAuctionTick {
  const lot = state.lot
  if (lot) {
    if (ctx.now >= lot.endsAtMs) {
      const sold = sellLot(state, ctx)
      return { state: sold.state, sale: sold.sale, complete: false }
    }
    if (lot.nextAiBidAtMs != null && ctx.now >= lot.nextAiBidAtMs) {
      const raise = pickAiBid(lot, ctx)
      if (raise) {
        return {
          sale: null,
          complete: false,
          state: {
            ...state,
            lot: {
              ...lot,
              bid: raise.amount,
              leaderSlot: raise.slot,
              endsAtMs: ctx.now + ctx.timing.bidWindowMs,
              nextAiBidAtMs: ctx.now + aiDelay(ctx),
              history: [...lot.history, { slot: raise.slot, amount: raise.amount }],
            },
          },
        }
      }
      // Nobody else will go higher. Close soon unless the user can still answer.
      const endsAtMs = userCanRaise(state, lot, ctx) ? lot.endsAtMs : Math.min(lot.endsAtMs, ctx.now + ctx.timing.quietCloseMs)
      return { sale: null, complete: false, state: { ...state, lot: { ...lot, nextAiBidAtMs: null, endsAtMs } } }
    }
    return { state, sale: null, complete: false }
  }

  const index = nextNominatorIndex(ctx.order, state.nominationIndex, ctx.spotsLeft)
  if (index == null || ctx.available.length === 0) return { state, sale: null, complete: true }
  const slot = ctx.order[index]!
  const aligned = index === state.nominationIndex ? state : { ...state, nominationIndex: index }

  if (slot === ctx.userSlot) {
    if (aligned.nominationDeadlineMs != null && ctx.now >= aligned.nominationDeadlineMs) {
      const pick = ctx.autoNominateId ?? ctx.available[0]?.id ?? null
      return { state: pick ? openLot(aligned, ctx, pick, slot) : aligned, sale: null, complete: false }
    }
    return { state: aligned, sale: null, complete: false }
  }

  if (aligned.nextAiNominationAtMs == null) {
    return { state: { ...aligned, nextAiNominationAtMs: ctx.now + ctx.timing.aiNominateDelayMs }, sale: null, complete: false }
  }
  if (ctx.now < aligned.nextAiNominationAtMs) return { state: aligned, sale: null, complete: false }
  const pick = pickAiNomination(ctx)
  return { state: pick ? openLot(aligned, ctx, pick, slot) : aligned, sale: null, complete: false }
}

/** The user nominates on their turn. Ignored when it is not their turn or a player is on the block. */
export function nominateForUser(state: MockAuctionState, ctx: MockAuctionContext, playerId: string): MockAuctionState {
  if (state.lot) return state
  const index = nextNominatorIndex(ctx.order, state.nominationIndex, ctx.spotsLeft)
  if (index == null || ctx.order[index] !== ctx.userSlot) return state
  return openLot({ ...state, nominationIndex: index }, ctx, playerId, ctx.userSlot)
}

/**
 * Resumes after a pause: every clock moves forward by the time spent paused, and a live lot gets at
 * least half a bid window so the user is not dropped into a lot that is about to close.
 */
export function resumeMockAuction(state: MockAuctionState, input: { pausedForMs: number; now: number; timing: MockAuctionTiming }): MockAuctionState {
  const shift = (ms: number | null) => (ms == null ? null : ms + Math.max(0, input.pausedForMs))
  const lot = state.lot
  return {
    ...state,
    nominationDeadlineMs: shift(state.nominationDeadlineMs),
    nextAiNominationAtMs: shift(state.nextAiNominationAtMs),
    lot: lot
      ? {
          ...lot,
          endsAtMs: Math.max(lot.endsAtMs + Math.max(0, input.pausedForMs), input.now + Math.round(input.timing.bidWindowMs / 2)),
          nextAiBidAtMs: shift(lot.nextAiBidAtMs),
        }
      : null,
  }
}
