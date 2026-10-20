// @vitest-environment node
/**
 * News routed by TEAM (owner's decision 2026-10-13): a story about a team reaches that team's
 * followers, and a player story reaches the followers of the team he is on NOW.
 *
 * Every headline, slot and tag below is a production `player_news` row sampled 2026-10-13, and the
 * Sleeper/registry disagreements are measured ones (Tyreek Hill: registry MIA, Sleeper no team).
 * The repeat guard is the REAL module over an in-memory cache, so the cross-row dedupe is exercised.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

type Pim = { id: string; canonicalName: string; normalizedName: string; position: string; currentTeam: string; sleeperId: string }
type RosterRow = { playerId: string; playerName: string; team: string | null; sport: string; roster: { ownerId: string; leagueId: string } }
type SpRow = { source: string; sleeperId: string | null; externalId: string; name: string; position: string | null; team: string | null; fetchedAt: Date }

const REGISTRY: Pim[] = [
  { id: 'pim-mclaurin', canonicalName: 'Terry McLaurin', normalizedName: 'terry mclaurin', position: 'WR', currentTeam: 'WAS', sleeperId: '5927' },
  { id: 'pim-daniels', canonicalName: 'Jayden Daniels', normalizedName: 'jayden daniels', position: 'QB', currentTeam: 'WAS', sleeperId: '11566' },
  { id: 'pim-hill', canonicalName: 'Tyreek Hill', normalizedName: 'tyreek hill', position: 'WR', currentTeam: 'MIA', sleeperId: '3321' },
  { id: 'pim-kj', canonicalName: 'Kaleb Johnson', normalizedName: 'kaleb johnson', position: 'RB', currentTeam: 'PIT', sleeperId: '12507' },
]

const h = vi.hoisted(() => ({
  news: [] as Array<Record<string, unknown>>,
  roster: [] as RosterRow[],
  sleeper: [] as SpRow[],
  sleeperThrows: false,
  cache: new Map<string, Date>(),
  dispatch: vi.fn(),
  teamFollowers: vi.fn(),
  cap: vi.fn(),
}))

const has = (hay: string, needle: string) => hay.toLowerCase().includes(needle.toLowerCase())

vi.mock('server-only', () => ({}))
vi.mock('@/lib/prisma', () => ({
  prisma: {
    playerNewsRecord: { findMany: async () => h.news, updateMany: async () => ({ count: 1 }) },
    playerIdentityMap: {
      findMany: async ({ where }: { where: { sport: string; sleeperId?: { in: string[] }; OR?: Array<Record<string, { contains?: string; in?: string[] }>> } }) =>
        REGISTRY.filter((p) =>
          where.sport === 'NFL' &&
          (where.sleeperId ? where.sleeperId.in.includes(p.sleeperId) : false ||
          (where.OR ?? []).some((c) =>
            (c.canonicalName?.contains != null && has(p.canonicalName, c.canonicalName.contains)) ||
            (c.normalizedName?.in != null && c.normalizedName.in.includes(p.normalizedName)),
          )),
        ),
    },
    redraftRosterPlayer: {
      findMany: async ({ where }: { where: { OR?: Array<{ playerName: { contains: string } }>; playerName?: { equals?: string } } }) => {
        if (where.playerName?.equals != null) return h.roster.filter((r) => r.playerName.toLowerCase() === where.playerName!.equals!.toLowerCase())
        return h.roster.filter((r) => (where.OR ?? []).some((c) => has(r.playerName, c.playerName.contains)))
      },
    },
    // Honours sleeperIdWhere's shape: sleeperId IN ids OR externalId IN sleeper:ids.
    sportsPlayer: {
      findMany: async ({ where }: { where: { sport?: string; OR: Array<{ sleeperId?: { in: string[] }; externalId?: { in: string[] } }> } }) => {
        if (h.sleeperThrows) throw new Error('relation does not exist')
        return h.sleeper.filter((r) =>
          where.OR.some((c) => (c.sleeperId && r.sleeperId && c.sleeperId.in.includes(r.sleeperId)) || (c.externalId && c.externalId.in.includes(r.externalId))),
        )
      },
    },
    $queryRaw: async () => [],
    // The repeat guard's store.
    sportsDataCache: {
      findMany: async ({ where }: { where: { cacheKey: { in: string[] }; expiresAt: { gt: Date } } }) =>
        where.cacheKey.in.filter((k) => (h.cache.get(k)?.getTime() ?? 0) > where.expiresAt.gt.getTime()).map((cacheKey) => ({ cacheKey })),
      deleteMany: async () => ({ count: 0 }),
      createMany: async ({ data }: { data: Array<{ cacheKey: string; expiresAt: Date }> }) => {
        for (const r of data) if (!h.cache.has(r.cacheKey)) h.cache.set(r.cacheKey, r.expiresAt)
        return { count: data.length }
      },
    },
  },
}))
vi.mock('@/lib/notifications/NotificationDispatcher', () => ({ dispatchNotification: h.dispatch }))
vi.mock('@/lib/news/player-news-category', () => ({ classifyPlayerNewsCategory: () => 'injury' }))
vi.mock('@/lib/follows/teamFollows', () => ({ listFollowerIdsForTeam: h.teamFollowers }))
vi.mock('@/lib/follows/teamFollowAlerts', () => ({
  // The real resolver maps a canonical NFL code onto the follow key, which for these clubs is the code.
  resolveNewsTeam: async (_s: string, team: string | null) => (team && /^[A-Z]{2,3}$/.test(team) ? team : null),
  withinTeamFollowDailyCap: h.cap,
}))

import { dispatchPendingPlayerNewsNotifications } from '@/lib/notifications/PlayerNewsNotificationService'
import { nflTeamsNamedIn, teamNewsSubject } from '@/lib/notifications/newsPlayerBinding'

const FANS: Record<string, string[]> = {
  WAS: ['commanders-fan'], MIA: ['dolphins-fan'], PIT: ['steelers-fan'], GB: ['packers-fan'], IND: ['colts-fan'],
  DAL: ['cowboys-fan'], MIN: ['vikings-fan'],
}

let seq = 0
const story = (playerName: string, team: string | null, headline: string) => ({
  id: `n-${++seq}`, sport: 'NFL', playerName, team, headline, body: null, impact: 'high',
})
const roster = (ownerId: string, playerId: string, playerName: string, team: string): RosterRow => ({
  playerId, playerName, team, sport: 'NFL', roster: { ownerId, leagueId: `lg-${ownerId}` },
})
const sleeperRow = (sleeperId: string, name: string, position: string, team: string | null): SpRow => ({
  source: 'sleeper', sleeperId, externalId: `sleeper:${sleeperId}`, name, position, team, fetchedAt: new Date(),
})
const calls = () => h.dispatch.mock.calls.map((c) => c[0] as { userIds: string[]; category: string; title: string; meta: Record<string, unknown> })
const toldUnder = (category: string) => calls().filter((p) => p.category === category).flatMap((p) => p.userIds)
const told = () => calls().flatMap((p) => p.userIds)

const MCLAURIN_OUT = "Commanders WR Terry McLaurin won't play London game because of hamstring injury"

beforeEach(() => {
  h.dispatch.mockReset()
  h.dispatch.mockResolvedValue({ requested: 1, delivered: 1, suppressed: 0, failed: 0 })
  h.teamFollowers.mockReset()
  h.teamFollowers.mockImplementation(async (_s: string, abbr: string) => FANS[abbr] ?? [])
  h.cap.mockReset()
  h.cap.mockImplementation(async (ids: string[]) => ids)
  h.cache.clear()
  h.roster = []
  h.sleeper = []
  h.sleeperThrows = false
  h.news = []
})

describe('teamNewsSubject — which ONE club a team row is about', () => {
  it.each([
    ['Washington Commanders', 'WAS', MCLAURIN_OUT, 'WAS'],
    ['Minnesota Vikings', 'MIN', "Murray and the Vikings might've found some momentum for a lagging offense, late in their latest win", 'MIN'],
    ['Cowboys', null, 'Cowboys release veteran linebacker after loss', 'DAL'],
    ['New York Giants', 'NYG', 'Giants fire defensive coordinator', 'NYG'],
  ])('%s / %s → %s', (slot, tag, headline, want) => {
    expect(teamNewsSubject('NFL', slot, tag, headline)).toBe(want)
  })

  it.each([
    // The tag names another club: this one is a Commanders story under a Colts slot.
    ['Indianapolis Colts', 'WAS', 'MCL sprain sidelines Mariota; Daniels preps for full practice'],
    // …and a tag that disagrees settles it even when the headline names only the slot's club.
    ['Detroit Lions', 'GB', "Detroit Lions get bad news in NFL analyst's hot take"],
    // Two clubs in the headline: a matchup is about neither alone.
    ['Baltimore Ravens', 'BAL', "Ravens vs. Falcons prediction, odds, time: Week 5 'Sunday Night Football' picks from proven model"],
    ['Chicago Bears', 'MIA', 'Chicago Bears have perfect $68M trade target from struggling Miami Dolphins'],
    ['Seattle Seahawks', 'SEA', 'Seahawks edge Niners in overtime'],
    // No club in the headline at all.
    ['Tennessee Titans', 'TEN', 'Week 5 NFL picks, best bets from proven model: This 5-leg parlay pays nearly 25-1'],
    // The slot is not a club, only contains one.
    ['How Bills', 'BUF', 'How Bills QB Josh Allen has become a star on and off the field'],
    ['Watch Lions', 'CAR', 'How to Watch Lions vs. Panthers: TV Channel, Live Stream, Time'],
    // A city is not a club ("Los Angeles" is two).
    ['Los Angeles', 'LAR', 'Rams sign kicker'],
    // An unreadable tag is disagreement, not absence.
    ['Dallas Cowboys', 'Free Agent', 'Cowboys release veteran linebacker'],
  ])('%s / %s → null', (slot, tag, headline) => {
    expect(teamNewsSubject('NFL', slot, tag, headline)).toBeNull()
  })

  it('NFL only', () => {
    expect(teamNewsSubject('NHL', 'Dallas Stars', 'DAL', 'Stars recall forward')).toBeNull()
  })

  it('a shared city names both clubs; a full name consumes its own city', () => {
    expect([...nflTeamsNamedIn('Rams lose in Los Angeles')].sort()).toEqual(['LAC', 'LAR'])
    expect([...nflTeamsNamedIn('New York Giants rally late')]).toEqual(['NYG'])
  })
})

describe('a TEAM row goes to that team\'s followers', () => {
  it('"Washington Commanders" / WAS reaches Commanders followers, titled with the club', async () => {
    h.news = [story('Washington Commanders', 'WAS', MCLAURIN_OUT)]
    const out = await dispatchPendingPlayerNewsNotifications()
    expect(toldUnder('followed_teams')).toEqual(['commanders-fan'])
    expect(calls()[0].title).toContain('Washington Commanders')
    expect(calls()[0].meta).toMatchObject({ followedTeam: 'WAS', teamNews: true })
    expect(out).toMatchObject({ teamNews: 1, unboundPlayer: 0, notified: 1, teamFollowerRecipients: 1 })
  })

  it('🛑 "Indianapolis Colts" tagged WAS over a Commanders story tells NOBODY — not Colts fans, not Commanders fans', async () => {
    h.news = [story('Indianapolis Colts', 'WAS', 'MCL sprain sidelines Mariota; Daniels preps for full practice')]
    const out = await dispatchPendingPlayerNewsNotifications()
    expect(h.dispatch).not.toHaveBeenCalled()
    expect(out).toMatchObject({ teamNews: 0, unboundPlayer: 1 })
  })

  it('respects the daily team-alert cap', async () => {
    h.news = [story('Washington Commanders', 'WAS', MCLAURIN_OUT)]
    h.cap.mockImplementation(async () => [])
    const out = await dispatchPendingPlayerNewsNotifications()
    expect(h.dispatch).not.toHaveBeenCalled()
    expect(out.teamFollowCapped).toBe(1)
  })

  it('two DIFFERENT team stories of the same kind both go out (the 24h topic key is not applied to a team)', async () => {
    h.news = [
      story('Dallas Cowboys', 'DAL', 'Cowboys rule out starting left tackle'),
      story('Dallas Cowboys', 'DAL', 'Cowboys rule out top cornerback for Sunday'),
    ]
    await dispatchPendingPlayerNewsNotifications()
    expect(toldUnder('followed_teams')).toEqual(['cowboys-fan', 'cowboys-fan'])
  })
})

describe('🛑 one headline is one alert, across the rows that carry it', () => {
  it('player row then its team-news twin: a Commanders fan hears it once', async () => {
    h.news = [story('Terry McLaurin', 'WAS', MCLAURIN_OUT), story('Washington Commanders', 'WAS', MCLAURIN_OUT)]
    const out = await dispatchPendingPlayerNewsNotifications()
    expect(toldUnder('followed_teams')).toEqual(['commanders-fan'])
    expect(out.repeatsSuppressed).toBe(1)
  })

  it('team-news row first, then the player row: still once', async () => {
    h.news = [story('Washington Commanders', 'WAS', MCLAURIN_OUT), story('Terry McLaurin', 'WAS', MCLAURIN_OUT)]
    await dispatchPendingPlayerNewsNotifications()
    expect(told()).toEqual(['commanders-fan'])
  })

  it('a manager who rosters the player AND follows the team is told once, by the roster', async () => {
    h.roster = [roster('mgr', '5927', 'Terry McLaurin', 'WAS')]
    h.teamFollowers.mockImplementation(async (_s: string, abbr: string) => (abbr === 'WAS' ? ['mgr', 'commanders-fan'] : []))
    h.news = [story('Terry McLaurin', 'WAS', MCLAURIN_OUT), story('Washington Commanders', 'WAS', MCLAURIN_OUT)]
    await dispatchPendingPlayerNewsNotifications()
    expect(toldUnder('injury_alerts')).toEqual(['mgr'])
    expect(toldUnder('followed_teams')).toEqual(['commanders-fan'])
  })

  it('two teammates named in one headline: the team fan hears it once', async () => {
    const headline = 'Commanders: Daniels and McLaurin ruled out Sunday'
    h.news = [story('Jayden Daniels', 'WAS', headline), story('Terry McLaurin', 'WAS', headline)]
    await dispatchPendingPlayerNewsNotifications()
    expect(toldUnder('followed_teams')).toEqual(['commanders-fan'])
  })
})

describe("a player story goes to the followers of the team he is on NOW (his Sleeper row)", () => {
  it('🛑 Tyreek Hill — registry MIA, Sleeper no team — is told to his managers and to NO Dolphins fan', async () => {
    h.sleeper = [sleeperRow('3321', 'Tyreek Hill', 'WR', null), { ...sleeperRow('3321', 'Tyreek Hill', 'WR', 'Miami Dolphins'), source: 'thesportsdb', externalId: '34161' }]
    h.roster = [roster('hill-mgr', '3321', 'Tyreek Hill', 'MIA')]
    h.news = [story('Tyreek Hill', 'MIA', 'Tyreek Hill (knee) cleared to work out for teams')]
    await dispatchPendingPlayerNewsNotifications()
    expect(toldUnder('injury_alerts')).toEqual(['hill-mgr'])
    expect(told()).not.toContain('dolphins-fan')
    expect(h.teamFollowers).not.toHaveBeenCalled()
  })

  it('Kaleb Johnson — registry PIT, Sleeper Green Bay Packers — goes to Packers fans, not Steelers fans', async () => {
    h.sleeper = [sleeperRow('12507', 'Kaleb Johnson', 'RB', 'Green Bay Packers')]
    h.news = [story('Kaleb Johnson', 'PIT', 'Kaleb Johnson (ankle) limited at practice')]
    await dispatchPendingPlayerNewsNotifications()
    expect(toldUnder('followed_teams')).toEqual(['packers-fan'])
    expect(calls()[0].meta.team).toBe('GB')
  })

  it('no readable Sleeper row keeps the registry team (what routed before)', async () => {
    h.sleeperThrows = true
    h.news = [story('Kaleb Johnson', null, 'Kaleb Johnson (ankle) limited at practice')]
    await dispatchPendingPlayerNewsNotifications()
    expect(toldUnder('followed_teams')).toEqual(['steelers-fan'])
  })
})
