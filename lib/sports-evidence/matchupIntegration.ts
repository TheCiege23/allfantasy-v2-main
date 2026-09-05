import 'server-only'
/**
 * Fantasy OS Phase 5E-g — shared certified Matchup integration service (Workstream A).
 *
 * Server-only. Reads the certified GAMES snapshot (schedule + game status) for a season/week and exposes it as
 * informational evidence + a finality-evidence signal. It does NOT reimplement matchup state rules, scoring,
 * playoff, or finalization logic, and it NEVER computes fantasy points. It supplies verified GAME facts only:
 * canonical game/team identity, scheduled start, game status, finality, schedule freshness, snapshot version.
 *
 * Unlike the player-level services, matchup finality operates at the GAME level, so the teamless-players
 * limitation does not apply — the certified games snapshot is real and complete.
 */
import { SportsRuntimeStore } from '@/lib/sports-data-gateway/runtime/store'
import { getCertifiedSchedule } from '@/lib/sports-data-gateway/runtime/scheduleRuntime'
import { buildCertifiedFreshness } from '@/lib/sports-data-gateway/runtime/freshnessPure'

/** Fields the certified GAMES plane does not provide for a matchup — surfaced explicitly, never fabricated. */
export const MATCHUP_UNSUPPORTED = {
  liveFantasyScore: 'unavailable',
  projection: 'unavailable',
  injury: 'unavailable',
  winProbability: 'unavailable',
  playerAvailability: 'unavailable',
  inferredWinner: 'unavailable',
  inferredPlayoffAdvancement: 'unavailable',
} as const

export type CertifiedMatchupGameState = {
  canonicalGameId: string
  homeTeamId: string
  awayTeamId: string
  scheduledStart: string
  status: string
  final: boolean
}

export type CertifiedMatchupContext = {
  available: boolean
  freshnessStatus: string
  snapshotVersion: string | null
  totalGames: number
  finalGames: number
  allGamesFinal: boolean
  games: CertifiedMatchupGameState[]
  unsupported: typeof MATCHUP_UNSUPPORTED
}

export type MatchupFinalityEvidence = {
  /** True only when the certified games snapshot is present, all games are final, and freshness is current. */
  certifiedAllGamesFinal: boolean
  unresolvedGames: number
  trustworthy: boolean
  freshnessStatus: string
  snapshotVersion: string | null
  /** Whether certified evidence can SUPPORT (never cause) a stricter finalization decision. Never finalizes alone. */
  canSupportFinalization: boolean
  reason: string
}

export class CertifiedMatchupIntegrationService {
  constructor(private store = new SportsRuntimeStore()) {}

  /** Informational certified game states for a matchup week (identity/status/finality/freshness). Never blocks. */
  async describeMatchupGameStates(input: { season: string; week: string | null; now?: Date }): Promise<CertifiedMatchupContext> {
    const now = input.now ?? new Date()
    let games
    let meta
    try {
      games = await getCertifiedSchedule(this.store, input.season, input.week)
      meta = await this.store.getCertifiedSnapshotMeta('NFL', 'games', `${input.season}-w${input.week ?? 'x'}`)
    } catch {
      return { available: false, freshnessStatus: 'unavailable', snapshotVersion: null, totalGames: 0, finalGames: 0, allGamesFinal: false, games: [], unsupported: MATCHUP_UNSUPPORTED }
    }
    if (!meta || games.length === 0) {
      return { available: false, freshnessStatus: 'unavailable', snapshotVersion: null, totalGames: 0, finalGames: 0, allGamesFinal: false, games: [], unsupported: MATCHUP_UNSUPPORTED }
    }
    const freshness = buildCertifiedFreshness(meta, now)
    const mapped: CertifiedMatchupGameState[] = games.map((g) => ({
      canonicalGameId: g.canonicalGameId,
      homeTeamId: g.homeTeamId,
      awayTeamId: g.awayTeamId,
      scheduledStart: g.scheduledStart,
      status: g.status,
      final: g.status === 'final',
    }))
    const finalGames = mapped.filter((g) => g.final).length
    return {
      available: true,
      freshnessStatus: freshness.freshnessStatus,
      snapshotVersion: meta.version ?? null,
      totalGames: mapped.length,
      finalGames,
      allGamesFinal: mapped.length > 0 && finalGames === mapped.length,
      games: mapped,
      unsupported: MATCHUP_UNSUPPORTED,
    }
  }

  /** Alias — informational certified matchup sports context (game-level). */
  async describeMatchupSportsContext(input: { season: string; week: string | null; now?: Date }): Promise<CertifiedMatchupContext> {
    return this.describeMatchupGameStates(input)
  }

  /**
   * Finality evidence. Certified game finality may only make finalization STRICTER — a final provider game
   * status alone must never finalize a fantasy matchup. `canSupportFinalization` is true only when certified
   * evidence is trustworthy AND every game is final; the existing finalization authority still decides.
   */
  async evaluateMatchupFinalityEvidence(input: { season: string; week: string | null; now?: Date }): Promise<MatchupFinalityEvidence> {
    const ctx = await this.describeMatchupGameStates(input)
    const trustworthy = ctx.available && ctx.freshnessStatus === 'current'
    const canSupportFinalization = trustworthy && ctx.allGamesFinal
    return {
      certifiedAllGamesFinal: ctx.available && ctx.allGamesFinal,
      unresolvedGames: ctx.totalGames - ctx.finalGames,
      trustworthy,
      freshnessStatus: ctx.freshnessStatus,
      snapshotVersion: ctx.snapshotVersion,
      canSupportFinalization,
      reason: !ctx.available
        ? 'certified games snapshot unavailable — existing finalization authority remains final'
        : !trustworthy
          ? `certified games ${ctx.freshnessStatus} — evidence not trustworthy enough to tighten finalization`
          : ctx.allGamesFinal
            ? 'certified evidence: all games final (may support, never cause, finalization)'
            : `certified evidence: ${ctx.totalGames - ctx.finalGames} game(s) not final`,
    }
  }
}
