/**
 * What kind of league this is, and therefore what a trade can even contain.
 *
 * ⚠ FORMAT IS NOT A FLAVOUR, IT DECIDES WHAT EXISTS. A "2027 1st" in a redraft
 * league is not a cheap asset — it is a nonexistent one, and an engine that
 * prices it has invented an asset and then valued a trade around it. In a keeper
 * league the same pick may or may not be tradeable depending on whether the
 * commissioner opens pick trading at all.
 *
 * ⚠ AND IN A KEEPER LEAGUE A PLAYER'S MARKET VALUE IS NOT HIS TRADE VALUE. What
 * you are acquiring is not the player, it is the player MINUS what he costs to
 * keep. A receiver kept at a 2nd is a worse asset than the same receiver kept at
 * a 7th, and they are the same player on every chart in the world. That gap is
 * the whole game in a keeper league and nothing prices it.
 */

export type LeagueConcept = 'redraft' | 'keeper' | 'dynasty' | 'other'

export type FormatRules = {
  concept: LeagueConcept
  /**
   * Whether future rookie/draft picks can be part of a trade at all.
   *
   * ⚠ NULL MEANS UNKNOWN AND MUST NOT BE READ AS "YES". Keeper leagues genuinely
   * differ — some open pick trading before the draft, some never do — and we do
   * not read that setting from any platform. Guessing "yes" prices assets that
   * may not be movable; guessing "no" hides real ones.
   */
  futurePicksTradeable: boolean | null
  /**
   * How a keeper's cost moves each year he is held. Positive means the pick
   * required climbs (an earlier round, more expensive); negative means it falls.
   * Null when this is not a keeper league or the rule is not on file.
   */
  keeperRoundPenalty: number | null
  keeperCostSystem: string | null
  maxKeepers: number | null
  notes: string[]
}

/**
 * Read the format from the league row.
 *
 * Prefers the explicit `leagueType` because it is the canonical concept id.
 * `isDynasty` is the fallback and is deliberately second: a keeper league is
 * frequently imported with `isDynasty` false and a keeper count above zero, and
 * treating that as redraft would switch off the surplus maths that matters most
 * there.
 */
export function readFormatRules(league: {
  leagueType?: string | null
  isDynasty?: boolean | null
  keeperCount?: number | null
  keeperCostSystem?: string | null
  keeperRoundPenalty?: number | null
}): FormatRules {
  const raw = (league.leagueType ?? '').trim().toLowerCase()
  const keeperCount = league.keeperCount ?? 0

  const concept: LeagueConcept =
    raw === 'dynasty' || (raw === '' && league.isDynasty)
      ? 'dynasty'
      : raw === 'keeper' || (raw === 'redraft' && keeperCount > 0)
        ? 'keeper'
        : raw === 'redraft' || raw === ''
          ? 'redraft'
          : /* guillotine, survivor, zombie and friends are their own thing and
               are NOT silently treated as redraft — a caller that does not know
               how to price them should be able to tell. */
            'other'

  const notes: string[] = []
  let futurePicksTradeable: boolean | null = null

  if (concept === 'dynasty') {
    futurePicksTradeable = true
  } else if (concept === 'redraft') {
    futurePicksTradeable = false
    notes.push(
      'Redraft: there are no future picks to trade, so this deal is decided entirely on players. Nothing here carries into next season.',
    )
  } else if (concept === 'keeper') {
    /*
     * ⚠ LEFT UNKNOWN ON PURPOSE. Keeper leagues split on this and no platform
     * setting we read records it. Saying "picks are tradeable" would price an
     * asset the commissioner may have frozen.
     */
    futurePicksTradeable = null
    notes.push(
      `Keeper league (${keeperCount} per team). Whether future picks can be traded is a commissioner setting we do not read — check before building a deal around one.`,
    )
  }

  const penalty = league.keeperRoundPenalty ?? null
  if (concept === 'keeper' && penalty != null) {
    notes.push(
      penalty > 0
        ? `Keepers cost ${penalty} round${penalty === 1 ? '' : 's'} earlier each year they are held, so a player you keep gets more expensive the longer you keep him.`
        : penalty < 0
          ? `Keepers cost ${Math.abs(penalty)} round${Math.abs(penalty) === 1 ? '' : 's'} later each year, so holding a player gets cheaper.`
          : 'Keepers cost the same round every year they are held.',
    )
  }

  return {
    concept,
    futurePicksTradeable,
    keeperRoundPenalty: penalty,
    keeperCostSystem: league.keeperCostSystem ?? null,
    maxKeepers: keeperCount > 0 ? keeperCount : null,
    notes,
  }
}

/**
 * A pick in a deal the format says cannot contain one.
 *
 * ⚠ THIS IS A CORRECTNESS PROBLEM, NOT A NOTE. If a redraft trade is graded with
 * a future first on one side, the verdict is arithmetic performed on an asset
 * that does not exist, and it will be confidently wrong in whichever direction
 * the phantom pick points.
 */
export function impossiblePickWarning(args: {
  rules: FormatRules
  pickCount: number
}): string | null {
  if (args.pickCount === 0) return null
  if (args.rules.futurePicksTradeable === false) {
    return `This is a redraft league and there are ${args.pickCount} future pick${
      args.pickCount === 1 ? '' : 's'
    } in this deal. Redraft leagues have no future picks — the verdict below is doing arithmetic on an asset that does not exist here.`
  }
  if (args.rules.futurePicksTradeable === null && args.rules.concept === 'keeper') {
    return `There ${args.pickCount === 1 ? 'is' : 'are'} ${args.pickCount} future pick${
      args.pickCount === 1 ? '' : 's'
    } in this deal. Many keeper leagues do not allow pick trading at all — confirm yours does before agreeing to it.`
  }
  return null
}

export type KeeperSurplus = {
  /** Market value of the player. */
  marketValue: number
  /** What the pick he consumes is worth. */
  keeperCost: number
  /** Value net of the cost of keeping him. Can be negative. */
  surplus: number
  costRound: number
  basis: string
}

/**
 * What a keeper is actually worth to acquire.
 *
 * ⚠ VALUE MINUS THE PICK HE EATS. Acquiring a player you can keep at a 7th is
 * acquiring a player and giving up a 7th; at a 2nd it is the same player and a
 * 2nd. On every chart in the world those are the same asset. Here they are not,
 * and the difference routinely exceeds the difference between the players
 * managers actually argue about.
 *
 * A NEGATIVE SURPLUS IS A REAL AND USEFUL ANSWER: the player costs more to keep
 * than he is worth, which is exactly the case a manager is about to trade for
 * without noticing.
 *
 * `pickPrice` is supplied by the caller because pricing a pick needs the league
 * size conversion and the market payload, neither of which belong in here.
 */
export function keeperSurplus(args: {
  marketValue: number | null
  /** The round he would cost to keep next season. */
  costRound: number | null
  /** Prices a round in this league, already size-converted. */
  pickPrice: (round: number) => number | null
  playerName?: string
}): KeeperSurplus | null {
  const { marketValue, costRound } = args
  if (marketValue == null || costRound == null) return null

  const keeperCost = args.pickPrice(costRound)
  if (keeperCost == null) return null

  const surplus = marketValue - keeperCost
  const who = args.playerName ? args.playerName : 'He'

  return {
    marketValue,
    keeperCost,
    surplus,
    costRound,
    basis:
      surplus >= 0
        ? `${who} keeps at a ${ordinal(costRound)} and is worth about ${marketValue.toLocaleString()} — that is ${surplus.toLocaleString()} of surplus over what the pick costs you.`
        : `${who} keeps at a ${ordinal(
            costRound,
          )}, which is worth more than he is. You would be paying ${Math.abs(
            surplus,
          ).toLocaleString()} above his value for the right to hold him.`,
  }
}

/**
 * How a player's keeper cost has moved against his value.
 *
 * ⚠ THE DIRECTION IS THE POINT. A player who cost a 2nd last year and is worth a
 * 4th now is a liability being dressed up as an asset; a player who cost a 4th
 * and is worth a 2nd is the best thing on the board and nobody's chart says so,
 * because a chart prices the player and not the contract.
 */
export function keeperDriftNote(args: {
  playerName: string
  /** Round he was originally drafted or last kept at. */
  previousRound: number
  /** The round his CURRENT market value is equivalent to. */
  impliedRoundNow: number
}): string | null {
  const { playerName, previousRound, impliedRoundNow } = args
  const moved = previousRound - impliedRoundNow
  if (Math.abs(moved) < 1) return null

  return moved > 0
    ? `${playerName} cost a ${ordinal(previousRound)} and is now worth roughly a ${ordinal(
        impliedRoundNow,
      )} — he has gained ${moved} round${moved === 1 ? '' : 's'} of value, and his keeper price has not caught up.`
    : `${playerName} cost a ${ordinal(previousRound)} and is now worth roughly a ${ordinal(
        impliedRoundNow,
      )} — he has lost ${Math.abs(moved)} round${
        Math.abs(moved) === 1 ? '' : 's'
      } of value. Trading a ${ordinal(previousRound)} for him would be paying last year's price.`
}

function ordinal(n: number): string {
  const s = ['th', 'st', 'nd', 'rd']
  const v = n % 100
  return `${n}${s[(v - 20) % 10] ?? s[v] ?? s[0]}`
}
