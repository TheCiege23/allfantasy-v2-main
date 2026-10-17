/**
 * What stayed English on My Team and its board after switching to Spanish (language audit,
 * 2026-10-03): the empty slot, the status chip's spoken name, the venue marks, five hover titles,
 * the matchup card's "from 8 of 9", the lineup-verification panel, and the board's Chimmy button.
 * Each is pinned here in Spanish, and a LIVE switch (no reload) is asserted in both directions.
 */
import React from 'react'
import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render } from '@testing-library/react'

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => '/core/my-team',
  useSearchParams: () => new URLSearchParams(),
}))
const lang = vi.hoisted(() => ({ language: 'en' as 'en' | 'es' }))
vi.mock('@/components/i18n/LanguageProviderClient', () => ({ useOptionalLanguage: () => ({ language: lang.language }) }))

import { MyTeam } from '@/components/core-app/screens/MyTeam'
import { LineupIntelligenceActions } from '@/components/core-app/LineupIntelligenceActions'
import { LineupVerification } from '@/components/core-app/LineupVerification'
import { verificationAge } from '@/lib/core-app/lineupVerification'
import type { LineupPlayer, MyTeamData } from '@/lib/core-app/myTeam'

const player = (over: Partial<LineupPlayer> = {}): LineupPlayer => ({
  sleeperId: 'p1', name: 'Bo Nix', position: 'QB', team: 'DEN', sport: 'NFL', imageUrl: null,
  gameContext: 'DEN vs MIA · Sun 10/4 1:00p ET', kickoff: new Date('2099-10-04T17:00:00Z'),
  preseason: false, venue: null, injuryStatus: 'Questionable', ruledOut: false, projectedPoints: 19.8,
  afProjectedPoints: 22.4, afEngineProjectedPoints: 21.1, indoors: false, weather: null,
  market: null, onBye: false, ...over,
})
const side = (over: Record<string, unknown> = {}) => ({ rosterId: 4, teamName: 'Mine', managerName: 'me', avatarUrl: null, projected: 131.7, afProjected: 128.4, projectedFrom: 8, starterCount: 9, ...over })
const data = {
  league: { id: 'l1', name: 'KBFL', platform: 'sleeper', format: 'dynasty', sourceLink: { href: 'https://sleeper.com/leagues/1/team', label: 'Sleeper' } },
  team: { available: false, reason: 'n/a' },
  starters: { available: true, data: [{ slotLabel: 'QB', player: player(), empty: false, unresolvedId: null }, { slotLabel: 'WR', player: null, empty: true, unresolvedId: null }] },
  bench: { available: true, data: [player({ sleeperId: 'b1', injuryStatus: null, indoors: true })] },
  ir: { available: false, reason: 'none' }, taxi: { available: false, reason: 'none' },
  lock: { available: false, reason: 'n/a' },
  projections: { available: true, data: { total: 19.8, projected: 1, unprojected: 1, season: '2026', week: 4, afTotal: 22.4, afEngineTotal: 21.1, afProjected: 1, standardComparable: true } },
  projectionBasis: { notes: [], scoringKnown: true },
  nextMatchup: { available: true, data: { seasonYear: 2026, week: 4, you: side(), opponent: side({ rosterId: 7, teamName: 'Them' }), bye: false, unpricedReason: null } },
  upcomingByes: [], rosterGrade: { available: false, reason: 'n/a' }, liveScore: { available: false, reason: 'n/a' },
} as unknown as MyTeamData

const attrs = (c: HTMLElement) =>
  [...c.querySelectorAll('[title],[aria-label]')].flatMap((e) => [e.getAttribute('title'), e.getAttribute('aria-label')]).filter(Boolean) as string[]

describe('My Team in Spanish', () => {
  it('says the empty slot, the matchup coverage and the status chip in Spanish', () => {
    lang.language = 'es'
    const c = render(<MyTeam data={data} />).container
    expect(c.textContent).toContain('Nadie es titular en esta posición')
    expect(c.textContent).toContain('con 8 de 9')
    expect(c.textContent).not.toContain('from 8 of 9')
    expect(c.querySelector('.af-mt-status[data-tone="warn"]')?.getAttribute('aria-label')).toBe('dudoso')
    lang.language = 'en'
  })

  it('speaks every hover title and spoken label it fixed in Spanish', () => {
    lang.language = 'es'
    const a = attrs(render(<MyTeam data={data} />).container)
    for (const s of [
      'Proyección del proveedor (Sleeper) puntuada con las reglas de TU liga · PPR estándar 19.8',
      'Proyección propia de AllFantasy ajustada a la puntuación de tu liga',
      'De las ligas que lo tienen, cuántas lo ponen de titular esta semana. Las semanas de descanso y las lesiones lo mueven por sí solas.',
      'Sin designación de lesión reportada, que no es lo mismo que confirmado sano',
      'Estadio cubierto',
      'Estadio al aire libre, pronóstico aún no disponible',
      'Proyección de AllFantasy ajustada a la puntuación de esta liga',
    ]) expect(a).toContain(s)
    for (const s of ['Indoor stadium', 'Outdoor stadium, forecast not available yet', 'standard PPR']) {
      expect(a.some((x) => x.includes(s))).toBe(false)
    }
    lang.language = 'en'
  })

  it('switches live, both ways, with no reload', () => {
    lang.language = 'en'
    const r = render(<MyTeam data={data} />)
    expect(r.container.textContent).toContain('Nobody is starting in this slot')
    lang.language = 'es'
    r.rerender(<MyTeam data={data} />)
    expect(r.container.textContent).toContain('Nadie es titular en esta posición')
    expect(r.container.textContent).not.toContain('Nobody is starting')
    lang.language = 'en'
    r.rerender(<MyTeam data={data} />)
    expect(r.container.textContent).toContain('Nobody is starting in this slot')
    expect(r.container.textContent).toContain('from 8 of 9')
  })
})

describe('the shared pieces', () => {
  it('the Chimmy button — label, words and the prefill the user will send', () => {
    lang.language = 'es'
    const seen: string[] = []
    const on = (e: Event) => seen.push((e as CustomEvent).detail.prefill)
    window.addEventListener('af-comms-open', on)
    const c = render(<LineupIntelligenceActions leagueId="l1" leagueName="KBFL" />).container
    const b = c.querySelector('button')!
    expect(b.getAttribute('aria-label')).toBe('Pedir a Chimmy que revise la alineación de KBFL')
    expect(b.textContent).toContain('revisar alineación')
    fireEvent.click(b)
    expect(seen).toHaveLength(1)
    expect(seen[0]).toContain('Revisa titulares y suplentes de mi alineación de KBFL')
    window.removeEventListener('af-comms-open', on)
    lang.language = 'en'
  })

  it('the lineup-verification panel, including its age', () => {
    lang.language = 'es'
    const c = render(<LineupVerification verification={null} />).container
    expect(c.textContent).toContain('No se pudo verificar la alineación')
    expect(c.textContent).toContain('Actualizar alineación')
    expect(c.querySelector('section')?.getAttribute('aria-label')).toBe('Verificación de la alineación')
    lang.language = 'en'
    const now = Date.parse('2026-10-03T12:00:00Z')
    expect(verificationAge('2026-10-03T11:55:00Z', now, 'es')).toBe('Revisada hace 5 min')
    expect(verificationAge('2026-10-03T11:55:00Z', now)).toBe('Checked 5 min ago')
    expect(verificationAge('invalid', now, 'es')).toBe('Hora de verificación no disponible')
  })
})
