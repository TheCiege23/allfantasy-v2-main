// @vitest-environment node
/**
 * Starter injuries: a player sitting in a STARTING lineup is ruled out before his kickoff, and Chimmy
 * says so in that league's chat, naming the team — from INSIDE the injury-news pipeline
 * (`dispatchPendingPlayerNewsNotifications`), on the repeat guard's own status reading and topic
 * identity. Not a second detector.
 *
 * The real pipeline, the real repeat guard, the real `postChimmyMoment` (claims, cap, switch) and the
 * real kickoff map (`buildWeekKickoffMap`) run over an in-memory Prisma.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  cache: new Map<string, { data: unknown; expiresAt: Date }>(),
  chat: [] as Array<Record<string, unknown>>,
  news: [] as Array<Record<string, unknown>>,
  roster: [] as Array<Record<string, unknown>>,
  seasons: [] as Array<Record<string, unknown>>,
  games: [] as Array<Record<string, unknown>>,
  settings: new Map<string, unknown>(),
  dispatch: vi.fn(async () => ({})),
}))

function keyMatches(key: string, where: Record<string, unknown>): boolean {
  const k = where.cacheKey as unknown
  if (typeof k === 'string') return k === key
  if (k && typeof k === 'object' && Array.isArray((k as { in?: string[] }).in)) return (k as { in: string[] }).in.includes(key)
  return true
}

vi.mock('@/lib/prisma', () => ({
  prisma: {
    playerNewsRecord: {
      findMany: async () => h.news.filter((n) => !n.notificationDispatchedAt),
      updateMany: async ({ where }: { where: { id: { in: string[] } } }) => {
        for (const n of h.news) if (where.id.in.includes(n.id as string)) n.notificationDispatchedAt = new Date()
        return { count: where.id.in.length }
      },
    },
    redraftRosterPlayer: {
      findMany: async ({ where }: { where: { playerName: { contains: string } } }) =>
        h.roster.filter((r) => String(r.playerName).toLowerCase().includes(where.playerName.contains.toLowerCase())),
    },
    redraftSeason: {
      findMany: async ({ where }: { where: { id: { in: string[] } } }) =>
        h.seasons
          .filter((s) => where.id.in.includes(s.id as string))
          .map((s) => ({ ...s, league: { settings: h.settings.get(s.leagueId as string) ?? null, bestBallMode: false, leagueVariant: null, leagueType: 'redraft' } })),
    },
    sportsGame: {
      findMany: async ({ where }: { where: { season: number; week: number } }) =>
        h.games.filter((g) => g.season === where.season && g.week === where.week),
    },
    league: {
      findUnique: async ({ where }: { where: { id: string } }) => ({ id: where.id, userId: `owner-${where.id}`, settings: h.settings.get(where.id) ?? null }),
    },
    leagueChatMessage: {
      create: async ({ data }: { data: Record<string, unknown> }) => {
        const row = { id: `m${h.chat.length + 1}`, ...data, createdAt: new Date(), user: { id: data.userId, username: 'o', displayName: 'Owner', avatarUrl: null, profile: null } }
        h.chat.push(row)
        return row
      },
    },
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
  },
}))
vi.mock('@/lib/notifications/NotificationDispatcher', () => ({ dispatchNotification: h.dispatch }))
vi.mock('@/lib/follows/playerFollows', () => ({ listFollowerIdsForPlayer: async () => [] }))
vi.mock('@/lib/discord/sync-outbound', () => ({ syncOutboundLeagueChat: async () => ({ synced: false }) }))

import { dispatchPendingPlayerNewsNotifications } from '@/lib/notifications/PlayerNewsNotificationService'
import { newsTopicId } from '@/lib/notifications/playerNewsRepeatGuard'
import { CHIMMY_DAILY_CAP, chimmyDayKey, chimmyMomentDedupeCacheKey, chimmyMomentSlotCacheKey } from '@/lib/league-chat/chimmyMoments'

/** Friday afternoon of NFL week 4, 2026. The Rams play Sunday at 4:25 PM ET. */
const FRIDAY = new Date('2026-09-25T18:00:00.000Z')
const RAMS_KICKOFF = new Date('2026-09-27T20:25:00.000Z')

let seq = 0
function news(headline: string, over: Record<string, unknown> = {}) {
  seq += 1
  h.news.push({
    id: `n${seq}`,
    sport: 'NFL',
    playerName: 'Puka Nacua',
    team: 'LAR',
    headline,
    body: null,
    impact: 'high',
    createdAt: FRIDAY,
    publishedAt: FRIDAY,
    notificationDispatchedAt: null,
    ...over,
  })
}

const player = (league: string, slotType: string, over: Record<string, unknown> = {}) => ({
  playerName: 'Puka Nacua',
  position: 'WR',
  team: 'LAR',
  slotType,
  sport: 'NFL',
  roster: { id: `r-${league}`, ownerId: `mgr-${league}`, leagueId: league, seasonId: `s-${league}`, teamName: `Team ${league}`, ownerName: `owner ${league}` },
  ...over,
})

const run = () => dispatchPendingPlayerNewsNotifications({ lookbackHours: 24 })

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(FRIDAY)
  h.cache.clear()
  h.chat = []
  h.news = []
  h.settings = new Map()
  h.dispatch.mockClear()
  h.roster = [player('Alpha', 'WR')]
  h.seasons = [
    { id: 's-Alpha', leagueId: 'Alpha', season: 2026, sport: 'NFL', status: 'in_season', currentWeek: 4 },
    { id: 's-Bravo', leagueId: 'Bravo', season: 2026, sport: 'NFL', status: 'in_season', currentWeek: 4 },
  ]
  h.games = [
    { sport: 'NFL', season: 2026, week: 4, homeTeam: 'LAR', awayTeam: 'SF', startTime: RAMS_KICKOFF },
    { sport: 'NFL', season: 2026, week: 4, homeTeam: 'BUF', awayTeam: 'MIA', startTime: new Date('2026-09-27T17:00:00.000Z') },
  ]
})

describe('a ruled-out STARTER gets one Chimmy line in that league', () => {
  it('names the player, the team it hits, the week and the kickoff — as Chimmy', async () => {
    news('Puka Nacua ruled out for Sunday with an ankle injury')
    const out = await run()
    expect(out.chimmyStarterPosts).toBe(1)
    expect(h.chat).toHaveLength(1)
    const row = h.chat[0]!
    expect(row.leagueId).toBe('Alpha')
    expect(row.metadata).toMatchObject({ chimmy: true, chimmyMoment: { v: 1, kind: 'starter_injury' } })
    expect(row.message).toMatch(
      /^🚑 Puka Nacua \(WR, LAR\) is ruled out for Week 4\. Team Alpha, that is one of your starters — kickoff is Sun 4:25 PM ET\. /,
    )
    expect(row.message).not.toMatch(/\bAI\b|leverage|synergy|disrupt|revolutionary|game-changing|@/i)
    // The people who roster him are still told, exactly as before.
    expect(h.dispatch).toHaveBeenCalledTimes(1)
  })

  it('never for a BENCH (or IR, or taxi) player', async () => {
    h.roster = [player('Alpha', 'BENCH'), player('Bravo', 'IR')]
    news('Puka Nacua ruled out for Sunday with an ankle injury')
    const out = await run()
    expect(out.chimmyStarterPosts).toBe(0)
    expect(h.chat).toHaveLength(0)
    expect(h.dispatch).toHaveBeenCalled() // managers still hear it privately
  })

  it('a starter in one league and a bench player in another: only the starter’s league hears it', async () => {
    h.roster = [player('Alpha', 'BENCH'), player('Bravo', 'FLEX')]
    news('Puka Nacua ruled out for Sunday with an ankle injury')
    await run()
    expect(h.chat.map((r) => r.leagueId)).toEqual(['Bravo'])
  })

  it('does not promise a swap the league’s lock rule no longer allows', async () => {
    // This league locks the whole lineup at the week's first kickoff — Buffalo's, at 1:00 PM ET.
    h.settings.set('Alpha', { sportConfig: { lineupLockType: 'first_game_of_week' } })
    vi.setSystemTime(new Date('2026-09-27T18:00:00.000Z')) // Sunday 2:00 PM ET: locked, Rams not yet on
    news('Puka Nacua ruled out, will not play this afternoon', { createdAt: new Date(), publishedAt: new Date() })
    await run()
    expect(h.chat).toHaveLength(1)
    expect(h.chat[0]!.message).toMatch(/Lineups are already locked for this one/)
    expect(h.chat[0]!.message).not.toMatch(/swap|bench before lock|replacement/)
  })

  it('never after his game has kicked off', async () => {
    vi.setSystemTime(new Date(RAMS_KICKOFF.getTime() + 60_000))
    news('Puka Nacua ruled out for the second half', { createdAt: new Date(), publishedAt: new Date() })
    await run()
    expect(h.chat).toHaveLength(0)
  })

  it('never on a bye, or for a team with no game on file — "before kickoff" needs a kickoff', async () => {
    h.games = h.games.filter((g) => g.homeTeam !== 'LAR')
    news('Puka Nacua ruled out for Sunday with an ankle injury')
    await run()
    expect(h.chat).toHaveLength(0)
  })

  it('not a different player who shares the name, and not on a name that merely contains his', async () => {
    h.roster = [
      player('Alpha', 'DL', { playerName: 'Josh Allen', position: 'DL', team: 'JAX' }),
      player('Bravo', 'QB', { playerName: 'Josh Allen Jr.', position: 'QB', team: 'BUF' }),
    ]
    news('Josh Allen ruled out with a shoulder injury', { playerName: 'Josh Allen', team: 'BUF' })
    await run()
    expect(h.chat).toHaveLength(0)
  })
})

describe('the repeat guard decides what "ruled out" and "the same news" mean', () => {
  it('questionable and doubtful are not ruled out — no post', async () => {
    news('Puka Nacua questionable for Sunday')
    news('Puka Nacua listed as doubtful for Sunday')
    await run()
    expect(h.chat).toHaveLength(0)
  })

  it('five outlets repeating "ruled out" are one post; a move to IR is new news', async () => {
    news('Puka Nacua ruled out for Sunday with an ankle injury')
    news('Rams rule out Nacua? McVay: Puka Nacua will not play Sunday')
    news("Puka Nacua won't play in Week 4")
    await run()
    expect(h.chat).toHaveLength(1)

    news('Puka Nacua placed on injured reserve')
    await run()
    expect(h.chat).toHaveLength(2)
    expect(h.chat[1]!.message).toMatch(/is headed to IR\. Team Alpha, that is one of your Week 4 starters/)
  })

  it('dedupes per league, player, status and week on the guard’s own topic id', async () => {
    const headline = 'Puka Nacua ruled out for Sunday with an ankle injury'
    news(headline)
    await run()
    const topic = newsTopicId({ sport: 'NFL', playerName: 'Puka Nacua', headline, category: 'injury' })
    expect(h.cache.has(chimmyMomentDedupeCacheKey('Alpha', 'starter_injury', `2026:w4:${topic}`))).toBe(true)
    // The same status next week is a new week.
    h.seasons = h.seasons.map((s) => ({ ...s, currentWeek: 5 }))
    h.games.push({ sport: 'NFL', season: 2026, week: 5, homeTeam: 'LAR', awayTeam: 'SEA', startTime: new Date('2026-10-04T20:25:00.000Z') })
    news('Puka Nacua ruled out again this week')
    await run()
    expect(h.chat).toHaveLength(2)
  })

  it('every league that starts him hears it once', async () => {
    h.roster = [player('Alpha', 'WR'), player('Bravo', 'FLEX')]
    news('Puka Nacua ruled out for Sunday with an ankle injury')
    news('Puka Nacua will not play Sunday')
    await run()
    expect(h.chat.map((r) => r.leagueId).sort()).toEqual(['Alpha', 'Bravo'])
  })
})

describe('the cap and the switch', () => {
  it(`counts against Chimmy’s ${CHIMMY_DAILY_CAP}-a-day cap`, async () => {
    for (let s = 1; s <= CHIMMY_DAILY_CAP; s++) {
      h.cache.set(chimmyMomentSlotCacheKey('Alpha', chimmyDayKey(FRIDAY), s), { data: {}, expiresAt: new Date(FRIDAY.getTime() + 86_400_000) })
    }
    news('Puka Nacua ruled out for Sunday with an ankle injury')
    const out = await run()
    expect(out.chimmyStarterPosts).toBe(0)
    expect(h.chat).toHaveLength(0)
  })

  it('stays silent when the commissioner switched Chimmy off', async () => {
    h.settings.set('Alpha', { chimmySpeaksUp: false })
    news('Puka Nacua ruled out for Sunday with an ankle injury')
    await run()
    expect(h.chat).toHaveLength(0)
    expect(h.dispatch).toHaveBeenCalledTimes(1)
  })
})
