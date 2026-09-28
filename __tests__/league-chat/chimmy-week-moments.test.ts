// @vitest-environment node
/**
 * Close finishes and upsets: once a week is final, ONE Chimmy post per league per week.
 *
 * Runs the REAL detection, the REAL `postChimmyMoment` (claims, daily cap, off-switch) and the REAL
 * NFL slate check (`readWeekSlate`) over an in-memory Prisma: `WeeklyMatchup` rows for an imported
 * league, `RedraftMatchup` rows for a native one, saved pre-game odds behind `$queryRaw`, and the NFL
 * week's games in `SportsGame`.
 *
 * The league: eight teams, three weeks played before week 4. Going into week 4:
 *   Alpha 2-1 · Bravo 2-1 · Charlie 1-2 · Delta 1-2 · Echo 0-3 · Foxtrot 3-0 · Golf 0-3 · Hotel 3-0
 * Week 4:
 *   Alpha 101.2 – Bravo 100.8    close finish (0.4), even records, no saved odds
 *   Charlie 118.4 – Delta 96.0   upset by SAVED ODDS (Charlie given 22%)
 *   Echo 110.0 – Foxtrot 90.0    NOT an upset: the saved odds had Echo a 60% favourite, whatever
 *                                the standings say — odds decide when they exist
 *   Golf 99.1 – Hotel 88.7       upset by STANDINGS AT KICKOFF (0-3 over 3-0), no saved odds
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

type Row = { leagueId: string; seasonYear: number; week: number; rosterId: string; matchupId: number | null; pointsFor: number; pointsAgainst: number; win: number }

const h = vi.hoisted(() => ({
  cache: new Map<string, { data: unknown; expiresAt: Date }>(),
  chat: [] as Array<Record<string, unknown>>,
  leagues: new Map<string, { id: string; userId: string; settings: unknown }>(),
  weekly: [] as Array<Record<string, unknown>>,
  teams: [] as Array<{ leagueId: string; externalId: string; teamName: string; ownerName: string }>,
  snapshots: [] as Array<Record<string, unknown>>,
  games: [] as Array<Record<string, unknown>>,
  native: [] as Array<Record<string, unknown>>,
  nativeRosters: [] as Array<{ seasonId: string; id: string; teamName: string | null; ownerName: string }>,
  weeklyReads: 0,
  leagueRows: [] as Array<Record<string, unknown>>,
  seasonRows: [] as Array<Record<string, unknown>>,
}))

function keyMatches(key: string, where: Record<string, unknown>): boolean {
  const k = where.cacheKey as unknown
  if (typeof k === 'string') return k === key
  if (k && typeof k === 'object' && Array.isArray((k as { in?: string[] }).in)) return (k as { in: string[] }).in.includes(key)
  return true
}

vi.mock('@/lib/prisma', () => ({
  prisma: {
    league: {
      findUnique: async ({ where }: { where: { id: string } }) => {
        const l = h.leagues.get(where.id)
        return l ? { ...l } : null
      },
      findMany: async () => h.leagueRows,
    },
    redraftSeason: { findMany: async () => h.seasonRows },
    sportsDataCache: {
      findMany: async ({ where }: { where: Record<string, unknown> }) =>
        [...h.cache.entries()]
          .filter(([key, row]) => keyMatches(key, where) && row.expiresAt > ((where.expiresAt as { gt?: Date })?.gt ?? new Date(0)))
          .map(([cacheKey]) => ({ cacheKey })),
      deleteMany: async ({ where }: { where: Record<string, unknown> }) => {
        let count = 0
        for (const [key, row] of [...h.cache.entries()]) {
          const lte = (where.expiresAt as { lte?: Date } | undefined)?.lte
          if (keyMatches(key, where) && (!lte || row.expiresAt <= lte)) {
            h.cache.delete(key)
            count += 1
          }
        }
        return { count }
      },
      createMany: async ({ data }: { data: Array<{ cacheKey: string; data: unknown; expiresAt: Date }> }) => {
        let count = 0
        for (const r of data) {
          if (h.cache.has(r.cacheKey)) continue
          h.cache.set(r.cacheKey, { data: r.data, expiresAt: r.expiresAt })
          count += 1
        }
        return { count }
      },
    },
    leagueChatMessage: {
      create: async ({ data }: { data: Record<string, unknown> }) => {
        const row = {
          id: `m${h.chat.length + 1}`,
          ...data,
          createdAt: new Date('2026-09-29T14:00:00.000Z'),
          user: { id: data.userId, username: 'pat', displayName: 'Pat Commissioner', avatarUrl: null, profile: null },
        }
        h.chat.push(row)
        return row
      },
      findMany: async () => [...h.chat].reverse(),
    },
    weeklyMatchup: {
      findMany: async ({ where }: { where: { leagueId: string; seasonYear: number } }) => {
        h.weeklyReads += 1
        return h.weekly.filter((r) => r.leagueId === where.leagueId && r.seasonYear === where.seasonYear)
      },
      aggregate: async () => ({ _max: { seasonYear: 2026 } }),
      groupBy: async () => [...new Set(h.weekly.map((r) => r.leagueId as string))].map((leagueId) => ({ leagueId })),
    },
    leagueTeam: {
      findMany: async ({ where }: { where: { leagueId: string; externalId: { in: string[] } } }) =>
        h.teams.filter((t) => t.leagueId === where.leagueId && where.externalId.in.includes(t.externalId)),
    },
    $queryRaw: async (_strings: TemplateStringsArray, season: number, week: number) =>
      h.snapshots.filter((s) => s.season === season && s.week === week),
    sportsGame: {
      findMany: async ({ where }: { where: { season: number; week?: number } }) =>
        h.games.filter((g) => g.season === where.season && g.week === where.week),
    },
    redraftMatchup: {
      findMany: async ({ where }: { where: { seasonId: string } }) => h.native.filter((m) => m.seasonId === where.seasonId),
    },
    redraftRoster: {
      findMany: async ({ where }: { where: { seasonId: string } }) => h.nativeRosters.filter((r) => r.seasonId === where.seasonId),
    },
  },
}))
vi.mock('@/lib/discord/sync-outbound', () => ({ syncOutboundLeagueChat: async () => ({ synced: false }) }))

import {
  CLOSE_FINISH_MAX_MARGIN,
  detectWeekMoments,
  postWeekMatchupMoments,
  runWeekMatchupMomentsSweep,
  type WeekGame,
  type WeekMomentUnit,
} from '@/lib/league-chat/weekMatchupMoments'
import { CHIMMY_DAILY_CAP, chimmyDayKey, chimmyMomentSlotCacheKey } from '@/lib/league-chat/chimmyMoments'
import { getLeagueChatMessages } from '@/lib/league-chat/LeagueChatMessageService'

/** Tuesday 10:00 ET, the morning after Monday night of NFL week 4, 2026. */
const NOW = new Date('2026-09-29T14:00:00.000Z')
const PID = 'SL-1'
const NAMES = ['Alpha', 'Bravo', 'Charlie', 'Delta', 'Echo', 'Foxtrot', 'Golf', 'Hotel']

const league = (id: string, over: Record<string, unknown> = {}) => ({
  id,
  name: 'Iron Horse',
  platform: 'sleeper',
  platformLeagueId: PID,
  sport: 'NFL',
  leagueType: 'redraft',
  settings: null as unknown,
  ...over,
})

const imported = (over: Record<string, unknown> = {}): WeekMomentUnit => ({
  source: 'imported',
  league: league('L1', over) as never,
  platformLeagueId: PID,
  season: 2026,
})

/** Both rows of one head-to-head, the way the Sleeper sync writes them. */
function game(week: number, matchupId: number, a: number, aPts: number, b: number, bPts: number): Row[] {
  const row = (r: number, pf: number, pa: number): Row => ({
    leagueId: PID,
    seasonYear: 2026,
    week,
    rosterId: String(r),
    matchupId,
    pointsFor: pf,
    pointsAgainst: pa,
    win: pf > pa ? 1 : 0,
  })
  return [row(a, aPts, bPts), row(b, bPts, aPts)]
}

function seedImported(week4 = true) {
  h.weekly = [
    // Week 1
    ...game(1, 1, 1, 110, 3, 100), ...game(1, 2, 2, 105, 4, 95), ...game(1, 3, 6, 120, 5, 80), ...game(1, 4, 8, 118, 7, 82),
    // Week 2
    ...game(2, 1, 2, 111, 1, 101), ...game(2, 2, 3, 108, 4, 98), ...game(2, 3, 6, 121, 7, 81), ...game(2, 4, 8, 119, 5, 79),
    // Week 3
    ...game(3, 1, 6, 122, 2, 102), ...game(3, 2, 8, 117, 3, 97), ...game(3, 3, 1, 109, 5, 89), ...game(3, 4, 4, 107, 7, 87),
    // Week 4
    ...(week4
      ? [...game(4, 1, 1, 101.2, 2, 100.8), ...game(4, 2, 3, 118.4, 4, 96.0), ...game(4, 3, 5, 110.0, 6, 90.0), ...game(4, 4, 7, 99.1, 8, 88.7)]
      : []),
    // Week 5: the whole schedule is on file, unplayed.
    ...game(5, 1, 1, 0, 4, 0), ...game(5, 2, 2, 0, 3, 0), ...game(5, 3, 5, 0, 8, 0), ...game(5, 4, 6, 0, 7, 0),
  ]
  h.teams = NAMES.map((n, i) => ({ leagueId: 'L1', externalId: String(i + 1), teamName: n, ownerName: `${n.toLowerCase()}_owner` }))
  h.snapshots = [
    { league_id: PID, season: 2026, week: 4, roster_id: '3', opponent_roster_id: '4', win_probability: 0.22, projected_points: 95, opponent_projected_points: 110 },
    { league_id: PID, season: 2026, week: 4, roster_id: '4', opponent_roster_id: '3', win_probability: 0.78, projected_points: 110, opponent_projected_points: 95 },
    { league_id: PID, season: 2026, week: 4, roster_id: '5', opponent_roster_id: '6', win_probability: 0.6, projected_points: 108, opponent_projected_points: 101 },
    { league_id: PID, season: 2026, week: 4, roster_id: '6', opponent_roster_id: '5', win_probability: 0.4, projected_points: 101, opponent_projected_points: 108 },
  ]
}

/** NFL week `week` of 2026: Thursday through a Monday-night kickoff at 00:15 UTC Tuesday. */
function seedSlate(week: number, lastKickoff: Date, status = 'Final') {
  h.games.push(
    { sport: 'NFL', season: 2026, week, status: 'Final', startTime: new Date(lastKickoff.getTime() - 4 * 86_400_000), source: 'espn', fetchedAt: lastKickoff, seasonType: 'regular', homeTeam: 'KC', awayTeam: 'LV' },
    { sport: 'NFL', season: 2026, week, status: 'Final', startTime: new Date(lastKickoff.getTime() - 32 * 3_600_000), source: 'espn', fetchedAt: lastKickoff, seasonType: 'regular', homeTeam: 'BUF', awayTeam: 'MIA' },
    { sport: 'NFL', season: 2026, week, status, startTime: lastKickoff, source: 'espn', fetchedAt: lastKickoff, seasonType: 'regular', homeTeam: 'DAL', awayTeam: 'NYG' },
  )
}

const MNF_WEEK4 = new Date('2026-09-29T00:15:00.000Z')

beforeEach(() => {
  h.cache.clear()
  h.chat = []
  h.leagues = new Map([['L1', { id: 'L1', userId: 'commish', settings: null }]])
  h.games = []
  h.native = []
  h.nativeRosters = []
  h.weeklyReads = 0
  h.leagueRows = []
  h.seasonRows = []
  seedImported()
  seedSlate(4, MNF_WEEK4)
})

// ─── Detection (pure) ──────────────────────────────────────────────────────────────────────────

const side = (name: string, points: number, over: Partial<WeekGame['a']> = {}): WeekGame['a'] => ({
  rosterId: name,
  name,
  points,
  winProbability: null,
  record: { wins: 1, losses: 1, ties: 0 },
  ...over,
})

describe('close finishes', () => {
  it(`calls a game decided by ${CLOSE_FINISH_MAX_MARGIN} points or less close — and one decided by more, not`, () => {
    const m = detectWeekMoments(2026, 4, [
      { a: side('A', 103.0), b: side('B', 100.0) }, // exactly 3.0
      { a: side('C', 100.0), b: side('D', 103.01) }, // 3.01
      { a: side('E', 95.5), b: side('F', 95.5) }, // a tie was not decided
      { a: side('G', 0), b: side('H', 0) }, // unplayed
    ])
    expect(m.closeFinishes.map((c) => [c.winner, c.loser, c.margin])).toEqual([['A', 'B', 3]])
    expect(m.upsets).toEqual([])
  })

  it('leaves out a game with no nameable team rather than posting "Team 4"', () => {
    const m = detectWeekMoments(2026, 4, [{ a: side('A', 100.2), b: { ...side('B', 100), name: null } }])
    expect(m.closeFinishes).toEqual([])
  })
})

describe('upsets', () => {
  it('by saved odds: a winner given 40% or less', () => {
    const m = detectWeekMoments(2026, 4, [{ a: side('A', 110, { winProbability: 0.31 }), b: side('B', 100, { winProbability: 0.69 }) }])
    expect(m.upsets).toMatchObject([{ winner: 'A', signal: 'saved_odds', winProbability: 0.31 }])
  })

  it('never calls a favourite’s win an upset — by the odds or by the standings', () => {
    const byOdds = detectWeekMoments(2026, 4, [
      // 0-3 beat 3-0, but the odds saved before kickoff had the winner at 60%: odds decide.
      {
        a: side('A', 110, { winProbability: 0.6, record: { wins: 0, losses: 3, ties: 0 } }),
        b: side('B', 90, { winProbability: 0.4, record: { wins: 3, losses: 0, ties: 0 } }),
      },
    ])
    expect(byOdds.upsets).toEqual([])
    const byStandings = detectWeekMoments(2026, 4, [
      { a: side('A', 120, { record: { wins: 3, losses: 0, ties: 0 } }), b: side('B', 80, { record: { wins: 0, losses: 3, ties: 0 } }) },
    ])
    expect(byStandings.upsets).toEqual([])
  })

  it('by standings at kickoff only with no saved odds, two games back, and three games in', () => {
    const early = detectWeekMoments(2026, 3, [
      { a: side('A', 110, { record: { wins: 0, losses: 2, ties: 0 } }), b: side('B', 90, { record: { wins: 2, losses: 0, ties: 0 } }) },
    ])
    expect(early.upsets).toEqual([]) // only two games in
    const oneBack = detectWeekMoments(2026, 5, [
      { a: side('A', 110, { record: { wins: 1, losses: 3, ties: 0 } }), b: side('B', 90, { record: { wins: 2, losses: 2, ties: 0 } }) },
    ])
    expect(oneBack.upsets).toEqual([])
    const twoBack = detectWeekMoments(2026, 5, [
      { a: side('A', 110, { record: { wins: 1, losses: 3, ties: 0 } }), b: side('B', 90, { record: { wins: 3, losses: 1, ties: 0 } }) },
    ])
    expect(twoBack.upsets).toMatchObject([{ winner: 'A', signal: 'standings', gamesBehind: 2 }])
  })
})

// ─── One league's week, end to end ─────────────────────────────────────────────────────────────

describe('one combined post per league per week', () => {
  it('posts ONE Chimmy message with the upsets and the close finish, real scores, and the signal each used', async () => {
    const out = await postWeekMatchupMoments(imported(), { now: NOW })
    expect(out).toEqual({ posted: true, messageId: 'm1' })
    expect(h.chat).toHaveLength(1)

    const row = h.chat[0]!
    expect(row.userId).toBe('commish') // the technical author; every reader shows Chimmy
    expect(row.metadata).toMatchObject({ chimmy: true, chimmyMoment: { v: 1, kind: 'upset' } })
    const text = row.message as string
    expect(text).toContain('Charlie beat Delta 118.4–96.0 as a 22% underdog.')
    expect(text).toContain('Golf (0-3 going in) took down Hotel (3-0), 99.1–88.7.')
    expect(text).toContain('Alpha edged Bravo by 0.4, 101.2–100.8.')
    // The favourite who won is not in the post at all.
    expect(text).not.toMatch(/Echo|Foxtrot/)
    // Never an id, never "AI", never a banned word.
    expect(text).not.toMatch(/SL-1|roster ?\d|team \d|\bAI\b|leverage|synergy|disrupt|revolutionary|game-changing/i)

    const card = (row.metadata as { weekMoments: { upsets: Array<{ signal: string }>; closeFinishes: unknown[]; week: number } }).weekMoments
    expect(card.week).toBe(4)
    expect(card.upsets.map((u) => u.signal)).toEqual(['saved_odds', 'standings'])
    expect(card.closeFinishes).toHaveLength(1)

    const [read] = await getLeagueChatMessages('L1', { requestingUserId: 'commish' })
    expect(read).toMatchObject({ senderName: 'Chimmy', senderUserId: null })
  })

  it('a week with only a close finish goes out as a close finish', async () => {
    // Alpha–Bravo (0.4) and Echo's win as the saved-odds favourite are all that is left.
    h.weekly = h.weekly.filter((r) => !(r.week === 4 && ['3', '4', '7', '8'].includes(r.rosterId as string)))
    const out = await postWeekMatchupMoments(imported(), { now: NOW })
    expect(out.posted).toBe(true)
    expect(h.chat[0]!.metadata).toMatchObject({ chimmyMoment: { kind: 'close_finish' } })
    expect(h.chat[0]!.message).toMatch(/^Week 4 (came down to the wire|had some nail-biters)\./)
  })

  it('a quiet week posts nothing', async () => {
    // Only Echo's 20-point win as the 60% favourite is left: neither close nor an upset.
    h.weekly = h.weekly.filter((r) => !(r.week === 4 && r.rosterId !== '5' && r.rosterId !== '6'))
    expect(await postWeekMatchupMoments(imported(), { now: NOW })).toEqual({ posted: false, reason: 'no_moments' })
    expect(h.chat).toHaveLength(0)
  })
})

describe('dedupe', () => {
  it('posts a league’s week once, however many times the cron runs', async () => {
    expect((await postWeekMatchupMoments(imported(), { now: NOW })).posted).toBe(true)
    expect(await postWeekMatchupMoments(imported(), { now: NOW })).toEqual({ posted: false, reason: 'duplicate' })
    expect(h.chat).toHaveLength(1)
  })

  it('once per week even when a later read finds an upset the first did not — whichever kind led', async () => {
    const snapshots = h.snapshots
    // Charlie's odds are not on file yet (Echo's are): the first read sees close finishes only.
    h.snapshots = snapshots.filter((x) => x.roster_id === '5' || x.roster_id === '6')
    h.weekly = h.weekly.filter((r) => !(r.week === 4 && ['7', '8'].includes(r.rosterId as string)))
    h.weekly = h.weekly.map((r) =>
      r.week === 4 && r.rosterId === '3' ? { ...r, pointsFor: 97.5, pointsAgainst: 96.0 } : r.week === 4 && r.rosterId === '4' ? { ...r, pointsFor: 96.0, pointsAgainst: 97.5 } : r,
    )
    const first = await postWeekMatchupMoments(imported(), { now: NOW })
    expect(first.posted).toBe(true)
    expect(h.chat[0]!.metadata).toMatchObject({ chimmyMoment: { kind: 'close_finish' } })
    h.snapshots = snapshots // odds turn up: Charlie is now an upset
    expect(await postWeekMatchupMoments(imported(), { now: NOW })).toEqual({ posted: false, reason: 'duplicate' })
    expect(h.chat).toHaveLength(1)
  })
})

describe('the daily cap and the off-switch', () => {
  it(`counts against Chimmy’s ${CHIMMY_DAILY_CAP}-a-day cap`, async () => {
    const day = chimmyDayKey(NOW)
    for (let s = 1; s <= CHIMMY_DAILY_CAP; s++) {
      h.cache.set(chimmyMomentSlotCacheKey('L1', day, s), { data: {}, expiresAt: new Date(NOW.getTime() + 86_400_000) })
    }
    expect(await postWeekMatchupMoments(imported(), { now: NOW })).toEqual({ posted: false, reason: 'daily_cap' })
    expect(h.chat).toHaveLength(0)
  })

  it('stays silent — and reads nothing — when the commissioner switched Chimmy off', async () => {
    const off = { chimmySpeaksUp: false }
    h.leagues.set('L1', { id: 'L1', userId: 'commish', settings: off })
    expect(await postWeekMatchupMoments(imported({ settings: off }), { now: NOW })).toEqual({ posted: false, reason: 'disabled' })
    expect(h.weeklyReads).toBe(0)
    expect(h.chat).toHaveLength(0)
  })
})

describe('only a final, recent week', () => {
  it('not while the week is still being played', async () => {
    // Golf and Hotel have not played yet: the week is in progress.
    h.weekly = h.weekly.map((r) => (r.week === 4 && ['7', '8'].includes(r.rosterId as string) ? { ...r, pointsFor: 0, pointsAgainst: 0 } : r))
    expect(await postWeekMatchupMoments(imported(), { now: NOW })).toEqual({ posted: false, reason: 'not_final' })
  })

  it('not while an NFL game of that week is unfinished, nor inside the grace after the last kickoff', async () => {
    h.games = []
    seedSlate(4, MNF_WEEK4, 'In Progress')
    expect(await postWeekMatchupMoments(imported(), { now: NOW })).toEqual({ posted: false, reason: 'not_final' })
    h.games = []
    seedSlate(4, MNF_WEEK4)
    const mondayNight = new Date('2026-09-29T03:30:00.000Z')
    expect(await postWeekMatchupMoments(imported(), { now: mondayNight })).toEqual({ posted: false, reason: 'not_final' })
  })

  it('not a finished week that is history — the first Tuesday of an offseason posts nothing', async () => {
    const monthLater = new Date(NOW.getTime() + 30 * 86_400_000)
    expect(await postWeekMatchupMoments(imported(), { now: monthLater })).toEqual({ posted: false, reason: 'not_final' })
  })
})

describe('native leagues read their own final matchups', () => {
  it('posts from RedraftMatchup finals, with standings at kickoff (no saved odds exist for them)', async () => {
    h.leagues.set('N1', { id: 'N1', userId: 'commish-n', settings: null })
    h.nativeRosters = NAMES.slice(0, 4).map((n, i) => ({ seasonId: 'S1', id: `r${i + 1}`, teamName: n, ownerName: `${n} owner` }))
    const m = (week: number, home: number, hs: number, away: number, as: number, status = 'final') => ({
      seasonId: 'S1', week, type: 'regular', homeRosterId: `r${home}`, awayRosterId: `r${away}`, homeScore: hs, awayScore: as, status, isMedianMatchup: false,
    })
    h.native = [
      m(1, 1, 120, 2, 90), m(1, 3, 110, 4, 100),
      m(2, 1, 118, 4, 90), m(2, 3, 112, 2, 95),
      m(3, 1, 121, 3, 99), m(3, 4, 105, 2, 98),
      // Week 4: Bravo (0-3) takes down Alpha (3-0); Charlie edges Delta by 1.5.
      m(4, 2, 104.5, 1, 99.0), m(4, 3, 101.5, 4, 100.0),
      m(5, 1, 0, 3, 0, 'scheduled'), m(5, 2, 0, 4, 0, 'scheduled'),
    ]
    const unit: WeekMomentUnit = {
      source: 'native',
      league: { ...league('N1'), platform: 'allfantasy', platformLeagueId: 'N1' } as never,
      seasonId: 'S1',
      season: 2026,
    }
    const out = await postWeekMatchupMoments(unit, { now: NOW })
    expect(out.posted).toBe(true)
    const text = h.chat[0]!.message as string
    expect(text).toContain('Bravo (0-3 going in) took down Alpha (3-0), 104.5–99.0.')
    expect(text).toContain('Charlie edged Delta by 1.5, 101.5–100.0.')

    // A week still being scored is not final.
    h.native = h.native.map((x) => (x.week === 4 && x.homeRosterId === 'r3' ? { ...x, status: 'active' } : x))
    expect(await postWeekMatchupMoments({ ...unit, league: { ...unit.league, id: 'N2' } }, { now: NOW })).toEqual({
      posted: false,
      reason: 'not_final',
    })
  })
})

describe('the sweep the weekly-awards cron runs', () => {
  it('stops when the shared run budget is spent and says how many it did not reach', async () => {
    const spent = { exhausted: () => true, elapsedMs: () => 240_000, remainingMs: () => 0 }
    h.leagueRows = [league('L1')]
    const counts = await runWeekMatchupMomentsSweep({ budget: spent, now: NOW })
    expect(counts).toMatchObject({ leagues: 1, posted: 0, skippedForTime: 1 })
    expect(h.chat).toHaveLength(0)

    const fresh = { exhausted: () => false, elapsedMs: () => 0, remainingMs: () => 240_000 }
    expect(await runWeekMatchupMomentsSweep({ budget: fresh, now: NOW })).toMatchObject({ leagues: 1, posted: 1, skippedForTime: 0 })
    expect(await runWeekMatchupMomentsSweep({ budget: fresh, now: NOW })).toMatchObject({ posted: 0, duplicate: 1 })
    expect(h.chat).toHaveLength(1)
  })
})
