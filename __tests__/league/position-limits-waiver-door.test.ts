/**
 * Position limits through a real door: `assertWaiverClaimEligibility`, which every free-agent add and
 * claim submission runs. The rule itself is covered in position-limits.test.ts; this proves the door
 * actually consults it (and that a league with no limits is untouched).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({ settings: {} as Record<string, unknown> }))

const playerData = {
  players: ['qb-a', 'rb-a'],
  starters: ['qb-a'],
  lineup_sections: { starters: [{ id: 'qb-a', position: 'QB' }], bench: [{ id: 'rb-a', position: 'RB' }] },
}

vi.mock('@/lib/prisma', () => ({
  prisma: {
    league: {
      findFirst: vi.fn(async () => ({ id: 'L1', rosterSize: 20, sport: 'NFL', lockAllMoves: false, lifecycleState: 'in_season' })),
      findUnique: vi.fn(async () => ({ settings: h.settings, sport: 'NFL' })),
    },
    roster: {
      findFirst: vi.fn(async () => ({ id: 'R1', playerData, faabRemaining: 100 })),
      findMany: vi.fn(async () => [{ id: 'R1', playerData, redraftRosterId: null }]),
    },
    leagueWaiverSettings: { findUnique: vi.fn(async () => null) },
    sportsPlayer: { findMany: vi.fn(async () => []) },
    playerIdentityMap: { findMany: vi.fn(async () => []) },
  },
}))
vi.mock('@/lib/roster-legality/loadLegalityEvaluationContext', () => ({ evaluateLegalityForProjectedRoster: vi.fn(async () => null) }))
vi.mock('@/lib/waiver-wire/settings-service', () => ({
  getEffectiveLeagueWaiverSettings: async () => ({ waiverType: 'free_agency', maxDropsPerWeek: null }),
}))
vi.mock('@/lib/league/commissioner-roster-lock', () => ({ isCommissionerRosterLocked: vi.fn(async () => false) }))

import { assertWaiverClaimEligibility } from '@/lib/waiver-wire/transaction-eligibility'

const add = (addPlayerId: string, dropPlayerId?: string) =>
  assertWaiverClaimEligibility({ leagueId: 'L1', rosterId: 'R1', addPlayerId, dropPlayerId })

beforeEach(() => {
  h.settings = { position_limits: { QB: 1 } }
})

describe('a free-agent add honours position limits', () => {
  it('refuses a second QB when the limit is one', async () => {
    await expect(add('name:Josh Allen:QB:BUF')).rejects.toThrow('Your team can roster at most 1 QB; this move would make it 2.')
  })
  it('allows another position', async () => {
    await expect(add('name:Saquon Barkley:RB:PHI')).resolves.toBeUndefined()
  })
  it('allows a QB for QB swap', async () => {
    await expect(add('name:Josh Allen:QB:BUF', 'qb-a')).resolves.toBeUndefined()
  })
  it('a league with no limits is untouched', async () => {
    h.settings = {}
    await expect(add('name:Josh Allen:QB:BUF')).resolves.toBeUndefined()
  })
})
