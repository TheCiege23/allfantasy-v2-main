// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'
const h = vi.hoisted(() => ({ pool: vi.fn(), evidence: vi.fn() }))
vi.mock('@/lib/prisma', () => ({ prisma: {} }))
vi.mock('@/lib/sport-teams/SportPlayerPoolResolver', () => ({ getPlayerPoolForLeague: h.pool }))
vi.mock('@/lib/draft-room/nbaSurvivorRosterEligibility', async original => ({
  ...await original<typeof import('@/lib/draft-room/nbaSurvivorRosterEligibility')>(), loadNbaSurvivorRosterEligibility: h.evidence,
}))
import { buildNbaRosterEligibility } from '@/lib/draft-room/nbaSurvivorRosterEligibility'
import { assertCurrentNbaWaiverPlayer, loadLeagueWaiverPlayerPool } from '@/lib/waiver-wire/current-nba-player-pool'
const league = { id: 'nba', sport: 'NBA' as const, leagueVariant: 'redraft', isDynasty: false }
const row = (name: string, id: string, position = 'C') => ({ full_name: name, external_source_id: id, player_id: `uuid-${id}`, position, team_abbreviation: 'DEN' })
const evidence = (name: string, id: string, status: string, source = 'rolling_insights') => ({ name, externalId: id, status, source, team: 'DEN', fetchedAt: new Date(), expiresAt: new Date(Date.now() + 86400000) })
beforeEach(() => {
  vi.clearAllMocks()
  h.pool.mockResolvedValue([
    ...Array.from({ length: 900 }, (_, n) => row(`Historical ${n}`, String(n + 1000))),
    row('Nikola Jokic', '114'), row('Nikola Jokic', '999'), row('Bam Adebayo', '115'), row('Owner Example', '900', 'OWNER'),
  ])
  h.evidence.mockResolvedValue(buildNbaRosterEligibility([
    evidence('Nikola Jokic', '114', 'ACT'), evidence('Bam Adebayo', '115', 'INACT'),
    evidence('Bam Adebayo', 'tsdb-bam', 'Active', 'thesportsdb'), evidence('Owner Example', '900', 'ACT'),
  ], 1))
})
describe('NBA waiver listing and transaction eligibility use the same current identities', () => {
  it('filters before truncation and keeps verified injured players', async () => {
    expect((await loadLeagueWaiverPlayerPool(league)).map(p => p.full_name)).toEqual(['Nikola Jokic', 'Bam Adebayo'])
    expect(h.pool).toHaveBeenCalledWith('nba', 'NBA', { limit: 5000 })
  })
  it.each(['uuid-114', '114', 'uuid-115'])('accepts the verified internal or provider id %s', async id => {
    await expect(assertCurrentNbaWaiverPlayer(league, id)).resolves.toBeUndefined()
  })
  it.each(['uuid-1001', '999', 'uuid-900', 'unknown'])('rejects historical, mismatched and staff identities %s', async id => {
    await expect(assertCurrentNbaWaiverPlayer(league, id)).rejects.toThrow('verified current NBA roster')
  })
  it('does not expose historical profiles when evidence is unavailable', async () => {
    h.evidence.mockResolvedValue({ ready: false, reason: 'Current NBA roster unavailable' })
    await expect(loadLeagueWaiverPlayerPool(league)).rejects.toThrow('Current NBA roster unavailable')
  })
  it.each([
    { ...league, sport: 'NFL' as const },
    { ...league, isDynasty: true },
    { ...league, leagueVariant: 'dynasty' },
    { ...league, leagueVariant: 'devy' },
    { ...league, leagueVariant: 'c2c' },
  ])('preserves existing pools for other sports or formats $sport/$leagueVariant', async other => {
    const original = await h.pool()
    h.pool.mockClear()
    expect(await loadLeagueWaiverPlayerPool(other)).toBe(original)
    expect(h.pool).toHaveBeenCalledWith(other.id, other.sport, { limit: 800 })
    expect(h.evidence).not.toHaveBeenCalled()
    h.pool.mockClear()
    await assertCurrentNbaWaiverPlayer(other, 'unknown')
    expect(h.pool).not.toHaveBeenCalled()
  })
})
