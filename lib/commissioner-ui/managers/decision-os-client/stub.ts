import { buildManagerRecord } from '@/lib/competitive-edge/managerRecord'
import type { ManagerIntelligenceClient } from './types'

/** One manager with an empty history — the smallest record the builder makes. */
export const stubManagerIntelligenceClient: ManagerIntelligenceClient = {
  async getManagerDirectory() {
    const record = buildManagerRecord({
      manager: { name: 'Test Manager One', teamExternalId: 'stub-mgr-1', ownerId: 'stub-owner-1' },
      viewerOwnerId: null,
      trades: { available: true, data: { trades: [], seasonsScanned: ['2026'], historyGaps: [], asOf: '2026-11-15T00:00:00Z', stale: false } },
      waivers: { available: true, data: { season: 2026, usesFaab: false, claims: [], faabRemaining: null, asOf: null, stale: false } },
      drafts: { available: true, data: { picks: [], unattributedSeasons: [] } },
    })
    return {
      data: [{ id: 'stub-mgr-1', managerName: 'Test Manager One', record }],
      error: null,
      source: 'stub',
      timestamp: new Date().toISOString(),
    }
  },
}
