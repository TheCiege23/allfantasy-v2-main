// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * 🛑 THE NFL BOARD MUST NOT MOVE WHEN OTHER SPORTS JOIN IT.
 *
 * The cross-league board was NFL-only by a filter at the top of `getWaiversBoard`. Extending it to
 * the season-rate sports (NBA, NHL, MLB, NCAAB, NCAAF) adds a second path beside the NFL one, and
 * the one thing that path must never do is perturb a row the NFL path already prints.
 *
 * ⚠ RE-CAPTURED 2026-10-02, DELIBERATELY: the board now ranks by LINEUP gain (`waiverSwap.ts`), so
 * L1's row changed by design — Free Agent One fills an empty slot (+16.0, was "+11.0 over Bench
 * One"), the roster has open spots so no drop is named, and `runsAt` is null because a Sleeper
 * league's stored schedule is a bootstrap default (`waiverScheduleIsImported`). Every withheld
 * count, the dedupe and the kickoffs are unchanged. Re-captured by this test and pasted unchanged.
 *
 * `GOLDEN` below was first written by THIS test against the pre-change loader (origin/main 812d99199) and
 * pasted in unchanged — so a match here is a byte-for-byte comparison against what production
 * served before, not against itself. It lives in the test as a template literal rather than a
 * snapshot file because this repo checks out with `core.autocrlf=true`: a `.json` golden would come
 * back CRLF and fail on a clean checkout, while a template literal's line breaks are LF by the
 * language's own rule whatever the file's endings are. The fixture exercises
 * every NFL branch that prints: a priced league with FAAB and a run time, its twin (deduped), an
 * injured best candidate (skipped), a league with no scoring (withheld), a Fleaflicker league
 * (withheld as idSpace), a league with no roster of yours (withheld), and the week's kickoffs.
 *
 * The second test adds NBA and Soccer leagues to the SAME account and requires every NFL field to
 * be identical to the NFL-only board.
 */

const h = vi.hoisted(() => ({ claimed: [] as unknown[] }))

const nflLeague = (id: string, over: Record<string, unknown> = {}) => ({
  id,
  name: `League ${id}`,
  platform: 'sleeper',
  sport: 'NFL',
  settings: { scoring_settings: { rec: 1, rec_yd: 0.1 }, roster_positions: ['QB', 'RB', 'WR', 'TE', 'FLEX', 'BN', 'BN'] },
  platformLeagueId: `P-${id}`,
  leagueType: 'redraft',
  scoring: 'ppr',
  logoUrl: null,
  avatarUrl: `av-${id}`,
  ...over,
})

const team = (leagueId: string, league: Record<string, unknown>) => ({
  leagueId,
  externalId: 'ext-me',
  platformUserId: 'me',
  league,
})

const NFL_CLAIMED = [
  team('L1', nflLeague('L1')),
  // A second AF row for the SAME real league (same platform + platformLeagueId): collapsed to one.
  team('L1b', nflLeague('L1b', { platformLeagueId: 'P-L1', name: 'League L1 (twin)' })),
  team('L2', nflLeague('L2', { settings: { roster_positions: ['QB', 'WR'] } })),
  team('L3', nflLeague('L3', { platform: 'fleaflicker' })),
  team('L4', nflLeague('L4')),
]

const OTHER_CLAIMED = [
  team('B1', { ...nflLeague('B1'), sport: 'NBA', platform: 'manual', settings: {} }),
  team('S1', { ...nflLeague('S1'), sport: 'SOCCER', platform: 'manual', settings: {} }),
]

const ROSTERS = [
  { leagueId: 'L1', platformUserId: 'me', faabRemaining: 87, playerData: { players: ['s1', 'b1', 'b2'], starters: ['s1'] } },
  { leagueId: 'L1', platformUserId: 'them', faabRemaining: 12, playerData: { players: ['t1'], starters: ['t1'] } },
  { leagueId: 'L1b', platformUserId: 'me', faabRemaining: 3, playerData: { players: ['s1', 'b2'], starters: ['s1'] } },
  { leagueId: 'L1b', platformUserId: 'them', faabRemaining: 3, playerData: { players: ['fa1', 't1'], starters: ['t1'] } },
  { leagueId: 'L2', platformUserId: 'me', faabRemaining: 5, playerData: { players: ['s1'], starters: ['s1'] } },
  { leagueId: 'L3', platformUserId: 'me', faabRemaining: 5, playerData: { players: ['s1', 'b1'], starters: ['s1'] } },
]

const proj = (playerId: string, rec: number, recYd: number) => ({
  playerId,
  projectedPoints: rec + recYd / 10,
  stats: { name: playerId, stats: { rec, rec_yd: recYd } },
})

const PLAYERS = [
  { sleeperId: 'hurt', source: 'sleeper', name: 'Hurt Star', position: 'WR', team: 'NYG', imageUrl: null },
  { sleeperId: 'fa1', source: 'sleeper', name: 'Free Agent One', position: 'WR', team: 'KC', imageUrl: 'img-fa1' },
  // Two rows for one Sleeper id: Sleeper's own wins over the Rolling Insights one.
  { sleeperId: 'fa2', source: 'rolling_insights', name: 'Wrong Name', position: 'OT', team: 'CAR', imageUrl: null },
  { sleeperId: 'fa2', source: 'sleeper', name: 'Free Agent Two', position: 'RB', team: 'BUF', imageUrl: null },
  { sleeperId: 's1', source: 'sleeper', name: 'Starter One', position: 'RB', team: 'DAL', imageUrl: null },
  { sleeperId: 'b1', source: 'sleeper', name: 'Bench One', position: 'WR', team: 'MIA', imageUrl: null },
  { sleeperId: 'b2', source: 'sleeper', name: 'Bench Two', position: 'TE', team: 'LV', imageUrl: null },
  { sleeperId: 't1', source: 'sleeper', name: 'Their Guy', position: 'WR', team: 'SF', imageUrl: null },
  { sleeperId: 'ol', source: 'sleeper', name: 'Big Tackle', position: 'OT', team: 'DEN', imageUrl: null },
]

vi.mock('server-only', () => ({}))
vi.mock('@/lib/prisma', () => ({
  prisma: {
    leagueTeam: { findMany: async () => h.claimed },
    roster: { findMany: async () => ROSTERS },
    leagueWaiverSettings: {
      findMany: async () => [
        { leagueId: 'L1', waiverType: 'FAAB', processingDayOfWeek: 3, processingTimeUtc: '09:00' },
        { leagueId: 'L1b', waiverType: 'rolling', processingDayOfWeek: null, processingTimeUtc: null },
      ],
    },
    fantasyProjection: {
      findMany: async () => [
        proj('ol', 30, 0),
        proj('hurt', 20, 150),
        proj('fa1', 7, 90),
        proj('fa2', 6, 40),
        proj('t1', 8, 100),
        proj('s1', 5, 60),
        proj('b1', 2, 30),
        proj('b2', 3, 20),
      ],
    },
    sportsPlayer: { findMany: async () => PLAYERS },
    sportsGame: {
      findMany: async () => [
        { homeTeam: 'KC', awayTeam: 'BUF', startTime: new Date('2026-09-24T00:15:00Z') },
        { homeTeam: 'Kansas City Chiefs', awayTeam: 'Buffalo Bills', startTime: new Date('2026-09-24T00:15:00Z') },
        { homeTeam: 'DAL', awayTeam: 'NYG', startTime: new Date('2026-09-27T17:00:00Z') },
      ],
    },
    // Only the non-NFL path reads these. The NFL-only board must not need them.
    aFProjectionSnapshot: { findMany: async () => [], findFirst: async () => null },
    playerIdentityMap: { findMany: async () => [] },
  },
}))
vi.mock('@/lib/core-app/rosteredMarket', () => ({
  MIN_LEAGUES_FOR_MARKET: 5,
  getRosteredMarket: async () => ({
    leaguesCounted: 40,
    byPlayerId: new Map([
      ['fa1', { ownPct: 0.25, startPct: 0.5 }],
      ['b2', { ownPct: 0.9, startPct: 0.1 }],
    ]),
  }),
}))
vi.mock('@/lib/core-app/playerProjections', () => ({ latestProjectionWeek: async () => ({ season: '2026', week: 4 }) }))
vi.mock('@/lib/injuries/injuryReadPort', () => ({
  resolveInjuryFacts: async () => ({ byPlayer: new Map([['hurt star', { status: 'IR', stale: false }]]) }),
}))

import { getWaiversBoard } from '@/lib/core-app/waiversBoard'

const NFL_KEYS = ['rows', 'considered', 'withheld', 'marketLeagues', 'at', 'weekKickoffs'] as const
const nflFields = (b: Record<string, unknown>) => Object.fromEntries(NFL_KEYS.map((k) => [k, b[k]]))

beforeEach(() => {
  h.claimed = NFL_CLAIMED
})

describe('getWaiversBoard — the NFL board is byte-identical to the pre-change loader', () => {
  it('matches the golden output captured from origin/main', async () => {
    const board = await getWaiversBoard('me')
    expect(JSON.stringify(board, null, 2)).toBe(GOLDEN)
  })

  it('adding NBA and Soccer leagues to the account changes no NFL field', async () => {
    const nflOnly = nflFields((await getWaiversBoard('me')) as unknown as Record<string, unknown>)
    h.claimed = [...NFL_CLAIMED, ...OTHER_CLAIMED]
    const mixed = nflFields((await getWaiversBoard('me')) as unknown as Record<string, unknown>)
    expect(JSON.stringify(mixed)).toBe(JSON.stringify(nflOnly))
  })
})

/* Captured from origin/main 812d99199 by the first test above, before any change. */
const GOLDEN = `{
  "rows": [
    {
      "leagueId": "L1",
      "leagueName": "League L1",
      "platform": "sleeper",
      "platformLeagueId": "P-L1",
      "logoUrl": "https://sleepercdn.com/avatars/thumbs/av-L1",
      "format": "Redraft · Ppr",
      "netGain": 16,
      "startsOver": null,
      "dropBasis": null,
      "openRosterSpot": true,
      "add": {
        "playerId": "fa1",
        "name": "Free Agent One",
        "position": "WR",
        "team": "KC",
        "imageUrl": "img-fa1",
        "projected": 16,
        "ownPct": 0.25,
        "startPct": 0.5
      },
      "drop": null,
      "faabRemaining": 87,
      "runsAt": null,
      "href": "/core/waivers?league=L1",
      "reasoning": "Free Agent One (WR) projects 16.0 under this league's own scoring, and would fill an empty starting slot — +16.0 to your starting lineup. You have an open roster spot, so nothing needs to go. Rostered in 25% of the leagues we can see."
    }
  ],
  "considered": 4,
  "withheld": {
    "noRoster": 1,
    "idSpace": 1,
    "noScoring": 1,
    "noCandidate": 0,
    "noUpgrade": 0
  },
  "marketLeagues": 40,
  "at": {
    "season": "2026",
    "week": 4
  },
  "weekKickoffs": [
    "2026-09-24T00:15:00.000Z",
    "2026-09-27T17:00:00.000Z"
  ]
}`
