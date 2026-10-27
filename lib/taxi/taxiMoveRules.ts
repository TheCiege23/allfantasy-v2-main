/**
 * THE TAXI SQUAD'S MOVE RULES — when a player may go onto the taxi squad and when he may come off.
 *
 * 🛑 THESE WERE STORED AND NEVER ENFORCED. `DynastyLeagueConfig` has carried a lock week
 * (`taxiDeadlineWeek`), a promotion deadline (`taxiPromotionDeadlineWeek`), "once promoted cannot
 * return" (`taxiLockBehavior`) and in-season / postseason switches since the dynasty config was
 * built, and no save ever read them (`TAXI_DEADLINE_PASSED` was never produced). Every league holds
 * the defaults — including "no taxi moves in the playoffs" — whether or not anyone chose them, so
 * turning enforcement on for everyone would change rules nobody picked. Enforcement is therefore
 * the commissioner's explicit switch (`League.settings.taxi_rules_enforced`), part of AF
 * Commissioner, and the settings panel shows every rule beside it.
 *
 * The rules, judged on the week the save is for:
 *
 *   lock week          no player goes ONTO the taxi squad after week N
 *   promotion deadline no player comes OFF the taxi squad onto the active roster after week N
 *   once promoted      a player promoted off the taxi squad cannot go back to it
 *   in-season moves    off: no taxi changes at all during the regular season
 *   postseason moves   off: no taxi changes at all during the playoffs
 *
 * The offseason is always open: the rules are about the season being played. Dropping a taxi
 * player is not a promotion — a roster move, not a lineup one, and the waiver rules own it.
 *
 * Pure.
 */

export const TAXI_RULES_ENFORCED_KEY = 'taxi_rules_enforced'

export type TaxiLockBehavior = 'once_promoted_no_return' | 'free_move' | 'commissioner_custom'

export type TaxiMoveRules = {
  /** Nothing goes onto the taxi squad after this week. Null: no lock. */
  lockAfterWeek: number | null
  /** Nothing comes off the taxi squad after this week. Null: no deadline. */
  promotionDeadlineWeek: number | null
  lockBehavior: TaxiLockBehavior
  inSeasonMoves: boolean
  postseasonMoves: boolean
}

export type TaxiSeasonPhase = 'offseason' | 'regular' | 'playoffs'

export type TaxiMoveIssueCode =
  | 'TAXI_DEADLINE_PASSED'
  | 'TAXI_PROMOTION_CLOSED'
  | 'TAXI_NO_RETURN'
  | 'TAXI_IN_SEASON_LOCKED'
  | 'TAXI_POSTSEASON_LOCKED'

export type TaxiMoveIssue = { code: TaxiMoveIssueCode; playerId: string; message: string }

export function readTaxiRulesEnforced(settings: unknown): boolean {
  return Boolean(settings && typeof settings === 'object' && (settings as Record<string, unknown>)[TAXI_RULES_ENFORCED_KEY] === true)
}

export function normalizeTaxiLockBehavior(value: unknown): TaxiLockBehavior {
  return value === 'free_move' || value === 'commissioner_custom' ? value : 'once_promoted_no_return'
}

/** The season phase a save is judged in. Anything not being played is the offseason. */
export function taxiSeasonPhase(season: { status: string; playoffStartWeek: number } | null, week: number): TaxiSeasonPhase {
  if (!season || season.status !== 'active') return 'offseason'
  return season.playoffStartWeek > 0 && week >= season.playoffStartWeek ? 'playoffs' : 'regular'
}

/** Who a save puts onto the taxi squad, and who it brings off it onto the active roster. */
export function diffTaxiSquad(input: {
  beforeTaxi: readonly string[]
  afterTaxi: readonly string[]
  /** Every player still on the roster after the save. */
  afterRoster: readonly string[]
}): { arrivals: string[]; promotions: string[] } {
  const before = new Set(input.beforeTaxi)
  const after = new Set(input.afterTaxi)
  const onRoster = new Set(input.afterRoster)
  return {
    arrivals: [...after].filter((id) => !before.has(id)),
    promotions: [...before].filter((id) => !after.has(id) && onRoster.has(id)),
  }
}

export function taxiMoveIssues(input: {
  rules: TaxiMoveRules
  phase: TaxiSeasonPhase
  week: number
  arrivals: readonly string[]
  promotions: readonly string[]
  /** Players this team has already promoted off its taxi squad. */
  promotedBefore: ReadonlySet<string>
  nameOf: (playerId: string) => string
}): TaxiMoveIssue[] {
  const { rules, phase, week, nameOf } = input
  const issues: TaxiMoveIssue[] = []
  const moved = [...input.arrivals, ...input.promotions]
  if (phase === 'offseason' || moved.length === 0) {
    // The one rule that is not about the calendar: a promoted player cannot go back.
    if (rules.lockBehavior === 'once_promoted_no_return') {
      for (const id of input.arrivals) if (input.promotedBefore.has(id)) issues.push(noReturn(id, nameOf))
    }
    return issues
  }
  if (phase === 'regular' && !rules.inSeasonMoves) {
    return moved.map((id) => ({
      code: 'TAXI_IN_SEASON_LOCKED' as const,
      playerId: id,
      message: `${nameOf(id)} can't move ${input.arrivals.includes(id) ? 'onto' : 'off'} the taxi squad: this league makes no taxi moves during the season.`,
    }))
  }
  if (phase === 'playoffs' && !rules.postseasonMoves) {
    return moved.map((id) => ({
      code: 'TAXI_POSTSEASON_LOCKED' as const,
      playerId: id,
      message: `${nameOf(id)} can't move ${input.arrivals.includes(id) ? 'onto' : 'off'} the taxi squad: this league makes no taxi moves in the playoffs.`,
    }))
  }
  for (const id of input.arrivals) {
    if (rules.lockBehavior === 'once_promoted_no_return' && input.promotedBefore.has(id)) issues.push(noReturn(id, nameOf))
    else if (rules.lockAfterWeek != null && week > rules.lockAfterWeek)
      issues.push({
        code: 'TAXI_DEADLINE_PASSED',
        playerId: id,
        message: `${nameOf(id)} can't go onto the taxi squad: it locked after week ${rules.lockAfterWeek}.`,
      })
  }
  for (const id of input.promotions) {
    if (rules.promotionDeadlineWeek != null && week > rules.promotionDeadlineWeek)
      issues.push({
        code: 'TAXI_PROMOTION_CLOSED',
        playerId: id,
        message: `${nameOf(id)} can't be promoted off the taxi squad: promotions closed after week ${rules.promotionDeadlineWeek}.`,
      })
  }
  return issues
}

function noReturn(id: string, nameOf: (playerId: string) => string): TaxiMoveIssue {
  return {
    code: 'TAXI_NO_RETURN',
    playerId: id,
    message: `${nameOf(id)} was promoted off the taxi squad and can't go back to it.`,
  }
}

/** The rules in words, for Chimmy. */
export function describeTaxiMoveRules(rules: TaxiMoveRules): string {
  const parts = [
    rules.lockAfterWeek != null ? `no player goes onto the taxi squad after week ${rules.lockAfterWeek}` : null,
    rules.promotionDeadlineWeek != null ? `no player comes off it after week ${rules.promotionDeadlineWeek}` : null,
    rules.lockBehavior === 'once_promoted_no_return' ? 'a player promoted off it cannot go back' : null,
    rules.inSeasonMoves ? null : 'no taxi moves during the regular season',
    rules.postseasonMoves ? null : 'no taxi moves in the playoffs',
  ].filter(Boolean)
  return parts.length
    ? `Taxi squad rules (enforced on every lineup save): ${parts.join('; ')}. The offseason is always open.`
    : 'Taxi squad rules are enforced, and none of them limits a move.'
}
