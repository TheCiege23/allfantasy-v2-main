import { beforeEach, describe, expect, it, vi } from 'vitest'

const db = vi.hoisted(() => ({
  survivorTribalCouncil: { findUnique: vi.fn() },
  survivorJuryMember: { findMany: vi.fn() },
  survivorTribeMember: { findMany: vi.fn() },
}))
vi.mock('@/lib/prisma', () => ({ prisma: db }))
vi.mock('@/lib/survivor/SurvivorRosterState', () => ({ getActiveRosterIdsForLeague: vi.fn(async () => ['a', 'b', 'juror']) }))
vi.mock('@/lib/survivor/SurvivorEffectEngine', () => ({ getWeeklyEffectState: vi.fn(async () => ({ immuneTribeIds: new Set(), protectedRosterIds: new Set() })) }))

import { excludeJuryRosterIds, survivorIdolPlayBlockReason } from '@/lib/survivor/juryGuards'
import { getEligibleRosterIdsForCouncil, getTargetableRosterIdsForCouncil } from '@/lib/survivor/SurvivorCouncilEligibility'

beforeEach(() => {
  vi.clearAllMocks()
  db.survivorTribalCouncil.findUnique.mockResolvedValue({ leagueId: 'L', week: 9, phase: 'merge', attendingTribeId: null })
  // A juror the elimination ledger failed to mark as eliminated must still be excluded.
  db.survivorJuryMember.findMany.mockResolvedValue([{ rosterId: 'juror' }])
})

describe('jurors are out of the game', () => {
  it('cannot play idols', () => {
    expect(survivorIdolPlayBlockReason({ playerState: 'jury' })).toBe('Jurors cannot play idols.')
    expect(survivorIdolPlayBlockReason({ playerState: 'active', isJuryMember: true })).toBe('Jurors cannot play idols.')
    expect(survivorIdolPlayBlockReason({ playerState: 'eliminated' })).toMatch(/still in the game/)
    expect(survivorIdolPlayBlockReason({ playerState: 'active' })).toBeNull()
  })
  it('can neither vote nor receive votes at council', async () => {
    expect(await getEligibleRosterIdsForCouncil('c1')).toEqual(['a', 'b'])
    expect(await getTargetableRosterIdsForCouncil('c1')).toEqual(['a', 'b'])
    expect(excludeJuryRosterIds(['x', 'y'], ['y'])).toEqual(['x'])
  })
})
