/**
 * FINAL TRIBAL COUNCIL — pure reveal rules (no DB).
 *
 * Secrecy: nothing about the jury vote (not the tally, not who has voted for whom) leaves the
 * server until every juror has voted or the deadline has passed. Before that the client gets only
 * "sealed". Once complete, the client gets the reveal sequence in a server-computed suspense order:
 * slips alternate between finalists, keeping the count close, and the deciding vote is read last.
 */

export interface FinaleSlipInput {
  finalistRosterId: string
  /** 2 for a doubled jury vote; each unit becomes its own slip. */
  weight: number
  /** 'jury' for a juror's ballot, 'advantage' for a finale-advantage bonus vote. */
  kind?: 'jury' | 'advantage'
}

export interface FinaleSlip {
  index: number
  finalistRosterId: string
  kind: 'jury' | 'advantage'
}

/** Whether the jury vote can be revealed to anyone yet. */
export function isFinaleVoteComplete(input: { votesSubmitted: number; votesRequired: number; deadline: Date | null; now: Date; crowned?: boolean }): boolean {
  if (input.crowned) return true
  if (input.votesRequired > 0 && input.votesSubmitted >= input.votesRequired) return true
  return Boolean(input.deadline && input.now.getTime() >= input.deadline.getTime())
}

/**
 * Suspense ordering. One of the winner's slips is reserved for last (the deciding vote). The rest
 * are dealt round-robin, taking the finalist with the most slips left and the fewest read (never the
 * same finalist twice in a row when another has slips left), so the tally stays close.
 * Deterministic for a given input order.
 */
export function orderFinaleRevealSequence(slips: ReadonlyArray<FinaleSlipInput>, winnerRosterId: string | null, finalistOrder: ReadonlyArray<string>): FinaleSlip[] {
  const units: Array<{ finalistRosterId: string; kind: 'jury' | 'advantage' }> = []
  for (const slip of slips) {
    const n = Math.max(1, Math.floor(slip.weight))
    for (let i = 0; i < n; i++) units.push({ finalistRosterId: slip.finalistRosterId, kind: slip.kind ?? 'jury' })
  }
  const order = (id: string) => {
    const idx = finalistOrder.indexOf(id)
    return idx === -1 ? Number.MAX_SAFE_INTEGER : idx
  }
  // Advantage votes are read first: they are not ballots and should not be the deciding slip.
  const advantage = units.filter((u) => u.kind === 'advantage')
  const jury = units.filter((u) => u.kind === 'jury')
  const remaining = new Map<string, Array<{ finalistRosterId: string; kind: 'jury' | 'advantage' }>>()
  for (const unit of jury) {
    const list = remaining.get(unit.finalistRosterId) ?? []
    list.push(unit)
    remaining.set(unit.finalistRosterId, list)
  }
  let last: { finalistRosterId: string; kind: 'jury' | 'advantage' } | null = null
  if (winnerRosterId && remaining.get(winnerRosterId)?.length) last = remaining.get(winnerRosterId)!.pop()!

  const read = new Map<string, number>()
  for (const unit of advantage) read.set(unit.finalistRosterId, (read.get(unit.finalistRosterId) ?? 0) + 1)
  const out: Array<{ finalistRosterId: string; kind: 'jury' | 'advantage' }> = [...advantage]
  let prev: string | null = advantage.at(-1)?.finalistRosterId ?? null
  for (;;) {
    const candidates = [...remaining.entries()].filter(([, list]) => list.length > 0).map(([id]) => id)
    if (!candidates.length) break
    const pool = candidates.length > 1 && prev ? candidates.filter((id) => id !== prev) : candidates
    // Most slips left first (so nobody is left with a run at the end), then fewest read so far,
    // then non-winner first so the leader is never the one pulling ahead early.
    pool.sort((a, b) =>
      remaining.get(b)!.length - remaining.get(a)!.length ||
      (read.get(a) ?? 0) - (read.get(b) ?? 0) ||
      (a === winnerRosterId ? 1 : 0) - (b === winnerRosterId ? 1 : 0) ||
      order(a) - order(b) ||
      a.localeCompare(b))
    const pick = pool[0]!
    out.push(remaining.get(pick)!.pop()!)
    read.set(pick, (read.get(pick) ?? 0) + 1)
    prev = pick
  }
  if (last) out.push(last)
  return out.map((unit, index) => ({ index, finalistRosterId: unit.finalistRosterId, kind: unit.kind }))
}

const ORDINALS = ['First', 'Second', 'Third', 'Fourth', 'Fifth', 'Sixth', 'Seventh', 'Eighth', 'Ninth', 'Tenth', 'Eleventh', 'Twelfth']

export function slipLabel(index: number, kind: 'jury' | 'advantage' = 'jury'): string {
  if (kind === 'advantage') return 'Advantage'
  const ordinal = ORDINALS[index]
  return ordinal ? `${ordinal} vote` : `Vote ${index + 1}`
}

/** "3–1–1": winner first, then the rest in descending order. */
export function juryScoreline(voteCount: Record<string, number>, winnerRosterId: string | null): string {
  const entries = Object.entries(voteCount)
  entries.sort(([a, x], [b, y]) => (a === winnerRosterId ? -1 : b === winnerRosterId ? 1 : 0) || y - x)
  return entries.map(([, n]) => String(n)).join('–')
}

export const FINALE_TIEBREAK_RULE = 'A tie on the jury vote is broken by season points: the tied finalist with the most points scored all season wins.'
