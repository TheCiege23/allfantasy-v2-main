/**
 * Forfeited picks (tanking penalty), the commissioner's skip, expired-timer skips and slow-draft skips all
 * submit position "SKIP". The roster-fit check refused it as "not starter-eligible", so the skip never
 * happened — a forfeited 1st fell through to the team that lost it, who made the pick (dynasty
 * simulation, 2026-11-08: "Position "SKIP" is not starter-eligible in this league draft").
 */
import { describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))
vi.mock('@/lib/league/league-draft-template-payload', async (load) => ({
  ...(await load<typeof import('@/lib/league/league-draft-template-payload')>()),
  getLeagueDraftTemplatePayload: vi.fn(async () => ({
    sport: 'NFL',
    totalRosterSlots: 3,
    template: { slots: [{ slotName: 'QB', starterCount: 1, allowedPositions: ['QB'] }, { slotName: 'RB', starterCount: 1, allowedPositions: ['RB'] }, { slotName: 'BN', benchCount: 1, allowedPositions: ['QB', 'RB'] }] },
  })),
  getDraftEligiblePositionsFromPayload: vi.fn(() => new Set(['QB', 'RB'])),
}))

import { validateRosterFitForDraftPick } from '@/lib/live-draft-engine/RosterFitValidation'

const fit = (newPickPosition: string, existing: Array<{ rosterId: string; position: string }> = []) =>
  validateRosterFitForDraftPick({ leagueId: 'lg', rosterId: 'r1', existingPicks: existing, newPickPosition })

describe('a skipped pick through the roster-fit check', () => {
  it('is allowed — it is not a player', async () => {
    expect(await fit('SKIP')).toEqual({ valid: true })
    expect(await fit('skip')).toEqual({ valid: true })
  })

  it('still refuses a real position the league does not draft', async () => {
    expect((await fit('K')).valid).toBe(false)
  })

  it('takes no roster spot: skips do not count toward the team limit', async () => {
    const twoSkipsOnePlayer = [
      { rosterId: 'r1', position: 'SKIP' },
      { rosterId: 'r1', position: 'SKIP' },
      { rosterId: 'r1', position: 'QB' },
    ]
    expect(await fit('RB', twoSkipsOnePlayer)).toEqual({ valid: true })
    const full = [{ rosterId: 'r1', position: 'QB' }, { rosterId: 'r1', position: 'RB' }, { rosterId: 'r1', position: 'QB' }]
    expect((await fit('RB', full)).valid).toBe(false)
  })
})
