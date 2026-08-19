import 'server-only'
/**
 * Fantasy OS Phase 5E-g — shared certified Scoring integration service (Workstream B).
 *
 * Server-only. Provides certified GAME-CONTEXT evidence (identity/status/finality/freshness) for scoring and
 * finalization paths, and a finality guard that can only make finalization STRICTER — it never finalizes on its
 * own and never computes or supplies fantasy points.
 *
 * TRUTH ABOUT CERTIFIED STATISTICS: the Sports Data Gateway lists a `statistics` capability NAME in its
 * capability enum, but there is NO adapter/runtime that produces certified player statistics (verified: no
 * consumer in lib/sports-data-gateway/{runtime,providers,gateway}.ts). The certified plane implements
 * players / rosters / transactions / games / draft_data only. Therefore this service does NOT provide a
 * player-stat capability; `describeStatSourceAvailability()` reports that honestly. The existing scoring inputs
 * (PlayerGameLogCache / PlayerWeeklyScore / provider-normalized stat tables) remain the sole authoritative
 * fantasy-point inputs and are never replaced by schedule/game data.
 */
import { CertifiedMatchupIntegrationService, type CertifiedMatchupContext, type MatchupFinalityEvidence } from './matchupIntegration'

export type StatSourceAvailability = {
  /**
   * Honest capability report. Phase 5F-a: certified player-game statistics now EXIST as a certified data
   * capability (`certified-not-scoring-input`) but are deliberately NOT yet a scoring input — the scoring engine
   * still computes fantasy points from its existing inputs. Switching scoring to certified stats is a later phase.
   */
  certifiedPlayerStatistics: 'certified-not-scoring-input'
  certifiedGameContext: 'available'
  /** The existing, authoritative fantasy-point inputs (unchanged by this service). */
  authoritativeStatInputs: string[]
  note: string
}

export type ScoringFinalityDecision = {
  /** Certified evidence can only ALLOW finalization to proceed (stricter). It never declares scoring complete. */
  certifiedGamesSupportFinalization: boolean
  certifiedAllGamesFinal: boolean
  unresolvedGames: number
  trustworthy: boolean
  freshnessStatus: string
  snapshotVersion: string | null
  reason: string
}

export class CertifiedScoringIntegrationService {
  constructor(private matchup = new CertifiedMatchupIntegrationService()) {}

  /** Certified GAME context for a scoring week (identity/status/finality/freshness). Never player stats. */
  async describeScoringGameContext(input: { season: string; week: string | null; now?: Date }): Promise<CertifiedMatchupContext> {
    return this.matchup.describeMatchupGameStates(input)
  }

  /** Honest report: certified player statistics are NOT implemented; existing stat inputs remain authoritative. */
  describeStatSourceAvailability(): StatSourceAvailability {
    return {
      certifiedPlayerStatistics: 'certified-not-scoring-input',
      certifiedGameContext: 'available',
      authoritativeStatInputs: ['PlayerGameLogCache', 'PlayerWeeklyScore', 'provider-normalized stat tables'],
      note: 'Certified player-game statistics now exist (ESPN box scores, append-only certified snapshots) but are NOT yet a scoring input. Fantasy points are still computed solely by the existing scoring engine from its existing stat inputs; switching scoring to certified statistics is a later certification phase.',
    }
  }

  /**
   * Finality guard for scoring. Returns whether certified GAME evidence can SUPPORT finalization proceeding
   * (all games final + trustworthy). It never finalizes on its own and never changes scores — a final provider
   * game status alone must not finalize a fantasy matchup. Fails open (supports=false → existing authority final).
   */
  async evaluateScoringFinalityEvidence(input: { season: string; week: string | null; now?: Date }): Promise<ScoringFinalityDecision> {
    const ev: MatchupFinalityEvidence = await this.matchup.evaluateMatchupFinalityEvidence(input)
    return {
      certifiedGamesSupportFinalization: ev.canSupportFinalization,
      certifiedAllGamesFinal: ev.certifiedAllGamesFinal,
      unresolvedGames: ev.unresolvedGames,
      trustworthy: ev.trustworthy,
      freshnessStatus: ev.freshnessStatus,
      snapshotVersion: ev.snapshotVersion,
      reason: ev.reason,
    }
  }
}
