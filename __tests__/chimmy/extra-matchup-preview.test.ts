import { beforeEach, describe, expect, it, vi } from 'vitest'

/* Chimmy's matchup preview names an odd-team league's extra matchup, with both scores. */

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

const EXTRA = {
  role: 'leftover' as const, otherRosterId: '7', teamName: 'Top Dogs', reason: 'top_scorer' as const, countsForYou: true,
  yourScore: 120.25, theirScore: 101.5, final: false,
  label: "Extra matchup vs Top Dogs (last week's top scorer)",
  line: "Extra matchup vs Top Dogs (last week's top scorer) · 120.3–101.5",
}

describe('buildMatchupPreviewContext — the extra matchup', () => {
  it('the leftover team: its game this week is the extra matchup, not "no game"', async () => {
    const b = board()
    getBoard.mockResolvedValue({ ...b, leagueBoard: { ...b.leagueBoard!, yours: null, extraMatchup: EXTRA } })
    const out = await buildMatchupPreviewContext({ leagueId: 'L1', userId: 'u1' }, deps)
    expect(out).toContain(EXTRA.line)
    expect(out).not.toMatch(/They have no game this week/)
  })

  it('the chosen team: its own game, and the extra one too', async () => {
    const b = board()
    getBoard.mockResolvedValue({ ...b, leagueBoard: { ...b.leagueBoard!, extraMatchup: { ...EXTRA, role: 'opponent', line: 'Extra matchup: Top Dogs plays you this week' } } })
    const out = await buildMatchupPreviewContext({ leagueId: 'L1', userId: 'u1' }, deps)
    expect(out).toMatch(/week 8 vs Waiver Wire Warriors/)
    expect(out).toContain('Also this week: Extra matchup: Top Dogs plays you this week.')
  })

  it('a plain bye still says so', async () => {
    const b = board()
    getBoard.mockResolvedValue({ ...b, leagueBoard: { ...b.leagueBoard!, yours: null } })
    expect(await buildMatchupPreviewContext({ leagueId: 'L1', userId: 'u1' }, deps)).toMatch(/They have no game this week/)
  })
})
