import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({ findMany: vi.fn(), count: vi.fn() }))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    sportsGame: { findMany: h.findMany },
    gameSchedule: { count: h.count },
  },
}))

import { tryDeterministicAnswer } from '@/lib/ai/deterministic'

function game(over: Record<string, unknown> = {}) {
  return {
    sport: 'NFL',
    awayTeam: 'Pittsburgh Steelers',
    homeTeam: 'Buffalo Bills',
    awayScore: null,
    homeScore: null,
    status: 'scheduled',
    startTime: new Date('2026-08-28T03:00:00.000Z'),
    seasonType: 'pre',
    ...over,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  h.findMany.mockResolvedValue([])
  h.count.mockResolvedValue(0)
})

describe('live sports questions', () => {
  /*
   * The guard that stops invented stats matched "touchdowns" and not "TDs", so
   * the shortest and most natural phrasing walked straight past it into a model
   * with no play-by-play data behind it.
   */
  it('refuses stat questions however they are abbreviated', async () => {
    for (const q of [
      'who has the most TDs today?',
      'who leads in TDs?',
      'who has the most touchdowns today?',
      'most RBIs today?',
      'who has the most passing yards?',
    ]) {
      const answer = await tryDeterministicAnswer(q)
      expect(answer, `should refuse: "${q}"`).toBeTruthy()
      expect(answer).toMatch(/play-by-play|will not invent/i)
    }
  })

  it('promises not to invent the specific things it cannot see', async () => {
    const answer = await tryDeterministicAnswer('who has the most TDs today?')
    expect(answer).toMatch(/touchdowns/i)
  })

  /*
   * ⚠ THE BUG THIS FILE EXISTS FOR. The window was a UTC calendar day while the
   * output was rendered in Eastern, so an evening kickoff — 03:00 UTC the next
   * day — fell outside "today" and the whole prime-time slate was invisible.
   */
  it('counts an Eastern-evening kickoff as today', async () => {
    h.findMany.mockResolvedValue([game()])

    await tryDeterministicAnswer('what games are on tonight?')

    expect(h.findMany).toHaveBeenCalled()
    const where = h.findMany.mock.calls[0][0].where
    const start = where.startTime.gte as Date
    const end = where.startTime.lt as Date

    /* An ET day starts at 04:00 or 05:00 UTC, never at 00:00 UTC. */
    expect(start.getUTCHours()).toBeGreaterThanOrEqual(4)
    expect(end.getTime()).toBeGreaterThan(start.getTime())

    /* The 03:00-UTC kickoff has to land inside the window. */
    const kickoff = new Date('2026-08-28T03:00:00.000Z').getTime()
    expect(kickoff).toBeGreaterThanOrEqual(start.getTime())
    expect(kickoff).toBeLessThan(end.getTime())
  })

  /*
   * Production stores the same fixture several times, differing only in
   * seasonType/status. Listing rows verbatim reads as several games.
   */
  it('lists one line per fixture, not one per stored row', async () => {
    h.findMany.mockResolvedValue([
      game({ seasonType: 'pre' }),
      game({ seasonType: null, status: 'NS' }),
      game({ seasonType: 'pre', status: 'scheduled' }),
    ])

    const answer = await tryDeterministicAnswer('what games are on tonight?')

    expect(answer).toBeTruthy()
    const mentions = (answer!.match(/Pittsburgh Steelers/g) || []).length
    expect(mentions).toBe(1)
  })

  it('prefers the copy carrying a score when collapsing duplicates', async () => {
    h.findMany.mockResolvedValue([
      game({ awayScore: null, homeScore: null }),
      game({ awayScore: 17, homeScore: 20, status: 'FT' }),
    ])

    const answer = await tryDeterministicAnswer('live scores today')

    expect(answer).toContain('17-20')
  })

  it('says nothing rather than inventing when no game is stored', async () => {
    h.findMany.mockResolvedValue([])

    /* Falls through to the schedule refusal or to the model — never a made-up game. */
    const answer = await tryDeterministicAnswer('what games are on tonight?')
    if (answer) expect(answer).not.toMatch(/Steelers|Bills/)
  })
})
