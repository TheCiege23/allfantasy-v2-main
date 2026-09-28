import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * Both inputs to a keeper's cost were constants — `yearsKept = 0`, `originalRound = 8` — so a
 * first-round pick and a waiver pickup cost the same round and the max-years rule never tripped.
 */

const m = vi.hoisted(() => ({
  leagueFindFirst: vi.fn(),
  rosterFindMany: vi.fn(),
  pickFindMany: vi.fn(),
  keeperFindMany: vi.fn(),
  sessionFindFirst: vi.fn(),
  upsert: vi.fn(),
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    league: { findFirst: m.leagueFindFirst },
    redraftRoster: { findMany: m.rosterFindMany },
    draftPick: { findMany: m.pickFindMany },
    keeperRecord: { findMany: m.keeperFindMany },
    draftSession: { findFirst: m.sessionFindFirst },
    keeperEligibility: { upsert: m.upsert },
  },
}))

import { computeKeeperEligibility } from '@/lib/keeper/eligibilityEngine'

const rosterPlayer = (playerId: string, playerName: string, position: string, acquisitionType = 'drafted') => ({
  playerId,
  playerName,
  position,
  acquisitionType,
  droppedAt: null,
})

beforeEach(() => {
  vi.clearAllMocks()
  m.leagueFindFirst.mockResolvedValue({
    id: 'L1',
    keeperCostSystem: 'round_based',
    keeperRoundPenalty: 1,
    keeperMaxYears: 3,
    keeperWaiverAllowed: true,
  })
  m.rosterFindMany.mockResolvedValue([
    {
      id: 'roster-a',
      players: [
        rosterPlayer('p-early', 'Early Pick', 'RB'),
        rosterPlayer('p-kept', 'Kept Once', 'WR'),
        rosterPlayer('p-waiver', 'Waiver Add', 'TE', 'waiver'),
        rosterPlayer('p-vet', 'Kept Thrice', 'QB'),
        // Drafted under a synthetic id; the roster holds the real one. Matched by name.
        rosterPlayer('real-99', "D'Andre Smith Jr.", 'WR'),
      ],
    },
  ])
  m.pickFindMany.mockResolvedValue([
    { playerId: 'p-early', playerName: 'Early Pick', position: 'RB', round: 2, createdAt: new Date() },
    { playerId: 'p-kept', playerName: 'Kept Once', position: 'WR', round: 9, createdAt: new Date() },
    { playerId: 'draft:x:1:dandre', playerName: "D'Andre Smith Jr.", position: 'WR', round: 6, createdAt: new Date() },
  ])
  m.keeperFindMany.mockResolvedValue([
    { playerId: 'p-kept', playerName: 'Kept Once', position: 'WR', costRound: 4, seasonId: 's1', lockedAt: new Date() },
    ...[1, 2, 3].map((i) => ({
      playerId: 'p-vet',
      playerName: 'Kept Thrice',
      position: 'QB',
      costRound: 5 - i,
      seasonId: `s${i}`,
      lockedAt: new Date(2020 + i, 0, 1),
    })),
  ])
  m.sessionFindFirst.mockResolvedValue({ rounds: 15 })
  m.upsert.mockImplementation(async ({ create }: { create: Record<string, unknown> }) => create)
})

describe('computeKeeperEligibility reads the league history', () => {
  it('costs each player from where he was drafted or last kept, and counts the years', async () => {
    const rows = await computeKeeperEligibility('L1', 'season-1')
    const byId = new Map(rows.map((r) => [r.playerId, r]))

    // Drafted in round 2 → costs round 1.
    expect(byId.get('p-early')).toMatchObject({ yearsKept: 0, projectedCostRound: 1, isEligible: true })
    // Kept once at round 4 → his cost starts from 4, not from his original draft round (9).
    expect(byId.get('p-kept')).toMatchObject({ yearsKept: 1, projectedCostRound: 3 })
    // Never drafted → the draft's last round.
    expect(byId.get('p-waiver')).toMatchObject({ yearsKept: 0, projectedCostRound: 14 })
    // Kept three times against a three-year limit.
    expect(byId.get('p-vet')).toMatchObject({ yearsKept: 3, isEligible: false, ineligibleReason: 'max_years_reached' })
    // Synthetic draft id, real roster id: matched by name and position.
    expect(byId.get('real-99')).toMatchObject({ projectedCostRound: 5 })
  })
})
