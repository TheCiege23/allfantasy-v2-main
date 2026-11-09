/**
 * How many players a bench may hold: its own slots, plus one for every starting slot left empty.
 *
 * A team that cannot fill a starting slot has nowhere to put that player's place but the bench. Found
 * by the dynasty simulation (2026-11-09): an auction team finished with 25 players and no quarterback,
 * so the 25th sat on a 15-man bench as its 16th player, and EVERY lineup save that manager made was
 * refused ("BENCH has 16 players, max 15") until a QB arrived — which, in a league whose pickups go
 * through waiver claims, can be days.
 *
 * The extra room is only ever the empty starting seats, and every caller still checks the roster's
 * TOTAL limit separately, so this never lets a team carry more players than the league allows.
 *
 * Pure.
 */
export function benchCapacityWithEmptyStarters(input: {
  benchSlots: number
  starterSlots: number
  startersFilled: number
}): number {
  const bench = Math.max(0, Math.floor(Number(input.benchSlots) || 0))
  const starters = Math.max(0, Math.floor(Number(input.starterSlots) || 0))
  const filled = Math.max(0, Math.floor(Number(input.startersFilled) || 0))
  return bench + Math.max(0, starters - filled)
}
