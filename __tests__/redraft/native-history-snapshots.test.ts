/** @vitest-environment node */
import { expect, it, vi } from 'vitest'
vi.mock('@/lib/prisma', () => ({ prisma: {
  leagueSeason: { findUnique: vi.fn(async () => ({ createdAt: new Date('2026-04-01'), teamRecords: [{ rosterId: 'old-roster', managerName: 'Friend', players: [
    { playerId: 'starter', slotType: 'PG' }, { playerId: 'reserve', slotType: 'bench' }, { playerId: 'injured', slotType: 'IR' },
  ] }] })) },
  redraftSeason: { findUnique: vi.fn(async () => ({ rosters: [], schedule: [], playoffRounds: [], playoffSeeds: [], redraftTransactions: [], playoffStartWeek: 20 })) },
  draftSession: { findFirst: vi.fn(async () => null) },
} }))
import { loadNativeSeasonHistory } from '@/lib/redraft/offseason/nativeSeasonHistory'
it('classifies saved draft bench slots correctly in the archived roster view', async () => {
  const history = await loadNativeSeasonHistory('league', 2025)
  expect(history?.lineupSnapshots[0]).toMatchObject({ rosterCount: 3, lineupCount: 1, benchCount: 2,
    lineupPlayers: [{ id: 'starter' }], benchPlayers: [{ id: 'reserve' }, { id: 'injured' }] })
})
