import React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render } from '@testing-library/react'

/**
 * A daily sport's player card lists his NEXT GAMES BY DATE (2026-11-06).
 *
 * NBA, NHL and MLB clubs play several times a week and have no byes, so #3303 replaced the football
 * week strip on their cards with a note. The card now reads his club's next five games from
 * `SportsGame` (one feed, his club only) and, for NBA/NHL, how many he plays in the fantasy week.
 *
 * Prisma is a default-empty stand-in; `sportsGame.findMany` applies the loader's own where clause, so
 * a row outside the read window or from an unranked feed is dropped the way Postgres would drop it.
 */

type Fn = (...a: any[]) => any
const overrides = vi.hoisted(() => ({}) as Record<string, Record<string, Fn>>)
const lang = vi.hoisted(() => ({ language: 'en' as 'en' | 'es' }))

vi.mock('server-only', () => ({}))
vi.mock('@/lib/prisma', () => {
  const model = (name: string) =>
    new Proxy(
      {},
      {
        get: (_t, method: string) =>
          overrides[name]?.[method] ??
          (async () => (method === 'findMany' || method === 'groupBy' ? [] : method === 'count' ? 0 : null)),
      },
    )
  return {
    prisma: new Proxy({}, { get: (_t, name: string) => (name.startsWith('$') ? async () => [] : model(name)) }),
  }
})
vi.mock('@/lib/league-access', () => ({ memberLeaguePlatformIdsFor: vi.fn(async () => []) }))
vi.mock('@/lib/waiver-wire/watchlist-service', () => ({ isWatched: vi.fn(async () => false) }))
vi.mock('@/lib/follows/playerFollows', () => ({ followKeyFor: () => null, isFollowingPlayer: vi.fn(async () => null) }))
vi.mock('@/lib/injuries/injurySyncState', () => ({ readInjurySyncFreshness: vi.fn(async () => null) }))
vi.mock('@/lib/core-app/rosteredMarket', () => ({
  getRosteredMarket: vi.fn(async () => ({ byPlayerId: new Map(), leaguesCounted: 0 })),
}))
vi.mock('@/lib/core-app/playerProjections', () => ({
  latestProjectionWeek: vi.fn(async () => null),
  lookupProjections: vi.fn(async () => new Map()),
  lookupAfEngineProjections: vi.fn(async () => new Map()),
}))
vi.mock('@/lib/core-app/archivedTradeGrade', () => ({ gradeArchivedTradeRows: vi.fn(async () => new Map()) }))
vi.mock('@/lib/core-app/playerTradeVisual', () => ({ marketContextFor: () => ({ teams: 12 }) }))
vi.mock('@/lib/trade-intel/marketValueService', () => ({ getMarketValues: vi.fn(async () => null), playerValue: () => null }))
vi.mock('@/components/i18n/LanguageProviderClient', () => ({ useOptionalLanguage: () => ({ language: lang.language }) }))

import PlayerCardSheet from '@/components/core-app/player-card/PlayerCardSheet'
import { getPlayerCard, NON_WEEKLY_SCHEDULE, type PlayerCardData } from '@/lib/core-app/playerCard'

/** Thursday 2026-11-05, 11am Eastern — NHL 2026 week 6, which runs Tue 11/3 to Mon 11/9 (opener 9/29). */
const NOW = new Date('2026-11-05T16:00:00.000Z')
const FRESH = new Date('2026-11-05T15:00:00.000Z')

type Row = {
  sport: string
  homeTeam: string
  awayTeam: string
  startTime: Date
  status: string | null
  source: string
  fetchedAt: Date
  season: number | null
  seasonType: string | null
}

const row = (over: Partial<Row> & Pick<Row, 'homeTeam' | 'awayTeam' | 'startTime'>): Row => ({
  sport: 'NHL',
  status: 'scheduled',
  source: 'thesportsdb',
  fetchedAt: FRESH,
  season: 2026,
  seasonType: null,
  ...over,
})
const at = (iso: string) => new Date(iso)

/** His club (the Islanders), as TheSportsDB writes it: full names. In time order after NOW: */
const ISLANDERS = [
  row({ homeTeam: 'Boston Bruins', awayTeam: 'New York Islanders', startTime: at('2026-11-04T00:00:00Z') }), // Tue 11/3 — played
  row({ homeTeam: 'New York Islanders', awayTeam: 'Boston Bruins', startTime: at('2026-11-06T00:00:00Z') }), // Thu 11/5 7:00p EST
  row({ homeTeam: 'Montréal Canadiens', awayTeam: 'New York Islanders', startTime: at('2026-11-08T00:00:00Z') }), // Sat 11/7 7:00p
  // Mon 11/9 7:30p Eastern — already 11/10 in UTC, still week 6 by the Eastern day.
  row({ homeTeam: 'New York Islanders', awayTeam: 'St. Louis Blues', startTime: at('2026-11-10T00:30:00Z') }),
  row({ homeTeam: 'Toronto Maple Leafs', awayTeam: 'New York Islanders', startTime: at('2026-11-12T00:00:00Z') }), // Wed 11/11
  row({ homeTeam: 'New York Islanders', awayTeam: 'Vegas Golden Knights', startTime: at('2026-11-13T00:00:00Z'), status: 'Postponed' }),
  row({ homeTeam: 'New York Islanders', awayTeam: 'Seattle Kraken', startTime: at('2026-11-14T00:00:00Z') }), // Fri 11/13
  row({ homeTeam: 'Utah Mammoth', awayTeam: 'New York Islanders', startTime: at('2026-11-15T00:00:00Z') }), // Sat 11/14 — 6th
]
/** Everyone else's games — a namesake club among them. */
const OTHERS = [
  row({ homeTeam: 'New York Rangers', awayTeam: 'Philadelphia Flyers', startTime: at('2026-11-06T00:00:00Z') }),
  row({ homeTeam: 'Edmonton Oilers', awayTeam: 'Calgary Flames', startTime: at('2026-11-06T02:00:00Z') }),
  row({ homeTeam: 'New Jersey Devils', awayTeam: 'New York Rangers', startTime: at('2026-11-07T00:00:00Z') }),
]
/** The same Islanders games again from a second feed, in abbreviations — must not double the list. */
const SECOND_FEED = ISLANDERS.map((r) => ({
  ...r,
  source: 'rolling_insights',
  homeTeam: r.homeTeam === 'New York Islanders' ? 'NYI' : 'OPP',
  awayTeam: r.awayTeam === 'New York Islanders' ? 'NYI' : 'OPP',
}))

let slate: Row[] = []
let wheres: any[] = []

function player(team: string, sport = 'NHL') {
  return {
    source: 'rolling_insights',
    fetchedAt: FRESH,
    externalId: '1114',
    sleeperId: null,
    sport,
    name: 'Ilya Sorokin',
    position: 'G',
    team,
    number: 30,
    imageUrl: null,
    age: 31,
    height: null,
    weight: null,
    yearsExp: null,
    college: null,
  }
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(NOW)
  for (const k of Object.keys(overrides)) delete overrides[k]
  slate = [...ISLANDERS, ...OTHERS, ...SECOND_FEED]
  wheres = []
  overrides.sportsGame = {
    findMany: async (args: { where: any }) => {
      const w = args.where
      wheres.push(w)
      // Only the daily read is honoured here; the weekly strip's read (by week) finds nothing.
      if (!w.startTime) return []
      return slate.filter(
        (r) =>
          r.sport === w.sport &&
          r.startTime >= w.startTime.gte &&
          r.startTime < w.startTime.lt &&
          w.source.in.includes(r.source) &&
          (r.seasonType == null || !w.OR[1].seasonType.notIn.includes(r.seasonType)),
      )
    },
  }
})

afterEach(() => {
  cleanup()
  vi.useRealTimers()
  lang.language = 'en'
})

function useSportsPlayer(team: string, sport = 'NHL') {
  overrides.sportsPlayer = { findFirst: async () => player(team, sport), findMany: async () => [] }
}

describe('an NHL card lists his next games by date', () => {
  it('returns his club’s next five games, in order, from one feed, with the week’s count', async () => {
    useSportsPlayer('NYI')
    const card = await getPlayerCard({ sport: 'NHL', sleeperId: '1114' })
    expect(card?.byeWeek).toBeNull()
    expect(card?.schedule).toEqual({
      available: true,
      data: {
        kind: 'daily',
        games: [
          { startTime: '2026-11-06T00:00:00.000Z', opponent: 'BOS', home: true },
          { startTime: '2026-11-08T00:00:00.000Z', opponent: 'MTL', home: false },
          { startTime: '2026-11-10T00:30:00.000Z', opponent: 'STL', home: true },
          { startTime: '2026-11-12T00:00:00.000Z', opponent: 'TOR', home: false },
          { startTime: '2026-11-14T00:00:00.000Z', opponent: 'SEA', home: true },
        ],
        // Tue 11/3 (played), Thu 11/5, Sat 11/7 and Mon 11/9 — by the Eastern day, not the UTC one.
        gamesThisWeek: 4,
      },
    })
    // One indexed read of the sport's slate around now, ranked feeds only — no provider call.
    const daily = wheres.find((w) => w.startTime)
    expect(daily).toMatchObject({ sport: 'NHL', source: { in: expect.arrayContaining(['thesportsdb', 'espn']) } })
  })

  it('reads a full-name club on the player the same as its code', async () => {
    useSportsPlayer('New York Islanders')
    const card = await getPlayerCard({ sport: 'NHL', sleeperId: '1114' })
    expect(card?.schedule.available && card.schedule.data.kind === 'daily' ? card.schedule.data.games.map((g) => g.opponent) : null).toEqual([
      'BOS',
      'MTL',
      'STL',
      'TOR',
      'SEA',
    ])
  })

  it('a club no game names keeps the note — never another team’s games', async () => {
    useSportsPlayer('NYI')
    slate = [...OTHERS]
    const card = await getPlayerCard({ sport: 'NHL', sleeperId: '1114' })
    expect(card?.schedule).toEqual({ available: false, reason: NON_WEEKLY_SCHEDULE })
  })

  it('an unrecognised club matches only its own exact name, not a namesake', async () => {
    useSportsPlayer('New York')
    const card = await getPlayerCard({ sport: 'NHL', sleeperId: '1114' })
    expect(card?.schedule).toEqual({ available: false, reason: NON_WEEKLY_SCHEDULE })
  })

  it('no club on file says so', async () => {
    useSportsPlayer('')
    const card = await getPlayerCard({ sport: 'NHL', sleeperId: '1114' })
    expect(card?.schedule).toEqual({
      available: false,
      reason: 'No club on file for this player, so his fixtures cannot be looked up.',
    })
  })

  it('MLB lists the games but claims no week count (its SportsGame slate is incomplete)', async () => {
    useSportsPlayer('NYY', 'MLB')
    slate = [
      row({ sport: 'MLB', homeTeam: 'New York Yankees', awayTeam: 'Boston Red Sox', startTime: at('2026-11-05T23:05:00Z'), season: 2026 }),
    ]
    const card = await getPlayerCard({ sport: 'MLB', sleeperId: '1114' })
    expect(card?.schedule).toEqual({
      available: true,
      data: { kind: 'daily', games: [{ startTime: '2026-11-05T23:05:00.000Z', opponent: 'BOS', home: true }], gamesThisWeek: null },
    })
  })
})

describe('control: the NFL card keeps its week strip', () => {
  it('reads by week, never by date, and carries no kind', async () => {
    useSportsPlayer('DET', 'NFL')
    const card = await getPlayerCard({ sport: 'NFL', sleeperId: '1114' })
    expect(wheres.some((w) => w.startTime)).toBe(false)
    expect(wheres.some((w) => w.week)).toBe(true)
    expect(card?.schedule).toEqual({ available: false, reason: 'No fixtures on file for these weeks.' })
  })
})

/* ── the sheet ─────────────────────────────────────────────────────────────────────────────────── */

function cardData(): PlayerCardData {
  const no = (reason: string) => ({ available: false as const, reason })
  return {
    context: 'universal',
    player: { externalId: 'rolling_insights:1114', sleeperId: null, sport: 'NHL', name: 'Ilya Sorokin', position: 'G', team: 'NYI', number: 30, imageUrl: null },
    bio: { age: 31, height: null, weight: null, yearsExp: null, college: null },
    market: no('No price.'),
    ownership: no('No ownership.'),
    schedule: {
      available: true,
      data: {
        kind: 'daily',
        games: [
          { startTime: '2026-11-06T00:00:00.000Z', opponent: 'BOS', home: true },
          { startTime: '2026-11-08T00:00:00.000Z', opponent: 'MTL', home: false },
        ],
        gamesThisWeek: 4,
      },
    },
    byeWeek: null,
    trades: no('No trades.'),
    comps: no('No comps.'),
    news: no('No news.'),
    injury: no('No injury.'),
    injuryFeed: no('No feed.'),
    insight: null,
    league: null,
    follow: { following: false },
    depth: null,
  } as unknown as PlayerCardData
}

function sheet(data: PlayerCardData) {
  return render(
    <PlayerCardSheet
      subject={{ sport: 'NHL', sleeperId: '1114', name: 'Ilya Sorokin', position: 'G' }}
      data={data}
      status="ready"
      onClose={() => {}}
      onOpen={() => {}}
    />,
  )
}

const rowsText = (c: HTMLElement) =>
  [...c.querySelectorAll('[data-testid="af-pc-daily-game"]')].map((n) => n.textContent?.replace(/\s+/g, ' ').trim())

describe('the sheet draws the dated games', () => {
  it('in English, on the Eastern clock', () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({ points: [] }) })))
    const { container } = sheet(cardData())
    expect(rowsText(container)).toEqual(['Thu 11/5 · vs BOS7:00p ET', 'Sat 11/7 · @ MTL7:00p ET'])
    expect(container.textContent).toContain('4 games this week')
    expect(container.textContent).not.toContain(NON_WEEKLY_SCHEDULE)
    vi.unstubAllGlobals()
  })

  it('in Spanish, day first', () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({ points: [] }) })))
    lang.language = 'es'
    const { container } = sheet(cardData())
    expect(rowsText(container)).toEqual(['jue 5/11 · vs BOS7:00p ET', 'sáb 7/11 · @ MTL7:00p ET'])
    expect(container.textContent).toContain('4 partidos esta semana')
    vi.unstubAllGlobals()
  })
})
