import { beforeEach, describe, expect, it, vi } from 'vitest'

/*
 * Player Finder, scoped to one league: who has him HERE.
 *
 * Four ownership states, each stated plainly, and the projection under THIS
 * league's scoring whoever holds him. Prisma is mocked at the module boundary;
 * every other helper the loader uses (slot eligibility, the scoring engine) is
 * the real one, so a change in how a starter is placed or a stat line scored
 * shows up here.
 */

const mockLeagueFindUnique = vi.hoisted(() => vi.fn())
const mockTeamFindMany = vi.hoisted(() => vi.fn())
const mockRosterFindMany = vi.hoisted(() => vi.fn())
const mockProjFindFirst = vi.hoisted(() => vi.fn())

vi.mock('@/lib/prisma', () => ({
  prisma: {
    league: { findUnique: mockLeagueFindUnique },
    leagueTeam: { findMany: mockTeamFindMany },
    roster: { findMany: mockRosterFindMany },
    fantasyProjection: { findFirst: mockProjFindFirst },
  },
}))

vi.mock('@/lib/core-app/playerProjections', () => ({
  latestProjectionWeek: vi.fn(async () => ({ season: '2026', week: 12 })),
}))

// Not exercised (the fixture league scores no IDP keys); stubbed so importing the
// loader cannot reach anything that opens a connection.
vi.mock('@/lib/idp-projections/loadIdpProjections', () => ({
  loadIdpProjections: vi.fn(async () => ({ bySleeperId: new Map() })),
  mergeIdpStatLine: (a: Record<string, unknown> | null | undefined, b: Record<string, number>) => ({ ...(a ?? {}), ...b }),
}))

import { getPlayerLeagueView } from '@/lib/core-app/playerLeagueView'

const KINCAID = '10236'

const LEAGUE = {
  id: 'L-gang',
  name: 'Gridiron Gang',
  platform: 'espn',
  platformLeagueId: '777',
  season: 2026,
  leagueType: 'Keeper',
  settings: {
    scoring_settings: { rec: 0.5, rec_yd: 0.1, rec_td: 6 },
    roster_positions: ['QB', 'RB', 'WR', 'TE', 'FLEX', 'BN', 'BN'],
  },
}

const TASHA = {
  externalId: '1',
  platformUserId: 'u-tasha',
  claimedByUserId: null,
  ownerName: 'tashaR',
  teamName: "Tasha's Titans",
  avatarUrl: null,
  wins: 4,
  losses: 2,
  ties: 0,
  isCommissioner: false,
  isCoCommissioner: false,
}
const ME = { ...TASHA, externalId: '2', platformUserId: 'u-me', claimedByUserId: 'me', ownerName: 'guap', teamName: 'Cafe Con Chimmy', wins: 5, losses: 1 }

const PROJECTION = { stats: { stats: { rec: 6, rec_yd: 60, rec_td: 1 } } }

beforeEach(() => {
  mockLeagueFindUnique.mockReset().mockResolvedValue(LEAGUE)
  mockTeamFindMany.mockReset().mockResolvedValue([TASHA, ME])
  mockRosterFindMany.mockReset()
  mockProjFindFirst.mockReset().mockResolvedValue(PROJECTION)
})

describe('getPlayerLeagueView', () => {
  it('names the manager who has him, with the slot they hold him in', async () => {
    mockRosterFindMany.mockResolvedValue([
      { platformUserId: 'u-tasha', playerData: { players: [KINCAID, '50'], starters: [KINCAID] } },
      { platformUserId: 'u-me', playerData: { players: ['60'], starters: ['60'] } },
    ])
    const view = await getPlayerLeagueView('L-gang', KINCAID, 'me', { position: 'TE' })
    expect(view?.ownership).toEqual({
      kind: 'other',
      slot: 'STARTER',
      owner: { teamName: "Tasha's Titans", ownerName: 'tashaR', avatarUrl: null, record: '4-2', isCommissioner: false },
    })
    expect(view?.yourTeam).toEqual({ teamName: 'Cafe Con Chimmy' })
    expect(view?.leagueName).toBe('Gridiron Gang')
    expect(view?.platform).toBe('espn')
  })

  /* Priced under THIS league's rules: 6 rec × 0.5 + 60 yds × 0.1 + 1 TD × 6. */
  it('prices him under this league’s own scoring, whoever holds him', async () => {
    mockRosterFindMany.mockResolvedValue([
      { platformUserId: 'u-tasha', playerData: { players: [KINCAID], starters: [KINCAID] } },
    ])
    const view = await getPlayerLeagueView('L-gang', KINCAID, 'me', { position: 'TE' })
    expect(view?.afPoints.available).toBe(true)
    if (view?.afPoints.available) {
      expect(view.afPoints.data.points).toBeCloseTo(15, 5)
      expect(view.afPoints.data.week).toBe(12)
    }
  })

  it('recognises your own roster through the claimed team and pins the exact slot', async () => {
    mockRosterFindMany.mockResolvedValue([
      { platformUserId: 'u-tasha', playerData: { players: ['50'], starters: ['50'] } },
      // Five slots, five starters: index 3 is the TE slot.
      { platformUserId: 'u-me', playerData: { players: ['1', '2', '3', KINCAID, '5', '6'], starters: ['1', '2', '3', KINCAID, '5'] } },
    ])
    const view = await getPlayerLeagueView('L-gang', KINCAID, 'me', { position: 'TE' })
    expect(view?.ownership).toEqual({ kind: 'yours', slot: 'STARTER', exactSlot: 'TE', teamName: 'Cafe Con Chimmy' })
  })

  it('a bench player on your roster is BENCH, not a starter', async () => {
    mockRosterFindMany.mockResolvedValue([
      { platformUserId: 'u-me', playerData: { players: ['1', KINCAID], starters: ['1'] } },
    ])
    const view = await getPlayerLeagueView('L-gang', KINCAID, 'me', { position: 'TE' })
    expect(view?.ownership).toMatchObject({ kind: 'yours', slot: 'BENCH', exactSlot: null })
  })

  it('calls him a free agent only when rosters were read and none holds him', async () => {
    mockRosterFindMany.mockResolvedValue([
      { platformUserId: 'u-tasha', playerData: { players: ['50'], starters: ['50'] } },
      { platformUserId: 'u-me', playerData: { players: ['60'], starters: ['60'] } },
    ])
    const view = await getPlayerLeagueView('L-gang', KINCAID, 'me', { position: 'TE' })
    expect(view?.ownership).toEqual({ kind: 'free-agent' })
    expect(view?.rosterCount).toBe(2)
  })

  /* ⚠ ZERO ROSTERS IS "WE HAVE NOT LOOKED", NEVER "UNROSTERED". */
  it('refuses to call him unrostered in a league with no imported rosters', async () => {
    mockRosterFindMany.mockResolvedValue([])
    const view = await getPlayerLeagueView('L-gang', KINCAID, 'me', { position: 'TE' })
    expect(view?.ownership.kind).toBe('unknown')
  })

  /* The importers do not agree on whether ids are strings; the fold is the same one every read uses. */
  it('matches a numeric id in playerData through the same String fold as every other read', async () => {
    mockRosterFindMany.mockResolvedValue([
      { platformUserId: 'u-tasha', playerData: { players: [10236], reserve: [10236] } },
    ])
    const view = await getPlayerLeagueView('L-gang', KINCAID, 'me', { position: 'TE' })
    expect(view?.ownership).toMatchObject({ kind: 'other', slot: 'IR SLOT' })
  })

  it('says "another manager" rather than inventing a name when the team row is missing', async () => {
    mockTeamFindMany.mockResolvedValue([ME])
    mockRosterFindMany.mockResolvedValue([
      { platformUserId: 'u-ghost', playerData: { players: [KINCAID], starters: [] } },
    ])
    const view = await getPlayerLeagueView('L-gang', KINCAID, 'me', { position: 'TE' })
    expect(view?.ownership).toEqual({ kind: 'other', slot: 'BENCH', owner: null })
  })

  it('distinguishes "no scoring rules" from "no projection" in the reason', async () => {
    mockRosterFindMany.mockResolvedValue([{ platformUserId: 'u-tasha', playerData: { players: [KINCAID] } }])

    mockLeagueFindUnique.mockResolvedValue({ ...LEAGUE, settings: {} })
    const noRules = await getPlayerLeagueView('L-gang', KINCAID, 'me', { position: 'TE' })
    expect(noRules?.afPoints.available).toBe(false)
    if (!noRules?.afPoints.available) expect(noRules?.afPoints.reason).toMatch(/no scoring settings/)

    mockLeagueFindUnique.mockResolvedValue(LEAGUE)
    mockProjFindFirst.mockResolvedValue(null)
    const noProj = await getPlayerLeagueView('L-gang', KINCAID, 'me', { position: 'TE' })
    expect(noProj?.afPoints.available).toBe(false)
    if (!noProj?.afPoints.available) expect(noProj?.afPoints.reason).toMatch(/does not carry this player/)
  })

  it('returns null for a league that does not exist', async () => {
    mockLeagueFindUnique.mockResolvedValue(null)
    expect(await getPlayerLeagueView('nope', KINCAID, 'me')).toBeNull()
  })
})
