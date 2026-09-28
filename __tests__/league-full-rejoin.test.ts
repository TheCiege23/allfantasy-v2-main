import { beforeEach, describe, expect, it, vi } from 'vitest'
const h = vi.hoisted(() => ({ leagues: vi.fn(), existing: vi.fn(), count: vi.fn() }))
vi.mock('@/lib/prisma', () => ({ prisma: { league: { findMany: h.leagues }, roster: { findUnique: h.existing } } }))
vi.mock('@/lib/league/leagueSeats', () => ({ countSeatsHeldByPeople: h.count }))
import { validateFantasyInviteCode } from '@/lib/league-invite/InviteValidationResolver'
beforeEach(() => {
  h.leagues.mockResolvedValue([{ id: 'L', name: 'League', sport: 'NFL', leagueSize: 2, settings: { inviteCode: 'join-code' } }])
  h.count.mockResolvedValue(2)
  h.existing.mockResolvedValue(null)
})
describe('full league invitation retries', () => {
  it('recognizes an existing member before refusing capacity', async () => {
    h.existing.mockResolvedValue({ id: 'roster' })
    expect(await validateFantasyInviteCode('join-code', { userId: 'member' })).toMatchObject({ valid: false, error: 'ALREADY_MEMBER', preview: { leagueId: 'L' } })
  })
  it('still refuses a new manager when full', async () => {
    expect(await validateFantasyInviteCode('join-code', { userId: 'new' })).toMatchObject({ valid: false, error: 'LEAGUE_FULL' })
  })
  it('admits a new manager while capacity remains', async () => {
    h.count.mockResolvedValue(1)
    expect(await validateFantasyInviteCode('join-code', { userId: 'new' })).toMatchObject({ valid: true })
  })
})
