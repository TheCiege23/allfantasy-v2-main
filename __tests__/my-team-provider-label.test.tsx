/**
 * "Sleeper", not "API" — 2026-10-03. The provider projection is named for who made it. Census of
 * production that day: every non-AllFantasy row in `fantasy_projections` is `source = 'sleeper'`
 * (see lib/core-app/projectionProvider.ts). In an IDP league the defenders are priced by
 * AllFantasy's own IDP model, because Sleeper publishes no defensive line — so the label there
 * names both.
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

import { MyTeam } from '@/components/core-app/screens/MyTeam'
import { PROJECTION_PROVIDER_LABEL } from '@/lib/core-app/projectionProvider'
import type { LineupPlayer, MyTeamData } from '@/lib/core-app/myTeam'

const player = (over: Partial<LineupPlayer> = {}): LineupPlayer => ({
  sleeperId: 'p1', name: 'Bo Nix', position: 'QB', team: 'DEN', sport: 'NFL', imageUrl: null,
  gameContext: 'DEN vs MIA · Sun 10/4 1:00p ET', kickoff: new Date('2099-10-04T17:00:00Z'),
  preseason: false, venue: null, injuryStatus: null, ruledOut: false, projectedPoints: 19.8,
  afProjectedPoints: 22.4, afEngineProjectedPoints: 21.1, indoors: false, weather: null,
  market: null, onBye: false, ...over,
})
const page = (defendersModelled: boolean, platform = 'espn') => ({
  league: { id: 'l1', name: 'KBFL', platform, format: 'dynasty' },
  team: { available: true, data: { teamName: 'Mine', record: '2-1', recordKnown: true, rank: 3, teamCount: 12 } },
  starters: { available: true, data: [{ slotLabel: 'QB', player: player(), empty: false, unresolvedId: null }] },
  bench: { available: true, data: [] },
  ir: { available: false, reason: 'none' },
  taxi: { available: false, reason: 'none' },
  lock: { available: false, reason: 'n/a' },
  projections: { available: true, data: { total: 19.8, projected: 1, unprojected: 0, season: '2026', week: 4, afTotal: 165.8, afEngineTotal: 178.7, afProjected: 1, standardComparable: !defendersModelled, defendersModelled } },
  projectionBasis: { notes: [], scoringKnown: true },
  nextMatchup: { available: false, reason: 'n/a' },
  upcomingByes: [],
  rosterGrade: { available: false, reason: 'n/a' },
  liveScore: { available: false, reason: 'n/a' },
}) as unknown as MyTeamData

const leadLabel = (c: HTMLElement) => c.querySelector('.af-mt-tile--lead .af-label')?.textContent

describe('the provider projection is named for who made it', () => {
  it('reads "Sleeper" — on an ESPN league too: it is the projection’s provider, not the league’s platform', () => {
    lang.language = 'en'
    const { container } = render(<MyTeam data={page(false, 'espn')} />)
    expect(PROJECTION_PROVIDER_LABEL).toBe('Sleeper')
    expect(container.querySelector('.af-mt-projhead--af')?.textContent).toBe('Sleeper?')
    expect(leadLabel(container)).toBe('Projected · Sleeper · your league')
    expect(container.textContent).not.toMatch(/\bAPI\b/)
  })

  it('names BOTH sources in an IDP league — Sleeper publishes no defensive line', () => {
    lang.language = 'en'
    const { container } = render(<MyTeam data={page(true)} />)
    expect(leadLabel(container)).toBe('Projected · Sleeper + AF IDP · your league')
    const pop = container.querySelector('.af-mt-info-pop')!.textContent!
    expect(pop).toContain('Sleeper projects no defensive stats')
    expect(pop).toContain('AllFantasy’s IDP model')
  })

  it('carries the names into Spanish rather than falling back to English', () => {
    lang.language = 'es'
    const { container } = render(<MyTeam data={page(true)} />)
    expect(leadLabel(container)).toBe('Proyección · Sleeper + IDP de AF · tu liga')
    expect(container.querySelector('.af-mt-info-pop strong')?.textContent).toBe('Sleeper y AF')
    expect(container.querySelector('.af-mt-info-pop p')?.textContent).toContain('modelo IDP de AllFantasy')
    lang.language = 'en'
  })
})

describe('the heading fits its 54px column', () => {
  it('tracks "SLEEPER" at 0.06em — 55px at the label’s own tracking, 51px here', () => {
    const css = readFileSync(resolve(__dirname, '../components/core-app/af-my-team.css'), 'utf8')
    let ls: string | undefined
    postcss.parse(css).walkRules((r: Rule) => {
      if (r.parent?.type === 'root' && r.selector === '.af-core .af-mt-projhead > .af-mt-projhead--af') {
        r.walkDecls('letter-spacing', (d) => {
          ls = d.value
        })
      }
    })
    expect(ls).toBe('0.06em')
  })
})
