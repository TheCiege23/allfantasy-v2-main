/**
 * Decision OS Core — universal, sport-agnostic primitives (Phase 1).
 *
 * These are pure data shapes. No I/O, no sport branching, no imports from any
 * live route or engine. Every field that could tempt a sport-specific enum
 * (position, schedule unit, scoring mode, bracket type) is deliberately typed
 * as an open string or a small set of format-neutral literals — the concrete
 * vocabulary comes from a `SportAdapter` (see `../sport-adapter/types.ts`),
 * never from this file.
 *
 * Nothing in `lib/decision-os-core/` is imported by any existing route, engine,
 * or the `lib/decision-os/` slices yet — see docs/DECISION_OS_CORE_UNIFICATION_PLAN.md §18.
 */

// ── Sport ─────────────────────────────────────────────────────────────────

export interface Sport {
  /** e.g. "NFL", "NCAAF", "MLB" — data, never branched on directly by callers. */
  key: string
  displayName: string
}

// ── Season / Competition / League / Contest ──────────────────────────────

export interface Season {
  id: string
  sportKey: string
  label: string
  startDate: string | null
  endDate: string | null
}

/**
 * The umbrella format concept: a season-long league, a single-slate contest,
 * a bracket tournament, etc. `League` and `Contest` are both specializations.
 */
export interface Competition {
  id: string
  sportKey: string
  competitionType: string
  seasonId: string | null
}

/** A persistent, season-scoped competition (redraft/dynasty/keeper/etc.). */
export interface League extends Competition {
  format: string
  isDynasty: boolean
  size: number
}

/**
 * A lightweight, non-persistent sibling of `League` for single-slate / short-lived
 * formats (DFS, pick'em) that have no roster continuity across periods.
 * Net-new primitive — nothing in the codebase implements this today
 * (docs/DECISION_OS_CORE_UNIFICATION_PLAN.md §6).
 */
export interface Contest extends Competition {
  entryFee: number | null
  maxEntries: number | null
  lockAt: string | null
}

// ── Event ─────────────────────────────────────────────────────────────────

/** A real-world occurrence a decision may reference (a game, a lock, a deadline). */
export interface Event {
  id: string
  competitionId: string
  startTime: string | null
  status: string
}

// ── Participant / Team / Player ───────────────────────────────────────────

/** Anything that can hold a roster and appear in a matchup/standing. */
export interface Participant {
  id: string
  competitionId: string
  ownerUserId: string | null
  displayName: string
}

export interface Team extends Participant {
  rosterId: string | null
}

export interface Player {
  id: string
  name: string
  /** Free-form string, never an enum — matches Canonical World's existing treatment. */
  position: string | null
  sportKey: string
  teamAbbrev: string | null
}

// ── Roster / Slot ─────────────────────────────────────────────────────────

/** A single slot definition within a roster template (mirrors RosterSlotDefinition). */
export interface Slot {
  key: string
  label: string
  /** Open category — never a hardcoded football-centric enum (kicker/dst/idp/college). */
  category: string
  minCount: number
  maxCount: number
  defaultCount: number
}

export interface Roster {
  id: string
  participantId: string
  templateKey: string
  slots: Slot[]
  /** playerId -> slotKey assignment. */
  assignments: Record<string, string>
}

// ── Asset / Transaction ────────────────────────────────────────────────────

export type AssetType =
  | 'player'
  | 'draft_pick'
  | 'faab'
  | 'contract'
  | 'keeper'
  | 'salary'
  | 'devy'
  | 'future_consideration'

export interface Asset {
  id: string
  assetType: AssetType
  ownerParticipantId: string | null
  /** Present only when assetType === 'player'. */
  playerId: string | null
  /** Present only when assetType === 'faab' or 'salary'. */
  amount: number | null
  metadata?: Record<string, unknown>
}

export type TransactionType = 'trade' | 'waiver_claim' | 'free_agent_add' | 'commissioner_move' | 'draft_pick'

export interface Transaction {
  id: string
  transactionType: TransactionType
  competitionId: string
  participantIds: string[]
  assets: Asset[]
  occurredAt: string
  status: 'proposed' | 'accepted' | 'rejected' | 'processed' | 'reversed'
}

// ── Draft / Pick ────────────────────────────────────────────────────────────

/** Format-neutral draft mode; concrete variant metadata lives in draftTypeRegistry. */
export type DraftMode = 'snake' | 'linear' | 'auction'

export interface Draft {
  id: string
  competitionId: string
  draftType: string
  mode: DraftMode
  totalRounds: number
  totalPicks: number
}

export interface Pick {
  id: string
  draftId: string
  overallPick: number
  round: number
  participantId: string | null
  playerId: string | null
}

// ── RuleSet / ScoringModel / ScheduleModel / StandingsModel / PlayoffModel ─

export interface RuleSet {
  competitionId: string
  rosterRules: { slots: Slot[] }
  scoringRules: ScoringModel
  scheduleRules: ScheduleModel
  playoffRules: PlayoffModel | null
  waiverRules: WaiverModel | null
  tradeRules: TradeModel | null
}

export type ScoringMode = 'points' | 'h2h_category' | 'roto'

export interface ScoringModel {
  mode: ScoringMode
  /** This sport's valid stat keys — replaces per-sport hardcoded enums. */
  statVocabulary: string[]
  rules: Record<string, number>
}

/**
 * Generalizes the currently week-hardcoded schedule engine
 * (docs/DECISION_OS_CORE_UNIFICATION_PLAN.md §7.2).
 */
export type ScheduleUnit = 'week' | 'round' | 'slate' | 'series' | 'continuous'

export interface ScheduleModel {
  unit: ScheduleUnit
  periodCount: number | null
  matchupFrequency: 'weekly' | 'daily' | 'round' | 'slate'
}

export interface StandingsModel {
  competitionId: string
  /** Ranked participant IDs, best to worst. */
  ranking: string[]
  tiebreaker: string
}

export type CompetitionStructure =
  | 'season_long_h2h'
  | 'bracket_elimination'
  | 'single_slate'
  | 'roto_standings'
  | 'best_of_n_series'

export interface PlayoffModel {
  structure: CompetitionStructure
  qualifyingParticipantIds: string[]
  seeding: Record<string, number>
}

export type WaiverType = 'faab' | 'priority'

export interface WaiverModel {
  waiverType: WaiverType
  claimWindowHours: number | null
  faabBudget: number | null
}

export interface TradeModel {
  deadlineEventId: string | null
  vetoMode: 'commissioner' | 'league_vote' | 'no_veto'
  maxParticipants: number
}

// ── Recommendation / Insight / Simulation (base shapes) ────────────────────
//
// These are the lightweight primitive shapes. The richer envelopes that pair
// them with Decision OS's evidence/confidence contracts (`RecommendationResult`,
// `InsightResult`, `SimulationResult`) live in `../results/types.ts`.

export interface Recommendation {
  id: string
  targetParticipantId: string | null
  actionType: string
  summary: string
}

export interface Insight {
  id: string
  subjectId: string
  summary: string
  confidence: number
}

export interface Simulation {
  id: string
  competitionId: string
  simulationType: string
  scenarioCount: number
}

// ── DecisionEvent ────────────────────────────────────────────────────────
//
// Re-exported here so the full primitive vocabulary is available from one
// entry point; the canonical definition lives in `../events/types.ts` since
// it generalizes the existing `BehavioralEvent` taxonomy in `lib/decision-os/behavioral`.

export type { DecisionEvent } from '../events/types'
