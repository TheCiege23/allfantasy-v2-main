/**
 * My Team's OWN / START column headings in Spanish — «PROP.» (propiedad) and «TIT.» (titular)
 * (2026-10-03). The header cells are 44px and 46px; measured on production at 1280px, «PROP.» and
 * «TIT.» fit while «TIENEN» (48px), «TITUL.» (48) and «TITULAR» (55) overflowed. jsdom cannot lay
 * out, so the length budget below is the guard against a longer word sneaking back in.
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

import { MARKET_COLUMN_LABELS, MyTeam } from '@/components/core-app/screens/MyTeam'
import type { LineupPlayer, MyTeamData } from '@/lib/core-app/myTeam'

const player = (over: Partial<LineupPlayer> = {}): LineupPlayer => ({
  sleeperId: 'p1', name: 'Bo Nix', position: 'QB', team: 'DEN', sport: 'NFL', imageUrl: null,
  gameContext: 'DEN vs MIA · Sun 10/4 1:00p ET', kickoff: new Date('2099-10-04T17:00:00Z'),
  preseason: false, venue: null, injuryStatus: null, ruledOut: false, projectedPoints: 19.8,
  afProjectedPoints: 22.4, afEngineProjectedPoints: 21.1, indoors: false, weather: null, market: null, onBye: false, ...over,
})
const data = {
  league: { id: 'l1', name: 'KBFL', platform: 'sleeper', format: 'dynasty', sourceLink: null },
  team: { available: false, reason: 'n/a' },
  starters: { available: true, data: [{ slotLabel: 'QB', benchCheck: null, player: player(), empty: false, unresolvedId: null }] },
  bench: { available: true, data: [] }, ir: { available: false, reason: 'n/a' }, taxi: { available: false, reason: 'n/a' },
  lock: { available: false, reason: 'n/a' },
  projections: { available: false, reason: 'n/a' }, projectionBasis: { notes: [], scoringKnown: false },
  nextMatchup: { available: false, reason: 'n/a' }, upcomingByes: [],
  rosterGrade: { available: false, reason: 'n/a' }, liveScore: { available: false, reason: 'n/a' },
} as unknown as MyTeamData

/** The four heading cells' own text — the "?" popover inside the first is not part of its label. */
const headings = (c: HTMLElement) =>
  [...c.querySelector('.af-mt-projhead')!.children].map((el) => {
    const copy = el.cloneNode(true) as Element
    copy.querySelectorAll('.af-info-tip-wrap').forEach((t) => t.remove())
    return copy.textContent!.trim()
  })

describe('the OWN / START columns in Spanish', () => {
  it('head the columns «PROP.» and «TIT.», and the key and the "?" name them the same way', () => {
    lang.language = 'es'
    const c = render(<MyTeam data={data} />).container
    expect(headings(c)).toEqual(['Sleeper', 'AF', 'PROP.', 'TIT.'])
    const key = [...c.querySelectorAll('.af-mt-key dt')].map((d) => d.textContent)
    expect(key).toContain('PROP. · TIT.')
    expect(c.querySelector('.af-mt-key')!.textContent).toContain('propiedad y titular')
    const tip = c.querySelector('.af-mt-projhead button.af-info-tip')!
    expect(tip.getAttribute('aria-label')).toBe('Qué significan Sleeper, AF, PROP. y TIT.')
    const pop = c.querySelector('.af-mt-projhead .af-info-pop')!.textContent!
    expect(pop).toContain('PROP. (propiedad)')
    expect(pop).toContain('TIT. (titular)')
    expect(pop).not.toMatch(/\b(OWN|START)\b/)
    lang.language = 'en'
  })

  it('keeps OWN / START in English, and switches live both ways', () => {
    lang.language = 'en'
    const r = render(<MyTeam data={data} />)
    expect(headings(r.container)).toEqual(['Sleeper', 'AF', 'OWN', 'START'])
    lang.language = 'es'
    r.rerender(<MyTeam data={data} />)
    expect(headings(r.container)).toEqual(['Sleeper', 'AF', 'PROP.', 'TIT.'])
    lang.language = 'en'
    r.rerender(<MyTeam data={data} />)
    expect(headings(r.container)).toEqual(['Sleeper', 'AF', 'OWN', 'START'])
  })

  it('⚠ stays inside the measured budget — 5 characters fit the 44/46px columns, 6 did not', () => {
    for (const label of Object.values(MARKET_COLUMN_LABELS.es)) expect(label.length, label).toBeLessThanOrEqual(5)
  })
})
