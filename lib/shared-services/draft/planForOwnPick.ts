/**
 * A PICK BEFORE THE DRAFT, AND A PICK FOR YOUR TURN (re-score build item 8, 2026-11-19) — PURE.
 *
 * The draft decision always ranked the pool at the pick on the clock (`DraftSession.nextOverallPick`). Before
 * the draft starts that is overall pick 1, so a manager drafting tenth was told to take the best player in the
 * draft — the one player certain to be gone by their turn. Mid-draft, off the clock, the card said "queue X"
 * for a player the next nine picks were likely to take.
 *
 * When the roster is not on the clock, the decision now plans for ITS next pick instead:
 *
 *   - the pick: the roster's next turn, from its slot in the session's slot order (the same snake/linear
 *     math the room uses, `picksUntilNextTurn`);
 *   - the pool: the players ADP says go in the picks before that turn are left out — exactly as many as there
 *     are picks, in market-ADP order. A market estimate, said as one; never a prediction about any manager.
 *
 * Players with no real ADP are never left out: nothing says when they go.
 */
import { picksUntilNextTurn } from '@/lib/draft-helper/draftContextSignals'

export type OwnPickPlan = {
  /** The overall pick the ranking is for — the roster's next turn. */
  overall: number
  round: number
  pickInRound: number
  /** Picks made before it, from the pick on the clock (or from pick 1 before the draft). */
  picksAway: number
  /** Players left out of the pool because ADP says they go in those picks. */
  leftOut: number
  /** The pick on the clock now; 1 before the draft. */
  fromOverall: number
}

type SlotEntry = { slot?: unknown; rosterId?: unknown }

/** The roster's draft slot: from the session's slot order, else from one of its own picks. Null when neither says. */
export function ownDraftSlot(args: {
  slotOrder: unknown
  ownIds: ReadonlySet<string>
  picks: ReadonlyArray<{ rosterId: string; slot?: number | null }>
}): number | null {
  if (Array.isArray(args.slotOrder)) {
    for (const e of args.slotOrder as SlotEntry[]) {
      if (e && typeof e.rosterId === 'string' && args.ownIds.has(e.rosterId) && Number.isInteger(e.slot) && (e.slot as number) >= 1) {
        return e.slot as number
      }
    }
  }
  const own = args.picks.find((p) => args.ownIds.has(p.rosterId) && Number.isInteger(p.slot) && (p.slot as number) >= 1)
  return own?.slot ?? null
}

/** The slot that picks at `overall`. */
export function slotAtOverall(overall: number, totalTeams: number, snake: boolean): number {
  const teams = Math.max(1, totalTeams)
  const round = Math.ceil(overall / teams)
  const inRound = ((overall - 1) % teams) + 1
  return snake && round % 2 === 0 ? teams - inRound + 1 : inRound
}

/**
 * The plan for the roster's next turn, or null when the decision should stay on the pick being made now: the
 * roster is on the clock, the draft is over or is an auction, its slot is unknown, or its next turn is past the
 * last pick.
 */
export function planOwnNextPick(args: {
  status: string | null
  draftType: string | null
  currentOverall: number
  ownSlot: number | null
  totalTeams: number
  rounds: number | null
}): Omit<OwnPickPlan, 'leftOut'> | null {
  const status = String(args.status ?? '')
  if (status !== 'pre_draft' && status !== 'in_progress' && status !== 'paused') return null
  if (String(args.draftType ?? 'snake') === 'auction') return null
  if (args.ownSlot == null) return null
  const teams = Math.max(1, args.totalTeams)
  if (args.ownSlot > teams) return null
  const snake = String(args.draftType ?? 'snake') !== 'linear'
  const from = status === 'pre_draft' ? 1 : Math.max(1, args.currentOverall)
  // On the clock now (or first up before the draft): the pick being made IS the roster's pick.
  if (status !== 'pre_draft' && slotAtOverall(from, teams, snake) === args.ownSlot) return null
  const picksAway = picksUntilNextTurn({ currentOverall: from, targetSlot: args.ownSlot, totalTeams: teams, snake })
  const overall = from + picksAway
  const totalPicks = args.rounds && args.rounds > 0 ? args.rounds * teams : null
  if (totalPicks != null && overall > totalPicks) return null
  return {
    overall,
    round: Math.ceil(overall / teams),
    pickInRound: ((overall - 1) % teams) + 1,
    picksAway,
    fromOverall: from,
  }
}

const realAdp = (adp: unknown): adp is number => typeof adp === 'number' && Number.isFinite(adp) && adp > 0

/**
 * The pool as it is likely to stand at the planned pick: the `picksAway` players with the lowest real ADP are
 * left out. Order is kept for everyone else.
 */
export function poolAtPlannedPick<P extends { adp?: number | null }>(available: readonly P[], picksAway: number): { pool: P[]; leftOut: number } {
  const n = Math.max(0, Math.floor(picksAway))
  if (n === 0) return { pool: [...available], leftOut: 0 }
  const byAdp = available
    .map((p, i) => ({ p, i }))
    .filter(({ p }) => realAdp(p.adp))
    .sort((a, b) => (a.p.adp as number) - (b.p.adp as number) || a.i - b.i)
    .slice(0, n)
  const gone = new Set(byAdp.map(({ i }) => i))
  return { pool: available.filter((_, i) => !gone.has(i)), leftOut: gone.size }
}
