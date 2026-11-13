import { describe, expect, it } from 'vitest'
import type { EliminationWeek, WeekBoard, WeekMatchup } from '@/lib/core-app/weekBoard'
import type { WeeklyCalendar } from '@/lib/core-app/weeklyCalendar'
import {
  closeGames,
  gameMargin,
  groupKickoffs,
  otherDeadlines,
  rankSurvival,
  summarizeWeek,
  survivalStatus,
} from '@/lib/core-app/weekGuide'
import { weekGuideMessages } from '@/lib/core-app/messages/weekGuide'

function game(id: string, over: Partial<WeekMatchup> = {}): WeekMatchup {
  return {
    leagueId: id,
    leagueName: `League ${id}`,
    platform: 'sleeper',
    leagueImageUrl: null,
    season: 2026,
    week: 10,
    opponent: { rosterId: 'o', name: 'Rival', avatarUrl: null },
    elimination: false,
    projection: null,
    form: null,
    yourSampleWeeks: 6,
    live: null,
    href: `/core/matchup?league=${id}`,
    ...over,
  }
}

const proj = (margin: number, wp: number) => ({ you: 100 + margin, them: 100, margin, winProbability: wp })
const live = (margin: number, final = false) => ({ you: 50 + margin, them: 50, margin, final })

function elim(id: string, over: Partial<EliminationWeek> = {}): EliminationWeek {
  return {
    leagueId: id,
    platformLeagueId: id,
    yourRosterId: 'me',
    leagueName: `Survival ${id}`,
    platform: 'sleeper',
    leagueImageUrl: null,
    season: 2026,
    week: 10,
    yourScore: null,
    cutLine: null,
    rank: null,
    fieldSize: 0,
    margin: null,
    onTheBlock: false,
    labelled: true,
    href: `/core/standings?league=${id}`,
    ...over,
  }
}

function board(over: Partial<WeekBoard> = {}): WeekBoard {
  return {
    season: 2026,
    week: 10,
    coinFlips: [],
    leaning: [],
    unprojected: [],
    eliminationWeeks: [],
    model: { basis: 'b', sampleSize: 0 },
    withoutSchedule: 0,
    firstKickoffAt: null,
    leagueBoard: null,
    ...over,
  }
}

describe('gameMargin', () => {
  it('ranks on the scoreboard once points are in, and on the projection before', () => {
    expect(gameMargin(game('a', { projection: proj(20, 0.8), live: live(-5) }))).toBe(-5)
    expect(gameMargin(game('a', { projection: proj(20, 0.8) }))).toBe(20)
    expect(gameMargin(game('a'))).toBeNull()
  })
})

describe('summarizeWeek', () => {
  it('counts winning, losing, close and unknown across every head-to-head game', () => {
    const b = board({
      coinFlips: [game('c1', { projection: proj(2, 0.55) }), game('c2', { projection: proj(-1, 0.45), live: live(0, true) })],
      leaning: [game('l1', { projection: proj(30, 0.9) }), game('l2', { projection: proj(-25, 0.15) })],
      unprojected: [game('u1'), game('u2', { live: live(12) })],
      eliminationWeeks: [elim('e1', { fieldSize: 9, margin: 0, onTheBlock: true }), elim('e2')],
      withoutSchedule: 22,
      firstKickoffAt: '2026-11-15T14:30:00.000Z',
    })
    expect(summarizeWeek(b)).toEqual({
      winning: 3, // c1, l1, u2 (live)
      losing: 1, // l2 — c2 is tied, so it is neither
      close: 1, // c2 is final, so it is no longer close
      unknown: 1, // u1
      survivalAtRisk: 1,
      survival: 2,
      noGame: 22,
      firstKickoffAt: '2026-11-15T14:30:00.000Z',
    })
  })

  it('drops a final game from the close list however close the projection was', () => {
    const b = board({ coinFlips: [game('a', { projection: proj(1, 0.5), live: live(3, true) }), game('b', { projection: proj(1, 0.5) })] })
    expect(closeGames(b).map((m) => m.leagueId)).toEqual(['b'])
  })
})

describe('survivalStatus', () => {
  it('says "lowest" for the score on the block, never "OUT" — the week is still being played', () => {
    expect(survivalStatus({ fieldSize: 5, margin: 0, onTheBlock: true })).toEqual({ kind: 'lowest' })
    expect(survivalStatus({ fieldSize: 5, margin: 11.04, onTheBlock: false })).toEqual({ kind: 'above', points: 11 })
    expect(survivalStatus({ fieldSize: 0, margin: null, onTheBlock: false })).toEqual({ kind: 'not-started' })
  })

  it('ranks the lowest score first, then the closest to it, then the leagues not started', () => {
    const ranked = rankSurvival([
      elim('late'),
      elim('safe', { fieldSize: 9, margin: 30 }),
      elim('tight', { fieldSize: 9, margin: 2 }),
      elim('block', { fieldSize: 9, margin: 0, onTheBlock: true }),
    ])
    expect(ranked.map((e) => e.leagueId)).toEqual(['block', 'tight', 'safe', 'late'])
  })
})

describe('groupKickoffs', () => {
  const ev = (id: string, leagueId: string, at: string, kind: WeeklyCalendar['events'][number]['kind'] = 'game') => ({
    id,
    leagueId,
    leagueName: `League ${leagueId}`,
    kind,
    title: '',
    at,
    source: 'stored-lineup' as const,
    href: `/core/my-team?league=${leagueId}`,
  })

  it('folds the same kickoff across leagues into one row, soonest first', () => {
    const cal = {
      events: [
        ev('1', 'a', '2026-11-15T18:00:00.000Z'),
        ev('2', 'b', '2026-11-15T14:30:00.000Z'),
        ev('3', 'c', '2026-11-15T14:30:00.000Z'),
        ev('4', 'c', '2026-11-15T14:30:00.000Z'),
        ev('5', 'd', '2026-11-12T10:00:00.000Z', 'waivers'),
      ],
    }
    const { groups, more } = groupKickoffs(cal)
    expect(groups.map((g) => [g.at, g.leagues.map((l) => l.leagueId)])).toEqual([
      ['2026-11-15T14:30:00.000Z', ['b', 'c']],
      ['2026-11-15T18:00:00.000Z', ['a']],
    ])
    expect(more).toBe(0)
    expect(otherDeadlines(cal).map((e) => e.id)).toEqual(['5'])
  })

  it('caps the rows and counts the rest, and survives a calendar that could not be read', () => {
    const cal = { events: Array.from({ length: 7 }, (_, i) => ev(`${i}`, `l${i}`, `2026-11-1${i}T12:00:00.000Z`)) }
    expect(groupKickoffs(cal, 5).more).toBe(2)
    expect(groupKickoffs(null)).toEqual({ groups: [], more: 0 })
  })
})

describe('week guide copy', () => {
  it('drops the close count from the headline when there is none, in both languages', () => {
    expect(weekGuideMessages.en.headline(31, 24, 6)).toBe('Winning 31 · losing 24 · 6 too close to call')
    expect(weekGuideMessages.en.headline(3, 1, 0)).toBe('Winning 3 · losing 1')
    expect(weekGuideMessages.es.headline!(3, 1, 2)).toBe('Ganando 3 · perdiendo 1 · 2 muy parejos')
  })
})
