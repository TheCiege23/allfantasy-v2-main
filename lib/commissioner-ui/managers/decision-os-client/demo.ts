import { buildManagerRecord } from '@/lib/competitive-edge/managerRecord'
import type { EdgeTrade, EdgeTradeSide } from '@/lib/competitive-edge/tradeEdge'
import type { EdgeWaiverClaim } from '@/lib/competitive-edge/waiverEdge'
import type { EdgeDraftPick } from '@/lib/competitive-edge/draftEdge'
import type { ManagerDirectoryEntry, ManagerIntelligenceClient } from './types'

/**
 * Preview data for the same "Iron Horse Dynasty" demo league as Mission Control and League Health.
 *
 * Built through the REAL record builder (lib/competitive-edge/managerRecord.ts) from a small sample
 * history, so the preview shows exactly the kind of facts the live screen shows — counts, never a
 * profile. It used to preview archetypes and reliability scores the product no longer makes.
 */
const MANAGERS = [
  { id: 'demo-mgr-1', name: 'Priya Natarajan', owner: 'priya', faab: 41 },
  { id: 'demo-mgr-2', name: 'Sam Rivera', owner: 'sam', faab: 88 },
  { id: 'demo-mgr-3', name: 'Marcus Webb', owner: 'marcus', faab: 12 },
  { id: 'demo-mgr-4', name: 'Devon Okafor', owner: 'devon', faab: 100 },
]

const side = (ownerId: string, got: string[], gave: string[], picksIn = 0, picksOut = 0): EdgeTradeSide => ({
  ownerId,
  playersIn: got.map((position) => ({ position })),
  playersOut: gave.map((position) => ({ position })),
  picksIn: Array.from({ length: picksIn }, () => ({})),
  picksOut: Array.from({ length: picksOut }, () => ({})),
})

const TRADES: EdgeTrade[] = [
  { id: 'd1', season: '2025', week: 4, createdIso: '2025-10-01T16:00:00Z', sides: [side('priya', ['WR'], ['RB']), side('marcus', ['RB'], ['WR'])] },
  { id: 'd2', season: '2025', week: 9, createdIso: '2025-11-04T16:00:00Z', sides: [side('priya', ['WR', 'TE'], ['RB'], 1), side('sam', ['RB'], ['WR', 'TE'], 0, 1)] },
  { id: 'd3', season: '2026', week: 3, createdIso: '2026-09-23T16:00:00Z', sides: [side('priya', ['QB'], ['WR']), side('devon', ['WR'], ['QB'])] },
  { id: 'd4', season: '2026', week: 6, createdIso: '2026-10-14T16:00:00Z', sides: [side('priya', ['WR'], ['RB', 'RB']), side('marcus', ['RB', 'RB'], ['WR'])] },
  { id: 'd5', season: '2026', week: 8, createdIso: '2026-10-28T16:00:00Z', sides: [side('marcus', ['TE'], [], 0, 1), side('sam', [], ['TE'], 1)] },
]

const CLAIMS: EdgeWaiverClaim[] = [
  { teamExternalId: 'demo-mgr-1', position: 'WR', bid: 14, atIso: '2026-09-17T08:00:00Z' },
  { teamExternalId: 'demo-mgr-1', position: 'RB', bid: 31, atIso: '2026-10-08T08:00:00Z' },
  { teamExternalId: 'demo-mgr-1', position: 'WR', bid: 0, atIso: '2026-10-22T08:00:00Z' },
  { teamExternalId: 'demo-mgr-3', position: 'RB', bid: 52, atIso: '2026-09-24T08:00:00Z' },
  { teamExternalId: 'demo-mgr-3', position: 'RB', bid: 22, atIso: '2026-10-15T08:00:00Z' },
  { teamExternalId: 'demo-mgr-3', position: 'TE', bid: 9, atIso: '2026-11-05T08:00:00Z' },
  { teamExternalId: 'demo-mgr-3', position: 'RB', bid: 5, atIso: '2026-11-12T08:00:00Z' },
  { teamExternalId: 'demo-mgr-2', position: 'K', bid: 1, atIso: '2026-10-01T08:00:00Z' },
]

const PICKS: EdgeDraftPick[] = [
  { season: 2025, round: 1, position: 'WR', ownerSleeperId: 'priya' },
  { season: 2025, round: 2, position: 'WR', ownerSleeperId: 'priya' },
  { season: 2026, round: 1, position: 'WR', ownerSleeperId: 'priya' },
  { season: 2026, round: 2, position: 'RB', ownerSleeperId: 'priya' },
  { season: 2025, round: 1, position: 'RB', ownerSleeperId: 'marcus' },
  { season: 2026, round: 1, position: 'RB', ownerSleeperId: 'marcus' },
  { season: 2026, round: 2, position: 'RB', ownerSleeperId: 'marcus' },
  { season: 2026, round: 1, position: 'QB', ownerSleeperId: 'sam' },
  { season: 2026, round: 1, position: 'WR', ownerSleeperId: 'devon' },
]

export function demoManagerDirectory(): ManagerDirectoryEntry[] {
  return MANAGERS.map((m) => {
    const record = buildManagerRecord({
      manager: { name: m.name, teamExternalId: m.id, ownerId: m.owner },
      viewerOwnerId: null,
      trades: {
        available: true,
        data: { trades: TRADES, seasonsScanned: ['2025', '2026'], historyGaps: [], asOf: '2026-11-15T12:00:00Z', stale: false },
      },
      waivers: {
        available: true,
        data: { season: 2026, usesFaab: true, claims: CLAIMS, faabRemaining: m.faab, asOf: '2026-11-15T12:00:00Z', stale: false },
      },
      drafts: { available: true, data: { picks: PICKS, unattributedSeasons: [] } },
    })
    return { id: m.id, managerName: m.name, record }
  })
}

export const demoManagerIntelligenceClient: ManagerIntelligenceClient = {
  async getManagerDirectory() {
    return { data: demoManagerDirectory(), error: null, source: 'demo', timestamp: new Date().toISOString() }
  },
}
