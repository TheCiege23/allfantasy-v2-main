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

export type LeagueConcept =
  | 'redraft'
  | 'keeper'
  | 'dynasty'
  | 'guillotine'
  | 'zombie'
  | 'survivor'
  | 'tournament'
  | 'pirate'
  | 'other'

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
    raw === 'pirate'
      ? 'pirate'
      : raw === 'tournament'
        ? 'tournament'
        : raw === 'survivor'
          ? 'survivor'
          : raw === 'zombie'
            ? 'zombie'
            : raw === 'guillotine'
              ? 'guillotine'
              : raw === 'dynasty' || (raw === '' && league.isDynasty)
                ? 'dynasty'
                : raw === 'keeper' || (raw === 'redraft' && keeperCount > 0)
                  ? 'keeper'
                  : raw === 'redraft' || raw === ''
                    ? 'redraft'
                    : /* Anything still unrecognised is NOT silently treated as
                         redraft — a caller that does not know how to price a
                         format should be able to tell. */
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
  } else if (concept === 'guillotine') {
    /*
     * ⚠ SEASONAL FORMAT: there is no next year to trade into. And the whole
     * valuation curve is different — see lib/trade-intel/guillotine.ts, where a
     * trade decays toward zero as the field shrinks and FAAB is the real
     * acquisition currency rather than a tiebreaker.
     */
    futurePicksTradeable = false
    notes.push(
      'Guillotine: one team is chopped every week and its whole roster hits waivers. There is no next season to trade into, a trade is worth less every week the field shrinks, and FAAB is the currency that actually converts into starters here.',
    )
  } else if (concept === 'pirate') {
    /*
     * ⚠ THREE PROTECTION SLOTS ARE THE WHOLE SHIELD. Winning a matchup takes a
     * player off the loser, and anyone unprotected — starter, bench or IR — is
     * takeable. So a player's value here depends on whether you can actually
     * keep him, which is a question no value chart asks.
     *
     * The trade window differs per player: protected players freeze from TNF to
     * Wednesday midnight, everyone else trades freely. See
     * lib/trade-intel/pirate.ts, which also documents where the existing
     * house-rule advice inverts under a protection cap.
     */
    futurePicksTradeable = null
    notes.push(
      'Pirate: winning a matchup takes a player off the loser, and only your 3 protected players are safe. Anything you acquire beyond those 3 can be stolen the first week you lose — and the tradeable pool shrinks all season, because every result moves a player and none come back.',
    )
  } else if (concept === 'tournament') {
    /*
     * ⚠ MOST TOURNAMENTS FORBID TRADES OUTRIGHT, and the King Buffalo rules bar
     * both trades (rule 3) and draft pick trading (rule 1). The platform spec
     * makes it a setting, so a variant can enable it — but the DEFAULT here is
     * barred, and reporting a tradeable asset in a tournament that forbids
     * trading would imply a deal that cannot happen.
     *
     * Pricing for the enabled case lives in lib/trade-intel/tournament.ts, where
     * the roster expires at the next redraft and single elimination compresses
     * every acquisition to about two games.
     */
    futurePicksTradeable = false
    notes.push(
      'Tournament: rosters dissolve at the next redraft, so nothing you acquire carries forward — and in the bracket, single elimination means a player is worth about two more games however many rounds remain. Most tournaments bar trades entirely; confirm before building a deal around one.',
    )
  } else if (concept === 'survivor') {
    /*
     * ⚠ IDOLS ARE TRADEABLE AND MOSTLY EXPIRE AT THE MERGE. Nine to twelve are
     * seeded from a twenty-power pool after the draft; only two convert rather
     * than expiring. And WHO you trade with decides whether the deal helps —
     * see lib/trade-intel/survivor.ts, where a losing trade with a tribemate can
     * still be correct because your tribe attends Tribal only if it scores
     * lowest.
     */
    futurePicksTradeable = true
    notes.push(
      'Survivor: idols are tradeable and almost all of them expire at the merge, so an idol saved for the perfect moment is how it ends up worth nothing. Pre-merge, who you trade with matters as much as what — your tribe attends Tribal only if it scores lowest.',
    )
  } else if (concept === 'zombie') {
    /*
     * ⚠ PICK TRADING IS EXPLICITLY ENCOURAGED HERE — "allowed, awesome, and
     * encouraged" per the rules document — but only between teams that are not
     * Zombies. The counterparty restriction is the real constraint, not the
     * asset type, and it is reported by lib/trade-intel/zombie.ts.
     */
    futurePicksTradeable = true
    notes.push(
      'Zombie Universe: there are no waivers at all, only free agents you can add at will — even during games. Replacement is close to free, so depth players carry little trade value here. Zombie teams cannot trade, so the pool of legal partners only ever shrinks.',
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
