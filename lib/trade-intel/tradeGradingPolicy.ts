/**
 * Canonical trade-grading policy for supported league formats.
 *
 * This module does not invent weights. It defines which question a grade must
 * answer and which evidence must exist before a contextual letter is allowed.
 * A market comparison may still be shown while the contextual grade is
 * withheld, but the two must never share a label.
 */

export const TRADE_GRADING_POLICY_VERSION = 'trade-policy-2.1' as const

export type SupportedTradeFormat =
  | 'redraft'
  | 'dynasty'
  | 'salary_cap'
  | 'guillotine'
  | 'survivor'
  | 'survivor_guillotine'
  | 'zombie'
  | 'tournament'
  | 'king_of_the_hill'
  | 'pirate'
  | 'best_ball'
export type TradeEligibility = 'enabled' | 'disabled' | 'unknown'
export type EvidenceState = 'available' | 'missing' | 'not_applicable'

export type TradeGradingPolicy = {
  version: typeof TRADE_GRADING_POLICY_VERSION
  format: SupportedTradeFormat
  /** Best ball is a lineup mode and can sit on redraft or dynasty lifecycle rules. */
  lifecycle: 'single_season' | 'multi_season'
  eligibility: TradeEligibility
  objective: string
  primaryOutcome:
    | 'playoff_probability'
    | 'championship_window'
    | 'cap_adjusted_championship_window'
    | 'survival_probability'
    | 'jury_win_probability'
    | 'infection_adjusted_survival'
    | 'advancement_probability'
    | 'crown_adjusted_championship_odds'
    | 'steal_adjusted_championship_odds'
    | 'optimal_roster_points'
  rosterMethod: 'submitted_lineup' | 'automatic_optimal_lineup'
  allowsFuturePicks: boolean | null
  requiredEvidence: readonly TradeEvidenceKey[]
  supportingEvidence: readonly TradeEvidenceKey[]
  rules: readonly string[]
}

export type TradeEvidenceKey =
  | 'team_identity'
  | 'user_strategy'
  | 'league_rules'
  | 'trade_rules'
  | 'roster_before'
  | 'roster_after'
  | 'as_of_asset_values'
  | 'as_of_projections'
  | 'replacement_pool'
  | 'paired_outcome_simulation'
  | 'player_availability'
  | 'schedule_and_byes'
  | 'faab_market'
  | 'field_and_chop_line'
  | 'best_ball_weekly_distribution'
  | 'historical_timestamp'
  | 'contract_terms'
  | 'cap_ledgers'
  | 'dead_money_rules'
  | 'format_phase'
  | 'trade_window'
  | 'counterparty_state'
  | 'tribe_relationship'
  | 'immunity_and_items'
  | 'infection_state'
  | 'advancement_rules'
  | 'roster_expiry'
  | 'crown_holder'
  | 'weekly_score_distributions'
  | 'matchup_state'
  | 'protection_state'
  | 'steal_exposure'

export type TradeEvidence = Partial<Record<TradeEvidenceKey, EvidenceState>>

export type TradeGradeDimension = {
  id: string
  label: string
  description: string
}

/**
 * The receipt shown behind every contextual grade. Primary dimensions define
 * the manager's actual league and objective. The twenty secondary dimensions
 * refine that answer; they may be not-applicable in a format, but may never be
 * silently assumed.
 */
export const TRADE_GRADE_DIMENSION_FRAMEWORK = {
  version: 'trade-dimensions-1.0',
  primary: [
    { id: 'league_format', label: 'League format', description: 'Redraft, dynasty, best ball, specialty mode, and season lifecycle.' },
    { id: 'league_settings', label: 'League settings', description: 'Team count, calendar, playoffs or elimination structure, waivers, and deadlines.' },
    { id: 'scoring_settings', label: 'Scoring settings', description: 'The league’s exact point values, premiums, bonuses, and penalties.' },
    { id: 'roster_settings', label: 'Roster settings', description: 'Starting slots, flex rules, bench, IR, taxi, and legal lineup shape.' },
    { id: 'trade_legality', label: 'Trade legality', description: 'Trade-enabled state, deadline, participant eligibility, cap rules, review, and format windows.' },
    { id: 'team_needs', label: 'Team needs', description: 'Before-and-after lineup holes, surplus positions, depth, and replacement options.' },
    { id: 'manager_strategy', label: 'Manager strategy', description: 'Contend, rebuild, survive, advance, or another confirmed team objective.' },
    { id: 'standings', label: 'Standings and record', description: 'Record, points, rank, tiebreakers, and remaining path.' },
    { id: 'playoff_contention', label: 'Contention state', description: 'Contender, bubble, eliminated, rebuilding, or format-specific survival state.' },
    { id: 'playoff_probability', label: 'Outcome probability', description: 'Paired before-and-after playoff, title, survival, jury, or advancement probability.' },
  ] as const satisfies readonly TradeGradeDimension[],
  secondary: [
    { id: 'market_value', label: 'Market value', description: 'As-of-time player and pick prices from permitted sources.' },
    { id: 'projection_delta', label: 'Projection change', description: 'Rest-of-window projected points gained or lost.' },
    { id: 'lineup_delta', label: 'Starting lineup change', description: 'Points that actually enter the legal lineup rather than remain on the bench.' },
    { id: 'replacement_level', label: 'Replacement level', description: 'Best realistic waiver or free-agent alternative in this league.' },
    { id: 'positional_scarcity', label: 'Positional scarcity', description: 'Supply relative to this league’s teams and required slots.' },
    { id: 'roster_depth', label: 'Roster depth', description: 'Injury coverage and usable depth after the transaction.' },
    { id: 'injury_availability', label: 'Availability', description: 'Current injury status, expected absence, suspension, and return uncertainty.' },
    { id: 'age_trajectory', label: 'Age and trajectory', description: 'Development or decline over the league’s relevant time horizon.' },
    { id: 'recent_usage', label: 'Recent role and usage', description: 'Routes, snaps, touches, targets, opportunities, and depth-chart role.' },
    { id: 'schedule_strength', label: 'Remaining schedule', description: 'Opponent difficulty over the remaining scoring window.' },
    { id: 'playoff_schedule', label: 'Playoff schedule', description: 'Matchups and availability during the league’s decisive weeks.' },
    { id: 'bye_overlap', label: 'Bye overlap', description: 'Lineup pressure created by overlapping byes and short benches.' },
    { id: 'volatility', label: 'Weekly volatility', description: 'Consistency, spike-week rate, and downside-tail risk.' },
    { id: 'ceiling_floor', label: 'Ceiling and floor', description: 'Weekly distribution shape required by the league objective.' },
    { id: 'correlation', label: 'Roster correlation', description: 'Stacking, cannibalization, and shared game or team outcomes.' },
    { id: 'draft_capital', label: 'Draft capital', description: 'Legal picks, expected slot, class strength, and ownership horizon.' },
    { id: 'liquidity', label: 'FAAB and cap liquidity', description: 'Acquisition currency, salary space, dead money, and observed purchasing power.' },
    { id: 'time_horizon', label: 'Time horizon', description: 'Weeks, rounds, contract years, or seasons in which value can still matter.' },
    { id: 'opponent_impact', label: 'Opponent impact', description: 'Value added to the counterparty and changes to the competitive field.' },
    { id: 'data_uncertainty', label: 'Freshness and uncertainty', description: 'Evidence timestamps, source agreement, missing inputs, and model confidence.' },
  ] as const satisfies readonly TradeGradeDimension[],
} as const

const COMMON_REQUIRED: readonly TradeEvidenceKey[] = [
  'team_identity',
  'league_rules',
  'trade_rules',
  'roster_before',
  'roster_after',
  'as_of_asset_values',
]

const COMMON_SUPPORTING: readonly TradeEvidenceKey[] = [
  'user_strategy',
  'player_availability',
  'schedule_and_byes',
  'replacement_pool',
]

export function resolveTradeGradingPolicy(input: {
  concept: string | null | undefined
  bestBall: boolean
  tradesEnabled: boolean | null
  survivorMode?: boolean
  guillotineMode?: boolean
}): TradeGradingPolicy {
  const concept = String(input.concept ?? 'redraft').trim().toLowerCase()
  const eligibility: TradeEligibility =
    input.tradesEnabled === true ? 'enabled' : input.tradesEnabled === false ? 'disabled' : 'unknown'

  if (input.survivorMode && input.guillotineMode) {
    return {
      version: TRADE_GRADING_POLICY_VERSION,
      format: 'survivor_guillotine',
      lifecycle: 'single_season',
      eligibility,
      objective: 'Maximize the chance of surviving the current tribe or gauntlet elimination rule through the final-three scoring week.',
      primaryOutcome: 'survival_probability',
      rosterMethod: 'submitted_lineup',
      allowsFuturePicks: false,
      requiredEvidence: [
        ...COMMON_REQUIRED,
        'format_phase',
        'trade_window',
        'as_of_projections',
        'paired_outcome_simulation',
        'field_and_chop_line',
        'tribe_relationship',
        'immunity_and_items',
        'faab_market',
      ],
      supportingEvidence: [...COMMON_SUPPORTING, 'counterparty_state'],
      rules: [
        'The supplied All-Stars rules prohibit trades; return ineligible before calculating value.',
        'If a commissioner creates a trade-enabled variant, use the exact week phase: match play, tribe champion, Gauntlet double elimination, standard guillotine, or final-three placement.',
        'Apply the week-specific lineup expansion, including the added superflex and W/R/T flex slots.',
        'Price standard and Gauntlet idols, swap tokens, and FAAB by their deadlines and legal uses.',
        'Strategic benching is legal in the supplied rules, so do not assume a full submitted lineup.',
      ],
    }
  }

  if (concept === 'salary_cap' || concept === 'contract_dynasty') {
    return {
      version: TRADE_GRADING_POLICY_VERSION,
      format: 'salary_cap',
      lifecycle: 'multi_season',
      eligibility,
      objective: 'Improve the team’s cap-adjusted championship window after moving every player contract and its future obligations.',
      primaryOutcome: 'cap_adjusted_championship_window',
      rosterMethod: 'submitted_lineup',
      allowsFuturePicks: true,
      requiredEvidence: [
        ...COMMON_REQUIRED,
        'contract_terms',
        'cap_ledgers',
        'dead_money_rules',
        'replacement_pool',
        'as_of_projections',
        'paired_outcome_simulation',
      ],
      supportingEvidence: [...COMMON_SUPPORTING, 'format_phase'],
      rules: [
        'Reject the trade before valuation if either post-trade roster violates the cap ceiling or an enforced floor.',
        'Value the player and contract together: salary, remaining years, surplus versus replacement, and exit cost.',
        'Include dead money, rollover, extensions, franchise tags, rookie options, and free-agent purchasing power when enabled.',
        'Keep current title impact separate from future contract surplus so the same benefit is not counted twice.',
      ],
    }
  }

  if (concept === 'tournament') {
    return {
      version: TRADE_GRADING_POLICY_VERSION,
      format: 'tournament',
      lifecycle: 'single_season',
      eligibility,
      objective: 'Improve advancement probability before the current roster expires at the next tournament redraft.',
      primaryOutcome: 'advancement_probability',
      rosterMethod: 'submitted_lineup',
      allowsFuturePicks: false,
      requiredEvidence: [
        ...COMMON_REQUIRED,
        'advancement_rules',
        'format_phase',
        'roster_expiry',
        'as_of_projections',
        'paired_outcome_simulation',
      ],
      supportingEvidence: [...COMMON_SUPPORTING, 'faab_market'],
      rules: [
        'The supplied Black and Gold tournament rules prohibit trades and draft-pick trading; return ineligible before valuation.',
        'For an enabled variant, stop all acquired value at the next redraft because the roster does not carry forward.',
        'Use qualification, bubble, single-elimination, and championship-round advancement rules rather than season-long playoff odds.',
        'Price byes, weekly ceiling, opponent, remaining games, and FAAB reset inside the current short window.',
      ],
    }
  }

  if (concept === 'zombie') {
    return {
      version: TRADE_GRADING_POLICY_VERSION,
      format: 'zombie',
      lifecycle: 'single_season',
      eligibility,
      objective: 'Improve expected payout and survival after infection risk, team state, items, and the shrinking legal trade market.',
      primaryOutcome: 'infection_adjusted_survival',
      rosterMethod: 'submitted_lineup',
      allowsFuturePicks: true,
      requiredEvidence: [
        ...COMMON_REQUIRED,
        'infection_state',
        'counterparty_state',
        'trade_window',
        'immunity_and_items',
        'as_of_projections',
        'paired_outcome_simulation',
      ],
      supportingEvidence: [...COMMON_SUPPORTING, 'format_phase'],
      rules: [
        'If zombie trading is blocked, every participant must be a Survivor or active Whisperer when the matchup is final; otherwise the trade is ineligible.',
        'Include serum, weapon, ambush, infection, revival, weekly-money, bashing, and mauling consequences that the league has enabled.',
        'Use the league’s near-free instant replacement market when pricing depth.',
        'Model the chance the trade becomes unavailable after infection and the commissioner-vote reversal risk separately from fairness.',
      ],
    }
  }

  if (concept === 'survivor') {
    return {
      version: TRADE_GRADING_POLICY_VERSION,
      format: 'survivor',
      lifecycle: 'single_season',
      eligibility,
      objective: 'Improve the manager’s chance to reach the jury outcome and win, under the current tribe, vote, challenge, and merge state.',
      primaryOutcome: 'jury_win_probability',
      rosterMethod: 'submitted_lineup',
      allowsFuturePicks: true,
      requiredEvidence: [
        ...COMMON_REQUIRED,
        'format_phase',
        'trade_window',
        'counterparty_state',
        'tribe_relationship',
        'immunity_and_items',
        'as_of_projections',
        'paired_outcome_simulation',
      ],
      supportingEvidence: [...COMMON_SUPPORTING, 'faab_market'],
      rules: [
        'Enforce cross-tribe, within-tribe, played-player, Tribal Council, and eliminated-team timing rules before valuation.',
        'Pre-merge, value the effect on the whole tribe and voting position; post-merge, value individual immunity and jury path.',
        'Apply idol, swap, Exile, FAAB, challenge, and host-defined advantages only when their ownership and deadlines are known.',
        'Void a pending deal when the supplied rules send an eliminated team’s assets to waivers before execution.',
      ],
    }
  }

  if (concept === 'king_of_the_hill' || concept === 'koth') {
    return {
      version: TRADE_GRADING_POLICY_VERSION,
      format: 'king_of_the_hill',
      lifecycle: 'single_season',
      eligibility,
      objective: 'Improve championship odds after the expected crown bonus, dethroning risk, three-player waiver penalty, and playoff cutoff.',
      primaryOutcome: 'crown_adjusted_championship_odds',
      rosterMethod: 'submitted_lineup',
      allowsFuturePicks: false,
      requiredEvidence: [
        ...COMMON_REQUIRED,
        'format_phase',
        'crown_holder',
        'matchup_state',
        'weekly_score_distributions',
        'faab_market',
        'as_of_projections',
        'paired_outcome_simulation',
      ],
      supportingEvidence: COMMON_SUPPORTING,
      rules: [
        'Week 1’s top scorer becomes King and receives +10 points each week until losing; the mechanic ends when playoffs begin.',
        'When the King loses, release that King roster’s three highest scorers from that week to waivers, then use the league’s normal claim process.',
        'The top scorer of the loss week becomes the new King.',
        'For the current King, price expected +10 bonuses against the probability and expected cost of losing three weekly top scorers.',
        'For every other team, include the probability of gaining the crown and acquiring released players through the actual FAAB or waiver market.',
      ],
    }
  }

  if (concept === 'pirate' || concept === 'pirate_vampire') {
    return {
      version: TRADE_GRADING_POLICY_VERSION,
      format: 'pirate',
      lifecycle: 'single_season',
      eligibility,
      objective: 'Improve championship odds after weekly win-and-steal outcomes and the value exposed outside three protection slots.',
      primaryOutcome: 'steal_adjusted_championship_odds',
      rosterMethod: 'submitted_lineup',
      allowsFuturePicks: null,
      requiredEvidence: [
        ...COMMON_REQUIRED,
        'trade_window',
        'protection_state',
        'steal_exposure',
        'matchup_state',
        'weekly_score_distributions',
        'as_of_projections',
        'paired_outcome_simulation',
      ],
      supportingEvidence: [...COMMON_SUPPORTING, 'format_phase'],
      rules: [
        'Block all trades from the start of the Thursday game until the Monday games end.',
        'Each manager may protect exactly three players; every unprotected starter, bench player, and IR player is eligible to be stolen.',
        'The weekly matchup winner chooses one player from the loser’s unprotected roster.',
        'Value an incoming player by whether the manager can place him inside the three-player shield and by the value displaced from protection.',
        'Simulate both the ordinary scoring change and the changed probability and cost of winning or losing future steals.',
      ],
    }
  }

  if (concept === 'guillotine') {
    const automaticLineup = input.bestBall
    return {
      version: TRADE_GRADING_POLICY_VERSION,
      format: 'guillotine',
      lifecycle: 'single_season',
      eligibility,
      objective: 'Reduce the team’s probability of being the lowest scorer in each remaining elimination period.',
      primaryOutcome: 'survival_probability',
      rosterMethod: automaticLineup ? 'automatic_optimal_lineup' : 'submitted_lineup',
      allowsFuturePicks: false,
      requiredEvidence: [
        ...COMMON_REQUIRED,
        'as_of_projections',
        'paired_outcome_simulation',
        'field_and_chop_line',
        ...(automaticLineup ? (['best_ball_weekly_distribution'] as const) : []),
      ],
      supportingEvidence: [...COMMON_SUPPORTING, 'faab_market'],
      rules: [
        'Do not use playoff probability; guillotine has no standard playoffs.',
        'Compare survival probability before and after the trade with the same simulation scenarios.',
        'Weight the weekly scoring floor, teams remaining, eliminations per period, distance from the chop line, and remaining weeks.',
        'Treat FAAB as an acquisition asset using this league’s observed winning bids when enough observations exist.',
        automaticLineup
          ? 'Because this league also uses best ball, compute survival from the automatically optimized whole roster rather than a submitted lineup.'
          : 'Compute survival from the league’s legal submitted lineup and replacement options.',
        'Refuse a contextual grade when trades are disabled or their status at the trade time is unknown.',
      ],
    }
  }

  if (input.bestBall) {
    const dynasty = concept === 'dynasty'
    return {
      version: TRADE_GRADING_POLICY_VERSION,
      format: 'best_ball',
      lifecycle: dynasty ? 'multi_season' : 'single_season',
      eligibility,
      objective: dynasty
        ? 'Improve automatically selected weekly scoring and the multi-year roster without requiring start/sit choices.'
        : 'Improve automatically selected weekly scoring over the rest of this season.',
      primaryOutcome: 'optimal_roster_points',
      rosterMethod: 'automatic_optimal_lineup',
      allowsFuturePicks: dynasty,
      requiredEvidence: [...COMMON_REQUIRED, 'as_of_projections', 'best_ball_weekly_distribution'],
      supportingEvidence: [...COMMON_SUPPORTING, 'paired_outcome_simulation'],
      rules: [
        'Check the league trade setting first; most best-ball products disable trades by default.',
        'Recalculate the legal optimal lineup from the entire roster for every scoring period.',
        'Measure spike-week contribution, depth, position fragility, bye overlap, and same-team correlation from observed or sourced data.',
        'Do not apply submitted-lineup or starter-versus-bench logic.',
        dynasty
          ? 'Retain dynasty age, rookie-pick, taxi, and multi-year horizon rules in addition to best-ball roster construction.'
          : 'Ignore value beyond the current season and reject future-season draft picks as assets.',
      ],
    }
  }

  if (concept === 'dynasty') {
    return {
      version: TRADE_GRADING_POLICY_VERSION,
      format: 'dynasty',
      lifecycle: 'multi_season',
      eligibility,
      objective: 'Improve the manager’s current title odds and multi-year championship window.',
      primaryOutcome: 'championship_window',
      rosterMethod: 'submitted_lineup',
      allowsFuturePicks: true,
      requiredEvidence: [...COMMON_REQUIRED, 'as_of_projections', 'paired_outcome_simulation'],
      supportingEvidence: COMMON_SUPPORTING,
      rules: [
        'Carry the entire roster, rookie picks, taxi rules, age curve, and league scoring across multiple seasons.',
        'Evaluate contender, competitive, and rebuilding teams against their own window; never assume every manager has the same horizon.',
        'Keep current playoff-odds impact separate from three- and five-year roster value so draft capital is not counted twice.',
        'Price only draft-pick seasons and rounds that the league could legally trade at that time.',
      ],
    }
  }

  return {
    version: TRADE_GRADING_POLICY_VERSION,
    format: 'redraft',
    lifecycle: 'single_season',
    eligibility,
    objective: 'Improve rest-of-season starting output and playoff/championship probability for this team.',
    primaryOutcome: 'playoff_probability',
    rosterMethod: 'submitted_lineup',
    allowsFuturePicks: false,
    requiredEvidence: [...COMMON_REQUIRED, 'as_of_projections', 'paired_outcome_simulation'],
    supportingEvidence: COMMON_SUPPORTING,
    rules: [
      'Use only the current season; player value does not carry into the next redraft.',
      'Recalculate the legal lineup and replacement-level alternatives under this league’s scoring and roster slots.',
      'Compare playoff probability before and after the trade with the same simulation scenarios.',
      'Reject future-season draft picks as nonexistent assets; current draft picks are relevant only before that season’s draft.',
    ],
  }
}

export function historicalEvidenceIsAsOfTrade(input: {
  tradeCreatedAt: string
  evidenceCapturedAt: string | null | undefined
  /** Evidence-specific freshness window; omitted only checks for future leakage. */
  maxAgeMs?: number
}): boolean {
  const tradeAt = Date.parse(input.tradeCreatedAt)
  const capturedAt = Date.parse(String(input.evidenceCapturedAt ?? ''))
  if (!Number.isFinite(tradeAt) || !Number.isFinite(capturedAt)) return false
  // A pre-trade snapshot or one captured in the same transaction is valid.
  const age = tradeAt - capturedAt
  if (age < 0) return false
  return input.maxAgeMs == null || age <= input.maxAgeMs
}
