/**
 * The league median is a regular-season game unless the commissioner keeps it on for the playoffs.
 *
 * Playoffs are win or go home, so by default (`settings.median_game_in_playoffs` absent or false) no
 * week on or after the playoff start — and no week holding a playoff, consolation or toilet-bowl row —
 * gets a median result: nothing counted on a record, no streak entry, no `medianScore` written. Turned
 * on, those weeks are counted exactly as a regular-season week is.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

type Row = { id: string; week: number; type?: string; homeRosterId: string; awayRosterId: string | null; homeScore: number; awayScore: number; status: string }

const h = vi.hoisted(() => ({
  rosterUpdates: [] as Array<{ id: string; data: Record<string, unknown> }>,
  medianWrites: [] as Array<{ week: number; medianScore: number }>,
  matchups: [] as Row[],
  season: { medianGame: true, playoffStartWeek: 2 as number | null, league: { medianGame: true, settings: {} as unknown } },
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
      findMany: vi.fn(async () => h.matchups),
      updateMany: vi.fn(async ({ where, data }: { where: { week: number }; data: { medianScore: number } }) => {
        h.medianWrites.push({ week: where.week, medianScore: data.medianScore })
        return { count: 2 }
      }),
    },
    redraftSeason: { findUnique: vi.fn(async () => h.season) },
  },
}))
vi.mock('@/lib/events', () => ({
  getPlatformEvents: () => ({ emit: vi.fn(async () => undefined) }),
  EVENT: { STANDINGS_UPDATED: 'standings.updated' },
}))

import { updateStandings } from '@/lib/redraft/standingsEngine'
import {
  MEDIAN_GAME_IN_PLAYOFFS_SETTINGS_KEY,
  computeWeeklyMedianResults,
  isPlayoffPhaseWeek,
  medianEligibleRows,
  readMedianGameInPlayoffs,
} from '@/lib/redraft/medianGame'

const record = (id: string) => h.rosterUpdates.find((u) => u.id === id)!.data

/** Week 1 regular season; week 2 is the first playoff week (a and c still play head-to-head rows). */
const week1: Row[] = [
  { id: 'm1', week: 1, homeRosterId: 'a', awayRosterId: 'b', homeScore: 120, awayScore: 90, status: 'final' },
  { id: 'm2', week: 1, homeRosterId: 'c', awayRosterId: 'd', homeScore: 100, awayScore: 80, status: 'final' },
]
const week2: Row[] = [
  { id: 'm3', week: 2, homeRosterId: 'a', awayRosterId: 'c', homeScore: 130, awayScore: 70, status: 'final' },
  { id: 'm4', week: 2, homeRosterId: 'b', awayRosterId: 'd', homeScore: 110, awayScore: 60, status: 'final' },
]

beforeEach(() => {
  h.rosterUpdates = []
  h.medianWrites = []
  h.matchups = [...week1, ...week2]
  h.season = { medianGame: true, playoffStartWeek: 2, league: { medianGame: true, settings: {} } }
})

describe('readMedianGameInPlayoffs', () => {
  it('is off unless the settings hold exactly true', () => {
    expect(MEDIAN_GAME_IN_PLAYOFFS_SETTINGS_KEY).toBe('median_game_in_playoffs')
    for (const settings of [null, undefined, {}, [], 'x', { median_game_in_playoffs: false }, { median_game_in_playoffs: 'true' }, { median_game_in_playoffs: 1 }]) {
      expect(readMedianGameInPlayoffs(settings)).toBe(false)
    }
    expect(readMedianGameInPlayoffs({ median_game_in_playoffs: true })).toBe(true)
  })
})

describe('medianEligibleRows', () => {
  it('off: drops every week on or after the playoff start, for every team', () => {
    expect(medianEligibleRows([...week1, ...week2], { playoffStartWeek: 2, medianInPlayoffs: false }).map((r) => r.id)).toEqual(['m1', 'm2'])
    expect(computeWeeklyMedianResults(medianEligibleRows([...week1, ...week2], { playoffStartWeek: 2, medianInPlayoffs: false })).map((r) => r.week)).toEqual([1])
  })

  it('off: a week holding a playoff, consolation or toilet-bowl row is dropped whole, whatever its number', () => {
    for (const type of ['playoff', 'consolation', 'toilet_bowl', 'championship']) {
      const rows = [...week1, { ...week2[0], week: 1, id: 'x', type }]
      expect(medianEligibleRows(rows, { playoffStartWeek: 14, medianInPlayoffs: false })).toEqual([])
    }
  })

  it('off: regular-season weeks are untouched, and a season with no playoff start has no playoff weeks by number', () => {
    expect(medianEligibleRows(week1, { playoffStartWeek: 14, medianInPlayoffs: false })).toEqual(week1)
    expect(medianEligibleRows([...week1, ...week2], { playoffStartWeek: null, medianInPlayoffs: false })).toHaveLength(4)
    expect(isPlayoffPhaseWeek(15, 15)).toBe(true)
    expect(isPlayoffPhaseWeek(14, 15)).toBe(false)
    expect(isPlayoffPhaseWeek(20, 0)).toBe(false)
  })

  it('on: every row is kept', () => {
    expect(medianEligibleRows([...week1, ...week2, { ...week2[0], id: 'y', type: 'consolation' }], { playoffStartWeek: 2, medianInPlayoffs: true })).toHaveLength(5)
  })
})

describe('standings: league median in playoff weeks', () => {
  it('default (setting absent): no median result in a playoff week — head-to-head only there', async () => {
    await updateStandings('season-1', 2)
    // Week 1: a, c beat their opponent and the median; b, d lost both. Week 2: head-to-head only.
    expect(record('a')).toMatchObject({ wins: 3, losses: 0, streak: 'W3' })
    expect(record('b')).toMatchObject({ wins: 1, losses: 2, streak: 'W1' })
    expect(record('c')).toMatchObject({ wins: 2, losses: 1, streak: 'L1' })
    expect(record('d')).toMatchObject({ wins: 0, losses: 3 })
    expect(h.medianWrites).toEqual([{ week: 1, medianScore: 95 }])
  })

  it('explicitly off behaves exactly like the default', async () => {
    h.season.league.settings = { median_game_in_playoffs: false }
    await updateStandings('season-1', 2)
    expect(record('a')).toMatchObject({ wins: 3, losses: 0 })
    expect(h.medianWrites.map((w) => w.week)).toEqual([1])
  })

  it('on: the playoff week is counted like a regular-season week, median included', async () => {
    h.season.league.settings = { median_game_in_playoffs: true }
    await updateStandings('season-1', 2)
    // Week 2 median is 90 (60, 70, 110, 130): a and b win it, c and d lose it.
    expect(record('a')).toMatchObject({ wins: 4, losses: 0, streak: 'W4' })
    expect(record('b')).toMatchObject({ wins: 2, losses: 2 })
    expect(record('c')).toMatchObject({ wins: 2, losses: 2, streak: 'L2' })
    expect(record('d')).toMatchObject({ wins: 0, losses: 4 })
    expect(h.medianWrites).toEqual([
      { week: 1, medianScore: 95 },
      { week: 2, medianScore: 90 },
    ])
  })

  it('the toggle changes nothing when the league plays no median game', async () => {
    h.season = { medianGame: false, playoffStartWeek: 2, league: { medianGame: false, settings: { median_game_in_playoffs: true } } }
    await updateStandings('season-1', 2)
    expect(record('a')).toMatchObject({ wins: 2, losses: 0 })
    expect(h.medianWrites).toEqual([])
  })

  it('a regular-season-only season is unchanged by the gate', async () => {
    h.season.playoffStartWeek = 15
    await updateStandings('season-1', 2)
    expect(record('a')).toMatchObject({ wins: 4, losses: 0 })
    expect(h.medianWrites.map((w) => w.week)).toEqual([1, 2])
  })
})
