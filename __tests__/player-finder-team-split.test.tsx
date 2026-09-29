/**
 * "Where your starters come from": the split rule, the loader wired through loadPlayerShares, and the block.
 */
import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const db = vi.hoisted(() => ({
  teamFindMany: vi.fn(),
  leagueFindMany: vi.fn(),
  rosterFindMany: vi.fn(),
  playerFindMany: vi.fn(),
  injuryFindMany: vi.fn(),
  identityFindMany: vi.fn(),
}))
const byeMap = vi.hoisted(() => vi.fn())

vi.mock('server-only', () => ({}))
vi.mock('@/lib/prisma', () => ({
  prisma: {
    leagueTeam: { findMany: db.teamFindMany },
    league: { findMany: db.leagueFindMany },
    roster: { findMany: db.rosterFindMany },
    sportsPlayer: { findMany: db.playerFindMany },
    sportsInjury: { findMany: db.injuryFindMany },
    playerIdentityMap: { findMany: db.identityFindMany },
  },
}))
vi.mock('@/lib/core-app/byeWeekMap', () => ({ resolveByeWeekMap: byeMap }))

import { buildTeamSplit, PLAYERS_PER_TEAM, TEAMS_SHOWN, type SplitStarter } from '@/lib/core-app/teamSplit'
import { loadPlayerShares } from '@/lib/core-app/playerShares'
import { TeamSplit } from '@/components/core-app/player-finder/TeamSplit'

const s = (sleeperId: string, team: string | null, starts: number, position = 'WR', name = `P${sleeperId}`): SplitStarter => ({ sleeperId, name, team, position, starts })
const fold = (t: string) => ({ JAC: 'JAX', WSH: 'WAS' } as Record<string, string>)[t.toUpperCase()] ?? t.toUpperCase()

describe('buildTeamSplit (pure)', () => {
  it('splits starting SLOTS by club, over every slot including the ones with no club', () => {
    const out = buildTeamSplit({
      starters: [s('1', 'BUF', 9, 'QB', 'Josh Allen'), s('2', 'BUF', 3), s('3', 'KC', 4), s('4', null, 4), s('5', 'KC', 0), s('6', 'BUF', 5, 'DEF'), s('7', 'MIA', 2, 'K')],
      byes: null,
      currentWeek: null,
      fold,
    })!
    // Counted: 9 + 3 BUF, 4 KC, 4 unknown = 20. The bench (starts 0), DEF and K are not.
    expect(out.totalStarts).toBe(20)
    expect(out.unknownStarts).toBe(4)
    expect(out.teams.map((t) => [t.team, t.starts, t.share])).toEqual([
      ['BUF', 12, 0.6],
      ['KC', 4, 0.2],
    ])
    expect(out.teams[0].players).toEqual(['Josh Allen', 'P2'])
    expect(out.byesKnown).toBe(false)
    expect(out.worstBye).toBeNull()
  })

  it('folds club spellings into one club', () => {
    const out = buildTeamSplit({ starters: [s('1', 'JAC', 2), s('2', 'JAX', 3), s('3', 'WSH', 1)], byes: null, currentWeek: null, fold })!
    expect(out.teams.map((t) => [t.team, t.starts])).toEqual([
      ['JAX', 5],
      ['WAS', 1],
    ])
  })

  it(`shows ${TEAMS_SHOWN} clubs, counts the rest, and names ${PLAYERS_PER_TEAM} players a club, most starts first`, () => {
    const clubs = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H']
    const starters = clubs.flatMap((c, i) => [s(`${c}1`, c, 10 - i), s(`${c}2`, c, 1)])
    starters.push(s('A3', 'A', 4, 'WR', 'Third A'), s('A4', 'A', 2, 'WR', 'Fourth A'))
    const out = buildTeamSplit({ starters, byes: null, currentWeek: null, fold })!
    expect(out.teams.map((t) => t.team)).toEqual(['A', 'B', 'C', 'D', 'E', 'F'])
    expect(out.others).toEqual({ teams: 2, starts: 4 + 1 + 3 + 1 })
    expect(out.teams[0].players).toEqual(['PA1', 'Third A', 'Fourth A'])
  })

  it('the worst bye AHEAD: the week whose byes empty the most slots; played byes do not count', () => {
    const starters = [s('1', 'BUF', 6), s('2', 'KC', 5), s('3', 'MIA', 4), s('4', 'DET', 3)]
    const byes = { BUF: 4, KC: 9, MIA: 9, DET: 7, SF: 9 }
    const out = buildTeamSplit({ starters, byes, currentWeek: 5, fold })!
    // Week 4 (BUF, 6) has been played. Week 9: KC + MIA = 9 of 18; SF is not yours and adds nothing.
    expect(out.worstBye).toEqual({ week: 9, starts: 9, share: 0.5, teams: ['KC', 'MIA'] })
  })

  it('a tie goes to the earlier week; the current week still counts', () => {
    const out = buildTeamSplit({ starters: [s('1', 'BUF', 3), s('2', 'KC', 3)], byes: { BUF: 5, KC: 8 }, currentWeek: 5, fold })!
    expect(out.worstBye?.week).toBe(5)
  })

  it('knows the difference between "no bye ahead" and "byes unknown"', () => {
    const past = buildTeamSplit({ starters: [s('1', 'BUF', 3)], byes: { BUF: 4 }, currentWeek: 10, fold })!
    expect([past.byesKnown, past.worstBye]).toEqual([true, null])
    const noWeek = buildTeamSplit({ starters: [s('1', 'BUF', 3)], byes: { BUF: 12 }, currentWeek: null, fold })!
    expect([noWeek.byesKnown, noWeek.worstBye]).toEqual([false, null])
    const empty = buildTeamSplit({ starters: [s('1', 'BUF', 3)], byes: {}, currentWeek: 5, fold })!
    expect(empty.byesKnown).toBe(false)
  })

  it('nobody starting is no split', () => {
    expect(buildTeamSplit({ starters: [s('1', 'BUF', 0), s('2', 'KC', 3, 'K')], byes: null, currentWeek: null, fold })).toBeNull()
  })
})

describe('loadPlayerShares → teamSplit', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    db.identityFindMany.mockResolvedValue([])
    db.injuryFindMany.mockResolvedValue([])
    db.teamFindMany.mockResolvedValue([
      { leagueId: 'S1', platformUserId: 'me-s1', externalId: '1' },
      { leagueId: 'S2', platformUserId: 'me-s2', externalId: '1' },
    ])
    db.leagueFindMany.mockResolvedValue([
      { id: 'S1', platform: 'sleeper', season: 2026, settings: { leg: 5 } },
      { id: 'S2', platform: 'sleeper', season: 2026, settings: { leg: 5 } },
    ])
    db.rosterFindMany.mockResolvedValue([
      { leagueId: 'S1', platformUserId: 'me-s1', playerData: { starters: ['100', '200'], players: ['100', '200', '300'] } },
      { leagueId: 'S2', platformUserId: 'me-s2', playerData: { starters: ['100', '300'], players: ['100', '300'] } },
      { leagueId: 'S2', platformUserId: 'rival', playerData: { starters: ['900'], players: ['900'] } },
    ])
    const clubs: Record<string, string> = { '100': 'BUF', '200': 'KC', '300': 'BUF', '900': 'MIA' }
    db.playerFindMany.mockImplementation(async ({ where }: { where: { sleeperId: { in: string[] } } }) =>
      where.sleeperId.in.map((id) => ({ sleeperId: id, sport: 'NFL', externalId: `x-${id}`, name: `Player ${id}`, position: 'WR', team: clubs[id] ?? null, imageUrl: null })),
    )
    byeMap.mockResolvedValue({ BUF: 7, KC: 12, MIA: 7 })
  })

  it('splits YOUR starters only, and reads the byes for the leagues\' own season and week', async () => {
    const out = await loadPlayerShares('me', ['S1', 'S2'])
    if (!out.available) throw new Error(out.reason)
    const split = out.data.teamSplit!
    // Starts: 100 twice (BUF), 200 once (KC), 300 once (BUF). The rival's 900 is not yours.
    expect(split.totalStarts).toBe(4)
    expect(split.teams.map((t) => [t.team, t.starts])).toEqual([
      ['BUF', 3],
      ['KC', 1],
    ])
    expect(byeMap).toHaveBeenCalledWith(2026)
    expect(split.worstBye).toEqual({ week: 7, starts: 3, share: 0.75, teams: ['BUF'] })
  })

  it('a failed bye read still gives the split, without a bye call', async () => {
    byeMap.mockRejectedValueOnce(new Error('schedule down'))
    const out = await loadPlayerShares('me', ['S1', 'S2'])
    if (!out.available) throw new Error(out.reason)
    expect(out.data.teamSplit!.teams).toHaveLength(2)
    expect(out.data.teamSplit!.byesKnown).toBe(false)
  })

  it('the week comes from the leagues whose rosters were READ — unreadable leagues do not outvote them', async () => {
    db.teamFindMany.mockResolvedValue([
      { leagueId: 'S1', platformUserId: 'me-s1', externalId: '1' },
      { leagueId: 'Y1', platformUserId: 'me-y1', externalId: '3' },
      { leagueId: 'Y2', platformUserId: 'me-y2', externalId: '3' },
    ])
    db.leagueFindMany.mockResolvedValue([
      { id: 'S1', platform: 'sleeper', season: 2026, settings: { leg: 5 } },
      // Yahoo ids cannot be read, so these rosters are not in the split — and their week must not set it.
      { id: 'Y1', platform: 'yahoo', season: 2026, settings: { leg: 12 } },
      { id: 'Y2', platform: 'yahoo', season: 2026, settings: { leg: 12 } },
    ])
    db.rosterFindMany.mockResolvedValue([
      { leagueId: 'S1', platformUserId: 'me-s1', playerData: { starters: ['100', '200'], players: ['100', '200'] } },
      { leagueId: 'Y1', platformUserId: 'me-y1', playerData: { starters: ['100'], players: ['100'] } },
      { leagueId: 'Y2', platformUserId: 'me-y2', playerData: { starters: ['100'], players: ['100'] } },
    ])
    const out = await loadPlayerShares('me', ['S1', 'Y1', 'Y2'])
    if (!out.available) throw new Error(out.reason)
    // Week 5, not 12: BUF's week-7 bye is still ahead.
    expect(out.data.teamSplit!.worstBye).toMatchObject({ week: 7, teams: ['BUF'] })
  })

  it('no stated week: no bye read at all', async () => {
    db.leagueFindMany.mockResolvedValue([
      { id: 'S1', platform: 'sleeper', season: 2026, settings: {} },
      { id: 'S2', platform: 'sleeper', season: 2026, settings: {} },
    ])
    const out = await loadPlayerShares('me', ['S1', 'S2'])
    if (!out.available) throw new Error(out.reason)
    expect(byeMap).not.toHaveBeenCalled()
    expect(out.data.teamSplit!.byesKnown).toBe(false)
  })
})

describe('TeamSplit block', () => {
  const data = buildTeamSplit({
    starters: [s('1', 'BUF', 6, 'QB', 'Josh Allen'), s('2', 'KC', 3), s('3', 'MIA', 1), s('4', null, 2)],
    byes: { BUF: 7, KC: 10 },
    currentWeek: 5,
    fold,
  })

  it('shows each club\'s share of all your starting slots, and the biggest bye ahead', () => {
    render(<TeamSplit data={data} />)
    expect(screen.getByRole('group', { name: 'Where your starters come from' })).toBeTruthy()
    expect(screen.getByText('12 starting QB/RB/WR/TE slots across your rosters')).toBeTruthy()
    expect(screen.getByText('50% · 6 slots')).toBeTruthy()
    expect(screen.getByText('2 with no club on file')).toBeTruthy()
    expect(screen.getByText(/Week 7 is your biggest bye ahead:/).parentElement!.textContent).toContain('6 of your 12 starting slots (50%) are off — BUF.')
  })

  it('says so when byes are unknown, and renders nothing with no split', () => {
    const noBye = buildTeamSplit({ starters: [s('1', 'BUF', 2)], byes: null, currentWeek: null, fold })
    const { unmount } = render(<TeamSplit data={noBye} />)
    expect(screen.getByText(/Bye weeks aren.t on file yet/)).toBeTruthy()
    unmount()
    const { container } = render(<TeamSplit data={null} />)
    expect(container.innerHTML).toBe('')
  })
})
