/**
 * The My Team board's one "?" — how to read a row (2026-10-03). The order, the tie mark, the tag
 * tones, the clock, the sync age and the score were each explained by a hover `title` or not at
 * all, which on a phone is not at all.
 */
import React from 'react'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import postcss, { type Rule } from 'postcss'
import { describe, expect, it, vi } from 'vitest'
import { render } from '@testing-library/react'

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => '/core/my-team',
  useSearchParams: () => new URLSearchParams(),
}))
const lang = vi.hoisted(() => ({ language: 'en' as 'en' | 'es' }))
vi.mock('@/components/i18n/LanguageProviderClient', () => ({ useOptionalLanguage: () => ({ language: lang.language }) }))

import { MyTeamBoard } from '@/components/core-app/MyTeamBoard'
import { SectionHead } from '@/components/core-app/boards/BoardKit'
import type { MyTeamPulse, MyTeamRow } from '@/lib/core-app/myTeamPulse'
import type { RailMatchup } from '@/lib/core-app/railMatchups'
import type { WeekLineups } from '@/lib/core-app/weekLineups'

const NOW = Date.parse('2026-09-10T12:00:00Z')

const row = (over: Partial<MyTeamRow> = {}): MyTeamRow => ({
  leagueId: 'l1', leagueName: 'Dynasty Warriors', platform: 'sleeper', logoUrl: null, leagueBadge: 'DW',
  teamName: 'Ghosts of Gridiron', starters: 9, empty: 0, out: 0, bye: 0, questionable: 0, unresolved: 0,
  lockAt: '2026-09-13T17:00:00Z', locked: false, season: 2026, week: 2, severity: 0,
  href: '/core/my-team?league=l1', platformLeagueId: '9990001', leagueSeason: 2026, teamId: '4', ...over,
})
const pulse = (over: Partial<MyTeamPulse> = {}): MyTeamPulse => ({
  needs: [], set: [], needsTotal: 0, setTotal: 0, considered: 2, checked: 2, byeChecked: true,
  notChecked: { noRoster: 0, noLineup: 0 }, ...over,
})
const withRows = () =>
  pulse({ needs: [row({ empty: 1, severity: 1, actionableSeverity: 1 })], set: [row({ leagueId: 'l2', questionable: 1 })], needsTotal: 1, setTotal: 1 })
const scored: WeekLineups = {
  byLeague: {
    l1: {
      leagueId: 'l1', yourTeam: 'Mine', yourAvatarUrl: null, yourScore: 88.4, yourProjection: null,
      opponentTeam: 'Them', opponentAvatarUrl: null, opponentScore: 71.2, opponentProjection: null,
      unpaired: false, standing: null, scored: true, freshAt: null, source: 'live_cache', season: 2026, week: 2,
    } as RailMatchup,
  },
  projectionWeek: null,
}
const board = (p: MyTeamPulse, lineups: WeekLineups | null = null) =>
  render(<MyTeamBoard pulse={p} now={NOW} allHref="/core/my-team?all=1" lineups={lineups} />).container

describe('the board explains how to read a row, once', () => {
  it('puts ONE "?" beside the list heading — none on the rows', () => {
    lang.language = 'en'
    const c = board(withRows())
    expect(c.querySelectorAll('.af-mt-board-row').length).toBe(2)
    const tips = c.querySelectorAll('button.af-info-tip')
    expect(tips.length).toBe(1)
    expect(tips[0].closest('.af-bd-sec-head > .af-bd-sec-info')).not.toBeNull()
    expect(c.querySelectorAll('.af-bd-rows button.af-info-tip').length).toBe(0)
    const text = c.querySelector('.af-bd-sec-info .af-info-pop')!.textContent!
    for (const s of ['T4 means tied for 4th', 'Red counts', '“questionable” count', 'Unidentified', 'SET means', 'Eastern time', 'synced 3h ago']) {
      expect(text).toContain(s)
    }
  })

  it('⚠ keeps the button OUT of the heading the section is labelled by', () => {
    const c = board(withRows())
    const section = c.querySelector('section[aria-labelledby]')!
    const heading = c.querySelector(`[id="${section.getAttribute('aria-labelledby')}"]`)!
    expect(heading.tagName).toBe('H2')
    expect(heading.querySelector('button')).toBeNull()
  })

  it('mentions the score only when a row can carry one', () => {
    expect(board(withRows()).querySelector('.af-bd-sec-info')!.textContent).not.toContain('88.4')
    expect(board(withRows(), scored).querySelector('.af-bd-sec-info')!.textContent).toContain('ahead 88.4–71.2')
  })

  it('says nothing over an empty list', () => {
    const c = board(pulse({ checked: 0, considered: 2, notChecked: { noRoster: 2, noLineup: 0 } }))
    expect(c.querySelector('.af-bd-sec-head')).not.toBeNull()
    expect(c.querySelector('button.af-info-tip')).toBeNull()
  })

  it('never sits under a `title`', () => {
    const c = board(withRows(), scored)
    for (const pop of c.querySelectorAll('.af-info-pop')) expect(pop.closest('[title]')).toBeNull()
  })

  it('reads in Spanish, naming the tags as Spanish renders them', () => {
    lang.language = 'es'
    const c = board(withRows())
    expect(c.querySelector('.af-bd-sec-info button')?.getAttribute('aria-label')).toBe('Cómo leer esta lista')
    const text = c.querySelector('.af-bd-sec-info .af-info-pop')!.textContent!
    expect(text).toContain('«en duda»')
    expect(c.querySelector('.af-bd-rows')!.textContent).toContain('en duda')
    lang.language = 'en'
  })
})

describe('SectionHead’s `info` slot', () => {
  it('renders nothing extra for the boards that do not use it', () => {
    const { container } = render(<SectionHead label="Top 3" id="x" />)
    expect(container.querySelector('.af-bd-sec-info')).toBeNull()
    expect([...container.firstElementChild!.children].map((e) => e.className)).toEqual(['af-bd-sec-label', 'af-bd-sec-rule'])
  })

  it('is styled: centred in a baseline row, in the heading’s quiet colour, no doubled gap', () => {
    const decls = (sel: string) => {
      const out: Record<string, string> = {}
      postcss.parse(readFileSync(resolve(__dirname, '../components/core-app/af-core-boards.css'), 'utf8')).walkRules((r: Rule) => {
        if (r.parent?.type === 'root' && r.selector === sel) r.walkDecls((d) => void (out[d.prop] = d.value))
      })
      return out
    }
    expect(decls('.af-core .af-bd-sec-info')).toMatchObject({ 'align-self': 'center', color: 'var(--faint)' })
    expect(decls('.af-core .af-bd-sec-info .af-info-tip')['margin-left']).toBe('0')
  })
})
