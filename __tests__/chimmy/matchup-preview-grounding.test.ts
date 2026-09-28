import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))

import { buildMatchupPreviewContext, type MatchupPreviewDeps } from '@/lib/chimmy/matchupPreviewGrounding'
import type { WeekBoard, WeekMatchup } from '@/lib/core-app/weekBoard'

const matchup = (over: Partial<WeekMatchup> = {}): WeekMatchup => ({
  leagueId: 'L1',
  leagueName: 'KBFL',
  platform: 'sleeper',
  leagueImageUrl: null,
  season: 2026,
  week: 8,
  opponent: { rosterId: '7', name: 'Waiver Wire Warriors', avatarUrl: null },
  elimination: false,
  projection: { you: 121.4, them: 114.1, margin: 7.3, winProbability: 0.64 },
  form: null,
  yourSampleWeeks: 7,
  href: '/core/matchup?league=L1',
  ...over,
})

const board = (over: Partial<WeekBoard> = {}): WeekBoard => ({
  season: 2026,
  week: 8,
  coinFlips: [matchup()],
  leaning: [],
  unprojected: [],
  eliminationWeeks: [],
  model: { basis: 'Each team fitted from its completed weeks.', sampleSize: 84 },
  withoutSchedule: 0,
  firstKickoffAt: null,
  leagueBoard: {
    leagueId: 'L1',
    leagueName: 'KBFL',
    platform: 'sleeper',
    season: 2026,
    week: 8,
    yours: matchup(),
    sidelines: [
      {
        a: { rosterId: '1', name: 'Top Dogs', avatarUrl: null, projected: 130 },
        b: { rosterId: '2', name: 'Bench Mob', avatarUrl: null, projected: 100 },
        aWinProbability: 0.81,
      },
    ],
    rivalry: { wins: 3, losses: 1, meetings: 4, averageMargin: 12.5 },
    records: { '3': { wins: 5, losses: 2 }, '7': { wins: 4, losses: 3 } },
    yourRosterId: '3',
    yourTeamName: 'Gridiron Gurus',
    yourAvatarUrl: null,
  },
  ...over,
})

const loadLeagues = vi.fn()
const listLeagueIds = vi.fn()
const getBoard = vi.fn()
let deps: MatchupPreviewDeps

beforeEach(() => {
  vi.clearAllMocks()
  loadLeagues.mockImplementation(async (ids: string[]) => ids.map((id) => ({ id, name: id, platformLeagueId: `p-${id}` })))
  listLeagueIds.mockResolvedValue(['L1', 'L2'])
  getBoard.mockResolvedValue(board())
  deps = { loadLeagues, listLeagueIds, getBoard: getBoard as never }
})

describe('buildMatchupPreviewContext — one league', () => {
  it('prints the week model\'s win probability, records and rivalry', async () => {
    const out = await buildMatchupPreviewContext({ leagueId: 'L1', userId: 'u1' }, deps)
    expect(out).toMatch(/week 8 vs Waiver Wire Warriors: a coin flip — win probability 64%/)
    expect(out).toMatch(/Records: them 5-2, opponent 4-3/)
    expect(out).toMatch(/All-time vs this opponent: 3-1 in 4 meeting/)
    expect(out).toMatch(/Top Dogs vs Bench Mob \(Top Dogs 81%\)/)
    expect(out).toMatch(/call optimize_my_lineup/)
    expect(getBoard).toHaveBeenCalledWith('u1', [expect.objectContaining({ id: 'L1' })], 'L1')
  })

  it('calls a clear edge favoured, not a coin flip', async () => {
    const m = matchup({ projection: { you: 130, them: 100, margin: 30, winProbability: 0.9 } })
    getBoard.mockResolvedValue(board({ leagueBoard: { ...board().leagueBoard!, yours: m } }))
    expect(await buildMatchupPreviewContext({ leagueId: 'L1', userId: 'u1' }, deps)).toMatch(/favoured by 30\.0 — win probability 90%/)
  })

  /* A two-week mean is a fact, not a forecast — and it carries no win probability. */
  it('labels thin samples as FORM with no probability', async () => {
    const m = matchup({ projection: null, form: { you: 118, them: 104, margin: 14, weeks: 2 } })
    getBoard.mockResolvedValue(board({ leagueBoard: { ...board().leagueBoard!, yours: m } }))
    const out = await buildMatchupPreviewContext({ leagueId: 'L1', userId: 'u1' }, deps)
    expect(out).toMatch(/FORM only \(not a forecast, no win probability\)/)
    expect(out).not.toMatch(/win probability \d/)
  })

  it('says so on a bye week rather than inventing an opponent', async () => {
    getBoard.mockResolvedValue(board({ leagueBoard: { ...board().leagueBoard!, yours: null } }))
    expect(await buildMatchupPreviewContext({ leagueId: 'L1', userId: 'u1' }, deps)).toMatch(/no game this week/)
  })

  it('reads a guillotine week as a cut line', async () => {
    getBoard.mockResolvedValue(
      board({
        leagueBoard: null,
        eliminationWeeks: [
          {
            leagueId: 'L1', leagueName: 'Chop Shop', platform: 'sleeper', leagueImageUrl: null, season: 2026, week: 8,
            yourScore: 88.2, cutLine: 88.2, rank: 12, fieldSize: 12, margin: 0, onTheBlock: true, labelled: true, href: '/core',
          },
        ],
      }),
    )
    expect(await buildMatchupPreviewContext({ leagueId: 'L1', userId: 'u1' }, deps)).toMatch(/CURRENTLY THE LOWEST SCORE/)
  })

  /*
   * 2026-09-28: 41.2 clear of the cut line with every relevant game finished, and the answer said
   * "you'd need a collapse". The block now carries whether the week is DECIDED.
   */
  const chopWeek = {
    leagueId: 'L1', platformLeagueId: 'p-L1', yourRosterId: '4', leagueName: 'Chop Shop', platform: 'sleeper', leagueImageUrl: null,
    season: 2026, week: 3, yourScore: 87.74, cutLine: 46.54, rank: 4, fieldSize: 16, margin: 41.2, onTheBlock: false, labelled: true, href: '/core',
  }

  it('says a decided guillotine week is SAFE, from whose games have finished', async () => {
    getBoard.mockResolvedValue(board({ leagueBoard: null, eliminationWeeks: [chopWeek] }))
    const loadSettle = vi.fn().mockResolvedValue({ verdict: 'safe', finishedBelow: 7, chops: 1 })
    const out = await buildMatchupPreviewContext({ leagueId: 'L1', userId: 'u1' }, { ...deps, loadSettle })
    expect(out).toMatch(/41\.2 points clear of the cut line \(46\.5\)\. SAFE THIS WEEK — IT IS DECIDED/)
    expect(loadSettle).toHaveBeenCalledWith(expect.objectContaining({ platformLeagueId: 'p-L1', yourRosterId: '4', week: 3, season: 2026 }))
  })

  it('says an undecided week is not decided, and a failed read changes nothing', async () => {
    getBoard.mockResolvedValue(board({ leagueBoard: null, eliminationWeeks: [chopWeek] }))
    const open = { verdict: 'open', yourUpcoming: 0, yourLive: 0, yourUnknown: 0, finishedBelow: 0, chops: 1, cutLinePending: 2 }
    const out = await buildMatchupPreviewContext({ leagueId: 'L1', userId: 'u1' }, { ...deps, loadSettle: vi.fn().mockResolvedValue(open) })
    expect(out).toMatch(/NOT YET DECIDED\. All their starters have finished\. The team currently lowest still has 2 starters to finish\./)
    const failed = await buildMatchupPreviewContext({ leagueId: 'L1', userId: 'u1' }, { ...deps, loadSettle: vi.fn().mockRejectedValue(new Error('x')) })
    expect(failed).toMatch(/41\.2 points clear of the cut line \(46\.5\)\.$/m)
  })

  it('carries the verdict into the all-leagues view too', async () => {
    getBoard.mockResolvedValue(board({ eliminationWeeks: [chopWeek] }))
    const loadSettle = vi.fn().mockResolvedValue({ verdict: 'safe', finishedBelow: 1, chops: 1 })
    const out = await buildMatchupPreviewContext({ leagueId: null, userId: 'u1' }, { ...deps, loadSettle })
    expect(out).toMatch(/- Chop Shop \(elimination format\), week 3: .*SAFE THIS WEEK — IT IS DECIDED/)
  })

  it('refuses to preview a league with no schedule', async () => {
    getBoard.mockResolvedValue(board({ week: null }))
    expect(await buildMatchupPreviewContext({ leagueId: 'L1', userId: 'u1' }, deps)).toMatch(/do not invent an opponent/)
  })
})

describe('buildMatchupPreviewContext — every league', () => {
  it('sorts every matchup into coin flips, favoured and underdog, via the membership list', async () => {
    getBoard.mockResolvedValue(
      board({
        leaning: [
          matchup({ leagueName: 'Dynasty', projection: { you: 140, them: 100, margin: 40, winProbability: 0.95 } }),
          matchup({ leagueName: 'Redraft', projection: { you: 90, them: 120, margin: -30, winProbability: 0.12 } }),
        ],
      }),
    )
    const out = await buildMatchupPreviewContext({ leagueId: null, userId: 'u1' }, deps)
    expect(listLeagueIds).toHaveBeenCalledWith('u1')
    expect(out).toMatch(/Coin flips/)
    expect(out).toMatch(/Favoured:\n  • Dynasty/)
    expect(out).toMatch(/Underdog:\n  • Redraft/)
  })

  it('never throws', async () => {
    getBoard.mockRejectedValue(new Error('boom'))
    expect(await buildMatchupPreviewContext({ leagueId: null, userId: 'u1' }, deps)).toMatch(/failed to load/)
  })
})
