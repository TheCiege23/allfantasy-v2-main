import { beforeEach, describe, expect, it, vi } from 'vitest'

/*
 * `loadNews` on a shared name. Measured on production 2026-10-12: the card for Panthers CB
 * DeVonta Smith (Sleeper 13977) listed "Saquon Barkley, DeVonta Smith among 5 Eagles ruled out vs.
 * Jags" — WR DeVonta Smith (PHI, 7525)'s news, matched on the name alone. Rows below are the real
 * shapes, including the one whose scalar `team` is the OPPONENT (JAX) and only `teams` names PHI.
 */

vi.mock('server-only', () => ({}))

const playerFindMany = vi.fn()
const newsFindMany = vi.fn()

vi.mock('@/lib/prisma', () => ({
  prisma: {
    sportsPlayer: { findMany: (...a: unknown[]) => playerFindMany(...a) },
    sportsNews: { findMany: (...a: unknown[]) => newsFindMany(...a) },
  },
}))

const EAGLES_ROWS = [
  {
    title: 'Saquon Barkley, DeVonta Smith among 5 Eagles ruled out vs. Jags',
    source: 'x',
    sourceUrl: 'https://x/1',
    publishedAt: new Date('2026-10-10T12:18:31Z'),
    playerName: 'DeVonta Smith',
    playerNames: ['DeVonta Smith', 'Drew Kendall'],
    team: 'PHI',
    teams: ['JAX', 'PHI'],
  },
  {
    title: 'Eagles stars Saquon Barkley and DeVonta Smith ruled out of London game against Jaguars',
    source: 'x',
    sourceUrl: 'https://x/2',
    publishedAt: new Date('2026-10-09T20:38:15Z'),
    playerName: 'DeVonta Smith',
    playerNames: ['DeVonta Smith'],
    team: 'JAX',
    teams: ['JAX', 'PHI'],
  },
  {
    title: 'Week 4 NFL schedule, scores, live updates',
    source: 'x',
    sourceUrl: 'https://x/3',
    publishedAt: new Date('2026-10-04T12:11:03Z'),
    playerName: 'DeVonta Smith',
    playerNames: ['DeVonta Smith', 'Breece Hall'],
    team: null,
    teams: [],
  },
]

async function loadNews() {
  return (await import('@/lib/core-app/playerCard')).loadNews
}

beforeEach(() => {
  playerFindMany.mockReset()
  newsFindMany.mockReset().mockResolvedValue(EAGLES_ROWS)
})

describe('loadNews — a shared name binds only to rows naming his club', () => {
  it('shows the Panthers corner none of the Eagles receiver’s news', async () => {
    playerFindMany.mockResolvedValue([{ sleeperId: '13977' }, { sleeperId: '7525' }])
    const res = await (await loadNews())('DeVonta Smith', 'NFL', 'Carolina Panthers')
    expect(res.available).toBe(false)
  })

  it('keeps the receiver’s rows, including one whose scalar team is the opponent', async () => {
    playerFindMany.mockResolvedValue([{ sleeperId: '13977' }, { sleeperId: '7525' }])
    const res = await (await loadNews())('DeVonta Smith', 'NFL', 'Philadelphia Eagles')
    expect(res.available).toBe(true)
    if (!res.available) return
    // The team-less row is dropped: for a shared name it proves nothing.
    expect(res.data.map((n) => n.url)).toEqual(['https://x/1', 'https://x/2'])
  })

  it('refuses a shared name when the player has no team to check against', async () => {
    playerFindMany.mockResolvedValue([{ sleeperId: '13977' }, { sleeperId: '7525' }])
    const res = await (await loadNews())('DeVonta Smith', 'NFL', null)
    expect(res.available).toBe(false)
    expect(newsFindMany).not.toHaveBeenCalled()
  })

  it('a unique name keeps today’s behaviour: every row, no team filter', async () => {
    playerFindMany.mockResolvedValue([{ sleeperId: '7525' }])
    const res = await (await loadNews())('DeVonta Smith', 'NFL', 'Carolina Panthers')
    expect(res.available).toBe(true)
    if (!res.available) return
    expect(res.data).toHaveLength(3)
  })
})
