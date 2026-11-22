import type { CommissionerPlatformResponse } from '../../contracts'
import type { ManagerRecord } from '@/lib/competitive-edge/managerRecord'

/**
 * The commissioner's Managers screen: every manager's RECORD, as facts (2026-11-16, re-score item 11 —
 * Manager Psychology returns as facts only, paid).
 *
 * 🛑 NOT A PROFILE. This namespace used to carry a "Manager DNA" profile — an archetype, a reliability
 * level, an engagement trend — from the classifier Milestone 32 retired. It now carries the same
 * Competitive Edge record Chimmy and the manager card read (lib/competitive-edge/managerRecord.ts):
 * counts of trades by position, waiver claims and FAAB, past drafts. No label, no score, no prediction.
 */
export interface ManagerDirectoryEntry {
  /** `LeagueTeam.externalId`. */
  id: string
  managerName: string
  record: ManagerRecord
}

export interface ManagerIntelligenceClient {
  getManagerDirectory(): Promise<CommissionerPlatformResponse<ManagerDirectoryEntry[]>>
}
