import { describe, expect, it } from 'vitest'
import { buildCareerTimeline, parseTimelineKind } from '@/lib/core-app/careerTimeline'
import { computeCareerAwards } from '@/lib/core-app/careerAwards'
import type { CareerTradeEvent } from '@/lib/core-app/careerTrades'
import { row } from './careerFixtures'

function trade(i: number, over: Partial<CareerTradeEvent> = {}): CareerTradeEvent {
  return {
    id: `t${i}`,
    season: 2022,
    week: i,
    date: `2022-09-${String(10 + i).padStart(2, '0')}T12:00:00Z`,
    leagueName: 'Dynasty Dragons',
    leagueKey: 'dynasty dragons',
    gave: ['Player A'],
    got: ['Player B'],
    assets: 2,
    partner: null,
    net: null,
    grade: null,
    ...over,
  }
}

const rows = [
  row({ season: 2021, wins: 60, losses: 20 }),
  row({ season: 2022, wins: 50, losses: 30, isChampion: true }),
  row({ season: 2023, leagueName: 'New League', wins: 5, losses: 9 }),
]

describe('buildCareerTimeline', () => {
  it('groups by season, newest first, headline events before trades', () => {
    const tl = buildCareerTimeline({
      rows,
      awards: computeCareerAwards({ rows, trades: [] }),
      trades: [trade(1, { net: 40, grade: 'A' })],
      tradesOmitted: 0,
      drafts: [],
      rivals: [],
      kind: null,
    })
    expect(tl.seasons.map((s) => s.season)).toEqual([2023, 2022, 2021])
    const y2022 = tl.seasons.find((s) => s.season === 2022)!
    expect(y2022.events[0].kind).toBe('title')
    expect(y2022.events.findIndex((e) => e.kind === 'trade')).toBeGreaterThan(0)
    expect(y2022.record).toBe('50-30')
    expect(y2022.titles).toBe(1)
  })

  it('places win milestones in the season they were crossed', () => {
    const tl = buildCareerTimeline({ rows, awards: [], trades: [], tradesOmitted: 0, drafts: [], rivals: [], kind: 'milestone' })
    const win100 = tl.seasons.flatMap((s) => s.events).find((e) => e.key === 'ms:wins:100')!
    expect(win100.season).toBe(2022)
    expect(tl.seasons.every((s) => s.events.every((e) => e.kind === 'milestone'))).toBe(true)
  })

  it('lists a few trades per season on the full view and every one when filtered', () => {
    const many = Array.from({ length: 7 }, (_, i) => trade(i + 1))
    const all = buildCareerTimeline({ rows, awards: [], trades: many, tradesOmitted: 0, drafts: [], rivals: [], kind: null })
    const y = all.seasons.find((s) => s.season === 2022)!
    expect(y.events.filter((e) => e.kind === 'trade' && !e.key.startsWith('trade:more'))).toHaveLength(4)
    expect(y.events.find((e) => e.key === 'trade:more:2022')?.title).toBe('3 more trades in 2022')
    expect(all.counts.trade).toBe(7)

    const only = buildCareerTimeline({ rows, awards: [], trades: many, tradesOmitted: 12, drafts: [], rivals: [], kind: 'trade' })
    expect(only.seasons.flatMap((s) => s.events)).toHaveLength(7)
    expect(only.notes.join(' ')).toMatch(/12 older trades/)
  })

  it('records joins and exits of leagues', () => {
    const tl = buildCareerTimeline({ rows, awards: [], trades: [], tradesOmitted: 0, drafts: [], rivals: [], kind: 'league' })
    const events = tl.seasons.flatMap((s) => s.events)
    expect(events.find((e) => e.key === 'league:joined:2023')?.items).toEqual(['New League'])
    expect(events.find((e) => e.key === 'league:left:2022')?.items).toEqual(['Dynasty Dragons'])
  })

  it('says what is missing instead of rendering nothing', () => {
    const tl = buildCareerTimeline({ rows, awards: [], trades: [], tradesOmitted: 0, drafts: [], rivals: [], kind: null })
    expect(tl.notes.some((n) => /draft/i.test(n))).toBe(true)
    expect(tl.notes.some((n) => /rival/i.test(n))).toBe(true)
  })

  it('only accepts known kinds from the URL', () => {
    expect(parseTimelineKind('trade')).toBe('trade')
    expect(parseTimelineKind('<script>')).toBeNull()
    expect(parseTimelineKind(null)).toBeNull()
  })
})
