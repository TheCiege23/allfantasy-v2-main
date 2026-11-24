import React from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render } from '@testing-library/react'

/**
 * Matchup in plain words (2026-11-14), for every league. Found on the owner's league: the win chance
 * three times (headline, a chip, the scoreboard's big number), "Behind by 13.0" twice, the projected
 * finals and players left twice each, an intro ending "Lineup changes are made on Sleeper", the league
 * named again on the week bar, two Sleeper buttons, a "Why it matters" paragraph, and a To win card
 * that printed a second projection (186.9 beside the scoreboard's 186.8) and left "46 short" to the
 * reader.
 */

const lang = vi.hoisted(() => ({ language: 'en' }))
vi.mock('@/components/i18n/LanguageProviderClient', () => ({
  useOptionalLanguage: () => ({ language: lang.language, t: (k: string) => k, tInterpolate: (k: string) => k }),
}))
vi.mock('next/navigation', async (orig) => ({
  ...(await orig<typeof import('next/navigation')>()),
  usePathname: () => '/core/matchup',
  useSearchParams: () => new URLSearchParams(),
  useRouter: () => ({ refresh() {}, push() {}, replace() {}, prefetch() {}, back() {}, forward() {} }),
}))
vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 503, json: async () => ({}) })))
vi.mock('@/components/MiniPlayerImg', () => ({ default: () => null }))

import Matchup from '@/components/core-app/screens/Matchup'
import { matchupFixture } from '@/app/e2e/redraft-core/matchup/fixtures'
import { toWin } from '@/lib/core-app/matchupInsights'
import { matchupScreenMessages } from '@/lib/core-app/messages/matchupScreen'
import type { MatchupData } from '@/lib/core-app/matchup'

afterEach(() => { cleanup(); lang.language = 'en' })

const title = () => document.getElementById('af-mug-title')?.textContent ?? ''
const withLinks = (d: MatchupData, lineup: boolean): MatchupData => ({
  ...d,
  league: {
    ...d.league,
    platform: 'sleeper',
    sourceLink: { href: 'https://sleeper.com/leagues/1/matchup', label: 'View Matchup in Sample League' },
    lineupLink: lineup ? { href: 'https://sleeper.com/leagues/1/team', platformLabel: 'Sleeper' } : null,
  },
} as unknown as MatchupData)

describe('the top', () => {
  it('is the headline alone: no intro, no number chips', () => {
    const { container } = render(<Matchup data={matchupFixture('NFL', 'live')} />)
    expect(title()).toMatch(/so far · \d+% to win$/)
    const head = container.querySelector('.af-mug-head')!
    expect(head.querySelector('.af-hg-chips')).toBeNull()
    expect(head.querySelector('.af-pg-sub')).toBeNull()
    expect(container.textContent).not.toMatch(/Follow this week|Lineup changes are made on/)
  })

  it('does not repeat the league on the week bar', () => {
    const { container } = render(<Matchup data={matchupFixture('NFL', 'live')} />)
    const bar = container.querySelector('.af-mu-week')!
    expect(bar.querySelector('.af-mu-league-name, .af-mu-league-crest')).toBeNull()
    expect(bar.querySelector('.af-mu-week-label')).not.toBeNull()
  })

  it('has one Sleeper button: "Set lineup in" when that link resolved, else the matchup', () => {
    const both = render(<Matchup data={withLinks(matchupFixture('NFL', 'live'), true)} />).container
    const a = [...both.querySelectorAll('.af-mu-handoff a')]
    expect(a).toHaveLength(1)
    expect(a[0].getAttribute('href')).toBe('https://sleeper.com/leagues/1/team')
    cleanup()
    const only = render(<Matchup data={withLinks(matchupFixture('NFL', 'live'), false)} />).container
    const b = [...only.querySelectorAll('.af-mu-handoff a')]
    expect(b).toHaveLength(1)
    expect(b[0].getAttribute('href')).toBe('https://sleeper.com/leagues/1/matchup')
  })
})

describe('the scoreboard', () => {
  it('draws the win chance as the bar, not a second number, and no margin tag during the week', () => {
    const { container } = render(<Matchup data={matchupFixture('NFL', 'live')} />)
    const board = container.querySelector('.af-mu-h2h')!
    expect(board.querySelector('.af-mu-centre-value')).toBeNull()
    expect(board.querySelector('.af-mu-wp')?.getAttribute('aria-label')).toMatch(/^Win probability \d+%$/)
    expect(board.querySelector('.af-mu-margin')).toBeNull()
    expect(board.querySelector('.af-mug-sure summary')?.textContent).toBe('How sure is this?')
  })

  it('keeps the result tag on a finished week, where it is the result', () => {
    const { container } = render(<Matchup data={matchupFixture('NFL', 'final')} />)
    expect(container.querySelector('.af-mu-h2h .af-mu-margin')).not.toBeNull()
  })
})

describe('to win', () => {
  const base = matchupFixture('NFL', 'live')
  const scored = { you: 10, opponent: 20 }
  const at = (you: number, opponent: number): MatchupData =>
    ({ ...base, projectedFinal: { available: true, data: { ...(base.projectedFinal as { data: object }).data, you, opponent } } }) as unknown as MatchupData

  it('says how far short you finish, off the scoreboard’s own projected finals', () => {
    const w = toWin(at(186.8, 233), 'live', scored)!
    expect(w.needed).toBe(223)
    expect(w.short).toBe(46.2)
  })

  it('says you get there when the projection covers it', () => {
    expect(toWin(at(240, 233), 'live', scored)!.short).toBe(0)
  })

  it('reads as one line, singular and plural, in both languages', () => {
    const en = matchupScreenMessages.en
    expect(en.toWinBody(10, 20, 10, 16, 186.9, 46.2)).toBe('On projection you finish 46.2 short, with 16 players still to play.')
    expect(en.toWinBody(10, 20, 10, 1, 9, 0)).toBe('On projection you get there, with 1 player still to play.')
    expect(en.toWinBody(10, 20, 10, 3, null, null)).toBe('')
    expect(en.toWinBody(0, 20, 25, 3, 9, 0)).toBe('Your 25.0 already beats their projected final of 20.0.')
    expect(en.toWinNeed(223, 250)).toBe('223.0 more points to beat their projected 250.0')
    const es = matchupScreenMessages.es
    expect(es.toWinBody(10, 20, 10, 16, 186.9, 46.2)).toBe('Según la proyección te quedas a 46.2 puntos, con 16 jugadores por jugar.')
    expect(es.toWinBody(10, 20, 10, 1, 9, 0)).toBe('Según la proyección lo logras, con 1 jugador por jugar.')
    expect(es.toWinNeed(223, 250)).toBe('223.0 puntos más para superar su proyección de 250.0')
  })

  it('draws no empty line when there is nothing to say', () => {
    const d = at(186.8, 233)
    if (d.lineups.available) for (const s of d.lineups.data) if (s.you) s.you = { ...s.you, projected: null }
    const { container } = render(<Matchup data={d} />)
    expect(container.querySelector('[data-testid=matchup-to-win-body]')).toBeNull()
  })
})

describe('the slot board', () => {
  it('has no "Why it matters" paragraph', () => {
    const { container } = render(<Matchup data={matchupFixture('NFL', 'live')} />)
    expect(container.querySelector('.af-mug-teach')).toBeNull()
    expect(container.textContent).not.toContain('Why it matters')
  })
})

describe('Spanish', () => {
  it('says the headline and the slot board in Spanish, with no repeated chips', () => {
    lang.language = 'es'
    const { container } = render(<Matchup data={matchupFixture('NFL', 'live')} />)
    expect(title()).toMatch(/de ganar$/)
    expect(container.querySelector('.af-hg-chips')).toBeNull()
    expect(container.textContent).not.toMatch(/Sigue el enfrentamiento|Por qué importa/)
  })

  it('never says «waiver» in the Spanish copy it touched', () => {
    const es = matchupScreenMessages.es
    const text = [es.toWinLabel, es.toWinAhead, es.toWinNeed(5, 9), es.toWinBody(5, 9, 4, 2, 3, 1), es.toWinBody(5, 9, 4, 2, 3, 0)].join(' ')
    expect(text).not.toMatch(/waiver/i)
  })
})
