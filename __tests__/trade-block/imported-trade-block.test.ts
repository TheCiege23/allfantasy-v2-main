// @vitest-environment node
/**
 * `lib/trade-block/importedTradeBlock` — the trade block for an imported Sleeper league, as marked
 * in AllFantasy (Sleeper does not share its own; measured 2026-09-17).
 *
 * The two rules that matter: only YOUR players can be listed, proved on the server from the claimed
 * team and its roster; and a listing stops counting the moment the team that listed him no longer has
 * him.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const leagueFindUnique = vi.fn()
const rosterFindMany = vi.fn()
const teamFindMany = vi.fn()
const entryFindMany = vi.fn()
const entryUpsert = vi.fn()
const entryUpdateMany = vi.fn()
const playerFindFirst = vi.fn()

vi.mock('server-only', () => ({}))
vi.mock('@/lib/prisma', () => ({
  prisma: {
    league: { findUnique: (...a: unknown[]) => leagueFindUnique(...a) },
    roster: { findMany: (...a: unknown[]) => rosterFindMany(...a) },
    leagueTeam: { findMany: (...a: unknown[]) => teamFindMany(...a) },
    tradeBlockEntry: {
      findMany: (...a: unknown[]) => entryFindMany(...a),
      upsert: (...a: unknown[]) => entryUpsert(...a),
      updateMany: (...a: unknown[]) => entryUpdateMany(...a),
    },
    sportsPlayer: { findFirst: (...a: unknown[]) => playerFindFirst(...a) },
  },
}))

import {
  currentListings,
  readTradeBlock,
  setTradeBlock,
  sleeperRosterIdOf,
  teamForRoster,
  tradeBlockListingFor,
  tradeBlockSupport,
  yourRoster,
} from '@/lib/trade-block/importedTradeBlock'

const LEAGUE = { id: 'lg-1', platform: 'sleeper', platformLeagueId: '1313532725151399936' }

/* Two managers. Sleeper owner ids are 18 digits; roster ids are 1..N. */
const MY_ROSTER = {
  platformUserId: '700000000000000001',
  playerData: { players: ['4046', '9221'], starters: ['4046'], reserve: [], taxi: [], source_team_id: 3 },
}
const THEIR_ROSTER = {
  platformUserId: '700000000000000002',
  playerData: { players: ['10229', '6794'], starters: ['10229'], source_team_id: '7' },
}
const MY_TEAM = {
  id: 'team-3',
  externalId: '3',
  platformUserId: '700000000000000001',
  claimedByUserId: 'u-me',
  ownerName: 'TheCiege26',
  teamName: 'Ice Kings',
}
const THEIR_TEAM = {
  id: 'team-7',
  externalId: '7',
  platformUserId: '700000000000000002',
  claimedByUserId: null,
  ownerName: 'Jordan',
  teamName: 'Gridiron Vultures',
}

const entry = (over: Record<string, unknown> = {}) => ({
  playerId: '10229',
  rosterId: 7,
  playerName: 'Rashee Rice',
  position: 'WR',
  team: 'KC',
  createdByUsername: 'Jordan',
  updatedAt: new Date('2026-09-15T12:00:00Z'),
  ...over,
})

beforeEach(() => {
  for (const f of [leagueFindUnique, rosterFindMany, teamFindMany, entryFindMany, entryUpsert, entryUpdateMany, playerFindFirst]) {
    f.mockReset()
  }
  leagueFindUnique.mockResolvedValue(LEAGUE)
  rosterFindMany.mockResolvedValue([MY_ROSTER, THEIR_ROSTER])
  teamFindMany.mockResolvedValue([MY_TEAM, THEIR_TEAM])
  entryFindMany.mockResolvedValue([])
  entryUpsert.mockResolvedValue({})
  entryUpdateMany.mockResolvedValue({ count: 1 })
  playerFindFirst.mockResolvedValue({ name: 'Jahmyr Gibbs', position: 'RB', team: 'DET' })
})

describe('tradeBlockSupport', () => {
  it('Sleeper is supported, and the note says its own block is not visible', () => {
    const s = tradeBlockSupport('Sleeper')
    expect(s.supported).toBe(true)
    expect(s.note).toMatch(/Sleeper doesn't share its trade block/)
  })

  it.each([
    ['espn', 'ESPN'],
    ['yahoo', 'Yahoo'],
    ['fleaflicker', 'Fleaflicker'],
    ['mfl', 'MyFantasyLeague'],
  ])('%s is not supported, and the note names the platform', (platform, label) => {
    const s = tradeBlockSupport(platform)
    expect(s.supported).toBe(false)
    expect(s.note).toBe(
      `${label} doesn't share its trade block with AllFantasy, and marking players here is only available for Sleeper leagues so far.`,
    )
  })

  it('an unknown or missing platform is unsupported, never Sleeper', () => {
    expect(tradeBlockSupport(null).supported).toBe(false)
    expect(tradeBlockSupport('manual').note).toMatch(/^This platform doesn't share/)
  })
})

describe('sleeperRosterIdOf', () => {
  it('reads the roster id from the roster first, then the team', () => {
    expect(sleeperRosterIdOf(MY_ROSTER, THEIR_TEAM)).toBe(3)
    expect(sleeperRosterIdOf({ platformUserId: 'x', playerData: {} }, MY_TEAM)).toBe(3)
  })

  /*
   * 🛑 The import falls back to the OWNER id when a roster id is missing, and an owner id is all
   * digits too. Storing one as `rosterId` would match no roster, ever — or overflow the column.
   */
  it('refuses an owner id that is standing in for a roster id', () => {
    const r = { platformUserId: 'x', playerData: { source_team_id: '700000000000000001' } }
    expect(sleeperRosterIdOf(r, { ...MY_TEAM, externalId: '700000000000000001' })).toBeNull()
    expect(sleeperRosterIdOf({ platformUserId: 'x', playerData: { source_team_id: 0 } }, null)).toBeNull()
    expect(sleeperRosterIdOf({ platformUserId: 'x', playerData: { source_team_id: 'abc' } }, null)).toBeNull()
  })
})

/*
 * 🛑 A CLAIMED team's roster is keyed by the claimant's AllFantasy id, not the Sleeper owner id —
 * measured on production 2026-09-17, where owner-id matching named no team for 5 of 12 rosters.
 */
describe('teamForRoster', () => {
  const claimedRoster = { platformUserId: 'u-me', playerData: { players: ['9221'] } }

  it('names a claimed team whose roster is keyed by the claimant', () => {
    const t = teamForRoster(claimedRoster, [THEIR_TEAM, { ...MY_TEAM, platformUserId: '700000000000000001' }])
    expect(t?.teamName).toBe('Ice Kings')
  })

  it('matches the Sleeper roster id first, as a number or a string', () => {
    const numeric = { platformUserId: 'someone-else', playerData: { source_team_id: 7 } }
    const text = { platformUserId: 'someone-else', playerData: { source_team_id: '7' } }
    expect(teamForRoster(numeric, [MY_TEAM, THEIR_TEAM])?.teamName).toBe('Gridiron Vultures')
    expect(teamForRoster(text, [MY_TEAM, THEIR_TEAM])?.teamName).toBe('Gridiron Vultures')
    // The roster id wins over an owner id that points at another team.
    const conflicting = { platformUserId: MY_TEAM.platformUserId, playerData: { source_team_id: '7' } }
    expect(teamForRoster(conflicting, [MY_TEAM, THEIR_TEAM])?.teamName).toBe('Gridiron Vultures')
  })

  it('falls back to the owner id, then to a roster keyed by the team external id', () => {
    expect(teamForRoster({ platformUserId: '700000000000000002', playerData: {} }, [MY_TEAM, THEIR_TEAM])?.teamName).toBe(
      'Gridiron Vultures',
    )
    expect(teamForRoster({ platformUserId: '7', playerData: {} }, [MY_TEAM, { ...THEIR_TEAM, platformUserId: null }])?.teamName).toBe(
      'Gridiron Vultures',
    )
  })

  it('is null when nothing matches', () => {
    expect(teamForRoster({ platformUserId: 'nobody', playerData: {} }, [MY_TEAM, THEIR_TEAM])).toBeNull()
  })
})

describe('yourRoster', () => {
  it('is the roster of the team you claimed', () => {
    expect(yourRoster('u-me', [THEIR_ROSTER, MY_ROSTER], [THEIR_TEAM, MY_TEAM])?.roster).toBe(MY_ROSTER)
  })

  it('is null when you claimed no team, or your team has no roster', () => {
    expect(yourRoster('u-other', [MY_ROSTER, THEIR_ROSTER], [MY_TEAM, THEIR_TEAM])).toBeNull()
    expect(yourRoster('u-me', [THEIR_ROSTER], [MY_TEAM, THEIR_TEAM])).toBeNull()
  })

  it('matches a roster through the team externalId when the import put it there', () => {
    const orphanish = { ...MY_ROSTER, platformUserId: '3' }
    expect(yourRoster('u-me', [orphanish], [{ ...MY_TEAM, platformUserId: null }])?.roster).toBe(orphanish)
  })
})

describe('currentListings', () => {
  it('keeps a listing while the listing roster still holds him, named by that team', () => {
    const out = currentListings([entry()], [MY_ROSTER, THEIR_ROSTER], [MY_TEAM, THEIR_TEAM])
    expect(out).toEqual([
      {
        sleeperId: '10229',
        playerName: 'Rashee Rice',
        position: 'WR',
        nflTeam: 'KC',
        rosterId: 7,
        teamName: 'Gridiron Vultures',
        ownerName: 'Jordan',
        since: '2026-09-15T12:00:00.000Z',
      },
    ])
  })

  /* 🛑 Traded after he was listed: the row still says roster 7, but roster 7 no longer has him. */
  it('drops a listing once the player has moved to another roster', () => {
    const traded = { ...THEIR_ROSTER, playerData: { players: ['6794'], source_team_id: 7 } }
    const mine = { ...MY_ROSTER, playerData: { ...MY_ROSTER.playerData, players: ['4046', '9221', '10229'] } }
    expect(currentListings([entry()], [mine, traded], [MY_TEAM, THEIR_TEAM])).toEqual([])
  })

  it('names the listing team for a claimed roster keyed by the claimant', () => {
    const claimed = { platformUserId: 'u-them', playerData: { players: ['10229'], source_team_id: '7' } }
    const out = currentListings([entry()], [MY_ROSTER, claimed], [MY_TEAM, { ...THEIR_TEAM, claimedByUserId: 'u-them' }])
    expect(out.map((l) => l.teamName)).toEqual(['Gridiron Vultures'])
  })

  /*
   * 🛑 GHOST ROSTER ROWS SHARE A ROSTER ID — 33 in production across 29 leagues, left behind by owner
   * changes. If the empty one answered for the id, every listing from that team would vanish.
   */
  it('keeps the listing when a ghost roster row shares the roster id and sorts first', () => {
    const ghost = { platformUserId: 'ghost', playerData: { players: [], source_team_id: '7' } }
    const out = currentListings([entry()], [ghost, THEIR_ROSTER], [MY_TEAM, THEIR_TEAM])
    expect(out.map((l) => l.playerName)).toEqual(['Rashee Rice'])
  })

  it('and when the ghost sorts last', () => {
    const ghost = { platformUserId: 'ghost', playerData: { players: [], source_team_id: '7' } }
    expect(currentListings([entry()], [THEIR_ROSTER, ghost], [MY_TEAM, THEIR_TEAM])).toHaveLength(1)
  })

  it('drops a listing whose roster id matches no roster', () => {
    expect(currentListings([entry({ rosterId: 11 })], [MY_ROSTER, THEIR_ROSTER], [MY_TEAM, THEIR_TEAM])).toEqual([])
  })

  it('finds him in taxi and reserve too', () => {
    const taxi = { ...THEIR_ROSTER, playerData: { players: [], taxi: ['10229'], source_team_id: 7 } }
    expect(currentListings([entry()], [taxi], [THEIR_TEAM])).toHaveLength(1)
    const ir = { ...THEIR_ROSTER, playerData: { players: [], reserve: ['10229'], source_team_id: 7 } }
    expect(currentListings([entry()], [ir], [THEIR_TEAM])).toHaveLength(1)
  })
})

describe('readTradeBlock', () => {
  it('reads active rows for the Sleeper league id and filters them', async () => {
    entryFindMany.mockResolvedValue([entry(), entry({ playerId: '4046', rosterId: 7, playerName: 'Moved Away' })])
    const read = await readTradeBlock('lg-1')
    expect(entryFindMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { sleeperLeagueId: '1313532725151399936', isActive: true } }),
    )
    expect(read?.support.supported).toBe(true)
    expect(read?.listings.map((l) => l.playerName)).toEqual(['Rashee Rice'])
  })

  it('does not query the table for a platform it cannot hold listings for', async () => {
    leagueFindUnique.mockResolvedValue({ ...LEAGUE, platform: 'espn' })
    const read = await readTradeBlock('lg-1')
    expect(read).toEqual({ support: tradeBlockSupport('espn'), listings: [] })
    expect(entryFindMany).not.toHaveBeenCalled()
  })

  it('is null for a league that does not exist', async () => {
    leagueFindUnique.mockResolvedValue(null)
    expect(await readTradeBlock('nope')).toBeNull()
  })

  /*
   * 🛑 A failed read is UNKNOWN, not empty. Swallowed into an empty list it would read as "nobody is
   * on the block" — and a failed roster read would drop every listing the same way.
   */
  it('a failed table read is null, not an empty block', async () => {
    entryFindMany.mockRejectedValue(new Error('P2021'))
    expect(await readTradeBlock('lg-1')).toBeNull()
  })

  it('a failed roster or team read is null, not an empty block', async () => {
    entryFindMany.mockResolvedValue([entry()])
    rosterFindMany.mockRejectedValueOnce(new Error('timeout'))
    expect(await readTradeBlock('lg-1')).toBeNull()
    teamFindMany.mockRejectedValueOnce(new Error('timeout'))
    expect(await readTradeBlock('lg-1')).toBeNull()
    leagueFindUnique.mockRejectedValueOnce(new Error('timeout'))
    expect(await readTradeBlock('lg-1')).toBeNull()
  })

  it('tradeBlockListingFor returns only that player', async () => {
    entryFindMany.mockResolvedValue([entry()])
    expect((await tradeBlockListingFor('lg-1', '10229'))?.teamName).toBe('Gridiron Vultures')
    expect(await tradeBlockListingFor('lg-1', '6794')).toBeNull()
  })

  it('tradeBlockListingFor throws when the block could not be read — unreadable is not "not listed"', async () => {
    entryFindMany.mockRejectedValue(new Error('P2021'))
    await expect(tradeBlockListingFor('lg-1', '10229')).rejects.toThrow(/could not be read/)
  })
})

describe('setTradeBlock', () => {
  it('🛑 lists YOUR player with a snapshot from our player row and your roster id', async () => {
    const out = await setTradeBlock({ leagueId: 'lg-1', userId: 'u-me', sleeperId: '9221', onBlock: true })
    expect(out).toEqual({ ok: true, onBlock: true })
    expect(playerFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { sleeperId: '9221', sport: { equals: 'NFL', mode: 'insensitive' } } }),
    )
    const snapshot = {
      rosterId: 3,
      playerName: 'Jahmyr Gibbs',
      position: 'RB',
      team: 'DET',
      createdByUsername: 'TheCiege26',
      isActive: true,
    }
    expect(entryUpsert).toHaveBeenCalledWith({
      where: { sleeperLeagueId_playerId: { sleeperLeagueId: '1313532725151399936', playerId: '9221' } },
      create: { sleeperLeagueId: '1313532725151399936', playerId: '9221', ...snapshot },
      update: snapshot,
    })
  })

  it('🛑 refuses someone else’s player and writes nothing', async () => {
    const out = await setTradeBlock({ leagueId: 'lg-1', userId: 'u-me', sleeperId: '10229', onBlock: true })
    expect(out).toMatchObject({ ok: false, reason: 'not_your_player' })
    expect(entryUpsert).not.toHaveBeenCalled()
    expect(entryUpdateMany).not.toHaveBeenCalled()
  })

  it('🛑 refuses to take someone else’s player OFF their block', async () => {
    const out = await setTradeBlock({ leagueId: 'lg-1', userId: 'u-me', sleeperId: '10229', onBlock: false })
    expect(out).toMatchObject({ ok: false, reason: 'not_your_player' })
    expect(entryUpdateMany).not.toHaveBeenCalled()
  })

  it('refuses a member who has not claimed a team', async () => {
    const out = await setTradeBlock({ leagueId: 'lg-1', userId: 'u-other', sleeperId: '9221', onBlock: true })
    expect(out).toMatchObject({ ok: false, reason: 'no_team' })
    expect(entryUpsert).not.toHaveBeenCalled()
  })

  it('refuses a platform it cannot hold listings for, with the platform note', async () => {
    leagueFindUnique.mockResolvedValue({ ...LEAGUE, platform: 'yahoo' })
    const out = await setTradeBlock({ leagueId: 'lg-1', userId: 'u-me', sleeperId: '9221', onBlock: true })
    expect(out).toEqual({ ok: false, reason: 'unsupported_platform', message: tradeBlockSupport('yahoo').note })
    expect(rosterFindMany).toHaveBeenCalled()
    expect(entryUpsert).not.toHaveBeenCalled()
  })

  it('refuses a league with no Sleeper id, and a missing league', async () => {
    leagueFindUnique.mockResolvedValueOnce({ ...LEAGUE, platformLeagueId: null })
    expect(await setTradeBlock({ leagueId: 'lg-1', userId: 'u-me', sleeperId: '9221', onBlock: true })).toMatchObject({
      reason: 'unsupported_platform',
    })
    leagueFindUnique.mockResolvedValueOnce(null)
    expect(await setTradeBlock({ leagueId: 'lg-1', userId: 'u-me', sleeperId: '9221', onBlock: true })).toMatchObject({
      reason: 'league_not_found',
    })
  })

  it('refuses when your roster id is not on file, rather than storing a wrong one', async () => {
    rosterFindMany.mockResolvedValue([{ ...MY_ROSTER, playerData: { players: ['9221'] } }, THEIR_ROSTER])
    teamFindMany.mockResolvedValue([{ ...MY_TEAM, externalId: '700000000000000001' }, THEIR_TEAM])
    const out = await setTradeBlock({ leagueId: 'lg-1', userId: 'u-me', sleeperId: '9221', onBlock: true })
    expect(out).toMatchObject({ ok: false, reason: 'no_roster_id' })
    expect(entryUpsert).not.toHaveBeenCalled()
  })

  it('taking him off deactivates the row rather than deleting it', async () => {
    const out = await setTradeBlock({ leagueId: 'lg-1', userId: 'u-me', sleeperId: '9221', onBlock: false })
    expect(out).toEqual({ ok: true, onBlock: false })
    expect(entryUpdateMany).toHaveBeenCalledWith({
      where: { sleeperLeagueId: '1313532725151399936', playerId: '9221' },
      data: { isActive: false },
    })
    expect(entryUpsert).not.toHaveBeenCalled()
  })

  it('a failed league read throws rather than answering "league not found"', async () => {
    rosterFindMany.mockRejectedValue(new Error('timeout'))
    await expect(setTradeBlock({ leagueId: 'lg-1', userId: 'u-me', sleeperId: '9221', onBlock: true })).rejects.toThrow(
      'timeout',
    )
    expect(entryUpsert).not.toHaveBeenCalled()
  })

  /* 🛑 Production holds full club names for some rows; the column is 8 characters. */
  it('stores the club CODE, never a truncated club name', async () => {
    playerFindFirst.mockResolvedValue({ name: 'Tre Tucker', position: 'WR', team: 'Las Vegas Raiders' })
    await setTradeBlock({ leagueId: 'lg-1', userId: 'u-me', sleeperId: '9221', onBlock: true })
    expect(entryUpsert.mock.calls[0][0].create).toMatchObject({ playerName: 'Tre Tucker', team: 'LV' })
  })

  it('leaves the club out when it still does not fit', async () => {
    playerFindFirst.mockResolvedValue({ name: 'Someone', position: 'WR', team: 'Some Long Unknown Club' })
    await setTradeBlock({ leagueId: 'lg-1', userId: 'u-me', sleeperId: '9221', onBlock: true })
    expect(entryUpsert.mock.calls[0][0].create).toMatchObject({ team: null })
  })

  it('an unknown player still lists under a placeholder name, never a client-supplied one', async () => {
    playerFindFirst.mockResolvedValue(null)
    await setTradeBlock({ leagueId: 'lg-1', userId: 'u-me', sleeperId: '9221', onBlock: true })
    expect(entryUpsert.mock.calls[0][0].create).toMatchObject({ playerName: 'Player 9221', position: null, team: null })
  })
})
