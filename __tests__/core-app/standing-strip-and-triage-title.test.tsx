/**
 * Two small Home/Live corrections from the 2026-11-07 best ball audit, both reaching every league format:
 *
 *  1. The live STANDING strip (an elimination or no-opponent week) was hard-coded English — a Spanish
 *     reader got "On the block · ranked on projected best-ball finals…" inside a translated screen.
 *     English is pinned byte for byte here, because it is the sentence the strip has always printed.
 *  2. Home's injury card was titled "Starters in doubt" whenever it had rows, but it lists every
 *     injured player you hold — bench, IR, taxi and best ball too — so it could say "starters" over a
 *     list with no starter in it.
 */
import React from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render } from '@testing-library/react'

const lang = vi.hoisted(() => ({ language: 'en' as 'en' | 'es' }))
vi.mock('@/components/i18n/LanguageProviderClient', () => ({ useOptionalLanguage: () => ({ language: lang.language }) }))
vi.mock('next/navigation', () => ({
  usePathname: () => '/core',
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn(), prefetch: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}))
vi.mock('@/lib/analytics/client', () => ({ sendProductAnalyticsBeacon: vi.fn() }))

import { LiveMatchupStrip } from '@/components/core-app/screens/LiveMatchupStrip'
import { Dash3ATriageView, type TriageViewRow } from '@/components/core-app/screens/Dash3ATriageView'
import type { RailStanding } from '@/lib/core-app/railMatchups'

afterEach(() => { cleanup(); lang.language = 'en' })

const strip = (standing: Partial<RailStanding>, language: 'en' | 'es' = 'en') => {
  lang.language = language
  const s = { rank: 9, outOf: 12, overCut: 14.6, basis: 'best_ball', provisional: true, placesAboveCut: 2, cutLine: 118.4, elimination: true, ...standing } as RailStanding
  const { container } = render(
    <LiveMatchupStrip strip={{ kind: 'unavailable', reason: 'no_opponent' }} leagueId="L1" pollMs={3_600_000} standing={s} />,
  )
  const section = container.querySelector('[data-state="standing"]')!
  return { text: section.textContent!, aria: section.getAttribute('aria-label'), link: section.querySelector('a')! }
}

describe('the live standing strip', () => {
  it('prints the same English it always did, byte for byte', () => {
    expect(strip({}).text).toBe(
      '9thof 12+14.6 over the cut2 places clear of the cut · cut line 118.4 · ranked on projected best-ball finals until the last game is final · See the field',
    )
    expect(strip({ provisional: false }).text).toContain(' · ranked on final best-ball points · ')
    expect(strip({ basis: 'projected', rank: 11, overCut: null, placesAboveCut: 0 }).text).toBe(
      '11thof 12On the blockYou are in the cut position · cut line 118.4 · ranked on projection until most of the field has played · See the field',
    )
    expect(strip({ basis: 'points', elimination: false, rank: 2, placesAboveCut: 1 }).text).toBe(
      '2ndof 12+14.6 over last place1 place clear of last place · cut line 118.4 · ranked on points · See the field',
    )
    expect(strip({}).aria).toBe('Your standing')
  })

  it('is Spanish in Spanish, with no English left in it', () => {
    const { text, aria, link } = strip({}, 'es')
    expect(text).toBe(
      '9.ºde 12+14.6 sobre el corte2 puestos por encima del corte · línea de corte 118.4 · según los finales proyectados de best ball hasta que termine el último partido · Ver la clasificación',
    )
    expect(aria).toBe('Tu posición')
    expect(link.getAttribute('href')).toBe('/core/standings?league=L1')
    const bottom = strip({ overCut: null, placesAboveCut: 0, elimination: false, basis: 'points' }, 'es').text
    expect(bottom).toContain('Último lugar')
    expect(bottom).toContain('Último de la liga esta semana')
    for (const t of [text, bottom]) {
      expect(t).not.toMatch(/\b(of|over|the cut|places? clear|cut line|ranked|See the field|On the block|Last place)\b/)
    }
  })
})

function row(over: Partial<TriageViewRow>): TriageViewRow {
  return {
    key: 'p1', name: 'Parker Okafor', initials: 'PO', sleeperId: null, imageUrl: null, playerHref: '/core/players?q=x',
    position: 'WR', team: 'SF', sport: 'NFL', status: 'Out', tone: 'bad', exposure: '1 of 9', exposureCount: 1, exposureTotal: 9,
    startingIn: 0, benchIn: 0, irIn: 0, taxiIn: 0, bestBallIn: 0, value: null, reportedAgo: null, kickoffMins: null, description: null,
    leagues: [{ id: 'L1', name: 'League', platform: 'sleeper', href: '/core?league=L1', slot: null, bench: [] }],
    leagueCount: 1, freeAgentLinks: [], ...over,
  }
}
const title = (rows: TriageViewRow[], language: 'en' | 'es' = 'en') => {
  lang.language = language
  return render(<Dash3ATriageView rows={rows} overflow={0} valueBasis={null} freshness={null} />).container.querySelector('.af-triage-title')!.textContent
}

describe("the Home injury card's title", () => {
  it('says "Starters in doubt" when one of them starts', () => {
    expect(title([row({ bestBallIn: 1 }), row({ key: 'p2', startingIn: 1 })])).toBe('Starters in doubt')
    expect(title([row({ startingIn: 2 })], 'es')).toBe('Titulares en duda')
  })

  it('does not call a bench- or best-ball-only list "starters"', () => {
    expect(title([row({ bestBallIn: 2 })])).toBe('Injured players you hold')
    expect(title([row({ benchIn: 1 }), row({ key: 'p2', irIn: 1 })])).toBe('Injured players you hold')
    expect(title([row({ bestBallIn: 2 })], 'es')).toBe('Jugadores lesionados en tu plantilla')
  })

  it('still says "Roster check" with nothing in it', () => {
    expect(title([])).toBe('Roster check')
  })
})
