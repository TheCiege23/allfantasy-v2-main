/**
 * @vitest-environment node
 *
 * 🛑 Both lineup scans took a starter's injury from `SportsPlayer.status` — which on Sleeper's row is
 * Sleeper's ROSTER status ("Active", "Injured Reserve"), not `injury_status` — and the native scan
 * preferred the imported `lineup_sections` snapshot's status over even that. So an Out, Doubtful or
 * Questionable starter read "Active" and was never flagged, while a provider row carrying an 'out'
 * that `PlayerStatusAggregator` stamped and never cleared was flagged forever.
 *
 * The designation now comes from the live injury feed (`resolveInjuryFacts`) by name + team + position;
 * a Sleeper roster absence ("Injured Reserve") still counts when the feed has nothing current.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

type PlayerRow = { sleeperId: string; source: string; name: string; position: string; team: string | null; status: string | null }

const h = vi.hoisted(() => ({
  players: [] as Array<Record<string, unknown>>,
  feed: [] as Array<Record<string, unknown>>,
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    sportsPlayer: {
      findMany: vi.fn(async ({ where }: { where: { OR: Array<{ sleeperId?: { in: string[] } }> } }) => {
        const asked = where.OR.find((c) => c.sleeperId)?.sleeperId?.in ?? []
        return h.players.filter((r) => asked.includes(String(r.sleeperId)))
      }),
    },
    sportsInjury: { findMany: vi.fn(async () => h.feed) },
  },
}))
vi.mock('@/lib/multi-sport/MultiSportRosterService', () => ({
  getRosterTemplateForLeague: vi.fn(async () => ({
    slots: [
      { slotName: 'QB', starterCount: 1 },
      { slotName: 'RB', starterCount: 1 },
      { slotName: 'WR', starterCount: 1 },
      { slotName: 'TE', starterCount: 1 },
      { slotName: 'FLEX', starterCount: 1 },
    ],
  })),
}))

import { scanSleeperLeagueLineup } from '@/lib/lineup-actions/sleeperLineupScan'
import { scanNativeLeagueLineup } from '@/lib/lineup-actions/nativeLineupScan'

const THRESHOLDS = {
  minimumStartSitConfidence: 0.72,
  minimumProjectedGain: 0.5,
  urgentLockWindowMinutes: 60,
  nearLockWindowHours: 24,
  countQuestionableAsAction: true,
  countDoubtfulAsAction: true,
  dailyLineupSports: [],
  bestBallSkipManual: true,
}

const recent = () => new Date(Date.now() - 2 * 3_600_000)
function feedRow(playerName: string, team: string, position: string, status: string, date: Date = recent()) {
  return { playerName, status, type: null, description: null, date, week: null, source: 'rolling_insights', fetchedAt: recent(), team, position }
}

/* Every Sleeper row says "Active" — the roster word — except the one genuinely on injured reserve. */
const PLAYERS: PlayerRow[] = [
  { sleeperId: '101', source: 'sleeper', name: 'Out Quarterback', position: 'QB', team: 'Detroit Lions', status: 'Active' },
  { sleeperId: '102', source: 'sleeper', name: 'Iffy Runner', position: 'RB', team: 'Detroit Lions', status: 'Active' },
  { sleeperId: '103', source: 'sleeper', name: 'Shelved Receiver', position: 'WR', team: 'Detroit Lions', status: 'Injured Reserve' },
  // A provider row: its `status` is the 'out' PlayerStatusAggregator stamped weeks ago. The feed has him Active.
  { sleeperId: '104', source: 'rolling_insights', name: 'Recovered End', position: 'TE', team: 'Detroit Lions', status: 'out' },
  { sleeperId: '105', source: 'sleeper', name: 'Doubtful Back', position: 'RB', team: 'Detroit Lions', status: 'Active' },
]
const FEED = [
  feedRow('Out Quarterback', 'Detroit Lions', 'QB', 'Out'),
  feedRow('Iffy Runner', 'Detroit Lions', 'RB', 'Questionable'),
  feedRow('Recovered End', 'Detroit Lions', 'TE', 'Active'),
  feedRow('Doubtful Back', 'Detroit Lions', 'RB', 'Doubtful'),
]
const STARTERS = ['101', '102', '103', '104', '105']

const EXPECTED = [
  ['injured_starter', 'Out Quarterback'],
  ['questionable_starter', 'Iffy Runner'],
  ['injured_starter', 'Shelved Receiver'],
  ['doubtful_starter', 'Doubtful Back'],
]

beforeEach(() => {
  h.players = PLAYERS
  h.feed = FEED
})

describe('scanSleeperLeagueLineup — injuries from the feed, not the roster status', () => {
  beforeEach(() => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        const u = String(url)
        const body = u.endsWith('/state/nfl')
          ? { week: 6 }
          : u.endsWith('/rosters')
            ? [{ roster_id: 1, owner_id: 'owner-1', starters: STARTERS, players: STARTERS }]
            : u.includes('/matchups/')
              ? [{ roster_id: 1, starters: STARTERS }]
              : { sport: 'nfl', roster_positions: ['QB', 'RB', 'WR', 'TE', 'FLEX', 'BN'], settings: {} }
        return { ok: true, json: async () => body } as Response
      }),
    )
  })
  afterEach(() => vi.unstubAllGlobals())

  it('🛑 flags Out / Questionable / Doubtful from the feed and Sleeper’s IR — never a stale stamped "out"', async () => {
    const { actions, scanIncomplete } = await scanSleeperLeagueLineup({
      leagueId: 'L1',
      leagueName: 'League',
      platformLeagueId: 'sl-1',
      ownerSleeperId: 'owner-1',
      thresholds: THRESHOLDS,
    })
    expect(scanIncomplete).toBe(false)
    expect(actions.map((a) => [a.reasonType, a.playerName])).toEqual(EXPECTED)
    expect(actions.find((a) => a.playerName === 'Out Quarterback')?.message).toBe('Out Quarterback is Out')
  })

  it('a STALE Out (last week’s game) does not bench this week’s starter', async () => {
    h.feed = [feedRow('Out Quarterback', 'Detroit Lions', 'QB', 'Out', new Date(Date.now() - 10 * 24 * 3_600_000))]
    const { actions } = await scanSleeperLeagueLineup({
      leagueId: 'L1',
      leagueName: 'League',
      platformLeagueId: 'sl-1',
      ownerSleeperId: 'owner-1',
      thresholds: THRESHOLDS,
    })
    expect(actions.find((a) => a.playerName === 'Out Quarterback')).toBeUndefined()
  })
})

describe('scanNativeLeagueLineup — the imported snapshot’s status is not an injury source', () => {
  it('🛑 flags from the feed even when the persisted lineup_sections snapshot says "Active", and ignores a snapshot "Out"', async () => {
    const sections = {
      starters: [
        { id: '101', name: 'Out Quarterback', position: 'QB', status: 'Active' },
        { id: '102', name: 'Iffy Runner', position: 'RB', status: 'Active' },
        { id: '103', name: 'Shelved Receiver', position: 'WR', status: 'Active' },
        // The snapshot froze an Out from weeks ago; the feed has him Active today.
        { id: '104', name: 'Recovered End', position: 'TE', status: 'Out' },
        { id: '105', name: 'Doubtful Back', position: 'RB', status: 'Active' },
      ],
    }
    const { actions } = await scanNativeLeagueLineup({
      leagueId: 'L1',
      leagueName: 'League',
      sport: 'NFL' as never,
      platform: 'manual',
      bestBallMode: false,
      playerData: { players: STARTERS, starters: STARTERS, lineup_sections: sections },
      thresholds: THRESHOLDS,
    })
    expect(actions.map((a) => [a.reasonType, a.playerName])).toEqual(EXPECTED)
  })
})
