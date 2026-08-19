/**
 * Decision OS — World Resolution for `manager.trade.evaluate` (Slice 3).
 *
 * READ-ONLY. Shapes ALREADY-LOADED trade facts (resolved by the route-seam loader) into a neutral
 * two-sided World: trade settings, deadline, both rosters' resource context, snapshot availability.
 * No prisma, no writes, no settlement/execution imports. The deterministic value verdict itself is
 * the persisted snapshot (the evaluation memo) — the World only carries the surrounding context.
 *
 * Honesty contract: the deadline/lock is an approximation here (precise enforcement is a RULE at
 * proposal time), surfaced with explicit provenance + uncertainty.
 */

export interface TradeSettingsFacts {
  reviewType: string
  tradeReviewHours: number | null
  tradeDeadlineWeek: number | null
  draftPickTrading: boolean
}

/** Per-roster resource/standings context (read-only). */
export interface TradeRosterFacts {
  rosterId: string
  faabBalance: number | null
  wins: number | null
  losses: number | null
  ties: number | null
  pointsFor: number | null
  playoffSeed: number | null
}

export interface TradeDeadlineState {
  passed: boolean
  week: number | null
  provenance: 'derived_approximate'
  uncertainty: string | null
}

export interface TradeWorld {
  sport: string
  leagueId: string
  seasonId: string
  currentWeek: number
  settings: TradeSettingsFacts
  proposer: TradeRosterFacts
  receiver: TradeRosterFacts
  /**
   * ALL participating rosters (multi-team capable). For a two-team trade this is [proposer, receiver];
   * future 3+ team trades populate every participant. Per-participant FAAB/legality rules iterate this.
   */
  participants: TradeRosterFacts[]
  deadline: TradeDeadlineState
  /** Whether the authoritative deterministic snapshot (the evaluation memo) was available. */
  snapshotAvailable: boolean
}

export interface TradeWorldInput {
  sport: string
  leagueId: string
  seasonId: string
  currentWeek: number
  settings: TradeSettingsFacts
  proposer: TradeRosterFacts
  receiver: TradeRosterFacts
  /** Optional — defaults to [proposer, receiver] for two-team trades. */
  participants?: TradeRosterFacts[]
  snapshotAvailable: boolean
}

/** Pure, read-only trade World Resolution. */
export function resolveTradeWorld(input: TradeWorldInput): TradeWorld {
  const deadlineWeek = input.settings.tradeDeadlineWeek
  const passed = deadlineWeek != null && input.currentWeek > deadlineWeek
  return {
    sport: input.sport,
    leagueId: input.leagueId,
    seasonId: input.seasonId,
    currentWeek: input.currentWeek,
    settings: input.settings,
    proposer: input.proposer,
    receiver: input.receiver,
    participants: input.participants ?? [input.proposer, input.receiver],
    deadline: {
      passed,
      week: deadlineWeek,
      provenance: 'derived_approximate',
      uncertainty: 'Trade deadline/lock is approximated from the league week; precise enforcement is at proposal time.',
    },
    snapshotAvailable: input.snapshotAvailable,
  }
}
