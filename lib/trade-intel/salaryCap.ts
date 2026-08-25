/**
 * Salary cap: where the best player in a trade is sometimes a negative asset.
 *
 * League Tycoon is the reference implementation. Contracts carry a salary and a
 * length, teams carry a cap hit and a space figure, cutting leaves dead money,
 * and — the part most models forget — there is a FLOOR as well as a ceiling.
 *
 * ⚠ CAP LEGALITY IS A HARD CONSTRAINT AND IT LEADS. A trade both managers want,
 * at a price both think is fair, simply cannot happen if either side lands over
 * the cap. Grading such a deal on value alone produces a verdict about a
 * transaction the platform will reject, which is the same failure as pricing a
 * pick in a redraft league.
 *
 * ⚠ AND IT CUTS BOTH WAYS. `capFloorEnabled` means salary dumping is also
 * illegal past a point. A manager clearing money to get flexible can fall
 * through the floor and be just as blocked as one who overspent — and nobody
 * expects that direction, so it is the one worth saying out loud.
 *
 * ⚠ THE BEST PLAYER IS OFTEN THE WORST ASSET. What you acquire is not a player,
 * it is a player AND his contract. An elite receiver at a punishing salary can
 * be worth less than a replacement-level body on a minimum deal, because the
 * difference between them is spendable on somebody else. Every value chart in
 * existence prices the first man higher, and in this format that is simply the
 * wrong question.
 *
 * ⚠ AND YEARS MATTER MORE THAN DOLLARS. The same player at the same salary with
 * one year left and with four years left are different assets by a wide margin —
 * a cheap long contract is the most valuable thing in a cap league, exactly as a
 * rookie deal is in the real NFL. Nothing that prices a player alone can see it.
 */

export type CapLegality = {
  /** Space after the deal. Negative means the trade cannot be made. */
  spaceAfter: number
  legal: boolean
  /** True when the block is the FLOOR rather than the ceiling. */
  blockedByFloor: boolean
  basis: string
}

/**
 * Whether one side of a deal can actually absorb it.
 *
 * `salaryIn` and `salaryOut` are cap hits for THIS side. Returns null when the
 * ledger is unknown — an unknown cap position must not be reported as legal,
 * and must not be reported as illegal either.
 */
export function capLegality(args: {
  /** Current cap space, from `SalaryCapTeamLedger.capSpace`. */
  capSpace: number | null
  salaryIn: number
  salaryOut: number
  /** From `SalaryCapLeagueConfig`, when the league enforces one. */
  capFloor?: number | null
  /** Current total cap hit, needed only for the floor check. */
  totalCapHit?: number | null
  /** Named in the sentence. */
  who?: string
}): CapLegality | null {
  const { capSpace, salaryIn, salaryOut } = args
  if (capSpace == null) return null

  const net = salaryIn - salaryOut
  const spaceAfter = capSpace - net
  const who = args.who ?? 'You'

  if (spaceAfter < 0) {
    return {
      spaceAfter,
      legal: false,
      blockedByFloor: false,
      basis: `${who} cannot absorb this. It adds ${net.toLocaleString()} of cap hit against ${capSpace.toLocaleString()} of space, leaving ${spaceAfter.toLocaleString()} — the trade is over the cap and will be rejected however fair the value is.`,
    }
  }

  /*
   * The floor. Only checked when the league enforces one and we know the
   * current total, because a floor breach is computed from spend, not space.
   */
  if (args.capFloor != null && args.totalCapHit != null) {
    const spendAfter = args.totalCapHit + net
    if (spendAfter < args.capFloor) {
      return {
        spaceAfter,
        legal: false,
        blockedByFloor: true,
        basis: `${who} would drop below the cap FLOOR. This deal takes total spend to ${spendAfter.toLocaleString()} against a floor of ${args.capFloor.toLocaleString()} — dumping salary is as illegal as overspending here, and almost nobody expects that direction.`,
      }
    }
  }

  return {
    spaceAfter,
    legal: true,
    blockedByFloor: false,
    basis:
      net === 0
        ? `${who} take on no net salary — cap-neutral.`
        : net > 0
          ? `${who} take on ${net.toLocaleString()} of salary, leaving ${spaceAfter.toLocaleString()} of space.`
          : `${who} shed ${Math.abs(net).toLocaleString()} of salary, leaving ${spaceAfter.toLocaleString()} of space.`,
  }
}

export type ContractSurplus = {
  playerValue: number
  /** Total remaining cost across the contract. */
  totalCost: number
  /** Value net of what he costs. Can be negative, and often is. */
  surplus: number
  yearsRemaining: number
  basis: string
}

/**
 * What a player is worth net of his contract.
 *
 * ⚠ A NEGATIVE SURPLUS IS A REAL AND USEFUL ANSWER, not a failure. It is the
 * case a manager is about to accept without noticing: a genuinely good player
 * whose salary costs more than he returns, where the right move is to let
 * somebody else have him.
 *
 * ⚠ THE VALUE AND THE COST ARE IN DIFFERENT UNITS and the caller must reconcile
 * them. Market value is in FantasyCalc points; salary is in the league's cap
 * currency. This function does the arithmetic it is given and names the
 * assumption; it does NOT invent a conversion, because a made-up exchange rate
 * would make every surplus figure confidently wrong.
 */
export function contractSurplus(args: {
  /** Player value, already converted into cap currency by the caller. */
  playerValueInCapUnits: number | null
  salary: number | null
  yearsRemaining: number | null
  playerName?: string
}): ContractSurplus | null {
  const { playerValueInCapUnits, salary, yearsRemaining } = args
  if (playerValueInCapUnits == null || salary == null || yearsRemaining == null) return null
  if (yearsRemaining < 0) return null

  const years = Math.max(1, yearsRemaining)
  const totalCost = salary * years
  const surplus = playerValueInCapUnits - totalCost
  const who = args.playerName ?? 'He'

  return {
    playerValue: playerValueInCapUnits,
    totalCost,
    surplus,
    yearsRemaining: years,
    basis:
      surplus >= 0
        ? `${who} is signed for ${years} more year${
            years === 1 ? '' : 's'
          } at ${salary.toLocaleString()}, costing ${totalCost.toLocaleString()} against about ${playerValueInCapUnits.toLocaleString()} of value — ${surplus.toLocaleString()} of surplus. A cheap long contract is the most valuable thing in a cap league.`
        : `⚠ ${who} costs more than he returns: ${totalCost.toLocaleString()} across ${years} year${
            years === 1 ? '' : 's'
          } against about ${playerValueInCapUnits.toLocaleString()} of value. He may still be the best player in this deal and be the worst asset in it — the gap is money you could spend on somebody else.`,
  }
}

/**
 * What cutting him later would cost, which is part of what you are buying.
 *
 * ⚠ A BAD CONTRACT IS STICKY, AND THAT IS THE POINT OF DEAD MONEY. Acquiring a
 * player you may want to release is acquiring the release cost too. A manager
 * who assumes they can simply cut a disappointment next season has not priced
 * `deadMoneyPercentPerYear`, and it is usually the reason a lopsided-looking
 * salary dump was actually available.
 */
export function deadMoneyNote(args: {
  salary: number | null
  yearsRemaining: number | null
  /** From `SalaryCapLeagueConfig.deadMoneyPercentPerYear`. */
  deadMoneyPercentPerYear: number | null
  enabled: boolean | null
  playerName?: string
}): string | null {
  if (args.enabled === false) return null
  const { salary, yearsRemaining, deadMoneyPercentPerYear } = args
  if (salary == null || yearsRemaining == null || deadMoneyPercentPerYear == null) return null
  if (yearsRemaining <= 0) return null

  const dead = Math.round(salary * yearsRemaining * (deadMoneyPercentPerYear / 100))
  if (dead <= 0) return null

  const who = args.playerName ?? 'This player'
  return `${who} carries ${yearsRemaining} year${
    yearsRemaining === 1 ? '' : 's'
  } at ${salary.toLocaleString()}. Cutting him would leave about ${dead.toLocaleString()} of dead money on your books — you are acquiring the exit cost as well as the player, and that is usually why a salary dump was available.`
}

/**
 * Contract length as an asset in its own right.
 *
 * Only speaks when the length is doing real work — a one-year deal and a
 * four-year deal are different propositions, and a two-year deal on a mid player
 * is not worth a sentence.
 */
const LONG_CONTRACT_YEARS = 3

export function contractLengthNote(args: {
  yearsRemaining: number | null
  surplusPositive: boolean
  playerName?: string
}): string | null {
  const { yearsRemaining } = args
  if (yearsRemaining == null) return null
  const who = args.playerName ?? 'He'

  if (yearsRemaining <= 1) {
    return `${who} is on an expiring deal — you are renting him for one season, and whatever you pay should be priced against that rather than against his market value.`
  }
  if (yearsRemaining >= LONG_CONTRACT_YEARS) {
    return args.surplusPositive
      ? `${who} is locked in for ${yearsRemaining} years below what he returns. That is the most valuable shape of asset in a cap league and it is worth more than his raw value suggests.`
      : `⚠ ${who} is locked in for ${yearsRemaining} years above what he returns. Length works against you here — this is not a player you can wait out.`
  }
  return null
}

/**
 * Cap space as a tradeable asset.
 *
 * ⚠ SPACE HAS FUTURE VALUE WHEN ROLLOVER IS ON, and none when it is off. In a
 * league without rollover, unspent cap at season's end is simply lost, which
 * makes hoarding it a strategy that ends in nothing — the same shape as saving
 * an idol past its expiry or FAAB past a reset.
 */
export function capSpaceNote(args: {
  capSpace: number | null
  rolloverEnabled: boolean | null
  rolloverMax: number | null
}): string | null {
  const { capSpace } = args
  if (capSpace == null || capSpace <= 0) return null

  if (args.rolloverEnabled) {
    const cap = args.rolloverMax != null ? ` up to ${args.rolloverMax.toLocaleString()}` : ''
    return `You hold ${capSpace.toLocaleString()} of space and this league rolls unspent cap over${cap}, so space is a real asset here rather than a use-it-or-lose-it one.`
  }
  return `You hold ${capSpace.toLocaleString()} of space and this league does NOT roll it over — anything unspent at season's end is gone. Hoarding it is the same mistake as saving an idol past its expiry.`
}
