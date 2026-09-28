import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))
const db = vi.hoisted(() => ({ query: vi.fn() }))
vi.mock('@/lib/prisma', () => ({ prisma: { $queryRaw: db.query } }))
import { findRostersForTeams, rosterTeamKey } from '@/lib/leagues/rosterForTeam'

beforeEach(() => { db.query.mockReset(); db.query.mockResolvedValue([]) })
describe('batched roster ownership reads', () => {
  it('does not query when no manager identities are available', async () => {
    expect((await findRostersForTeams([])).size).toBe(0)
    expect((await findRostersForTeams([{ leagueId: 'a', platformManagerId: '' }])).size).toBe(0)
    expect(db.query).not.toHaveBeenCalled()
  })
  it('keeps hundreds of claimed teams in one parameterized database call', async () => {
    const teams = Array.from({ length: 500 }, (_, i) => ({ leagueId: `league-${i}`, platformManagerId: 'manager' }))
    await findRostersForTeams([...teams, teams[0]])
    expect(db.query).toHaveBeenCalledTimes(1)
    const [sql, payload] = db.query.mock.calls[0]
    expect(JSON.parse(payload)).toEqual(teams)
    expect(sql.join('')).toContain('CROSS JOIN LATERAL')
    expect(sql.join('')).toContain('source_manager_id')
  })
  it('keeps the same manager isolated by league and preserves missing and empty rosters', async () => {
    db.query.mockResolvedValue([
      { leagueId: 'a', platformManagerId: 'manager', id: 'linked', playerData: { players: ['one'] }, matched_by: 'source_manager_id' },
      { leagueId: 'b', platformManagerId: 'manager', id: 'legacy', playerData: { players: [] }, matched_by: 'platform_user_id' },
    ])
    const rows = await findRostersForTeams(['a', 'b', 'c'].map(leagueId => ({ leagueId, platformManagerId: 'manager' })))
    expect(rows.get(rosterTeamKey('a', 'manager'))?.matchedBy).toBe('source_manager_id')
    expect(rows.get(rosterTeamKey('a', 'manager'))?.playerData).toEqual({ players: ['one'] })
    expect(rows.get(rosterTeamKey('b', 'manager'))?.playerData).toEqual({ players: [] })
    expect(rows.get(rosterTeamKey('c', 'manager'))).toBeUndefined()
  })
})
