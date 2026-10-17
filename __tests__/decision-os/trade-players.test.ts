/**
 * A stored trade's player ids → EXACTLY ONE player each, in the right id space, or a refusal.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { sportsFindMany, providerResolve } = vi.hoisted(() => ({ sportsFindMany: vi.fn(), providerResolve: vi.fn() }))
vi.mock('server-only', () => ({}))
vi.mock('@/lib/prisma', () => ({ prisma: { sportsPlayer: { findMany: sportsFindMany } } }))
vi.mock('@/lib/player-identity/resolveProviderRosterPlayers', () => ({
  resolveProviderRosterPlayers: providerResolve,
  providerIdentityColumn: (p: string) => (['espn', 'fantrax', 'fleaflicker', 'mfl'].includes(p) ? `${p}Id` : null),
}))

import { decidePlayerIdentity, playerIdSpaceFor, resolveTradePlayers } from '@/lib/decision-os/trade/tradePlayers'

beforeEach(() => {
  sportsFindMany.mockClear()
  sportsFindMany.mockImplementation(async () => [])
  providerResolve.mockClear()
  providerResolve.mockImplementation(async () => new Map())
})

describe('playerIdSpaceFor — the league decides the id space', () => {
  it.each([
    [{ platform: 'sleeper', sport: 'NFL' }, 'sleeper'],
    [{ platform: 'manual', sport: 'NFL' }, 'sleeper'], // native NFL pools are Sleeper-keyed
    [{ platform: 'manual', sport: 'NBA' }, 'rolling_insights'], // …every other native sport is not
    [{ platform: null, sport: 'NHL' }, 'rolling_insights'],
    [{ platform: 'espn', sport: 'NFL' }, { provider: 'espn' }],
  ] as const)('%j → %j', (league, want) => {
    expect(playerIdSpaceFor(league)).toEqual(want)
  })
})

describe('decidePlayerIdentity', () => {
  it('several rows that agree on the name are one player', () => {
    expect(decidePlayerIdentity([
      { name: 'Josh Allen', position: 'QB' },
      { name: 'Josh Allen', position: null },
      { name: 'JOSH ALLEN', position: 'QB' },
    ])).toEqual({ ok: true, name: 'Josh Allen', position: 'QB' })
  })

  it('rows that disagree are ambiguous — refused, never a pick of the first', () => {
    expect(decidePlayerIdentity([{ name: 'Josh Allen', position: 'QB' }, { name: 'Mike Evans', position: 'WR' }])).toEqual({ ok: false, why: 'ambiguous' })
  })

  it('a generational suffix on ONE ROW OF THE SAME ID is spelling noise, not a second person', () => {
    // All rows here share one provider id; `playerNamesAgree` drops the suffix. Across different ids
    // this rule is never applied — each id is decided on its own rows.
    expect(decidePlayerIdentity([{ name: 'Kenneth Walker III', position: 'RB' }, { name: 'Kenneth Walker', position: 'RB' }])).toMatchObject({ ok: true })
  })

  it('no named row is unresolved', () => {
    expect(decidePlayerIdentity([])).toEqual({ ok: false, why: 'unresolved' })
    expect(decidePlayerIdentity([{ name: '  ', position: 'QB' }])).toEqual({ ok: false, why: 'unresolved' })
  })
})

describe('resolveTradePlayers', () => {
  it('Sleeper ids are looked up as Sleeper ids, in the league’s sport', async () => {
    sportsFindMany.mockResolvedValue([
      { sleeperId: '4984', externalId: 'x', name: 'Josh Allen', position: 'QB' },
      { sleeperId: null, externalId: 'sleeper:4984', name: 'Josh Allen', position: 'QB' },
    ])
    const out = await resolveTradePlayers(['4984', '9999'], { space: 'sleeper', sport: 'nfl' })
    const where = sportsFindMany.mock.calls[0]![0].where
    expect(where.sport).toBe('NFL')
    expect(where.OR).toEqual([{ sleeperId: { in: ['4984', '9999'] } }, { externalId: { in: ['sleeper:4984', 'sleeper:9999'] } }])
    expect(out.get('4984')).toEqual({ ok: true, name: 'Josh Allen', position: 'QB' })
    expect(out.get('9999')).toEqual({ ok: false, why: 'unresolved' })
  })

  it('a native NBA trade is looked up as Rolling Insights ids — never as Sleeper ids', async () => {
    sportsFindMany.mockResolvedValue([{ externalId: '1234', name: 'Nikola Jokic', position: 'C' }])
    const out = await resolveTradePlayers(['1234'], { space: 'rolling_insights', sport: 'NBA' })
    const where = sportsFindMany.mock.calls[0]![0].where
    expect(where).toMatchObject({ source: 'rolling_insights', externalId: { in: ['1234'] }, sport: 'NBA' })
    expect(where.OR).toBeUndefined()
    expect(out.get('1234')).toMatchObject({ ok: true, name: 'Nikola Jokic' })
  })

  it('ESPN-style ids go through the platform’s identity column', async () => {
    providerResolve.mockResolvedValue(new Map([['15847', { name: 'Travis Kelce', position: 'TE' }]]))
    const out = await resolveTradePlayers(['15847', '1'], { space: { provider: 'espn' }, sport: 'NFL' })
    expect(providerResolve).toHaveBeenCalledWith('espn', ['15847', '1'], 'NFL')
    expect(sportsFindMany).not.toHaveBeenCalled()
    expect(out.get('15847')).toMatchObject({ ok: true, name: 'Travis Kelce' })
    expect(out.get('1')).toEqual({ ok: false, why: 'unresolved' })
  })

  it('an unreadable table leaves every id unresolved — refused, never thrown', async () => {
    sportsFindMany.mockImplementation(() => {
      throw new Error('db down')
    })
    const out = await resolveTradePlayers(['4984'], { space: 'sleeper', sport: 'NFL' })
    expect(out.get('4984')).toEqual({ ok: false, why: 'unresolved' })
  })
})
