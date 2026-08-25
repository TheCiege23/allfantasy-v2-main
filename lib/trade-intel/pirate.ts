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
 *   4. Once the games start, the ONLY players who can be traded are PROTECTED
 *      ones. Unprotected players are frozen until Wednesday midnight.
 *
 * ⚠ RULE 4 EXISTS TO PROTECT THE WINNER'S PICK, AND THAT IS WHAT MAKES IT READ
 * BACKWARDS AT FIRST. Unprotected players are the steal pool. If a manager who
 * is losing could ship them out mid-week, the winner would arrive to find
 * nothing worth taking — the whole mechanic would be dodgeable. So the takeable
 * players are exactly the ones frozen in place, and the safe ones are the only
 * currency that still moves.
 *
 * ⚠ THE COMMISSIONER'S PINNED TEXT SAYS THIS THE OTHER WAY ROUND — "you cannot
 * trade a protected player between TNF and the following Wednesday at midnight
 * but all other players can be traded at any time". Implemented per the
 * commissioner's stated INTENT rather than that wording, because the wording
 * describes a rule with no purpose: freezing players who cannot be stolen while
 * letting the stealable ones move is exactly the loophole rule 4 exists to
 * close. Worth correcting the pinned message for the league's own members.
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
 * ⚠ DURING THE LOCK YOU CANNOT TRADE THE PLAYERS YOU ARE ABOUT TO LOSE. That is
 * the point of the rule: unprotected players are the steal pool, so freezing
 * them stops a losing manager shipping them out before the winner picks. Only
 * protected players move mid-week.
 *
 * ⚠ AND THAT CREATES A TRAP ON THE RECEIVING END. Protections are frozen in the
 * same window, so a player who arrives mid-week lands on your roster
 * UNPROTECTED and cannot be covered until Wednesday. Trade for a star on Friday,
 * lose on Sunday, and he is the first thing the winner takes — you will have
 * paid a protected price for a player you held for two days.
 */
export function tradeLockNote(args: {
  inLockWindow: boolean
  /** Whether the player in question is currently protected. */
  playerProtected: boolean | null
}): string | null {
  if (!args.inLockWindow) return null

  if (args.playerProtected === true) {
    return 'He is protected, so he is one of the few players who CAN move right now — protected players are the only ones tradeable once the games start. ⚠ But protections are frozen too, so he arrives on the other roster unprotected and stays that way until Wednesday midnight: whoever takes him can lose him this week.'
  }
  if (args.playerProtected === false) {
    return 'He is unprotected, so he cannot be traded until Wednesday midnight. Unprotected players are the steal pool and freezing them is what stops a losing manager shipping them out before the winner picks — you cannot trade your way out of this week’s exposure.'
  }
  return 'We cannot tell whether this player is protected. Once the games start only PROTECTED players can be traded — the unprotected ones are frozen so the winner still has something to take. Check his status before agreeing.'
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
