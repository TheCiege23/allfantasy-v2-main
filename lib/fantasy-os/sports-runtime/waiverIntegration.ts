import 'server-only'
/**
 * Fantasy OS Phase 5E-e — shared certified Waiver integration service.
 *
 * ONE server-only service used by every wired Waiver path (claim submission, eligibility/preview, and the
 * WaiverContextAssembler). It does NOT reimplement schedule/identity/lock logic — it COMPOSES the existing
 * `CertifiedLineupIntegrationService` schedule primitives (`describeScheduleForPlayers`), so there is a single
 * source of truth for certified schedule evidence and lock classification. It supplies EVIDENCE only: it never
 * replaces the deterministic waiver engine, roster legality, or eligibility authority. Fails closed to
 * `available:false`; never fabricates; never returns raw provider fields.
 */
import { CertifiedLineupIntegrationService, type PlayerRef, type CertifiedScheduleDescription } from './lineupIntegration'

export type { PlayerRef, CertifiedScheduleDescription }

export type WaiverClaimSafety = {
  block: boolean
  reason: string
  freshnessStatus: string
  identityStatus: string
  blockedPlayers: string[]
  snapshotVersion: string | null
}

export class CertifiedWaiverIntegrationService {
  constructor(private lineup = new CertifiedLineupIntegrationService()) {}

  /**
   * Informational (never-blocking) certified schedule context for waiver candidates (add/drop/pool players).
   * Exposes kickoff/status/lock evidence/freshness/identity; injuries/projections/availability/rankings are NOT
   * provided by the certified schedule plane and are surfaced as explicitly `unavailable`. Never mutates.
   */
  async describeWaiverScheduleContext(input: { season: string; week: string | null; players: PlayerRef[]; now?: Date }): Promise<CertifiedScheduleDescription> {
    return this.lineup.describeScheduleForPlayers(input)
  }

  /**
   * Reject-only pre-submission safety for a MANUAL waiver claim. Returns a SUPPLEMENTAL rejection only when it
   * has TRUSTWORTHY (current) certified evidence that an add or drop player's game is already
   * locked/started/final/postponed — a stricter catch the existing eligibility/roster-legality authority may
   * miss. It NEVER approves and NEVER weakens the existing decision. On stale/unavailable certified context it
   * does NOT block this human-confirmed manual claim (the existing waiver eligibility + roster legality remain
   * final). (Automatic recommendations fail closed instead — see the recommendation surface.)
   */
  async evaluateWaiverClaimSafety(input: { season: string; week: string | null; addRefs: PlayerRef[]; dropRefs: PlayerRef[]; now?: Date }): Promise<WaiverClaimSafety> {
    const players = [...input.addRefs, ...input.dropRefs]
    if (players.length === 0) {
      return { block: false, reason: 'no resolvable add/drop players', freshnessStatus: 'unavailable', identityStatus: 'unresolved', blockedPlayers: [], snapshotVersion: null }
    }
    const desc = await this.describeWaiverScheduleContext({ season: input.season, week: input.week, players, now: input.now })
    if (!desc.available) {
      return { block: false, reason: 'certified schedule unavailable — existing waiver authority remains final', freshnessStatus: desc.freshnessStatus, identityStatus: desc.identityStatus, blockedPlayers: [], snapshotVersion: null }
    }
    const trustworthy = desc.freshnessStatus === 'current'
    const blocked = trustworthy ? desc.players.filter((p) => p.locked).map((p) => p.canonicalPlayerId) : []
    return {
      block: blocked.length > 0,
      reason: blocked.length > 0
        ? `certified evidence: ${blocked.length} add/drop player(s) are in a locked/started/final game`
        : trustworthy ? 'no certified lock condition for add/drop players' : `certified schedule ${desc.freshnessStatus} — not used to block a manual claim`,
      freshnessStatus: desc.freshnessStatus,
      identityStatus: desc.identityStatus,
      blockedPlayers: blocked,
      snapshotVersion: desc.snapshotVersion,
    }
  }
}
