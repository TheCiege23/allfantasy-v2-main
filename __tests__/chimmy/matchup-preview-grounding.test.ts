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

  /*
   * SAFE / OUT chip (2026-09-28): the verdict also leaves as DATA — the same object the sentence was
   * written from — but only for ONE league in scope. One chip cannot speak for several leagues.
   */
  it('reports the settle object it wrote the sentence from, for one league only', async () => {
    const safe = { verdict: 'safe', finishedBelow: 7, chops: 1 }
    getBoard.mockResolvedValue(board({ leagueBoard: null, eliminationWeeks: [chopWeek] }))
    const onSettle = vi.fn()
    const out = await buildMatchupPreviewContext({ leagueId: 'L1', userId: 'u1', onSettle }, { ...deps, loadSettle: vi.fn().mockResolvedValue(safe) })
    expect(out).toMatch(/SAFE THIS WEEK — IT IS DECIDED/)
    expect(onSettle).toHaveBeenCalledTimes(1)
    expect(onSettle.mock.calls[0]![0]).toEqual({ leagueId: 'L1', settle: safe })

    onSettle.mockClear()
    await buildMatchupPreviewContext({ leagueId: null, userId: 'u1', onSettle }, { ...deps, loadSettle: vi.fn().mockResolvedValue(safe) })
    expect(onSettle).not.toHaveBeenCalled()
  })

  it('reports null for a league with no elimination week, so a later read clears an earlier chip', async () => {
    const onSettle = vi.fn()
    await buildMatchupPreviewContext({ leagueId: 'L1', userId: 'u1', onSettle }, deps)
    expect(onSettle).toHaveBeenCalledWith({ leagueId: 'L1', settle: null })
  })

  it('a collector that throws does not cost the user the matchup', async () => {
    getBoard.mockResolvedValue(board({ leagueBoard: null, eliminationWeeks: [chopWeek] }))
    const out = await buildMatchupPreviewContext(
      { leagueId: 'L1', userId: 'u1', onSettle: () => { throw new Error('boom') } },
      { ...deps, loadSettle: vi.fn().mockResolvedValue({ verdict: 'safe', finishedBelow: 1, chops: 1 }) },
    )
    expect(out).toMatch(/SAFE THIS WEEK — IT IS DECIDED/)
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

/*
 * This week's LINEUP projections (2026-09-30): AllFantasy's own engine (AF) and the provider's (API),
 * summed over the lineups as set — the totals the league rail draws. A different measure from the
 * team averages, labelled as one, and never shown for a week other than the matchup's.
 */
describe('buildMatchupPreviewContext — AF and API lineup projections', () => {
  const side = (over: Record<string, unknown> = {}) => ({
    projected: 110, afProjected: 118.2, afEngine: 121.5, afEngineFrom: 9, pricedFrom: 9, starterCount: 9, ...over,
  })
  const pair = (over: Record<string, unknown> = {}) => ({
    season: 2026, week: 8, unpaired: false,
    you: side(), them: side({ afProjected: 112.4, afEngine: 115 }),
    projectionWeek: { season: '2026', week: 8 },
    ...over,
  })
  const withLineups = (p: Record<string, unknown> | Error) => ({
    ...deps,
    loadLineupProjections: vi.fn(async () => {
      if (p instanceof Error) throw p
      return new Map([['L1', p as never]])
    }),
  })

  it('gives both sources, labelled, for the league in scope — and says not to average them', async () => {
    const out = await buildMatchupPreviewContext({ leagueId: 'L1', userId: 'u1' }, withLineups(pair()))
    expect(out).toContain("AF (AllFantasy's own engine) them 121.5 vs opponent 115.0")
    expect(out).toContain("Sleeper (Sleeper's own projection) them 118.2 vs opponent 112.4")
    expect(out).toContain('a different measure from the team averages above')
    expect(out).toContain('do not average them or turn them into a win probability')
    // The week model's own line is still there, first.
    expect(out).toMatch(/a coin flip — win probability 64%/)
  })

  it('🛑 never shows a total from a fallback week as this week’s', async () => {
    const out = await buildMatchupPreviewContext(
      { leagueId: 'L1', userId: 'u1' },
      withLineups(pair({ projectionWeek: { season: '2026', week: 9 } })),
    )
    expect(out).not.toContain('LINEUP projections')
  })

  it('says a partial lineup total is partial', async () => {
    const out = await buildMatchupPreviewContext(
      { leagueId: 'L1', userId: 'u1' },
      withLineups(pair({ you: side({ afEngineFrom: 7 }) })),
    )
    expect(out).toContain('them 121.5 (from 7 of 9 starters) vs opponent 115.0')
  })

  it('carries them onto the matching league across all leagues', async () => {
    const out = await buildMatchupPreviewContext({ leagueId: null, userId: 'u1' }, withLineups(pair()))
    expect(out).toMatch(/KBFL, week 8 vs Waiver Wire Warriors: .*AF \(AllFantasy's own engine\) them 121\.5/)
  })

  it('a failed lineup read leaves the preview exactly as it was', async () => {
    const plain = await buildMatchupPreviewContext({ leagueId: 'L1', userId: 'u1' }, deps)
    const failed = await buildMatchupPreviewContext({ leagueId: 'L1', userId: 'u1' }, withLineups(new Error('db down')))
    expect(failed).toBe(plain)
  })
})

/*
 * Production 2026-10-06, HailShiva: week 4 was already WON 135.5–129.9 and this tool still printed
 * "underdog by 28.4 — win probability 29%", while the optimizer and season simulator had moved on to
 * week 5. Chimmy then told the user it could not tell which week was live. Once a game has points,
 * the block reports the scoreboard and never the pre-game probability.
 */
describe('buildMatchupPreviewContext — a game that already has points', () => {
  const preGame = { you: 126.4, them: 154.8, margin: -28.4, winProbability: 0.29 }
  const paid = (live: WeekMatchup['live']) =>
    matchup({ leagueName: 'HailShiva', week: 4, opponent: { rosterId: '7', name: 'Paid', avatarUrl: null }, projection: preGame, live })
  const oneLeague = (m: WeekMatchup) => board({ week: 4, leagueBoard: { ...board().leagueBoard!, leagueName: 'HailShiva', week: 4, yours: m } })
  const withLineups = (): MatchupPreviewDeps => ({
    ...deps,
    loadLineupProjections: vi.fn(async () => new Map([['L1', {
      season: 2026, week: 4, unpaired: false, projectionWeek: { season: '2026', week: 4 },
      you: { projected: 158.4, afProjected: 158.4, afEngine: 164.8, afEngineFrom: 9, pricedFrom: 9, starterCount: 9 },
      them: { projected: 156.6, afProjected: 156.6, afEngine: 161.4, afEngineFrom: 9, pricedFrom: 9, starterCount: 9 },
    } as never]])),
  })

  it('reads a FINAL week as decided — the result, no probability, no pre-game odds for other games', async () => {
    getBoard.mockResolvedValue(oneLeague(paid({ you: 135.5, them: 129.9, margin: 5.6, final: true })))
    const out = await buildMatchupPreviewContext({ leagueId: 'L1', userId: 'u1' }, withLineups())
    expect(out).toMatch(/WEEK 4 in HailShiva \(FINAL\)/)
    expect(out).toMatch(/HailShiva, week 4 vs Paid: FINAL — they WON 135\.5–129\.9\. This game is decided/)
    expect(out).toMatch(/a later week from those tools is their next game, not a conflict/)
    expect(out).not.toMatch(/win probability \d|underdog|29%/)
    expect(out).not.toContain('LINEUP projections')
    expect(out).not.toContain('Other games in the league')
    // Records and the rivalry are still facts worth repeating.
    expect(out).toMatch(/All-time vs this opponent: 3-1/)
  })

  it('names the NEXT game from the stored schedule once the board week is final', async () => {
    const b = oneLeague(paid({ you: 135.5, them: 129.9, margin: 5.6, final: true }))
    getBoard.mockResolvedValue({ ...b, leagueBoard: { ...b.leagueBoard!, records: { ...b.leagueBoard!.records, '9': { wins: 2, losses: 2 } } } })
    const loadNextGame = vi.fn().mockResolvedValue({ week: 5, opponentRosterId: '9', opponentName: 'Rittnasty' })
    const out = await buildMatchupPreviewContext({ leagueId: 'L1', userId: 'u1' }, { ...deps, loadNextGame })
    expect(out).toMatch(/Their NEXT game: week 5 vs Rittnasty \(2-2\), from the stored schedule\./)
    expect(out).toMatch(/for its odds call get_playoff_outlook/)
    expect(loadNextGame).toHaveBeenCalledWith({ league: expect.objectContaining({ id: 'L1', platformLeagueId: 'p-L1' }), season: 2026, week: 4, yourRosterId: '3' })
  })

  it('says next week is not on file rather than naming anyone, including when the read fails', async () => {
    getBoard.mockResolvedValue(oneLeague(paid({ you: 135.5, them: 129.9, margin: 5.6, final: true })))
    for (const loadNextGame of [vi.fn().mockResolvedValue(null), vi.fn().mockRejectedValue(new Error('db down'))]) {
      const out = await buildMatchupPreviewContext({ leagueId: 'L1', userId: 'u1' }, { ...deps, loadNextGame })
      expect(out).toMatch(/Week 5's opponent is not on file yet .* Do not name one\./)
      expect(out).not.toMatch(/NEXT game/)
    }
  })

  it('does not look for a next game while the board week is still being played', async () => {
    const loadNextGame = vi.fn()
    getBoard.mockResolvedValue(oneLeague(paid({ you: 98.1, them: 120.4, margin: -22.3, final: false })))
    const live = await buildMatchupPreviewContext({ leagueId: 'L1', userId: 'u1' }, { ...deps, loadNextGame })
    getBoard.mockResolvedValue(oneLeague(paid(null)))
    const before = await buildMatchupPreviewContext({ leagueId: 'L1', userId: 'u1' }, { ...deps, loadNextGame })
    expect(loadNextGame).not.toHaveBeenCalled()
    expect(`${live}${before}`).not.toMatch(/NEXT game|not on file yet/)
  })

  it('says LOST and TIE plainly', async () => {
    getBoard.mockResolvedValue(oneLeague(paid({ you: 101, them: 120.2, margin: -19.2, final: true })))
    expect(await buildMatchupPreviewContext({ leagueId: 'L1', userId: 'u1' }, deps)).toMatch(/FINAL — they LOST 101\.0–120\.2/)
    getBoard.mockResolvedValue(oneLeague(paid({ you: 110, them: 110, margin: 0, final: true })))
    expect(await buildMatchupPreviewContext({ leagueId: 'L1', userId: 'u1' }, deps)).toMatch(/FINAL — a TIE, 110\.0–110\.0/)
  })

  it('reads an unfinished week as the live score, without full-week totals that read as points to come', async () => {
    getBoard.mockResolvedValue(oneLeague(paid({ you: 98.1, them: 120.4, margin: -22.3, final: false })))
    const out = await buildMatchupPreviewContext({ leagueId: 'L1', userId: 'u1' }, withLineups())
    expect(out).toMatch(/WEEK 4 in HailShiva \(in progress\)/)
    expect(out).toMatch(/week 4 vs Paid: IN PROGRESS \(not final\) — they have 98\.1, the opponent 120\.4, behind by 22\.3\./)
    expect(out).not.toMatch(/win probability \d/)
    expect(out).not.toContain('LINEUP projections')
    expect(out).toContain('Other games in the league')
    // Control: the same fixture before kickoff does carry them, so the absence above is the live score's doing.
    getBoard.mockResolvedValue(oneLeague(paid(null)))
    const before = await buildMatchupPreviewContext({ leagueId: 'L1', userId: 'u1' }, withLineups())
    expect(before).toContain("AF (AllFantasy's own engine) them 164.8 vs opponent 161.4")
    expect(before).toMatch(/underdog by 28\.4 — win probability 29%/)
  })

  it('lists a scored game under the scoreboard across leagues, never under Underdog', async () => {
    getBoard.mockResolvedValue(board({
      coinFlips: [],
      leaning: [
        paid({ you: 135.5, them: 129.9, margin: 5.6, final: true }),
        matchup({ leagueName: 'Redraft', projection: { you: 90, them: 120, margin: -30, winProbability: 0.12 } }),
      ],
    }))
    const out = await buildMatchupPreviewContext({ leagueId: null, userId: 'u1' }, deps)
    expect(out).toMatch(/Already scoring \(the scoreboard, not a forecast\):\n  • HailShiva, week 4 vs Paid: FINAL — they WON/)
    expect(out).toMatch(/Underdog:\n  • Redraft/)
    expect(out).not.toMatch(/Underdog:\n  • HailShiva/)
  })
})
