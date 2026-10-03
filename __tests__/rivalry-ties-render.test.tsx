/**
 * A tied series renders as W–L–T, in English and Spanish (2026-10-03).
 *
 * The loader half is `rivalry-ties.test.ts`. This half pins what a reader sees:
 * a record with ties grows a third number, a record without ties reads exactly
 * as before, and a dead-heat "closest ever" never says "you lost by 0.0".
 */
import React from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render } from '@testing-library/react'
import type {
  LeagueWeekBoard,
  RivalryCard,
  RivalryRadar as RivalryRadarData,
  WeekMatchup,
} from '@/lib/core-app/weekBoard'

const lang = vi.hoisted(() => ({ language: 'en' }))
vi.mock('@/components/i18n/LanguageProviderClient', () => ({
  useOptionalLanguage: () => ({ language: lang.language }),
}))

import RivalryRadar from '@/components/core-app/screens/RivalryRadar'
import YourWeekLeague from '@/components/core-app/screens/YourWeekLeague'

afterEach(() => {
  cleanup()
  lang.language = 'en'
})

function card(over: Partial<RivalryCard> = {}): RivalryCard {
  return {
    leagueId: 'l1',
    leagueName: 'Turf Wars',
    platform: 'sleeper',
    opponent: { rosterId: '2', name: 'Gridiron Ghosts', avatarUrl: null },
    series: { wins: 1, losses: 1, ties: 1, meetings: 3 },
    averageMargin: -1.7,
    closest: { season: 2026, week: 3, margin: 0, won: false, tied: true },
    thisWeek: { winProbability: 0.45, projectedMargin: -1.7 },
    sampleTooSmall: false,
    ...over,
  }
}

function radar(c: RivalryCard): RivalryRadarData {
  return {
    season: 2026,
    week: 4,
    theyOwnYou: [],
    youOwnThem: [],
    even: [c],
    oneToWatch: c,
    totals: { seasons: 1, meetings: c.series.meetings, platforms: 1 },
    firstKickoffAt: null,
  }
}

function matchup(): WeekMatchup {
  return {
    leagueId: 'l1',
    leagueName: 'Turf Wars',
    platform: 'sleeper',
    leagueImageUrl: null,
    season: 2026,
    week: 4,
    opponent: { rosterId: '2', name: 'Gridiron Ghosts', avatarUrl: null },
    elimination: false,
    projection: null,
    yourSampleWeeks: 3,
    href: '/core/matchup?league=l1',
  } as WeekMatchup
}

function leagueBoard(rivalry: LeagueWeekBoard['rivalry']): LeagueWeekBoard {
  return {
    leagueId: 'l1',
    leagueName: 'Turf Wars',
    platform: 'sleeper',
    season: 2026,
    week: 4,
    yours: matchup(),
    sidelines: [],
    rivalry,
    records: {},
    yourRosterId: '1',
    yourTeamName: 'My Team',
    yourAvatarUrl: null,
  }
}

function text(container: HTMLElement, selector: string): string {
  const el = container.querySelector(selector)
  expect(el, selector).not.toBeNull()
  return (el!.textContent ?? '').replace(/\s+/g, ' ').trim()
}

/** The record text itself — the tag also carries the rivalrySeries "?" tip after it. */
function recordTag(container: HTMLElement): string {
  const tag = container.querySelector('.af-wl-rivalry-tag')
  expect(tag).not.toBeNull()
  return (tag!.firstChild?.textContent ?? '').trim()
}

describe('RivalryRadar — tied series', () => {
  it.each(['en', 'es'])('shows a W–L–T record and a tied closest meeting (%s)', (language) => {
    lang.language = language
    const { container } = render(<RivalryRadar data={radar(card())} weekHref="/core/week" />)
    expect(text(container, '.af-rr-record')).toMatch(/^1–1–1/)
    expect(text(container, '.af-rr-watch-body')).toMatch(/^1–1–1 /)
    const closest = text(container, '.af-rr-closest')
    expect(closest).toContain(language === 'es' ? 'empate' : 'a tie')
    expect(closest).not.toMatch(/lost by|perdiste por|0\.0/)
  })

  it('keeps a series with no ties as W–L, and a lost closest meeting as a loss', () => {
    const c = card({
      series: { wins: 1, losses: 2, ties: 0, meetings: 3 },
      closest: { season: 2026, week: 1, margin: -4.2, won: false, tied: false },
    })
    const { container } = render(<RivalryRadar data={radar(c)} weekHref="/core/week" />)
    expect(text(container, '.af-rr-record')).toMatch(/^1–2 ?all-time$/)
    expect(text(container, '.af-rr-closest')).toContain('you lost by 4.2')
  })

  it.each([
    ['en', 'Every opponent you have played or play this week'],
    ['es', 'Cada rival al que te has enfrentado o te enfrentas esta semana'],
  ])('does not claim the list is only this week’s opponents (%s)', (language, expected) => {
    lang.language = language
    const { container } = render(<RivalryRadar data={radar(card())} weekHref="/core/week" />)
    const sub = text(container, '.af-wk-sub')
    expect(sub).toContain(expected)
    expect(sub).not.toMatch(/This week's opponents|Rivales de esta semana/)
  })
})

describe('YourWeekLeague — tied all-time record', () => {
  it.each([
    ['en', 'All-time 1—1—1'],
    ['es', 'Historial 1—1—1'],
  ])('renders W—L—T when a meeting finished level (%s)', (language, expected) => {
    lang.language = language
    const { container } = render(
      <YourWeekLeague
        board={leagueBoard({ wins: 1, losses: 1, ties: 1, meetings: 3, averageMargin: -1.7 })}
        allWeeksHref="/core/week"
      />,
    )
    expect(recordTag(container)).toBe(expected)
    // 1-1-1 is level, not a series the opponent leads.
    expect(container.querySelector('.af-wl-rivalry')!.getAttribute('data-tone')).toBe('even')
  })

  it('keeps W—L when there are no ties', () => {
    const { container } = render(
      <YourWeekLeague
        board={leagueBoard({ wins: 2, losses: 1, ties: 0, meetings: 3, averageMargin: 3 })}
        allWeeksHref="/core/week"
      />,
    )
    expect(recordTag(container)).toBe('All-time 2—1')
  })
})
