import { describe, expect, it } from 'vitest'
import { detectCareerMilestones } from '@/lib/core-app/careerMilestoneEvents'
import { composeLegacyLine } from '@/lib/core-app/careerMilestones'
import type { CareerRow } from '@/lib/core-app/careerModel'
import { row } from './careerFixtures'

/** A row with a fixed key, so "the same league-season" survives across two profiles. */
const keyed = (key: string, over: Partial<CareerRow> = {}) => row({ key, ...over })
const slice = (rows: CareerRow[]) => ({ rows, trades: [] })

describe('detectCareerMilestones', () => {
  it('announces a title won in a season that just finished, numbered from the rings on file', () => {
    const history = [keyed('a', { season: 2022, isChampion: true, leagueName: 'A' }), keyed('b', { season: 2023, isChampion: true, leagueName: 'B' })]
    const live = keyed('c', { season: 2026, leagueName: 'Dynasty Dragons', counted: false, status: 'in_season', wins: 11, losses: 3 })
    const done = { ...live, counted: true, status: 'complete', isChampion: true }
    const events = detectCareerMilestones(slice([...history, live]), slice([...history, done]))
    // The fixture's default 8-6 seasons also carry it past 25 wins and a third season (Iron Manager).
    expect(events.map((e) => e.key)).toEqual([
      'title:c',
      'award:ring-collector:silver',
      'award:iron-manager:bronze',
      'wins:25',
    ])
    expect(events[0]).toMatchObject({
      title: 'You won Dynasty Dragons',
      body: "2026 champion at 11-3. That's the 3rd title of your career.",
    })
    expect(events[1].title).toBe('New award: Ring Collector Silver')
  })

  it('stays silent when an import only BACKFILLS history', () => {
    const before = [keyed('x', { season: 2025 })]
    const after = [
      ...before,
      keyed('old1', { season: 2019, isChampion: true }),
      keyed('old2', { season: 2020, isChampion: true, leagueName: 'Other' }),
      keyed('old3', { season: 2021, isChampion: true, leagueName: 'Third' }),
    ]
    expect(detectCareerMilestones(slice(before), slice(after))).toEqual([])
  })

  it('does not credit a backfilled tier to a season that finished in the same rebuild', () => {
    const live = keyed('live', { season: 2026, counted: false, status: 'in_season', isChampion: false })
    const before = [keyed('a', { season: 2024, isChampion: true }), live]
    const after = [
      keyed('a', { season: 2024, isChampion: true }),
      keyed('b', { season: 2018, isChampion: true, leagueName: 'Backfill' }),
      { ...live, counted: true, status: 'complete' },
    ]
    // Ring Collector went bronze → bronze from the finished season's point of view (2 titles, not 3).
    expect(detectCareerMilestones(slice(before), slice(after)).filter((e) => e.kind === 'award' && e.key.startsWith('award:ring'))).toEqual([])
  })

  it('announces the highest career-wins mark crossed', () => {
    const base = Array.from({ length: 5 }, (_, i) => keyed(`h${i}`, { season: 2015 + i, wins: 9, losses: 5 }))
    const live = keyed('now', { season: 2026, counted: false, status: 'in_season', wins: 6, losses: 8 })
    const events = detectCareerMilestones(slice([...base, live]), slice([...base, { ...live, counted: true, status: 'complete' }]))
    expect(events.find((e) => e.kind === 'wins')).toMatchObject({ key: 'wins:50', title: '50 career wins' })
  })

  it('reports nothing when nothing finished', () => {
    const rows = [keyed('a'), keyed('b', { counted: false, status: 'in_season' })]
    expect(detectCareerMilestones(slice(rows), slice(rows))).toEqual([])
  })
})

describe('composeLegacyLine', () => {
  const s = { key: 'k', leagueName: 'Alpha', platform: 'sleeper', record: null, title: 'Win Alpha', detail: '', tone: 'title' as const, ask: '', ringNumber: 3 }
  const m = { key: 'm', kind: 'award' as const, title: 'Ring Collector Silver', detail: '', short: '1 title to go', remaining: 1, progressPct: 67, ask: '' }

  it('leads with the stake, then the nearest milestone', () => {
    expect(composeLegacyLine({ stakes: [s, { ...s, key: 'k2' }], milestones: [m] })).toBe(
      "Win Alpha and it's ring #3 (1 more league in play). Next up: Ring Collector Silver, 1 title to go.",
    )
  })

  it('falls back to the milestone alone, and to null when there is nothing', () => {
    expect(composeLegacyLine({ stakes: [], milestones: [m] })).toBe('Within reach: Ring Collector Silver, 1 title to go.')
    expect(composeLegacyLine({ stakes: [], milestones: [] })).toBeNull()
  })
})
