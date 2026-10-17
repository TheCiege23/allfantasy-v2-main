/**
 * The board's sync stamp in Spanish, through the shell's `ageText` (2026-10-03). The hand-built
 * Spanish it replaced (`hace ${age.replace(' ago', '')}`) left «hace 2mo» / «hace 1y» on exactly the
 * rows the stamp exists for — leagues nobody has synced in months. Every shape `relativeAge` writes is
 * driven through the real board here.
 */
import React from 'react'
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
import { relativeAge } from '@/lib/core-app/cardFreshness'
import type { MyTeamPulse, MyTeamRow } from '@/lib/core-app/myTeamPulse'

const NOW = Date.parse('2026-10-03T12:00:00Z')
const MIN = 60_000
const DAY = 86_400_000
/** One age per branch of relativeAge: just now, min, h, d, w, mo, y. */
const AGES: Array<[number, string]> = [
  [30_000, 'sincronizada justo ahora'],
  [10 * MIN, 'sincronizada hace 10 min'],
  [3 * 60 * MIN, 'sincronizada hace 3 h'],
  [2 * DAY, 'sincronizada hace 2 d'],
  [14 * DAY, 'sincronizada hace 2 sem'],
  [65 * DAY, 'sincronizada hace 2 meses'],
  [31 * DAY, 'sincronizada hace 4 sem'],
  [400 * DAY, 'sincronizada hace 1 año'],
  [800 * DAY, 'sincronizada hace 2 años'],
]
const row = (i: number, agoMs: number): MyTeamRow => ({
  leagueId: `l${i}`, leagueName: `League ${i}`, platform: 'sleeper', logoUrl: null, leagueBadge: 'L',
  teamName: 'Mine', starters: 9, empty: 0, out: 0, bye: 0, questionable: 0, unresolved: 0,
  lockAt: null, locked: false, season: 2026, week: 4, severity: 0,
  href: `/core/my-team?league=l${i}`, platformLeagueId: String(i), leagueSeason: 2026, teamId: '4',
  syncedAt: new Date(NOW - agoMs).toISOString(),
})
const pulse = {
  needs: [], set: AGES.map(([ms], i) => row(i, ms)), needsTotal: 0, setTotal: AGES.length,
  considered: AGES.length, checked: AGES.length, byeChecked: true, notChecked: { noRoster: 0, noLineup: 0 },
} as unknown as MyTeamPulse
const stamps = (c: HTMLElement) => [...c.querySelectorAll('.af-bd-sync')].map((e) => e.textContent!.replace(/^\s*·\s*/, ''))

describe('the board’s sync stamp in Spanish', () => {
  it('covers every shape relativeAge writes — incl. the months and years that were half-English', () => {
    // The fixture really does reach each branch, or the Spanish below proves nothing about it.
    expect(new Set(AGES.map(([ms]) => relativeAge(NOW - ms, NOW).replace(/\d+/g, 'N')))).toEqual(
      new Set(['just now', 'N min ago', 'Nh ago', 'Nd ago', 'Nw ago', 'Nmo ago', 'Ny ago']),
    )
    lang.language = 'es'
    const c = render(<MyTeamBoard pulse={pulse} now={NOW} allHref="/x" />).container
    expect(stamps(c)).toEqual(AGES.map(([, es]) => es))
    for (const s of stamps(c)) expect(s).not.toMatch(/\b(ago|mo|y|min ago|just now)\b|\d(mo|y|h|d|w)\b/)
    lang.language = 'en'
  })

  it('switches live, both ways', () => {
    lang.language = 'en'
    const r = render(<MyTeamBoard pulse={pulse} now={NOW} allHref="/x" />)
    expect(stamps(r.container)[5]).toBe('synced 2mo ago')
    lang.language = 'es'
    r.rerender(<MyTeamBoard pulse={pulse} now={NOW} allHref="/x" />)
    expect(stamps(r.container)[5]).toBe('sincronizada hace 2 meses')
    lang.language = 'en'
    r.rerender(<MyTeamBoard pulse={pulse} now={NOW} allHref="/x" />)
    expect(stamps(r.container)[5]).toBe('synced 2mo ago')
  })
})
