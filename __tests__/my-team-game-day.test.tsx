import React from 'react'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { render } from '@testing-library/react'

vi.mock('server-only', () => ({}))
vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => '/core/my-team',
  useSearchParams: () => new URLSearchParams(),
}))
const findGames = vi.fn()
const findScores = vi.fn()
vi.mock('@/lib/prisma', () => ({
  prisma: {
    sportsGame: { findMany: (...a: unknown[]) => findGames(...a) },
    leaguePlayerWeeklyScore: { findMany: (...a: unknown[]) => findScores(...a) },
  },
}))

import { playerGameDay, readLineupGameDay, summariseStarterGameDay } from '@/lib/core-app/myTeamGameDay'
import { MyTeam } from '@/components/core-app/screens/MyTeam'
import { formatKickoff, type LineupPlayer, type MyTeamData } from '@/lib/core-app/myTeam'

/*
 * Measured 2026-10-02 on a live KBFL roster: three starters had played Thursday's PIT @ CLE,
 * the board said "3 starters past kickoff", and the league view still showed all three with
 * projections, a 79° forecast and an undated "Thu 8:15p ET".
 */
const NOW = new Date('2026-10-02T21:00:00Z') // Friday
const THU = new Date('2026-10-02T00:15:00Z') // Thu 10/1 8:15p ET
const SUN = new Date('2026-10-04T17:00:00Z') // Sun 10/4 1:00p ET

beforeAll(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true })
  vi.setSystemTime(NOW)
})
afterAll(() => vi.useRealTimers())
beforeEach(() => {
  findGames.mockReset()
  findScores.mockReset()
})

describe('playerGameDay', () => {
  it('takes final and live from the provider status', () => {
    expect(playerGameDay('final', THU, 12.4, NOW)).toEqual({ state: 'final', points: 12.4 })
    expect(playerGameDay('live', THU, 6.2, NOW)).toEqual({ state: 'live', points: 6.2 })
  })

  it('past kickoff with no fresh status is "started", never "final"', () => {
    expect(playerGameDay('unknown', THU, 8, NOW)).toEqual({ state: 'started', points: 8 })
    expect(playerGameDay(undefined, THU, undefined, NOW)).toEqual({ state: 'started', points: null })
    // A stale "scheduled" row cannot overrule a kickoff that has passed.
    expect(playerGameDay('upcoming', THU, undefined, NOW).state).toBe('started')
  })

  it("hides Sleeper's placeholder 0 on a game that has not kicked off", () => {
    expect(playerGameDay('upcoming', SUN, 0, NOW)).toEqual({ state: 'upcoming', points: null })
    expect(playerGameDay('unknown', SUN, 0, NOW)).toEqual({ state: 'upcoming', points: null })
    expect(playerGameDay('unknown', null, 0, NOW)).toEqual({ state: 'upcoming', points: null })
  })

  it('keeps a real zero once the game is final', () => {
    expect(playerGameDay('final', THU, 0, NOW)).toEqual({ state: 'final', points: 0 })
  })
})

describe('summariseStarterGameDay', () => {
  it('counts each state and sums only the points it holds', () => {
    expect(
      summariseStarterGameDay([
        { state: 'final', points: 12.4 },
        { state: 'final', points: null },
        { state: 'live', points: 3.1 },
        { state: 'upcoming', points: null },
        { state: 'upcoming', points: null },
      ]),
    ).toEqual({ final: 2, live: 1, started: 0, upcoming: 2, scored: 15.5, scoredCount: 2 })
  })

  it('reports no score, not zero, when no score row is held', () => {
    expect(summariseStarterGameDay([{ state: 'final', points: null }]).scored).toBeNull()
  })
})

describe('readLineupGameDay', () => {
  const week = { season: 2026, week: 4, seasonType: 'regular', firstKickoff: THU, preseasonFirst: false } as never

  it('joins provider game status and platform points onto roster ids', async () => {
    findGames.mockResolvedValue([
      { homeTeam: 'CLE', awayTeam: 'PIT', status: 'final', startTime: THU, fetchedAt: NOW, seasonType: 'regular' },
      { homeTeam: 'CHI', awayTeam: 'NYJ', status: 'scheduled', startTime: SUN, fetchedAt: NOW, seasonType: 'regular' },
    ])
    findScores.mockResolvedValue([
      { playerId: 'homer', points: 5.4 },
      { playerId: 'allen', points: 0 }, // Sleeper's placeholder for an unplayed starter
    ])
    const out = await readLineupGameDay({
      sport: 'NFL',
      week,
      platformLeagueId: '1338541390891606016',
      players: new Map([
        ['homer', { team: 'PIT', kickoff: THU }],
        ['allen', { team: 'NYJ', kickoff: SUN }],
      ]),
      now: NOW,
    })
    expect(out.get('homer')).toEqual({ state: 'final', points: 5.4 })
    expect(out.get('allen')).toEqual({ state: 'upcoming', points: null })
    // The score table is keyed on the PLATFORM's league id and this week only.
    expect(findScores.mock.calls[0][0].where).toMatchObject({
      leagueId: '1338541390891606016', seasonYear: 2026, week: 4,
    })
  })

  it('reads nothing without a week, and survives a failed read', async () => {
    expect((await readLineupGameDay({ sport: 'NFL', week: null, platformLeagueId: 'x', players: new Map([['a', { team: 'PIT', kickoff: THU }]]) })).size).toBe(0)
    expect(findGames).not.toHaveBeenCalled()

    findGames.mockRejectedValue(new Error('db down'))
    findScores.mockRejectedValue(new Error('db down'))
    const out = await readLineupGameDay({ sport: 'NFL', week, platformLeagueId: 'x', players: new Map([['a', { team: 'PIT', kickoff: THU }]]), now: NOW })
    // No status and no score, but the kickoff has passed: "started", with no invented number.
    expect(out.get('a')).toEqual({ state: 'started', points: null })
  })
})

function player(over: Partial<LineupPlayer> = {}): LineupPlayer {
  return {
    sleeperId: 'p1', name: 'Travis Homer', position: 'RB', team: 'PIT', sport: 'NFL', imageUrl: null,
    gameContext: 'PIT @ CLE · Thu 10/1 8:15p ET', kickoff: THU, preseason: false, venue: null,
    injuryStatus: null, ruledOut: false, projectedPoints: 5.8, afProjectedPoints: 5.8,
    afEngineProjectedPoints: 5.3, indoors: false,
    weather: { indoors: false, temperatureF: 79, windSpeedMph: 18, precipChancePct: 0, conditionLabel: 'Windy', symbol: '💨' },
    market: null, onBye: false,
    ...over,
  }
}

function data(starters: LineupPlayer[], over: Partial<MyTeamData> = {}): MyTeamData {
  return {
    league: { id: 'l1', name: 'KBFL', platform: 'sleeper', format: 'dynasty' },
    team: { available: false, reason: 'n/a' },
    starters: {
      available: true,
      data: starters.map((p) => ({ slotLabel: 'FLEX', player: p, empty: false, unresolvedId: null })),
    },
    bench: { available: false, reason: 'none' },
    ir: { available: false, reason: 'none' },
    taxi: { available: false, reason: 'none' },
    lock: { available: false, reason: 'n/a' },
    projections: { available: false, reason: 'n/a' },
    projectionBasis: { notes: [], scoringKnown: false },
    nextMatchup: { available: false, reason: 'n/a' },
    upcomingByes: [],
    rosterGrade: { available: false, reason: 'n/a' },
    liveScore: { available: false, reason: 'n/a' },
    ...over,
  } as MyTeamData
}

describe('formatKickoff', () => {
  it('dates the weekday, in Eastern time, so last night reads differently from next week', () => {
    expect(formatKickoff(THU)).toBe('Thu 10/1 8:15p ET')
    expect(formatKickoff(SUN)).toBe('Sun 10/4 1:00p ET')
    // A UTC-midnight kickoff keeps its Eastern day, not the next one.
    expect(formatKickoff(new Date('2026-10-06T00:15:00Z'))).toBe('Mon 10/5 8:15p ET')
    expect(formatKickoff(null)).toBeNull()
  })
})

describe('MyTeam rows on game day', () => {
  it('marks a played starter Final with his points, and drops the stale forecast', () => {
    const { container } = render(
      <MyTeam data={data([player({ gameDay: { state: 'final', points: 12.4 } })])} />,
    )
    const row = container.querySelector('#lineup-player-p1')!
    expect(row.getAttribute('data-game')).toBe('final')
    const chip = row.querySelector('.af-mt-gameday')!
    expect(chip.textContent).toContain('Final')
    expect(chip.textContent).toContain('12.4 pts')
    expect(row.querySelector('.af-mt-venue')).toBeNull()
    expect(row.textContent).not.toContain('79°')
    expect(row.textContent).toContain('Thu 10/1 8:15p ET')
  })

  it('says Final with no number when the platform score is not imported', () => {
    const { container } = render(
      <MyTeam data={data([player({ gameDay: { state: 'final', points: null } })])} />,
    )
    const chip = container.querySelector('.af-mt-gameday')!
    expect(chip.textContent).toBe('Final')
  })

  it('leaves an upcoming row exactly as before', () => {
    const { container } = render(
      <MyTeam data={data([player({ kickoff: SUN, gameDay: { state: 'upcoming', points: null } })])} />,
    )
    expect(container.querySelector('.af-mt-gameday')).toBeNull()
    expect(container.querySelector('.af-mt-venue')).not.toBeNull()
  })

  it('summarises the week so far above the starters', () => {
    const { container } = render(
      <MyTeam
        data={data([player()], {
          starterGameDay: { final: 3, live: 0, started: 0, upcoming: 13, scored: 41.2, scoredCount: 3 },
        })}
      />,
    )
    const line = container.querySelector('.af-mt-gameday-line')!
    expect(line.textContent).toContain('3 final')
    expect(line.textContent).toContain('13 to play')
    expect(line.textContent).toContain('41.2 pts scored')
    expect(line.textContent).not.toContain('live')
  })

  it('shows no summary line before anyone has kicked off', () => {
    const { container } = render(<MyTeam data={data([player({ kickoff: SUN })], { starterGameDay: null })} />)
    expect(container.querySelector('.af-mt-gameday-line')).toBeNull()
  })
})
