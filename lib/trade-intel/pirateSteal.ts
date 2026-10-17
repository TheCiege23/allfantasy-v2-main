import { readConfirmedLeagueConcept } from '@/lib/league/leagueConceptOptions'

/**
 * A Pirate STEAL, told apart from a trade.
 *
 * In a Pirate league the winner of a matchup takes a player off the loser (`./pirate.ts`). Sleeper has
 * no transaction type for that, so the commissioner executes it as a TRADE with one side empty: one
 * player moves, nothing comes back. Pirate League twinty logged seven of them in 2026 week 3 alone —
 * Zay Flowers among them — and every trade surface read each one as a lopsided trade ("received
 * nothing in return") beside the league's real, two-sided deals.
 *
 * 🛑 A STEAL IS NOT A TRADE AND IS NEVER GRADED (Guap, 2026-09-30). It is the league's rules settling a
 * result, not a deal anyone negotiated — so it carries no letter, does not count as a trade on file,
 * and never takes a league card's "latest trade" slot from a real one. It is still SHOWN, labelled.
 *
 * PURE and client-safe, so the grader, the Trades board and the email read one answer.
 */

/**
 * Whether a league plays Pirate rules (Guap's ruling, 2026-09-30):
 *   - confirmed Pirate by a person → yes;
 *   - confirmed as anything else → no. The person who confirmed it is the authority, and a league
 *     named "Pirates" after a mascot is not thereby a Pirate league;
 *   - never confirmed → its NAME decides: "pirate" anywhere in it.
 *
 * ⚠ THE NAME RULE IS A GUESS AND ONLY FILLS THE GAP A PERSON LEFT. Measured 2026-09-30: all three
 * leagues named Pirate on production lacked a Pirate confirmation, and one ("Pirate League twinty")
 * had been confirmed plain Redraft — which this rule respects. Re-confirming it as Pirate is the fix
 * for that league, not a wider name match.
 */
export function isPirateLeague(league: { name?: string | null; settings?: unknown }): boolean {
  const confirmed = readConfirmedLeagueConcept(league.settings)
  if (confirmed) return confirmed === 'pirate'
  return /pirate/i.test(String(league.name ?? ''))
}

/** One side of a transaction as the stores hold it: counts are all this needs. */
export type TransferSide = {
  playersIn: number
  picksIn: number
  /** FAAB received. `undefined` means the store never read FAAB — see `isOneWayTransfer`. */
  faabIn?: number
}

/**
 * Which side received NOTHING in a two-team transaction, or null.
 *
 * ⚠ FAAB IS A CLAIM ONLY WHEN IT WAS READ. `LeagueTrade` stores no FAAB at all, so a side there with
 * no players and no picks may have been paid in FAAB we never loaded. That is why this is asked only
 * inside a Pirate league: there, one player for nothing is the steal the rules define, and a
 * player-for-FAAB deal is the rare case. Outside one, the same shape stays an ordinary (ungraded)
 * one-way trade, exactly as before.
 */
export function emptySideIndex(sides: readonly [TransferSide, TransferSide]): 0 | 1 | null {
  const empty = (s: TransferSide) => s.playersIn === 0 && s.picksIn === 0 && !(typeof s.faabIn === 'number' && s.faabIn > 0)
  const a = empty(sides[0])
  const b = empty(sides[1])
  // Both empty is no transaction at all; neither empty is a real trade.
  if (a === b) return null
  return a ? 0 : 1
}

/** A steal: a Pirate league, and a two-team transaction with exactly one side that received nothing. */
export function isPirateSteal(args: {
  pirateLeague: boolean
  sides: readonly [TransferSide, TransferSide]
}): boolean {
  return args.pirateLeague && emptySideIndex(args.sides) != null
}

/** The withheld reason a steal carries, naming who took whom when we know. */
export function pirateStealReason(args: { taker?: string | null; from?: string | null } = {}): string {
  const taker = args.taker?.trim()
  const from = args.from?.trim()
  const who = taker && from ? `${taker} took this from ${from}` : taker ? `${taker} took this` : 'A player was taken'
  return `Pirate steal — ${who} under the league's steal rule after a head-to-head win. A steal is not a trade, so it is not graded.`
}

/** Marks a withheld grade as a steal, so a surface can label it without parsing the sentence. */
export const PIRATE_STEAL_KIND = 'pirate_steal' as const
