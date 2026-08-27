import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({ findMany: vi.fn(), count: vi.fn() }))

vi.mock('@/lib/prisma', () => ({
  prisma: { sportsGame: { findMany: h.findMany, count: h.count } },
}))

import { detectUpcomingIntent, findUpcomingGames } from '@/lib/ai/upcomingGames'

/** The real ordering from deterministic.ts, which this depends on. */
const SPORT_ALIASES: Array<[string, RegExp]> = [
  ['NCAAF', /\b(ncaaf|college football|cfb)\b/i],
  ['NCAAB', /\b(ncaab|college basketball|cbb|march madness)\b/i],
  ['NBA', /\b(nba|basketball)\b/i],
  ['MLB', /\b(mlb|baseball)\b/i],
  ['NHL', /\b(nhl|hockey)\b/i],
  ['NFL', /\b(nfl|football|bills|chiefs)\b/i],
]
const resolveSport = (m: string) => SPORT_ALIASES.find(([, p]) => p.test(m))?.[0] ?? null

const NOW = new Date('2026-08-27T15:00:00.000Z')

function game(over: Record<string, unknown> = {}) {
  return {
    sport: 'NFL',
    homeTeam: 'Buffalo Bills',
    awayTeam: 'Pittsburgh Steelers',
    startTime: new Date('2026-08-28T03:00:00.000Z'),
    seasonType: 'pre',
    week: null,
    season: 2026,
    venue: null,
    ...over,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  h.findMany.mockResolvedValue([])
  h.count.mockResolvedValue(0)
})

describe('detectUpcomingIntent', () => {
  it('recognises the two questions that used to fall through', () => {
    expect(detectUpcomingIntent('when is the next preseason game?', resolveSport)).toMatchObject({
      kind: 'next-game',
      sport: 'NFL',
      seasonType: 'pre',
    })
    expect(
      detectUpcomingIntent('when does the college football season start?', resolveSport),
    ).toMatchObject({ kind: 'season-start', sport: 'NCAAF', seasonType: 'regular' })
  })

  /*
   * The alias list tests NFL's bare "football" before the college entries unless
   * ordered correctly — this pins the sport, which is what actually went wrong.
   */
  it('does not answer a college question with the NFL', () => {
    expect(detectUpcomingIntent('when does college football start?', resolveSport)?.sport).toBe('NCAAF')
  })

  it('assumes the NFL for a bare preseason question, and names it in the answer', () => {
    expect(detectUpcomingIntent('when is the next preseason game?', resolveSport)?.sport).toBe('NFL')
  })

  it('handles the other natural phrasings', () => {
    for (const q of [
      'when is the next nfl game',
      'next bills game?',
      'when does the nfl season start?',
      'upcoming games this week',
    ]) {
      expect(detectUpcomingIntent(q, resolveSport), q).not.toBeNull()
    }
  })

  it('ignores questions that are not about the schedule', () => {
    for (const q of ['who should I start?', 'what is the capital of France?', 'grade this trade']) {
      expect(detectUpcomingIntent(q, resolveSport), q).toBeNull()
    }
  })
})

describe('findUpcomingGames', () => {
  it('looks strictly forward', async () => {
    await findUpcomingGames({ kind: 'next-game', sport: 'NFL', seasonType: null }, NOW)
    expect(h.findMany.mock.calls[0][0].where.startTime).toEqual({ gt: NOW })
  })

  it('narrows on season type only when one was asked for', async () => {
    await findUpcomingGames({ kind: 'next-game', sport: 'NFL', seasonType: 'pre' }, NOW)
    expect(h.findMany.mock.calls[0][0].where.seasonType).toBe('pre')

    h.findMany.mockClear()
    await findUpcomingGames({ kind: 'next-game', sport: 'NFL', seasonType: null }, NOW)
    expect(h.findMany.mock.calls[0][0].where).not.toHaveProperty('seasonType')
  })

  /*
   * Production stores the same fixture several times, differing only in
   * seasonType/status — a naive "next 5" lists one game five times.
   */
  it('collapses duplicate rows for one fixture', async () => {
    h.findMany.mockResolvedValue([game(), game({ seasonType: null }), game()])

    const { games } = await findUpcomingGames({ kind: 'next-game', sport: 'NFL', seasonType: null }, NOW)

    expect(games).toHaveLength(1)
    /* Keeps the copy that carries a season type — the filterable one. */
    expect(games[0].seasonType).toBe('pre')
  })

  it('returns them in kickoff order', async () => {
    h.findMany.mockResolvedValue([
      game({ homeTeam: 'Later', startTime: new Date('2026-08-30T00:00:00Z') }),
      game({ homeTeam: 'Sooner', startTime: new Date('2026-08-28T03:00:00Z') }),
    ])

    const { games } = await findUpcomingGames({ kind: 'next-game', sport: 'NFL', seasonType: null }, NOW)

    expect(games.map((g) => g.homeTeam)).toEqual(['Sooner', 'Later'])
  })

  /*
   * "When does the season start" about a season already running: answering with
   * the next game would be flatly wrong.
   */
  it('notices a season that has already started', async () => {
    h.findMany.mockResolvedValue([game({ seasonType: 'regular' })])
    h.count.mockResolvedValue(48)

    const out = await findUpcomingGames({ kind: 'season-start', sport: 'NFL', seasonType: 'regular' }, NOW)

    expect(out.alreadyUnderway).toBe(true)
  })

  it('does not claim a season started when none of it has been played', async () => {
    h.findMany.mockResolvedValue([game({ seasonType: 'regular' })])
    h.count.mockResolvedValue(0)

    const out = await findUpcomingGames({ kind: 'season-start', sport: 'NFL', seasonType: 'regular' }, NOW)

    expect(out.alreadyUnderway).toBe(false)
  })

  /* Widening the search would answer a question nobody asked. */
  it('returns nothing rather than broadening when there is no match', async () => {
    h.findMany.mockResolvedValue([])

    const out = await findUpcomingGames({ kind: 'next-game', sport: 'NFL', seasonType: 'pre' }, NOW)

    expect(out.games).toEqual([])
  })

  it('survives the database being unavailable', async () => {
    h.findMany.mockRejectedValue(new Error('db down'))

    const out = await findUpcomingGames({ kind: 'next-game', sport: 'NFL', seasonType: null }, NOW)

    expect(out.games).toEqual([])
  })
})
