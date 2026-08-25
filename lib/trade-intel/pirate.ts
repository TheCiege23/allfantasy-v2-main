/**
 * Pirate: where winning a matchup takes a player off the loser, and only three
 * of yours are safe.
 *
 * House rules as pinned by the commissioner:
 *
 *   1. You may PROTECT 3 players. Anyone unprotected — starter, bench or IR —
 *      can be stolen.
 *   2. You may only take from an opponent you BEAT head-to-head that week.
 *   3. Protections cannot be changed after the first TNF game until the
 *      following Wednesday at midnight.
 *   4. A PROTECTED player cannot be traded between TNF and that Wednesday
 *      midnight. Everyone else can be traded at any time.
 *
 * ⚠ THE CONCENTRATION ADVICE IN `lib/league-context/leagueContextService.ts` IS
 * BACKWARDS FOR THIS RULE SET, and this module exists partly to say so. That file
 * carries the line "Concentration is risk: value stacked in one or two studs is
 * exactly what an opponent steals. Spread value across the lineup." That is
 * correct for a pirate league with NO protection cap. With three protected
 * slots it is inverted: value inside the cap is untouchable, so concentrating
 * into it is the safest thing you can do, and spreading value across nine
 * unprotected players means every loss costs you a genuinely useful one.
 *
 * The rule that matters is not "don't concentrate", it is "everything past your
 * third-best player is inventory the league can take".
 */

/** Players a manager may shield. Everyone else on the roster is takeable. */
export const PROTECTION_SLOTS = 3

export type StealExposure = {
  /** The best player you could actually lose if you lose this week. */
  atRiskValue: number | null
  /** How many rostered players are exposed. */
  exposedCount: number
  basis: string
}

/**
 * What losing a matchup actually costs.
 *
 * ⚠ IT IS YOUR BEST UNPROTECTED PLAYER, NOT AN AVERAGE. The winner chooses, so
 * they take the most valuable thing you left uncovered. Modelling this as a
 * typical or expected loss would understate every week.
 */
export function stealExposure(args: {
  /** Every rostered player's value; nulls are skipped rather than zeroed. */
  rosterValues: Array<number | null>
  /** How many protection slots are actually in use. */
  protectedCount?: number
}): StealExposure | null {
  const priced = args.rosterValues.filter((v): v is number => typeof v === 'number' && v > 0)
  if (priced.length === 0) return null

  const slots = Math.max(0, Math.min(PROTECTION_SLOTS, args.protectedCount ?? PROTECTION_SLOTS))
  const sorted = [...priced].sort((a, b) => b - a)
  const exposed = sorted.slice(slots)

  if (exposed.length === 0) {
    return {
      atRiskValue: null,
      exposedCount: 0,
      basis: 'Every priced player on this roster fits inside your protection slots — a loss this week costs you nothing we can price.',
    }
  }

  const atRisk = exposed[0]!
  return {
    atRiskValue: atRisk,
    exposedCount: exposed.length,
    basis: `Lose this week and they take your best UNPROTECTED player — about ${atRisk.toLocaleString()} of value, from the ${exposed.length} you cannot shield. The winner picks, so assume they take the most valuable thing you left uncovered.`,
  }
}

export type AcquisitionSafety = {
  /** Whether the incoming player would fit inside the protection cap. */
  protectable: boolean
  /** Who he would displace from protection, if anyone. */
  displaces: number | null
  basis: string
}

/**
 * Whether a player you acquire can actually be kept.
 *
 * ⚠ THE QUESTION NOBODY ASKS BEFORE TRADING HERE. Three slots is the whole
 * shield. Acquiring a fourth stud does not give you four studs — it gives you
 * three studs and a stud the league can take off you the first week you lose.
 * The market price is for a player you own; here you are buying a player you may
 * only rent.
 *
 * And if he DOES fit, he pushes somebody out of the cap, so the real cost of the
 * trade includes the player you stop protecting.
 */
export function acquisitionSafety(args: {
  incomingValue: number | null
  /** Values of the players currently protected. */
  protectedValues: Array<number | null>
}): AcquisitionSafety | null {
  const { incomingValue } = args
  if (incomingValue == null || incomingValue <= 0) return null

  const priced = args.protectedValues.filter((v): v is number => typeof v === 'number' && v > 0)
  const sorted = [...priced].sort((a, b) => b - a).slice(0, PROTECTION_SLOTS)

  if (sorted.length < PROTECTION_SLOTS) {
    return {
      protectable: true,
      displaces: null,
      basis: `You have a protection slot free, so he can be shielded the moment protections open. That is the version of this trade worth making.`,
    }
  }

  const weakest = sorted[sorted.length - 1]!
  if (incomingValue > weakest) {
    return {
      protectable: true,
      displaces: weakest,
      basis: `He is worth more than your weakest protected player, so protecting him means dropping cover from someone worth about ${weakest.toLocaleString()}. That player becomes stealable — count him as part of the price of this deal.`,
    }
  }

  return {
    protectable: false,
    displaces: null,
    basis: `⚠ You already protect three players worth more than him, so he CANNOT be shielded. You are acquiring a player the league can take off you the first week you lose — his market price assumes you get to keep him, and here you may only be renting him.`,
  }
}

/**
 * The trade window, which is not the same for every player on your roster.
 *
 * ⚠ DURING THE LOCK, THE ONLY THINGS YOU CAN TRADE ARE THE THINGS YOU CAN LOSE.
 * Protected players are frozen from TNF until Wednesday midnight; everyone else
 * trades freely. So the market inside that window consists entirely of stealable
 * assets — which cuts both ways: you can convert a player who is about to be
 * taken into something before it happens, and so can the manager on the other
 * side of the table.
 *
 * ⚠ THE RULES AS GIVEN TO US CONFLICT ON THE WINDOW and we do not resolve it
 * silently. The pinned message says protected players are frozen "between TNF
 * and the following Wednesday at midnight" with everyone else tradeable at any
 * time; a separate description says there is no trading at all between Thursday
 * kickoff and the Monday game ending. Those are different rules. The pinned
 * message is the more specific and is implemented; the note says a conflict
 * exists rather than pretending it does not.
 */
export function tradeLockNote(args: {
  inLockWindow: boolean
  /** Whether the player in question is currently protected. */
  playerProtected: boolean | null
}): string | null {
  if (!args.inLockWindow) return null

  if (args.playerProtected === true) {
    return 'This player is protected and protections are frozen from TNF until Wednesday midnight — he cannot be traded until then, and you cannot unprotect him to get around it.'
  }
  if (args.playerProtected === false) {
    return 'Trading is open for this player — only protected players are frozen until Wednesday midnight. Note that the same rule makes him stealable if you lose, so a deal now is a way to bank him before that happens.'
  }
  return 'We cannot tell whether this player is protected. Protected players cannot be traded between TNF and Wednesday midnight; everyone else can. Check before agreeing. (Two versions of this rule are in circulation — one freezes only protected players, the other closes trading entirely from Thursday to Monday. Confirm which your league runs.)'
}

/**
 * Why trading gets harder every week.
 *
 * ⚠ THE POOL SHRINKS FOR EVERY MANAGER AT ONCE. Each matchup moves a player from
 * a loser to a winner, so half the league is poorer every week and the teams
 * with anything left to trade are the same teams that keep winning. A deal you
 * can make in week 3 may have no counterparty in week 11 — not because nobody
 * wants it, but because nobody has the pieces.
 */
export function attritionNote(args: {
  currentWeek: number
  seasonWeeks: number | null
}): string | null {
  const { currentWeek, seasonWeeks } = args
  if (currentWeek < 1) return null

  const late = seasonWeeks != null ? currentWeek / seasonWeeks >= 0.5 : currentWeek >= 8
  if (!late) return null

  return `Week ${currentWeek}: every matchup so far has moved a player from a loser to a winner, so the pool of tradeable depth has been shrinking all season and it never refills. If a deal is available now, "later" is a worse market, not a safer one.`
}

/**
 * The correction to the strategy line this repo already ships.
 *
 * Stated as a note rather than silently changing the other file, because that
 * file's advice is right for a pirate league WITHOUT a protection cap and we do
 * not know which rule set every league detected by name is actually running.
 */
export function concentrationCorrectionNote(args: { protectionSlots?: number }): string {
  const slots = args.protectionSlots ?? PROTECTION_SLOTS
  return `With ${slots} protection slots, value inside the cap is untouchable and everything outside it is inventory the league can take. Concentrating your best players into those ${slots} slots is the SAFEST thing you can do here — spreading value across an unprotected lineup means every loss costs you someone genuinely useful.`
}
