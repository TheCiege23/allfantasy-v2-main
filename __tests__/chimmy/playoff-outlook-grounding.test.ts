import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))

import { buildPlayoffOutlookContext, type PlayoffOutlookDeps } from '@/lib/chimmy/playoffOutlookGrounding'
import type { OutlookLeague, OutlookTeam, SeasonOutlook } from '@/lib/core-app/seasonOutlook'

/**
 * Chimmy's playoff answer is the Season Outlook simulator's, verbatim. These pin that every number
 * it prints comes from the outlook it was handed, that a league the simulator could not run says
 * so instead of guessing, and that the league comes only from the session.
 */

const team = (over: Partial<OutlookTeam> & Pick<OutlookTeam, 'rosterId' | 'name' | 'seed'>): OutlookTeam => ({
  isYou: false,
  wins: 4,
  losses: 3,
  pointsFor: 800,
  playoffPct: 50,
  byePct: 10,
  titlePct: 8,
  missPct: 50,
  range: null,
  status: null,
  modelled: true,
  weeksFitted: 7,
  weeklyMean: 115,
  expectedWins: 4,
  schedule: null,
  ...over,
})

const YOU = team({
  rosterId: '3',
  name: 'Gridiron Gurus',
  seed: 5,
  isYou: true,
  wins: 5,
  losses: 2,
  pointsFor: 845.6,
  playoffPct: 62.4,
  byePct: 14.2,
  titlePct: 11.3,
  range: { playoff: { lo: 55, hi: 70 }, bye: { lo: 9, hi: 19 }, title: { lo: 8, hi: 15 } },
  expectedWins: 3.6,
  schedule: {
    pastOpponentMu: 110,
    remainingOpponentMu: 121,
    pastRank: 10,
    remainingRank: 2,
    leagueMu: 115,
    pastGames: 7,
    remainingGames: 7,
  },
})

const league = (over: Partial<OutlookLeague> = {}): OutlookLeague => ({
  leagueId: 'L1',
  leagueName: 'KBFL',
  platform: 'sleeper',
  season: 2026,
  weeksRemaining: 7,
  playoffTeams: 6,
  byeTeams: 2,
  you: YOU,
  teams: [team({ rosterId: '1', name: 'Top Dogs', seed: 1, wins: 7, losses: 0, playoffPct: 99.6, status: 'clinched' }), YOU],
  whatDecidesIt: 'Get to 9 wins — that is in more often than not.',
  href: '/core?league=L1',
  milestones: {
    totalGames: 14,
    winsForLikely: 8,
    winsForSafe: 9,
    cutWinsMedian: 8,
    cutWinsLow: 7,
    cutWinsHigh: 9,
    cutPointsMedian: 1612.4,
    cutPointsLow: 1500,
    cutPointsHigh: 1700,
    projectedWins: 8,
    projectedPoints: 1690,
    oddsByWins: [],
    currentWins: 5,
    maxWins: 12,
  },
  assumptions: {
    iterations: 10000,
    rangeBatches: 10,
    rangeRunsPerBatch: 500,
    seasonsFitted: [2026],
    weeksFitted: { min: 7, median: 7, max: 7 },
    teams: 12,
    modelledTeams: 12,
    remainingGames: 42,
    regularSeasonEndWeek: 14,
    playoffTeams: { value: 6, source: 'league_settings' as never },
    byes: { value: 2, source: 'league_settings' as never },
    tiebreak: 'Wins, then points for.',
    computedAt: '2026-09-24T12:00:00.000Z',
    reused: true,
    missing: ['Trades and waiver moves after today'],
  },
  focus: {
    scenario: {} as never,
    drivers: [{ key: 'schedule', label: 'Remaining schedule', detail: 'Four of seven against top-four scorers.', impact: -6.2, spread: false }],
    moves: [
      {
        key: 'm1',
        kind: 'waiver',
        title: 'Add Rashod Bateman',
        detail: 'Replaces your weakest WR start.',
        week: null,
        pointsPerWeek: 3.4,
        playoffDelta: 4.1,
        titleDelta: 1.2,
        href: '/core',
      },
    ],
    durability: null,
    branchIterations: 2000,
    notes: [],
  },
  ...over,
})

const outlook = (over: Partial<SeasonOutlook> = {}): SeasonOutlook => ({
  leagues: [league()],
  summary: { makingPlayoffs: 1, clinched: 0, onTheBubble: 1, onByePace: 0, bestTitle: { pct: 11.3, leagueName: 'KBFL' } },
  weekThatMatters: null,
  swingByLeague: {
    L1: {
      leagueId: 'L1',
      leagueName: 'KBFL',
      week: 8,
      opponentName: 'Waiver Wire Warriors',
      ifWin: 74.2,
      ifLose: 48.9,
      swing: 25.3,
      clinchOnWin: false,
      helpIfLose: ['Top Dogs'],
    },
  },
  priorities: [],
  basis: '10,000 simulations per league.',
  withheld: [],
  firstKickoffAt: null,
  generatedAt: '2026-09-24T12:00:00.000Z',
  runs: { reused: 1, computed: 0 },
  ...over,
})

const loadLeagues = vi.fn()
const listLeagueIds = vi.fn()
const getOutlook = vi.fn()
let deps: PlayoffOutlookDeps

beforeEach(() => {
  vi.clearAllMocks()
  loadLeagues.mockImplementation(async (ids: string[]) => ids.map((id) => ({ id, name: id, platform: 'sleeper', platformLeagueId: `p-${id}` })))
  listLeagueIds.mockResolvedValue(['L1', 'L2'])
  getOutlook.mockResolvedValue(outlook())
  deps = { loadLeagues, listLeagueIds, getOutlook, timeoutMs: 1000 }
})

describe('buildPlayoffOutlookContext — one league', () => {
  it('prints the simulator\'s own numbers for the caller\'s team', async () => {
    const out = await buildPlayoffOutlookContext({ leagueId: 'L1', userId: 'u1' }, deps)
    expect(out).toMatch(/Gridiron Gurus, 5-2/)
    expect(out).toMatch(/5th seed of 2/)
    expect(out).toMatch(/Playoff odds 62% \(range 55–70%\)/)
    expect(out).toMatch(/first-round bye 14%/)
    expect(out).toMatch(/championship 11%/)
    expect(out).toMatch(/Get to 9 wins/)
    expect(out).toMatch(/8 wins gets them in more often than not; 9 wins is safe/)
    expect(out).toMatch(/2nd hardest/)
    expect(out).toMatch(/running lucky by 1\.4/)
  })

  it('carries the swing game and who to root against', async () => {
    const out = await buildPlayoffOutlookContext({ leagueId: 'L1', userId: 'u1' }, deps)
    expect(out).toMatch(/week 8 vs Waiver Wire Warriors\): win → 74% playoff odds; lose → 49%/)
    expect(out).toMatch(/misses help them most: Top Dogs — "root against"/)
  })

  it('carries the simulated moves that raise the odds', async () => {
    const out = await buildPlayoffOutlookContext({ leagueId: 'L1', userId: 'u1' }, deps)
    expect(out).toMatch(/Add Rashod Bateman.*playoff odds \+4\.1/)
    expect(out).toMatch(/Remaining schedule \(-6 pts\)/)
  })

  it('states its basis and what it does not model', async () => {
    const out = await buildPlayoffOutlookContext({ leagueId: 'L1', userId: 'u1' }, deps)
    expect(out).toMatch(/10,000 simulations/)
    expect(out).toMatch(/Not modelled: Trades and waiver moves after today/)
    expect(out).toContain('/core/season-outlook?league=L1')
  })

  /* 🛑 The session's league, and only that one, is simulated and focused. */
  it('asks the simulator for exactly the session league, focused', async () => {
    await buildPlayoffOutlookContext({ leagueId: 'L1', userId: 'u1' }, deps)
    expect(listLeagueIds).not.toHaveBeenCalled()
    expect(loadLeagues).toHaveBeenCalledWith(['L1'])
    expect(getOutlook).toHaveBeenCalledWith('u1', [expect.objectContaining({ id: 'L1' })], 'L1')
  })

  it('refuses to estimate when the simulator withheld the league, and says why', async () => {
    getOutlook.mockResolvedValue(outlook({ leagues: [], withheld: [{ leagueName: 'KBFL', reason: 'No matchups have been synced for this league.' }] }))
    const out = await buildPlayoffOutlookContext({ leagueId: 'L1', userId: 'u1' }, deps)
    expect(out).toMatch(/NOT COMPUTED/)
    expect(out).toMatch(/No matchups have been synced/)
    expect(out).toMatch(/Do NOT estimate/)
  })

  it('says there are no odds FOR THEM when their team is not identified', async () => {
    getOutlook.mockResolvedValue(outlook({ leagues: [league({ you: null })] }))
    const out = await buildPlayoffOutlookContext({ leagueId: 'L1', userId: 'u1' }, deps)
    expect(out).toMatch(/not identified in this league/)
    expect(out).not.toMatch(/Playoff odds \d/)
  })

  it('reports a clinch by arithmetic', async () => {
    getOutlook.mockResolvedValue(outlook({ leagues: [league({ you: { ...YOU, status: 'clinched', playoffPct: 100 } })] }))
    expect(await buildPlayoffOutlookContext({ leagueId: 'L1', userId: 'u1' }, deps)).toMatch(/CLINCHED/)
  })

  it('says it ran out of time instead of returning half an answer', async () => {
    getOutlook.mockImplementation(() => new Promise(() => {}))
    const out = await buildPlayoffOutlookContext({ leagueId: 'L1', userId: 'u1' }, { ...deps, timeoutMs: 5 })
    expect(out).toMatch(/did not finish in time/)
    expect(out).toMatch(/do not estimate odds/)
  })

  it('never throws', async () => {
    getOutlook.mockRejectedValue(new Error('boom'))
    expect(await buildPlayoffOutlookContext({ leagueId: 'L1', userId: 'u1' }, deps)).toMatch(/failed to run/)
  })
})

describe('buildPlayoffOutlookContext — every league', () => {
  it('reads leagues through the membership list, never a model-supplied id', async () => {
    await buildPlayoffOutlookContext({ leagueId: null, userId: 'u1' }, deps)
    expect(listLeagueIds).toHaveBeenCalledWith('u1')
    expect(getOutlook).toHaveBeenCalledWith('u1', expect.any(Array), null)
  })

  it('summarises each league on one line', async () => {
    const out = await buildPlayoffOutlookContext({ leagueId: null, userId: 'u1' }, deps)
    expect(out).toMatch(/ACROSS 1 LEAGUE/)
    expect(out).toMatch(/KBFL: 5-2, 5th seed, playoffs 62%, title 11%/)
    expect(out).toMatch(/best title shot 11% in KBFL/)
  })

  it('says so when the user has no current leagues', async () => {
    listLeagueIds.mockResolvedValue([])
    expect(await buildPlayoffOutlookContext({ leagueId: null, userId: 'u1' }, deps)).toMatch(/no current-season leagues/)
    expect(getOutlook).not.toHaveBeenCalled()
  })
})
