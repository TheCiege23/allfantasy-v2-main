import type { CommissionerPlatformResponse, CommissionerRecommendationContract } from '../../contracts'
import type { SeverityTier } from '../../tokens/colors'

/**
 * 🛑 THIS CONTRACT USED TO DESCRIBE A SCORING MODEL THAT DOES NOT EXIST, AND THAT IS WHY
 * THREE OF THE FOUR LIVE METHODS WERE PERMANENT PLACEHOLDERS.
 *
 * It asked for `baseline: number` and `deductions: { label, points }[]` — a baseline-minus-penalties
 * decomposition — plus `subScores` for engagement, retention, competitive balance and risk. The real
 * intelligence pipeline computes ONE number (`leagueEngagementScore`) and no decomposition
 * whatsoever. `retentionRisk` is a category (low/medium/high/critical), not a score, and no
 * standings or competitive-balance signal exists anywhere in behavioural intelligence.
 *
 * A live client cannot satisfy that shape without inventing the story it tells: a fabricated
 * `baseline: 100` with deductions reverse-engineered to reach the real score would present a false
 * causal account of the score, and four `subScores` where one exists would present three invented
 * numbers with the same visual weight as the true one. So the client returned an honest error
 * instead, and League Health showed a commissioner nothing at all.
 *
 * Narrowed to what is actually computed. The fields below are each traceable to a value the
 * intelligence API returns; the decomposition is gone rather than faked. Building the model is a
 * real product decision and a much larger piece of work — this contract no longer pretends it has
 * already happened.
 */
export interface LeagueHealthDetail {
  /** The one real computed number: `leagueEngagementScore`, 0-100. */
  score: number
  tier: SeverityTier
  /**
   * Category-valued on purpose. Decision OS bands retention risk rather than scoring it, so this is
   * a band; rendering it as a number would invent precision the pipeline does not have.
   */
  retentionRisk: SeverityTier
  /** Same shape, same reason. How much this league is asking of its commissioner right now. */
  commissionerWorkload: SeverityTier
  /**
   * ⚠ `totalManagers` IS NOT THE LEAGUE'S TEAM COUNT. It counts managers with at least one event
   * inside the intelligence lookback window, so a manager who did nothing is absent from the
   * denominator and the ratio moves as the window slides. The label that renders it has to say so —
   * see the identical note in League Analytics' `buildKpis`.
   */
  participation: { activeManagers: number; totalManagers: number }
  /**
   * Data-quality score for this league, 0-100 — how much of what the pipeline wanted it actually
   * had. Deliberately NOT presented as confidence in any single finding; it is a property of the
   * inputs, not of a conclusion.
   */
  completeness: number
}

export interface LeagueHealthRisk {
  id: string
  description: string
  severity: SeverityTier
  category: string
  /**
   * Both optional, and both stay absent on every live read today.
   *
   * They imply persisted risk-lifecycle tracking — when a risk was first seen, and whether it is
   * new, ongoing or resolving. Decision OS recomputes risks from the current event window on every
   * request, so there is no first-seen timestamp and no status machine to read. Required fields here
   * were what made `getRisks()` unimplementable; optional ones let the real risks through now and
   * become populated the day something persists a lifecycle (P3).
   */
  ageInDays?: number
  status?: 'new' | 'ongoing' | 'resolving'
}

export interface LeagueHealthEvidencePoint {
  label: string
  detail: string
}

/** League Health owns all League Health intelligence — Mission Control and every other consumer reach it only through this interface. */
export interface LeagueHealthClient {
  getHealthDetail(): Promise<CommissionerPlatformResponse<LeagueHealthDetail>>
  getRisks(): Promise<CommissionerPlatformResponse<LeagueHealthRisk[]>>
  getEvidence(): Promise<CommissionerPlatformResponse<LeagueHealthEvidencePoint[]>>
  getRecommendations(): Promise<CommissionerPlatformResponse<CommissionerRecommendationContract[]>>
}
