import { describe, expect, it } from 'vitest'
import {
  buildWeeklyStory,
  headlinePrompt,
  MAX_RESULT_CARDS,
  validateHeadline,
  type WeeklyStory,
} from '@/lib/core-app/weeklyStoryModel'
import type { WeekAllData, WeekRow } from '@/lib/core-app/weekAll'

const row = (leagueId: string, pf: number, pa: number, over: Partial<WeekRow> = {}): WeekRow => ({
  leagueId,
  leagueName: `League ${leagueId}`,
  platform: 'sleeper',
  season: 2026,
  week: 4,
  pointsFor: pf,
  pointsAgainst: pa,
  won: pf > pa,
  completed: true,
  ...over,
})

const week = (rows: WeekRow[]): WeekAllData => ({
  rows,
  season: 2026,
  week: 4,
  withoutHistory: 0,
  unscored: 0,
  record: null,
})

const build = (rows: WeekRow[], extra: Partial<Parameters<typeof buildWeeklyStory>[0]> = {}): WeeklyStory =>
  buildWeeklyStory({ lastWeek: week(rows), topScorer: null, awards: [], upsets: [], ...extra })!

describe('buildWeeklyStory', () => {
  it('is null with no played week, or nothing settled', () => {
    expect(buildWeeklyStory({ lastWeek: null, topScorer: null, awards: [], upsets: [] })).toBeNull()
    expect(build([]) ).toBeNull()
    expect(buildWeeklyStory({ lastWeek: week([row('a', 100, 90, { completed: false })]), topScorer: null, awards: [], upsets: [] })).toBeNull()
  })

  it('opens on the record, leaves unsettled games out of it, and counts them as pending', () => {
    const story = build([row('a', 120, 100), row('b', 90, 110), row('c', 80, 70, { completed: false })])
    expect(story.id).toBe('2026-W4')
    expect(story.cards[0]).toMatchObject({ kind: 'cover', wins: 1, losses: 1, ties: 0, leagues: 2, pending: 1 })
    expect(story.cards.filter((c) => c.kind === 'result').map((c) => c.key)).toEqual(['result:a', 'result:b'])
  })

  it('orders wins by margin, then the closest losses — and ends on what to do next', () => {
    const story = build([row('small', 101, 100), row('big', 150, 100), row('blowout', 60, 120), row('close', 99, 100)])
    expect(story.cards.map((c) => c.key)).toEqual(['cover', 'result:big', 'result:small', 'result:close', 'result:blowout', 'next'])
    const next = story.cards.at(-1)!
    expect(next.kind === 'next' && next.ask).toContain('lost League close by 1')
  })

  it('folds results past the cap into one "and the rest" card', () => {
    const rows = Array.from({ length: MAX_RESULT_CARDS + 3 }, (_, i) => row(`l${i}`, 100 + i, 100 - (i % 2 ? 50 : -50)))
    const story = build(rows)
    expect(story.cards.filter((c) => c.kind === 'result')).toHaveLength(MAX_RESULT_CARDS)
    const more = story.cards.find((c) => c.kind === 'more')
    expect(more).toMatchObject({ count: 3 })
  })

  it('adds the top starter, upsets and awards between the results and the close', () => {
    const story = build([row('a', 120, 100)], {
      topScorer: { name: 'Ja’Marr Chase', points: 38.4, leagueName: 'League a' },
      upsets: [{ leagueId: 'a', leagueName: 'League a', winChance: '22%', pointsFor: 120, pointsAgainst: 100 }],
      awards: [{ leagueId: 'a', leagueName: 'League a', label: 'Top score', value: 120, unit: 'pts' }],
    })
    expect(story.cards.map((c) => c.kind)).toEqual(['cover', 'result', 'top-scorer', 'upset', 'award', 'next'])
  })

  it('writes a template headline that only states the record and a real margin', () => {
    expect(build([row('a', 120, 100), row('b', 130, 100)]).templateHeadline).toBe('A perfect 2-0 week. League b led the way, by 30.')
    expect(build([row('a', 90, 100), row('b', 99, 100)]).templateHeadline).toBe('A 0-2 week. League b came closest, by 1.')
    expect(build([row('a', 120, 100), row('b', 99, 100), row('c', 130, 90)]).templateHeadline).toBe('League c set the tone, by 40.')
    expect(build([row('a', 120, 100), row('b', 90, 100), row('c', 99, 100)]).templateHeadline).toBe('League c got away, by just 1.')
    expect(build([row('a', 120, 100)]).templateHeadline).toBe('A win in League a, by 20.')
  })

  it('labels a native league AllFantasy, never by its stored "manual" key', () => {
    const story = build([row('a', 120, 100, { platform: 'manual' }), row('b', 90, 100, { platform: 'espn' })])
    expect(story.cards.filter((c) => c.kind === 'result').map((c) => c.kind === 'result' && c.platform)).toEqual(['AllFantasy', 'ESPN'])
  })
})

describe('validateHeadline', () => {
  const story = build([row('a', 120.5, 100), row('b', 99, 100)], {
    topScorer: { name: 'Bijan Robinson', points: 31.2, leagueName: 'League a' },
  })

  it('accepts a line whose every number is in the facts', () => {
    expect(validateHeadline('A 1-1 week: Bijan dropped 31.2 and you won by 20.5.', story)).toBe(
      'A 1-1 week: Bijan dropped 31.2 and you won by 20.5.',
    )
  })

  it('refuses a line that invents a number', () => {
    expect(validateHeadline('You went 3-0 this week!', story)).toBeNull() // 3 is not a fact (2 would be: two leagues)
    expect(validateHeadline('Bijan dropped 41.2 for you.', story)).toBeNull()
  })

  it('strips wrapping quotes, and refuses empty, long, multi-line, linked or hashtagged text', () => {
    expect(validateHeadline('"A split week, and a 1 point heartbreak."', story)).toBe('A split week, and a 1 point heartbreak.')
    expect(validateHeadline('', story)).toBeNull()
    expect(validateHeadline('x'.repeat(141), story)).toBeNull()
    expect(validateHeadline('Line one\nline two', story)).toBeNull()
    expect(validateHeadline('See https://example.com', story)).toBeNull()
    expect(validateHeadline('Big week #winning', story)).toBeNull()
  })

  it('puts every fact the validator allows into the prompt', () => {
    const prompt = headlinePrompt(story)
    for (const fact of ['1-1', '120.5', '100', '20.5', '99', '31.2', 'Bijan Robinson']) expect(prompt).toContain(fact)
  })
})
