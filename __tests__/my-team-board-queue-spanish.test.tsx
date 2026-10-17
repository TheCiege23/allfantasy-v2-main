/**
 * The My Team board's "Before lock" action queue (#1963) in Spanish (2026-10-03). A live Spanish
 * check on production found it entirely English: its six copy() keys had no Spanish entry, and the
 * per-row counts ("2 empty · 1 out · 1 on bye") were built in English by hand.
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
import type { MyTeamPulse, MyTeamRow } from '@/lib/core-app/myTeamPulse'

const NOW = Date.parse('2026-09-10T12:00:00Z')
const row = (over: Partial<MyTeamRow> = {}): MyTeamRow => ({
  leagueId: 'l1', leagueName: 'KBFL', platform: 'sleeper', logoUrl: null, leagueBadge: 'KB',
  teamName: 'Mine', starters: 9, empty: 2, out: 1, bye: 1, questionable: 0, unresolved: 0,
  lockAt: '2026-09-13T17:00:00Z', locked: false, season: 2026, week: 2, severity: 4, actionableSeverity: 4,
  href: '/core/my-team?league=l1', platformLeagueId: '9990001', leagueSeason: 2026, teamId: '4', ...over,
})
const pulse = {
  needs: [row(), row({ leagueId: 'l2', leagueName: 'DW', empty: 1, out: 2, bye: 0, href: '/core/my-team?league=l2' })],
  set: [], needsTotal: 2, setTotal: 0, considered: 2, checked: 2, byeChecked: true, notChecked: { noRoster: 0, noLineup: 0 },
} as unknown as MyTeamPulse
const board = () => <MyTeamBoard pulse={pulse} now={NOW} allHref="/core/my-team?all=1" />

/** Words only an English sentence uses — not "no"/"a", which Spanish shares. */
const ENGLISH = /\b(before|lock|lineups?|needs?|look|open|team|inspect|issue|confirm|player|locks|your|platform|empty|out|on bye|risk|review)\b/i

describe('the action queue in Spanish', () => {
  it('reads Spanish end to end — heading, sentence, counts, and the platform link', () => {
    lang.language = 'es'
    const q = render(board()).container.querySelector('.af-bd-action-queue')!
    const t = q.textContent!
    expect(t).toContain('Antes del cierre')
    expect(t).toContain('2 alineaciones necesitan revisión')
    expect(t).toContain('Abre un equipo para revisar el problema')
    expect(t).toContain('2 vacías · 1 descartado · 1 en descanso')
    expect(t).toContain('1 vacía · 2 descartados')
    expect(t).toContain('Abrir en sleeper')
    // Strip the parts that are data, not copy: league names and the pinned-English kickoff clock.
    const copyOnly = t.replace(/KBFL|DW|sleeper|\b(Sun|Mon|Thu|Sat)\b[^·]*/g, '')
    expect(copyOnly).not.toMatch(ENGLISH)
    lang.language = 'en'
  })

  it('switches live, both ways, with no reload', () => {
    lang.language = 'en'
    const r = render(board())
    const text = () => r.container.querySelector('.af-bd-action-queue')!.textContent!
    expect(text()).toContain('2 empty · 1 out · 1 on bye')
    expect(text()).toContain('2 lineups need a look')
    lang.language = 'es'
    r.rerender(board())
    expect(text()).toContain('2 vacías · 1 descartado · 1 en descanso')
    lang.language = 'en'
    r.rerender(board())
    expect(text()).toContain('2 empty · 1 out · 1 on bye')
  })
})
