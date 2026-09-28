/**
 * Standings count the league-median game when the league has it on — reading the league's CURRENT
 * setting, not the copy taken onto the season at draft time.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  rosterUpdates: [] as Array<{ id: string; data: Record<string, unknown> }>,
  medianWrites: [] as Array<{ week: number; medianScore: number }>,
  league: { medianGame: true } as { medianGame: boolean },
  seasonMedian: false,
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    redraftRoster: {
      findMany: vi.fn(async () => [{ id: 'a' }, { id: 'b' }, { id: 'c' }, { id: 'd' }]),
      update: vi.fn(async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
        h.rosterUpdates.push({ id: where.id, data })
        return {}
      }),
    },
    redraftMatchup: {
      findMany: vi.fn(async () => [
        { id: 'm1', week: 1, homeRosterId: 'a', awayRosterId: 'b', homeScore: 120, awayScore: 90, status: 'final' },
        { id: 'm2', week: 1, homeRosterId: 'c', awayRosterId: 'd', homeScore: 100, awayScore: 80, status: 'final' },
      ]),
      updateMany: vi.fn(async ({ where, data }: { where: { week: number }; data: { medianScore: number } }) => {
        h.medianWrites.push({ week: where.week, medianScore: data.medianScore })
        return { count: 2 }
      }),
    },
    redraftSeason: {
      findUnique: vi.fn(async () => ({ medianGame: h.seasonMedian, league: h.league })),
    },
  },
}))
vi.mock('@/lib/events', () => ({
  getPlatformEvents: () => ({ emit: vi.fn(async () => undefined) }),
  EVENT: { STANDINGS_UPDATED: 'standings.updated' },
}))

import { updateStandings } from '@/lib/redraft/standingsEngine'

const record = (id: string) => h.rosterUpdates.find((u) => u.id === id)!.data

beforeEach(() => {
  h.rosterUpdates = []
  h.medianWrites = []
})

describe('standings with the league median', () => {
  it('adds a median win or loss to each team and stores the week’s median', async () => {
    h.league = { medianGame: true }
    await updateStandings('season-1', 1)
    // a beat b and the median (95); c beat d and the median; b and d lost both.
    expect(record('a')).toMatchObject({ wins: 2, losses: 0, streak: 'W2' })
    expect(record('c')).toMatchObject({ wins: 2, losses: 0 })
    expect(record('b')).toMatchObject({ wins: 0, losses: 2, streak: 'L2' })
    expect(record('d')).toMatchObject({ wins: 0, losses: 2 })
    expect(h.medianWrites).toEqual([{ week: 1, medianScore: 95 }])
  })

  it('plays head-to-head only when the league has it off — even if the season copy says on', async () => {
    h.league = { medianGame: false }
    h.seasonMedian = true
    await updateStandings('season-1', 1)
    expect(record('a')).toMatchObject({ wins: 1, losses: 0 })
    expect(record('b')).toMatchObject({ wins: 0, losses: 1 })
    expect(h.medianWrites).toEqual([])
  })
})
