/**
 * What keeping a player costs in an IMPORTED keeper league — read from the league's own drafts. PURE.
 *
 * 🛑 NOTHING PRICED KEEPER COST (2026-09-28). The six native keeper tables hold no rows in production,
 * and the 19 keeper leagues we grade are all Sleeper imports — whose draft sync fetched Sleeper's
 * `is_keeper` flag for years and threw it away. So a receiver kept at a 2nd and the same receiver
 * kept at a 12th graded identically. The sync now keeps the flag (`dw_draft_facts.metadata.isKeeper`).
 *
 * 🛑 THE COST RULE IS MEASURED PER LEAGUE, NEVER ASSUMED. Sleeper does not publish a league's keeper
 * rule, and leagues differ: "kept at the round he was drafted", "one round earlier", "last round".
 * The draft history says most of these leagues keep at the SAME round (542 of 1,368 same-owner
 * repeats; 105 of 156 in one league) — but two keep 9 and 19 players and behave like dynasty drafts.
 * So a league earns a cost only when its OWN flagged keepers show the same-round rule: each keeper
 * slotted this season at the round he went in the season before. Anything else, or too few keepers
 * to tell, prices nothing and says so. A guessed rule would print a confident wrong round.
 *
 * Next season's cost under that rule is the round the player occupies in THIS season's draft —
 * drafted or kept. A player nobody drafted this season (a waiver pickup) has no cost on file: leagues
 * price those by rules we cannot see.
 */

/** One pick from `dw_draft_facts`. */
export type KeeperDraftPick = {
  playerId: string
  season: number
  round: number
  isKeeper: boolean
}

/** Flagged keepers needed before a league's rule counts as measured. */
export const MIN_MEASURED_KEEPERS = 5
/** Share of them that must sit at their previous round for the same-round rule. */
export const SAME_ROUND_SHARE = 0.7

export type KeeperCostRule =
  | { rule: 'same_round'; season: number; measured: number; agreeing: number }
  | { rule: null; season: number | null; measured: number; agreeing: number; reason: string }

/**
 * The league's keeper cost rule, measured on its latest drafted season: every flagged keeper there
 * that was also drafted the season before, and whether he sits at that same round.
 */
export function measureKeeperCostRule(picks: readonly KeeperDraftPick[]): KeeperCostRule {
  const seasons = [...new Set(picks.map((p) => p.season))].sort((a, b) => b - a)
  const season = seasons[0] ?? null
  if (season == null) {
    return { rule: null, season: null, measured: 0, agreeing: 0, reason: 'No draft on file for this league yet' }
  }
  const previousRound = new Map<string, number>()
  for (const p of picks) if (p.season === season - 1) previousRound.set(p.playerId, p.round)

  let measured = 0
  let agreeing = 0
  for (const p of picks) {
    if (p.season !== season || !p.isKeeper) continue
    const before = previousRound.get(p.playerId)
    if (before == null) continue
    measured += 1
    if (before === p.round) agreeing += 1
  }

  if (measured < MIN_MEASURED_KEEPERS) {
    return {
      rule: null,
      season,
      measured,
      agreeing,
      reason:
        measured === 0
          ? `No keepers are flagged in this league's ${season} draft, so its keeper cost rule is not measured`
          : `Only ${measured} flagged keeper${measured === 1 ? '' : 's'} in the ${season} draft — too few to measure this league's keeper cost rule`,
    }
  }
  if (agreeing / measured < SAME_ROUND_SHARE) {
    return {
      rule: null,
      season,
      measured,
      agreeing,
      reason: `This league does not keep players at the round they were drafted (${agreeing} of ${measured} keepers in ${season}), so keeper cost is not priced`,
    }
  }
  return { rule: 'same_round', season, measured, agreeing }
}

export type PlayerKeeperCost = {
  /** The round keeping him costs next season. */
  costRound: number
  /** He was himself kept this season (slotted as a keeper), not freshly drafted. */
  keptThisSeason: boolean
}

/**
 * Next season's cost for each Sleeper player id, under a measured same-round rule. A player absent
 * from this season's draft has no entry — his cost is not on file, and null is never a round.
 */
export function keeperCostsBySleeperId(
  picks: readonly KeeperDraftPick[],
  rule: KeeperCostRule,
): Map<string, PlayerKeeperCost> {
  const out = new Map<string, PlayerKeeperCost>()
  if (rule.rule !== 'same_round') return out
  for (const p of picks) {
    if (p.season !== rule.season) continue
    out.set(p.playerId, { costRound: p.round, keptThisSeason: p.isKeeper })
  }
  return out
}

/**
 * The one id among this league's drafted players that a typed name can mean — or null when the
 * name matches none of them, or more than one (the stranger who shares his name is not him).
 */
export function draftedIdForName(candidateIds: readonly string[], drafted: ReadonlyMap<string, unknown>): string | null {
  const hits = [...new Set(candidateIds)].filter((id) => drafted.has(id))
  return hits.length === 1 ? hits[0]! : null
}
