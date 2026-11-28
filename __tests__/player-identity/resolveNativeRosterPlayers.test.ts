// @vitest-environment node
/**
 * A native league's roster ids, named in the one id space each sport uses — never both. The trade
 * screen showed every native league's players as bare ids ("114") until this existed.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const m = vi.hoisted(() => ({
  rows: [] as Array<Record<string, unknown>>,
  findMany: vi.fn(),
  sleeper: vi.fn(),
}))

vi.mock('server-only', () => ({}))
vi.mock('@/lib/prisma', () => ({ prisma: { sportsPlayer: { findMany: m.findMany } } }))
vi.mock('@/lib/player-identity/resolveSleeperRosterPlayers', () => ({ resolveSleeperRosterPlayers: m.sleeper }))

import { resolveNativeRosterPlayers } from '@/lib/player-identity/resolveNativeRosterPlayers'

const ri = (externalId: string, name: string, extra: Record<string, unknown> = {}) => ({ externalId, name, position: 'C', team: 'Denver Nuggets', imageUrl: null, sleeperId: null, source: 'rolling_insights', ...extra })

beforeEach(() => {
  vi.clearAllMocks()
  m.findMany.mockImplementation(async ({ where }: { where: { externalId: { in: string[] } } }) => m.rows.filter((r) => where.externalId.in.includes(String(r.externalId))))
  m.sleeper.mockResolvedValue(new Map())
})

describe('resolveNativeRosterPlayers', () => {
  it('names native NBA players by their Rolling Insights id, and never asks Sleeper', async () => {
    m.rows = [ri('114', 'Nikola Jokic'), ri('759', 'Derrick White', { position: 'PG', team: 'Boston Celtics' })]
    const out = await resolveNativeRosterPlayers(['114', '759', '999'], 'NBA')
    expect(out.get('114')).toMatchObject({ name: 'Nikola Jokic', position: 'C', team: 'Denver Nuggets', sport: 'NBA', rollingInsightsId: '114' })
    expect(out.get('759')).toMatchObject({ name: 'Derrick White', position: 'PG' })
    expect(out.has('999')).toBe(false)
    expect(m.sleeper).not.toHaveBeenCalled()
    // Never Sleeper's own rows, whose externalId is `sleeper:<id>`.
    expect(m.findMany.mock.calls[0]![0].where).toMatchObject({ sport: 'NBA', source: { not: 'sleeper' } })
  })

  it('🛑 in NFL a bare number is a Sleeper id: it is NEVER matched against another provider\'s number', async () => {
    // RI 1232 is a different player; the NFL roster's 1232 is a Sleeper id.
    m.rows = [ri('1232', 'Some Other Person', { source: 'rolling_insights' }), ri('tsdb_9', 'Self Described', { source: 'thesportsdb' })]
    m.sleeper.mockResolvedValue(new Map([['1232', { sleeperId: '1232', name: 'Real Sleeper Player', position: 'WR', team: 'BUF', sport: 'NFL', source: 'sleeper', imageUrl: null }]]))
    const out = await resolveNativeRosterPlayers(['1232', 'tsdb_9'], 'NFL')
    expect(m.sleeper).toHaveBeenCalledWith(['1232'], 'NFL')
    expect(out.get('1232')).toMatchObject({ name: 'Real Sleeper Player', position: 'WR', sleeperId: '1232' })
    // The self-describing id goes to our table; the bare number was never sent there.
    expect(m.findMany.mock.calls[0]![0].where.externalId.in).toEqual(['tsdb_9'])
    expect(out.get('tsdb_9')).toMatchObject({ name: 'Self Described', rollingInsightsId: null })
  })

  it('an id whose rows name different people is left unresolved; agreeing rows are one player', async () => {
    m.rows = [ri('5', 'Player One'), ri('5', 'Player Two', { source: 'thesportsdb' }), ri('6', 'Same Guy', { position: null }), ri('6', 'same guy', { position: 'SF', source: 'thesportsdb' })]
    const out = await resolveNativeRosterPlayers(['5', '6'], 'NBA')
    expect(out.has('5')).toBe(false)
    expect(out.get('6')).toMatchObject({ name: 'Same Guy', position: 'SF' })
  })

  it('a failed read leaves players unnamed instead of failing the screen', async () => {
    m.findMany.mockRejectedValue(new Error('db down'))
    m.sleeper.mockRejectedValue(new Error('db down'))
    expect((await resolveNativeRosterPlayers(['114'], 'NBA')).size).toBe(0)
    expect((await resolveNativeRosterPlayers(['1232'], 'NFL')).size).toBe(0)
  })
})
