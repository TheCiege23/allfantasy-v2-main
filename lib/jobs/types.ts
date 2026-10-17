/**
 * Background job types — queue names and payload shapes for BullMQ.
 */

export const QUEUE_NAMES = {
  AI: "ai",
  NOTIFICATIONS: "notifications",
  SIMULATIONS: "simulations",
  DEVY: "devy",
  INTEGRITY: "integrity",
  AUTOCOACH_STATUS: "autocoach_status",
  /** Heavy league-engine work: waivers, scoring batches, automation, import resync (BullMQ). */
  LEAGUE_ENGINE: "league_engine",
} as const

export type QueueName = (typeof QUEUE_NAMES)[keyof typeof QUEUE_NAMES]

/** Payload for notification jobs: dispatch in-app + optional email/SMS/push. */
export interface NotificationJobPayload {
  userIds: string[]
  category: string
  productType?: "shared" | "app" | "bracket" | "legacy"
  type: string
  title: string
  body?: string
  actionHref?: string
  actionLabel?: string
  meta?: Record<string, unknown>
  severity?: "low" | "medium" | "high"
}

/** AI job types; payload is type-specific. */
export type AiJobType =
  | "trade_analysis"
  | "waiver_analysis"
  | "draft_insight"
  | "digest"
  | "autocoach_pregame_scan"
  | "autocoach_status_check"

export interface AiJobPayload {
  type: AiJobType
  userId?: string
  leagueId?: string
  /** e.g. autocoach: `{ rosterId?, gameSlateDate?, sport? }` */
  payload: Record<string, unknown>
}

/** Simulation job payload (e.g. mock draft). */
export interface SimulationJobPayload {
  leagueId?: string
  rounds?: number
  draftType?: string
  [key: string]: unknown
}

/** Devy Dynasty / C2C background job types (NCAA sync, graduation, pools, snapshots, rankings, C2C). */
export type DevyJobType =
  | "ncaa_player_sync"
  | "declare_status_refresh"
  | "auto_graduation_after_draft"
  | "rookie_pool_generation"
  | "devy_pool_generation"
  | "promotion_window_sync"
  | "rookie_draft_exclusion_list"
  | "best_ball_lineup_snapshot"
  | "rankings_refresh_after_promotions"
  | "class_strength_snapshot"
  | "hybrid_standings_recompute"
  | "c2c_pipeline_recalculation"

export interface DevyJobPayload {
  type: DevyJobType
  leagueId?: string
  sport?: string
  seasonYear?: number
  rosterId?: string
  periodKey?: string
  [key: string]: unknown
}

/** Integrity / collusion / tanking background jobs (BullMQ). */
export type IntegrityJobType =
  | "collusion_scan_trade"
  | "collusion_scan_league"
  | "tanking_scan_week"
  | "tanking_scan_league"

export interface IntegrityJobPayload {
  type: IntegrityJobType
  leagueId: string
  tradeTransactionId?: string
  /** The real trade a collusion scan reviews. A job without one (queued before 2026-09-27) is skipped. */
  tradeRef?: { kind: "af"; tradeId: string } | { kind: "redraft"; proposalId: string }
  tradingRosterIds?: string[]
  weekNumber?: number
  seasonId?: string
}

/** AutoCoach multi-source status intelligence (BullMQ). */
export interface AutoCoachStatusJobPayload {
  type: "status_scan_all_sports" | "status_scan_sport" | "status_scan_player"
  sport?: string
  playerId?: string
  gameDate?: string
}

/** Processed by `lib/workers/league-engine-worker.ts` — keep payloads JSON-serializable. */
export type LeagueEngineJobKind =
  | "waiver_process"
  | "scoring_week"
  | "standings_refresh"
  | "specialty_automation"
  | "import_resync"
  | "notification_fanout"
  | "stat_correction"

export interface LeagueEngineJobPayload {
  kind: LeagueEngineJobKind
  /** Required for all kinds except optional fanout-only jobs that are global. */
  leagueId?: string
  idempotencyKey?: string
  /** Kind-specific parameters (season, week, trigger id, etc.). */
  payload?: Record<string, unknown>
}
