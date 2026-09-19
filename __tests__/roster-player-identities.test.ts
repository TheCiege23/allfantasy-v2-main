// @vitest-environment node
/**
 * `resolveRosterPlayerIdentities` — the one place that knows which id space a roster is written in.
 *
 * The bug this module exists for was invisible to every check in the repo: no throw, no failed
 * sync, no red test. A Fantrax roster was looked up in the Sleeper id space, matched nothing, and
 * Chimmy reported the roster as unreadable while `/core` rendered it with names. So the assertions
 * here are about WHICH TABLE IS ASKED, not only about what comes back — a test that mocked the
 * answer and checked the answer would have passed throughout.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  identityMap: vi.fn(),
  sleeper: vi.fn(),
  crosswalk: vi.fn(),
  providerNames: vi.fn(),
}))

vi.mock('@/lib/prisma', () => ({
  prisma: { playerIdentityMap: { findMany: mocks.identityMap } },
}))
vi.mock('@/lib/player-identity/resolveSleeperRosterPlayers', () => ({
  resolveSleeperRosterPlayers: mocks.sleeper,
}))
vi.mock('@/lib/core-app/rosterIdCrosswalk', () => ({ crosswalkToSleeperIds: mocks.crosswalk }))
vi.mock('@/lib/core-app/providerIdentityNames', () => ({
  lookupProviderIdentityNames: mocks.providerNames,
}))

import {
  normalizeIdentitySport,
  resolveRosterPlayerIdentities,
} from '@/lib/player-identity/resolveRosterPlayerIdentities'

beforeEach(() => {
  vi.clearAllMocks()
  mocks.identityMap.mockResolvedValue([])
  mocks.sleeper.mockResolvedValue(new Map())
  mocks.crosswalk.mockResolvedValue(new Map())
  mocks.providerNames.mockResolvedValue(new Map())
})

describe('normalizeIdentitySport', () => {
  it('folds every spelling of college football onto NCAAF', () => {
    for (const spelling of ['cfb', 'CFB', 'ncaafb', 'college', 'NCAAF']) {
      expect(normalizeIdentitySport(spelling)).toBe('NCAAF')
    }
  })

  it('defaults to NFL only when nothing was given', () => {
    expect(normalizeIdentitySport(null)).toBe('NFL')
    expect(normalizeIdentitySport('  ')).toBe('NFL')
    expect(normalizeIdentitySport('nba')).toBe('NBA')
  })
})

describe('Fantrax rosters', () => {
  it('🛑 reads the Fantrax column, and never the Sleeper path', async () => {
    mocks.identityMap.mockResolvedValue([
      {
        fantraxId: '06k5m',
        canonicalName: 'Arch Manning',
        position: 'QB',
        currentTeam: 'Texas',
        rollingInsightsId: 'ri-1',
        cfbdId: null,
      },
    ])

    const out = await resolveRosterPlayerIdentities('fantrax', 'cfb', ['06k5m'])

    expect(mocks.identityMap.mock.calls[0][0].where).toEqual({
      sport: 'NCAAF',
      fantraxId: { in: ['06k5m'] },
    })
    /*
     * The control for the actual regression. The Sleeper crosswalk cannot serve a college league
     * at all — 0 of 73,883 NCAAF `SportsPlayer` rows carry a `sleeperId` — so reaching for it here
     * is not a slower route to the same answer, it is the wrong answer.
     */
    expect(mocks.sleeper).not.toHaveBeenCalled()
    expect(mocks.crosswalk).not.toHaveBeenCalled()
    expect(out.get('06k5m')).toMatchObject({
      name: 'Arch Manning',
      position: 'QB',
      team: 'Texas',
      rollingInsightsId: 'ri-1',
    })
  })

  it('🛑 refuses an id held by more than one identity row', async () => {
    mocks.identityMap.mockResolvedValue([
      { fantraxId: 'dupe', canonicalName: 'Ryan Davis', rollingInsightsId: 'ri-a' },
      { fantraxId: 'dupe', canonicalName: 'Ryan Davis', rollingInsightsId: 'ri-b' },
      { fantraxId: 'clean', canonicalName: 'Jeremiah Smith', rollingInsightsId: 'ri-c' },
    ])

    const out = await resolveRosterPlayerIdentities('fantrax', 'NCAAF', ['dupe', 'clean'])

    // `fantraxId` is not unique, and two rows means two people until proven otherwise. A gap here
    // costs a blank slot; a guess costs another athlete's projection on someone's roster.
    expect(out.has('dupe')).toBe(false)
    expect(out.get('clean')?.name).toBe('Jeremiah Smith')
  })

  it('leaves an unmatched id absent rather than naming it after itself', async () => {
    const out = await resolveRosterPlayerIdentities('fantrax', 'NCAAF', ['05jxr'])
    expect(out.has('05jxr')).toBe(false)
  })

  it('survives a registry read failure with an empty map', async () => {
    mocks.identityMap.mockRejectedValue(new Error('registry down'))
    await expect(resolveRosterPlayerIdentities('fantrax', 'NCAAF', ['06k5m'])).resolves.toEqual(
      new Map(),
    )
  })
})

describe('Sleeper-keyed rosters', () => {
  it('looks ids up directly, with no crosswalk', async () => {
    mocks.sleeper.mockResolvedValue(
      new Map([
        ['4034', { name: 'Christian McCaffrey', position: 'RB', team: 'SF', imageUrl: 'u' }],
      ]),
    )

    const out = await resolveRosterPlayerIdentities('sleeper', 'NFL', ['4034'])

    expect(mocks.crosswalk).not.toHaveBeenCalled()
    expect(mocks.sleeper).toHaveBeenCalledWith(['4034'], 'NFL')
    expect(out.get('4034')).toMatchObject({ name: 'Christian McCaffrey', imageUrl: 'u' })
  })

  it('does not ask the provider-name fallback for a platform that has no separate id space', async () => {
    const out = await resolveRosterPlayerIdentities('sleeper', 'NFL', ['9999'])
    expect(mocks.providerNames).not.toHaveBeenCalled()
    expect(out.has('9999')).toBe(false)
  })
})

describe('Crosswalked platforms', () => {
  it('translates the roster id before looking it up, and reports under the ROSTER id', async () => {
    mocks.crosswalk.mockResolvedValue(new Map([['3139477', '4034']]))
    mocks.sleeper.mockResolvedValue(
      new Map([['4034', { name: 'Christian McCaffrey', position: 'RB', team: 'SF', imageUrl: null }]]),
    )

    const out = await resolveRosterPlayerIdentities('espn', 'NFL', ['3139477'])

    expect(mocks.sleeper).toHaveBeenCalledWith(['4034'], 'NFL')
    // Keyed by what the roster actually holds — a caller cannot look up an id it never had.
    expect(out.get('3139477')?.name).toBe('Christian McCaffrey')
    expect(out.has('4034')).toBe(false)
  })

  it('names an unbridged id from the provider’s own record, with position and team left null', async () => {
    mocks.providerNames.mockResolvedValue(new Map([['15847', { name: 'Zac Alcorn' }]]))

    const out = await resolveRosterPlayerIdentities('espn', 'NFL', ['15847'])

    expect(mocks.providerNames).toHaveBeenCalledWith('espn', 'NFL', ['15847'])
    /*
     * Those rows carry no position and no team (0 of 1,257 sampled). Inferring either from the name
     * is the fabrication this whole module exists to avoid — naming him is a fact the row supports,
     * pricing him is not.
     */
    expect(out.get('15847')).toMatchObject({ name: 'Zac Alcorn', position: null, team: null })
  })

  it('asks the name fallback only for what is still missing', async () => {
    mocks.crosswalk.mockResolvedValue(new Map([['a', '4034']]))
    mocks.sleeper.mockResolvedValue(
      new Map([['4034', { name: 'Resolved', position: 'RB', team: 'SF', imageUrl: null }]]),
    )

    await resolveRosterPlayerIdentities('espn', 'NFL', ['a', 'b'])

    expect(mocks.providerNames).toHaveBeenCalledWith('espn', 'NFL', ['b'])
  })

  it('skips the name fallback entirely when every id resolved', async () => {
    mocks.crosswalk.mockResolvedValue(new Map([['a', '4034']]))
    mocks.sleeper.mockResolvedValue(
      new Map([['4034', { name: 'Resolved', position: 'RB', team: 'SF', imageUrl: null }]]),
    )

    await resolveRosterPlayerIdentities('espn', 'NFL', ['a'])

    expect(mocks.providerNames).not.toHaveBeenCalled()
  })
})

describe('input hygiene', () => {
  it('touches nothing for an empty roster', async () => {
    await resolveRosterPlayerIdentities('fantrax', 'NCAAF', [])
    await resolveRosterPlayerIdentities('espn', 'NFL', ['', '  ', null, undefined])
    expect(mocks.identityMap).not.toHaveBeenCalled()
    expect(mocks.crosswalk).not.toHaveBeenCalled()
    expect(mocks.sleeper).not.toHaveBeenCalled()
  })

  it('de-duplicates ids before querying', async () => {
    await resolveRosterPlayerIdentities('fantrax', 'NCAAF', ['x', 'x', ' x '])
    expect(mocks.identityMap.mock.calls[0][0].where.fantraxId.in).toEqual(['x'])
  })
})
