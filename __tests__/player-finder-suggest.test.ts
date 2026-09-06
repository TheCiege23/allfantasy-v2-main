import { beforeEach, describe, expect, it, vi } from 'vitest'

/*
 * Typeahead suggestions: ranked prefix-first, then by who is in your leagues,
 * each carrying where he is. The catalog search is mocked; the roster index,
 * the coverage guard and the ranking are the real ones.
 */

const mockLeagueFindMany = vi.hoisted(() => vi.fn())
const mockTeamFindMany = vi.hoisted(() => vi.fn())
const mockRosterFindMany = vi.hoisted(() => vi.fn())
const mockSportsPlayerFindMany = vi.hoisted(() => vi.fn())
const mockSearchPlayers = vi.hoisted(() => vi.fn())

vi.mock('@/lib/prisma', () => ({
  prisma: {
    league: { findMany: mockLeagueFindMany },
    leagueTeam: { findMany: mockTeamFindMany },
    roster: { findMany: mockRosterFindMany },
    sportsPlayer: { findMany: mockSportsPlayerFindMany },
  },
}))
vi.mock('@/lib/core-app/playerFinder', () => ({ suggestCatalog: mockSearchPlayers }))

import { clearRosterIndexCache, getGlobalRosterCounts, getRosterIndex, isPrefixMatch, rosterIndexCacheSize, suggestPlayers } from '@/lib/core-app/playerSuggest'

const match = (over: { externalId: string; sleeperId: string | null; name: string; position?: string; team?: string }) => ({
  sport: 'NFL',
  position: 'TE',
  team: 'BUF',
  imageUrl: null,
  number: null,
  rosteredIn: null,
  platforms: [],
  ...over,
})

const KINCAID = match({ externalId: 'ri-1', sleeperId: '10236', name: 'Dalton Kincaid' })
const KINCHENS = match({ externalId: 'ri-2', sleeperId: '11726', name: 'Kamren Kinchens', position: 'DB', team: 'LAR' })
const SUAMATAIA = match({ externalId: 'ri-3', sleeperId: '9', name: 'Kingsley Suamataia', position: 'OT', team: 'KC' })
const SKINNER = match({ externalId: 'ri-4', sleeperId: '77', name: 'Tyler Skinner', position: 'WR', team: 'DEN' })
const NO_ID = match({ externalId: 'ri-5', sleeperId: null, name: 'Kinsley Unknown' })
// The same person's college row, and a second NFL row for Kiner under another team spelling.
const KINCAID_COLLEGE = { ...match({ externalId: 'cfbd-1', sleeperId: null, name: 'Dalton Kincaid', team: 'Utah' }), sport: 'NCAAF' }
const KINER_A = match({ externalId: 'ri-6', sleeperId: '5001', name: 'Corey Kiner', position: 'RB', team: 'CIN' })
const KINER_B = match({ externalId: 'ri-7', sleeperId: '5001', name: 'Corey Kiner', position: 'RB', team: 'Cincinnati Bengals' })
// Kinchens filed as a safety by another vendor: same person, another defensive label.
const KINCHENS_S = match({ externalId: 'ri-8', sleeperId: null, name: 'Kamren Kinchens', position: 'S', team: 'LAR' })
// Two different people who share a name but not a position group both stay.
const ALLEN_QB = match({ externalId: 'ri-9', sleeperId: '4984', name: 'Josh Allen', position: 'QB', team: 'BUF' })
const ALLEN_LB = match({ externalId: 'ri-10', sleeperId: '4600', name: 'Josh Allen', position: 'LB', team: 'JAX' })

const LEAGUES = [
  { id: 'L-dragons', name: 'Dynasty Dragons' },
  { id: 'L-gang', name: 'Gridiron Gang' },
  { id: 'L-espn', name: 'End Zone Elites' },
]
const TEAMS = [
  { leagueId: 'L-dragons', externalId: '4', platformUserId: 'sl-me', claimedByUserId: 'me', ownerName: 'guap' },
  { leagueId: 'L-dragons', externalId: '1', platformUserId: 'sl-tasha', claimedByUserId: null, ownerName: 'tashaR' },
  { leagueId: 'L-gang', externalId: '2', platformUserId: 'sl-me2', claimedByUserId: 'me', ownerName: 'guap' },
  { leagueId: 'L-gang', externalId: '1', platformUserId: 'sl-tasha2', claimedByUserId: null, ownerName: 'tashaR' },
  { leagueId: 'L-espn', externalId: '7', platformUserId: 'e-me', claimedByUserId: 'me', ownerName: 'guap' },
]
const ROSTERS = [
  // Dragons: Kincaid and Skinner are yours; Suamataia is Tasha's.
  { leagueId: 'L-dragons', platformUserId: 'sl-me', playerData: { players: ['10236', '77'], starters: ['10236'] } },
  { leagueId: 'L-dragons', platformUserId: 'sl-tasha', playerData: { players: ['9', '50'], starters: ['9'] } },
  // Gang: Kincaid is yours; nobody has Kinchens or Suamataia.
  { leagueId: 'L-gang', platformUserId: 'sl-me2', playerData: { players: ['10236'], starters: ['10236'] } },
  { leagueId: 'L-gang', platformUserId: 'sl-tasha2', playerData: { players: ['60'], starters: ['60'] } },
  // ESPN: rosters speak ESPN ids — a Sleeper-id scan must NOT call anyone free here.
  { leagueId: 'L-espn', platformUserId: 'e-me', playerData: { players: ['e1', 'e2', 'e3'], starters: ['e1'] } },
  { leagueId: 'L-espn', platformUserId: 'e-them', playerData: { players: ['e4', 'e5', 'e6'], starters: ['e4'] } },
]
/** The player table knows every Sleeper-vocabulary id the rosters sample, and none of the ESPN ones. */
const KNOWN = new Set(['10236', '77', '9', '50', '60'])

beforeEach(() => {
  vi.clearAllMocks()
  clearRosterIndexCache()
  mockLeagueFindMany.mockResolvedValue(LEAGUES)
  mockTeamFindMany.mockResolvedValue(TEAMS)
  mockRosterFindMany.mockResolvedValue(ROSTERS)
  mockSportsPlayerFindMany.mockImplementation(async (args: { where: { sleeperId: { in: string[] } } }) =>
    args.where.sleeperId.in.filter((id) => KNOWN.has(id)).map((id) => ({ sleeperId: id })),
  )
  // The catalog's own order: alphabetical, which is exactly the problem.
  mockSearchPlayers.mockResolvedValue([KINCAID, KINCHENS, SUAMATAIA, NO_ID, SKINNER])
})

const loadLeagueIds = vi.fn(async () => ['L-dragons', 'L-gang', 'L-espn'])

describe('suggestPlayers', () => {
  it('ranks a name that starts with the letters first, then who is in your leagues, then the rest', async () => {
    const got = await suggestPlayers({ query: 'kin', userId: 'me', loadLeagueIds })
    expect(got.map((s) => s.name)).toEqual([
      'Dalton Kincaid', // prefix, yours in 2
      'Kingsley Suamataia', // prefix, Tasha has him
      'Kamren Kinchens', // prefix, free
      'Kinsley Unknown', // prefix, no id to join on
      'Tyler Skinner', // contains only — even though he is yours
    ])
    // The catalog is told which ids anyone rosters, so it reads those first.
    expect(mockSearchPlayers).toHaveBeenCalledWith('kin', 24, { preferIds: expect.arrayContaining(['10236', '77', '9', '50', '60']) })
    // How many rosters across AllFantasy hold each: the fixture's Kincaid twice, Suamataia and Skinner once.
    expect(got.map((s) => s.rostered)).toEqual([2, 1, 0, 0, 1])
  })

  it('says where each one is: yours, whose, free — and never "free" for a league it could not read', async () => {
    const got = await suggestPlayers({ query: 'kin', userId: 'me', loadLeagueIds })
    const by = Object.fromEntries(got.map((s) => [s.name, s.presence]))
    expect(by['Dalton Kincaid']).toEqual({ yours: ['Dynasty Dragons', 'Gridiron Gang'], owned: [], free: [], unchecked: 1 })
    expect(by['Kingsley Suamataia']).toEqual({ yours: [], owned: [{ leagueName: 'Dynasty Dragons', ownerName: 'tashaR' }], free: ['Gridiron Gang'], unchecked: 1 })
    expect(by['Kamren Kinchens']).toEqual({ yours: [], owned: [], free: ['Dynasty Dragons', 'Gridiron Gang'], unchecked: 1 })
    expect(by['Kinsley Unknown']).toBeNull()
  })

  /*
   * Signed out there is no "yours", so within the prefix set the players more
   * of AllFantasy rosters come first — Kincaid (2) over Suamataia (1) over
   * Kinchens (0) — and the contains-match stays last however popular.
   */
  it('carries no presence when signed out, and ranks by prefix, then how widely rostered, then name', async () => {
    const got = await suggestPlayers({ query: 'kin', userId: null, loadLeagueIds })
    expect(got.every((s) => s.presence === null)).toBe(true)
    expect(got.map((s) => s.name)).toEqual(['Dalton Kincaid', 'Kingsley Suamataia', 'Kamren Kinchens', 'Kinsley Unknown', 'Tyler Skinner'])
    expect(loadLeagueIds).not.toHaveBeenCalled()
    // The global count is one read of every roster, with no league filter.
    expect(mockRosterFindMany).toHaveBeenCalledTimes(1)
    expect(mockRosterFindMany.mock.calls[0][0]).toEqual({ select: { playerData: true } })
  })

  it('reads the roster index once a minute per user and the global count once in ten, not once per keystroke', async () => {
    await suggestPlayers({ query: 'kin', userId: 'me', loadLeagueIds })
    await suggestPlayers({ query: 'kinc', userId: 'me', loadLeagueIds })
    await suggestPlayers({ query: 'kinca', userId: 'me', loadLeagueIds })
    expect(loadLeagueIds).toHaveBeenCalledTimes(1)
    // One read for the user's index, one for the global count.
    expect(mockRosterFindMany).toHaveBeenCalledTimes(2)
  })

  /* ⚠ ONE ROW PER PERSON: the college row and the second team spelling fold into the rostered NFL row. */
  it('folds a player’s college row and a second team spelling into one suggestion, NFL first', async () => {
    mockSearchPlayers.mockResolvedValue([KINCAID_COLLEGE, KINER_A, KINER_B, KINCAID, KINCHENS, KINCHENS_S])
    const got = await suggestPlayers({ query: 'kin', userId: null, loadLeagueIds })
    expect(got.map((s) => `${s.name} · ${s.sport} · ${s.externalId}`)).toEqual([
      'Dalton Kincaid · NFL · ri-1',
      'Corey Kiner · NFL · ri-6',
      'Kamren Kinchens · NFL · ri-2',
    ])
  })

  it('keeps two different players who share a name but not a position group', async () => {
    mockSearchPlayers.mockResolvedValue([ALLEN_LB, ALLEN_QB])
    const got = await suggestPlayers({ query: 'jos', userId: null, loadLeagueIds })
    expect(got.map((s) => `${s.name} · ${s.position}`)).toEqual(['Josh Allen · LB', 'Josh Allen · QB'])
  })

  it('returns nothing under two characters and caps the list', async () => {
    expect(await suggestPlayers({ query: 'k', userId: 'me', loadLeagueIds })).toEqual([])
    expect(mockSearchPlayers).not.toHaveBeenCalled()
    const two = await suggestPlayers({ query: 'kin', userId: null, loadLeagueIds, limit: 2 })
    expect(two).toHaveLength(2)
  })
})

/*
 * The global count is every roster row (3,407 rows / 4.3 MB on production the
 * day this shipped) and must never wait on a request once a value exists.
 */
describe('getGlobalRosterCounts', () => {
  it('serves the stale count at once and refreshes it once behind the request', async () => {
    const first = await getGlobalRosterCounts(0)
    expect(first.get('10236')).toBe(2)
    expect(mockRosterFindMany).toHaveBeenCalledTimes(1)

    // Ten minutes on, the rosters have grown; the caller still gets the old map immediately.
    mockRosterFindMany.mockResolvedValue([...ROSTERS, { leagueId: 'L-x', platformUserId: 'sl-z', playerData: { players: ['10236'] } }])
    const stale = await getGlobalRosterCounts(11 * 60_000)
    expect(stale).toBe(first)
    const staleAgain = await getGlobalRosterCounts(11 * 60_000)
    expect(staleAgain).toBe(first)
    // One refresh for both stale reads, not two.
    expect(mockRosterFindMany).toHaveBeenCalledTimes(2)

    await new Promise((r) => setTimeout(r, 0))
    const fresh = await getGlobalRosterCounts(11 * 60_000 + 1)
    expect(fresh.get('10236')).toBe(3)
    expect(mockRosterFindMany).toHaveBeenCalledTimes(2)
  })
})

describe('getRosterIndex', () => {
  it('caps the per-user cache and drops the least recently used first', async () => {
    const none = async () => [] as string[]
    for (let i = 0; i < 505; i += 1) await getRosterIndex(`u${i}`, none, 0)
    expect(rosterIndexCacheSize()).toBe(500)
    // u0..u4 were evicted; touching u5 keeps it alive through the next insert.
    await getRosterIndex('u5', none, 0)
    await getRosterIndex('u-new', none, 0)
    expect(rosterIndexCacheSize()).toBe(500)
    const loads = vi.fn(async () => [] as string[])
    await getRosterIndex('u5', loads, 0)
    expect(loads).not.toHaveBeenCalled() // still cached
    await getRosterIndex('u6', loads, 0)
    expect(loads).toHaveBeenCalledTimes(1) // u6 was the oldest and went
  })
})

describe('isPrefixMatch', () => {
  it('matches the start of the name or of any word in it, case-insensitively', () => {
    expect(isPrefixMatch('kin', 'Dalton Kincaid')).toBe(true)
    expect(isPrefixMatch('DAL', 'Dalton Kincaid')).toBe(true)
    expect(isPrefixMatch('kin', 'Tyler Skinner')).toBe(false)
    expect(isPrefixMatch('', 'Dalton Kincaid')).toBe(false)
  })
})
