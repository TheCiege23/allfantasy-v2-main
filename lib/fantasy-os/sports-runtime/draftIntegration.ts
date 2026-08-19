import 'server-only'
/**
 * Fantasy OS Phase 5E-f — shared certified Draft integration service (Workstream B).
 *
 * ONE server-only service for every wired Draft path (draft room / board / player card, and the live pick
 * path). It COMPOSES the existing `CertifiedLineupIntegrationService` schedule primitive
 * (`describeScheduleForPlayers`) — it does NOT reimplement schedule/identity logic, nor any Draft rule (draft
 * order, current pick, clock, ownership, player pool, eligibility, duplicate protection, roster construction,
 * idempotency). It supplies EVIDENCE only and NEVER grants permission.
 *
 * IMPORTANT authority note: certified sports facts (identity resolution, schedule freshness, a game having
 * started, missing injury data) are NOT Draft legality rules — the existing Draft engine has no policy keyed to
 * them. Per the Global Authority Rule, `evaluateDraftPickSafety` therefore NEVER blocks a pick on such facts; it
 * only emits evidence. When evidence is uncertain, the existing Draft engine remains authoritative.
 */
import { CertifiedLineupIntegrationService, type PlayerRef, type CertifiedScheduleDescription } from './lineupIntegration'

export type { PlayerRef, CertifiedScheduleDescription }

export type DraftPickSafety = {
  block: boolean
  reason: string
  freshnessStatus: string
  identityStatus: string
  snapshotVersion: string | null
  /** Schedule description for the single drafted player (evidence only). */
  player: CertifiedScheduleDescription['players'][number] | null
}

export class CertifiedDraftIntegrationService {
  constructor(private lineup = new CertifiedLineupIntegrationService()) {}

  /** Informational certified schedule context for a single draft player card. */
  async describeDraftPlayerSportsContext(input: { season: string; week: string | null; player: PlayerRef; now?: Date }): Promise<CertifiedScheduleDescription> {
    return this.lineup.describeScheduleForPlayers({ season: input.season, week: input.week, players: [input.player], now: input.now })
  }

  /** Informational certified schedule context for a bounded set of draft-board players. */
  async describeDraftBoardSportsContext(input: { season: string; week: string | null; players: PlayerRef[]; now?: Date }): Promise<CertifiedScheduleDescription> {
    return this.lineup.describeScheduleForPlayers({ season: input.season, week: input.week, players: input.players.slice(0, 60), now: input.now })
  }

  /**
   * Reject-only pick safety. Certified sports facts are NOT Draft legality rules, so this NEVER blocks — it
   * emits identity/freshness/schedule evidence for the drafted player. Unresolved identity, stale schedule, or a
   * started game do not falsely invalidate a legal manual pick; the existing Draft engine remains authoritative.
   */
  async evaluateDraftPickSafety(input: { season: string; week: string | null; player: PlayerRef; now?: Date }): Promise<DraftPickSafety> {
    const desc = await this.lineup.describeScheduleForPlayers({ season: input.season, week: input.week, players: [input.player], now: input.now })
    const player = desc.players[0] ?? null
    return {
      block: false, // certified facts are not Draft legality — existing Draft engine is authoritative
      reason: desc.available
        ? 'certified schedule evidence attached; not a Draft legality rule (existing Draft engine authoritative)'
        : 'certified schedule unavailable; existing Draft engine authoritative',
      freshnessStatus: desc.freshnessStatus,
      identityStatus: desc.identityStatus,
      snapshotVersion: desc.snapshotVersion,
      player,
    }
  }
}
