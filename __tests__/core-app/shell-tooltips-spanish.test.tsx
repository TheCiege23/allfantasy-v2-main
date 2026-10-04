// @vitest-environment jsdom
/**
 * The /core shell's hover and screen-reader words follow the language switch (2026-10-04).
 *
 * #2007 made the shell's VISIBLE words Spanish. A live sweep of production in Spanish then found the
 * hidden ones still English: the league rail's projection tooltip and per-league label, the rail's
 * career line ("2 titles" is visible too, on the Career screen), the profile tile, the commissioner
 * badge, the dashboard rail's titles, and the Player Finder's lineup buttons. Each case renders the
 * real component in both languages, so a translation that leaks into English fails here as well.
 */
import { act, cleanup, fireEvent, render } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  language: 'en' as 'en' | 'es',
  router: { push: () => {}, replace: () => {}, prefetch: () => {}, refresh: () => {} },
}))
vi.mock('@/components/i18n/LanguageProviderClient', () => ({
  useOptionalLanguage: () => ({ language: h.language, setLanguage: () => {}, t: (k: string) => k, tInterpolate: (k: string) => k }),
}))
// One router object for the life of the suite — see core-rail-active-league.test.tsx.
vi.mock('next/navigation', () => ({
  useRouter: () => h.router,
  usePathname: () => '/core/career',
  useSearchParams: () => new URLSearchParams(),
}))
vi.mock('@/components/core-app/comms/CommsDock', () => ({ default: () => null }))
vi.mock('@/components/core-app/SyncNowButton', () => ({ default: () => null }))
vi.mock('@/components/core-app/GeoRestrictionNotice', () => ({ GeoRestrictionNotice: () => null }))
vi.mock('@/components/core-app/AfCrest', () => ({ AfCrest: () => null }))
vi.mock('@/components/MiniPlayerImg', () => ({ default: () => null }))
vi.mock('@/lib/geo/useGeoRestriction', () => ({ useGeoRestriction: () => ({ loading: true, isPaidBlocked: false }) }))
vi.mock('@/components/values/ValuesPageLink', () => ({ ValuesPageLink: () => null }))

import AfCoreShell from '@/components/core-app/AfCoreShell'
import { CommissionerBadge } from '@/components/core-app/CommissionerBadge'
import { Dashboard3A } from '@/components/core-app/screens/Dashboard3A'
import { TriageLineupLinks } from '@/components/core-app/player-finder/TriageLineupLinks'
import { publishRailCareerLines } from '@/lib/core-app/railCareerChannel'
import { careerLineText } from '@/lib/core-app/shellCopy'

afterEach(() => {
  cleanup()
  publishRailCareerLines(null)
  h.language = 'en'
})

const LEAGUES = [
  { id: 'l1', name: 'Dynasty Dragons', platform: 'sleeper', mark: 'DD' },
  { id: 'l2', name: 'Office Redraft', platform: 'espn', mark: 'OR' },
]
const MATCHUP = {
  l1: {
    yourTeam: 'Mine', yourAvatarUrl: null, yourScore: 28.4,
    yourProjection: { projected: 51.4, afProjected: 51.4, afEngine: 49.0, afEngineFrom: 8, pricedFrom: 9, starterCount: 9 },
    opponentTeam: 'Other', opponentAvatarUrl: null, opponentScore: 6.6,
    opponentProjection: { projected: 40.1, afProjected: null, pricedFrom: 7, starterCount: 9 },
    scored: true,
  },
}

function renderShell(language: 'en' | 'es') {
  h.language = language
  const view = render(
    <AfCoreShell
      active="career"
      leagues={LEAGUES as never}
      syncAge={{ label: 'just now', stale: false }}
      syncEligibleCount={0}
      railMatchups={MATCHUP as never}
    >
      <div>screen</div>
    </AfCoreShell>,
  )
  const c = view.container
  if (!c.querySelector('.af-rail-row-side')) fireEvent.click(c.querySelector('.af-rail-toggle')!)
  return c
}
const sides = (c: HTMLElement) => [...c.querySelectorAll('.af-rail-row-side')].map((e) => e.getAttribute('title') ?? '')
const tile = (c: HTMLElement, id: string) => c.querySelector(`.af-rail-tile.af-platform[href*="${id}"]`)!

describe('the league rail', () => {
  it('the projection tooltip, both re-scored and generic-PPR forms', () => {
    const [mine, theirs] = sides(renderShell('es'))
    expect(mine).toBe(
      'Proyección base semanal — Sleeper (SLPR): proyección de Sleeper con 9 de 9 titulares, recalculada con la configuración de esta liga · AF: motor de AllFantasy con 8 de 9 titulares · el marcador en vivo se muestra aparte',
    )
    expect(theirs).toContain(', PPR genérico porque no se pudo recalcular con la puntuación de esta liga')
    for (const en of ['Weekly', 'starters', 're-scored', 'shown separately']) expect(mine + theirs).not.toContain(en)
  })

  it('CONTROL — English tooltip unchanged', () => {
    const [mine, theirs] = sides(renderShell('en'))
    expect(mine).toBe(
      'Weekly baseline projection — Sleeper (SLPR): Sleeper’s projection from 9 of 9 starters, re-scored with this league’s settings · AF: AllFantasy engine from 8 of 9 starters · live score is shown separately',
    )
    expect(theirs).toContain(', generic PPR because this league’s scoring could not be re-scored')
  })

  it('each league’s label and tooltip, with the career line translated where it shows', () => {
    publishRailCareerLines({ 'dynasty dragons': '23-11 · 2 titles', 'office redraft': '9-5 · 1 title' })
    const c = renderShell('es')
    expect(tile(c, 'l1').getAttribute('aria-label')).toBe('Dynasty Dragons en sleeper, tu historial aquí 23-11 · 2 títulos')
    expect(tile(c, 'l1').getAttribute('title')).toBe('Dynasty Dragons · sleeper · tu historial aquí 23-11 · 2 títulos')
    expect(tile(c, 'l2').getAttribute('aria-label')).toBe('Office Redraft en espn, tu historial aquí 9-5 · 1 título')
    const visible = [...c.querySelectorAll('.af-rail-row-career')].map((e) => e.textContent)
    expect(visible).toEqual(expect.arrayContaining(['23-11 · 2 títulos', '9-5 · 1 título']))
    expect(c.innerHTML).not.toMatch(/your career here|\d titles?\b/)
  })

  it('CONTROL — English labels and career line unchanged', () => {
    act(() => publishRailCareerLines({ 'dynasty dragons': '23-11 · 2 titles' }))
    const c = renderShell('en')
    expect(tile(c, 'l1').getAttribute('aria-label')).toBe('Dynasty Dragons on sleeper, your career here 23-11 · 2 titles')
    expect(tile(c, 'l2').getAttribute('aria-label')).toBe('Office Redraft on espn')
  })

  it('the profile tile', () => {
    expect(renderShell('es').querySelector('.af-rail-profile')?.getAttribute('title')).toBe('Perfil, ajustes y modos')
    cleanup()
    expect(renderShell('en').querySelector('.af-rail-profile')?.getAttribute('title')).toBe('Profile, settings and modes')
  })
})

describe('the expanded rail, every row shape', () => {
  // l1 head-to-head, l2 ESPN with no schedule, l3 an elimination league ranked on projection.
  const ROWS = {
    ...MATCHUP,
    l3: {
      yourTeam: 'Mine', yourAvatarUrl: null, yourScore: 0, opponentTeam: null, opponentAvatarUrl: null, opponentScore: 0,
      yourProjection: { projected: 90, afProjected: 92, pricedFrom: 9, starterCount: 9 },
      unpaired: true, scored: false,
      standing: { rank: 10, outOf: 15, overCut: 3.2, basis: 'projected', placesAboveCut: 2, cutLine: 80, elimination: true },
    },
  }
  const LEAGUES3 = [...LEAGUES, { id: 'l3', name: 'Elimination Station', platform: 'sleeper', mark: 'ES' }]
  const shellText = (language: 'en' | 'es') => {
    h.language = language
    const { container } = render(
      <AfCoreShell active="career" leagues={LEAGUES3 as never} syncAge={{ label: 'just now', stale: false }} syncEligibleCount={0} railMatchups={ROWS as never}>
        <div>screen</div>
      </AfCoreShell>,
    )
    if (!container.querySelector('.af-rail-row-side')) fireEvent.click(container.querySelector('.af-rail-toggle')!)
    const attrs = [...container.querySelectorAll('[aria-label],[title]')].map((e) => `${e.getAttribute('aria-label') ?? ''} ${e.getAttribute('title') ?? ''}`)
    return `${container.textContent ?? ''} ${attrs.join(' ')}`
  }

  it('reads Spanish — standing, freshness, labels, the no-schedule line and the profile tile', () => {
    const t = shellText('es')
    for (const es of ['#10 de 15', '+3.2 sobre el corte', '2 puestos de margen', 'por proyección', 'PTS',
      'ESPN no devolvió un calendario de enfrentamientos para esta liga', 'antigüedad desconocida',
      'Proyección del motor de AllFantasy', 'Tu cuenta', 'Perfil y ajustes', 'Saltar al contenido', '3 ligas']) {
      expect(t, es).toContain(es)
    }
    // The shell's own English as a word list a reviewer can extend. League names are not shell words.
    const ENGLISH = /\b(of 15|over the cut|places? clear|on projection|on points|SCORE|did not return|sync age unknown|last import|Your account|Profile & settings|Skip to content|AllFantasy home|Sections|leagues|Weekly baseline|your career here|re-scored|starters)\b/
    expect(t.replace(/Dynasty Dragons|Office Redraft|Elimination Station/g, '')).not.toMatch(ENGLISH)
  })

  it('CONTROL — the same shell in English keeps every English word', () => {
    const t = shellText('en')
    for (const en of ['10th', ' of 15', '+3.2 over the cut', '2 places clear', 'on projection', 'SCORE',
      'ESPN did not return a matchup schedule for this league', 'Your account', 'Profile & settings', 'Skip to content', '3 leagues']) {
      expect(t, en).toContain(en)
    }
  })
})

describe('the dashboard’s own rail', () => {
  it('profile and import titles, both ways', () => {
    h.language = 'es'
    let c = render(<Dashboard3A slots={{} as never} />).container
    expect(c.querySelector('.af3a-avatar')?.getAttribute('title')).toBe('Perfil, ajustes y modos')
    expect(c.querySelector('.af3a-tile-add')?.getAttribute('title')).toBe('Importar una liga')
    cleanup()
    h.language = 'en'
    c = render(<Dashboard3A slots={{} as never} />).container
    expect(c.querySelector('.af3a-avatar')?.getAttribute('title')).toBe('Profile, settings and modes')
    expect(c.querySelector('.af3a-tile-add')?.getAttribute('title')).toBe('Import a league')
  })
})

describe('the commissioner badge', () => {
  it('names itself in the reader’s language, both ways', () => {
    h.language = 'es'
    const es = render(<CommissionerBadge />).getByTestId('commissioner-badge')
    expect(es.getAttribute('aria-label')).toBe('Eres comisionado')
    expect(es.getAttribute('title')).toBe('Eres comisionado')
    cleanup()
    h.language = 'en'
    const en = render(<CommissionerBadge />).getByTestId('commissioner-badge')
    expect(en.getAttribute('aria-label')).toBe("You're the commissioner")
  })
})

// Translated by 80360ac9c (Player Finder Spanish); pinned here because the live sweep found them.
describe('the Player Finder’s lineup buttons', () => {
  const leagues = [
    { leagueId: 'A', leagueName: 'KBFL', platform: 'sleeper', platformLeagueId: '1180000000000000000', season: 2026, teamId: '3' },
    { leagueId: 'B', leagueName: 'Native One', platform: 'allfantasy', platformLeagueId: null, season: 2026, teamId: null },
  ]
  const links = (language: 'en' | 'es') => {
    h.language = language
    const { container } = render(<TriageLineupLinks playerKey="p1" playerName="Ben Sauls" leagues={leagues} weekKey="2026-4" locked={false} />)
    return [...container.querySelectorAll('a.af-pf-triage-lg-btn')]
  }

  it('Spanish labels and the visible "where it lands" word', () => {
    const as = links('es')
    expect(as.length).toBeGreaterThan(0)
    for (const a of as) {
      expect(a.getAttribute('aria-label')).toMatch(/^[^—]+: abrir .+ en .+$/)
      expect(a.getAttribute('aria-label')).not.toMatch(/open the| on /)
      expect(a.textContent).not.toMatch(/· (league|waivers|trade|.+ home)\b/)
    }
  })

  it('CONTROL — English labels unchanged', () => {
    for (const a of links('en')) expect(a.getAttribute('aria-label')).toMatch(/^.+ — open the .+ on .+$/)
  })
})

describe('the helpers', () => {
  it('careerLineText', () => {
    expect(careerLineText('23-11 · 2 titles', 'es')).toBe('23-11 · 2 títulos')
    expect(careerLineText('1 title', 'es')).toBe('1 título')
    expect(careerLineText('23-11', 'es')).toBe('23-11')
    expect(careerLineText('23-11 · 2 titles', 'en')).toBe('23-11 · 2 titles')
  })
})
