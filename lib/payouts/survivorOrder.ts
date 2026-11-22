import type { PlaceRow } from './payoutCalculator'

/**
 * A Survivor league's finishing order for the payouts card (./payoutService.ts).
 *
 * 🛑 THE PAYOUTS CARD RANKED SURVIVOR BY STANDINGS SEED. `readFinalOrder` knows only a finished playoff bracket and
 * rotisserie results; Survivor has neither — its winner is chosen by the jury — so the card fell back to
 * `playoffSeed`, and a league with a payout plan could show first-place money going to whoever topped the
 * points table rather than the Sole Survivor.
 *
 * The order, from what the game itself records:
 *   1. the winner (`JurySession.winnerId`);
 *   2. the other finalists, by jury votes received;
 *   3. everyone still in the game (before the finale), by standings seed;
 *   4. everyone voted out, latest out first (`SurvivorPlayer.eliminatedWeek`).
 * Within a step, ties fall back to standings seed, then id, so the same data always gives the same order — places
 * must be unique, because the calculator pays each place to one team.
 *
 * ⚠ FINAL ONLY ONCE THE WINNER IS REVEALED (`status === 'winner_revealed'`). Before that the jury votes are secret and
 * nothing here reads them: the order is "if the season ended now" — still-in players ahead of the voted-out — and
 * `final` is false, so the card says the money is not settled.
 *
 * Pure (no I/O).
 */

export type SurvivorOrderInput = {
  players: ReadonlyArray<{ userId: string; redraftRosterId: string | null; eliminatedWeek: number | null; isFinalist: boolean }>
  rosters: ReadonlyArray<{ id: string; ownerId: string; playoffSeed: number | null }>
  jury: { status: string; winnerId: string | null; finalistUserIds: string[] } | null
  /** Jury votes, one row per juror — passed only once the winner is revealed. */
  votes: ReadonlyArray<{ finalistUserId: string }>
}

export function survivorFinishingOrder(input: SurvivorOrderInput): { order: PlaceRow[]; final: boolean } | null {
  if (!input.players.length) return null
  const rosterIds = new Set(input.rosters.map((r) => r.id))
  const byOwner = new Map(input.rosters.map((r) => [r.ownerId, r.id]))
  const seedOf = new Map(input.rosters.map((r) => [r.id, r.playoffSeed ?? Number.MAX_SAFE_INTEGER]))
  const rosterFor = (p: SurvivorOrderInput['players'][number]) =>
    p.redraftRosterId && rosterIds.has(p.redraftRosterId) ? p.redraftRosterId : byOwner.get(p.userId) ?? null

  const final = input.jury?.status === 'winner_revealed' && typeof input.jury.winnerId === 'string' && input.jury.winnerId.length > 0
  const votesFor = new Map<string, number>()
  if (final) for (const v of input.votes) votesFor.set(v.finalistUserId, (votesFor.get(v.finalistUserId) ?? 0) + 1)
  const finalists = new Set(final ? [...input.jury!.finalistUserIds, ...input.players.filter((p) => p.isFinalist).map((p) => p.userId)] : [])

  const rows = input.players
    .map((p) => ({ p, rosterId: rosterFor(p) }))
    .filter((x): x is { p: typeof x.p; rosterId: string } => x.rosterId !== null)
    .map(({ p, rosterId }) => {
      const step = final && p.userId === input.jury!.winnerId ? 0 : final && finalists.has(p.userId) ? 1 : p.eliminatedWeek == null ? 2 : 3
      return { rosterId, userId: p.userId, step, votes: votesFor.get(p.userId) ?? 0, out: p.eliminatedWeek ?? 0, seed: seedOf.get(rosterId)! }
    })
    .sort((a, b) =>
      a.step - b.step ||
      (a.step === 1 ? b.votes - a.votes : 0) ||
      (a.step === 3 ? b.out - a.out : 0) ||
      a.seed - b.seed ||
      a.userId.localeCompare(b.userId))

  return { order: rows.map((r, i) => ({ rosterId: r.rosterId, place: i + 1 })), final }
}
