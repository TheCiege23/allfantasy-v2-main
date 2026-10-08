// @vitest-environment jsdom
/**
 * The /core shell's own words follow the language switch, both ways (2026-10-03).
 *
 * A live Spanish check of production found the shared top bar, league switcher, Sync button, league
 * context bar and source link all English on every /core screen. These render the real components,
 * flip the language between renders, and assert the words follow — including SHORT strings ("Synced
 * 4m ago", "League type") that a two-common-English-words heuristic cannot see, which is exactly how
 * the context bar's chips slipped past the first live scan.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'

const h = vi.hoisted(() => ({ language: 'en' as 'en' | 'es' }))

vi.mock('@/components/i18n/LanguageProviderClient', () => ({
  useOptionalLanguage: () => ({ language: h.language, setLanguage: () => {}, t: (k: string) => k }),
}))
vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: () => {}, push: () => {}, replace: () => {} }),
  usePathname: () => '/core/matchup',
}))

import { ScopeSwitcher } from '@/components/core-app/ScopeSwitcher'
import { SyncNowButton } from '@/components/core-app/SyncNowButton'
import CoreLeagueContextBar from '@/components/core-app/CoreLeagueContextBar'
import { SourceActionLink, ReadOnlyLeagueNote } from '@/components/league-links/SourceActionLink'
import { syncChipText } from '@/components/core-app/AfCoreShell'
import { ageText, leagueConceptText, platformsPhraseText, scopeLabelText } from '@/lib/core-app/shellCopy'

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, json: async () => ({}) })))
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  h.language = 'en'
})

const text = () => document.body.textContent ?? ''

describe('shell copy helpers', () => {
  it('scope labels, ages, platform lists and league types', () => {
    expect(scopeLabelText('All leagues', 'es')).toBe('Todas las ligas')
    expect(scopeLabelText('NFL leagues', 'es')).toBe('Ligas de NFL')
    expect(scopeLabelText('All leagues', 'en')).toBe('All leagues')
    expect(ageText('4m ago', 'es')).toBe('hace 4 min')
    expect(ageText('3h ago', 'es')).toBe('hace 3 h')
    expect(ageText('45s ago', 'es')).toBe('hace 45 s')
    expect(ageText('2d ago', 'es')).toBe('hace 2 d')
    expect(ageText('4m ago', 'en')).toBe('4m ago')
    // relativeAge's forms (cardFreshness.ts) — month and year must not fall through as English.
    expect(ageText('4 min ago', 'es')).toBe('hace 4 min')
    expect(ageText('3w ago', 'es')).toBe('hace 3 sem')
    expect(ageText('1mo ago', 'es')).toBe('hace 1 mes')
    expect(ageText('2mo ago', 'es')).toBe('hace 2 meses')
    expect(ageText('1y ago', 'es')).toBe('hace 1 año')
    expect(ageText('3y ago', 'es')).toBe('hace 3 años')
    expect(ageText('just now', 'es')).toBe('justo ahora')
    expect(platformsPhraseText('Sleeper, ESPN, Fantrax, MFL or Fleaflicker', 'es')).toBe('Sleeper, ESPN, Fantrax, MFL o Fleaflicker')
    expect(leagueConceptText('Guillotine', 'es')).toBe('Guillotina')
    expect(leagueConceptText('Dynasty', 'es')).toBe('Dynasty') // a format name kept as is
  })

  it('the top bar sync chip', () => {
    expect(syncChipText('4m ago')).toBe('synced 4m ago') // English default unchanged
    expect(syncChipText('4m ago', 'es')).toBe('sincronizado hace 4 min')
    expect(syncChipText('never synced', 'es')).toBe('Nunca sincronizado')
  })
})

describe('the shell follows en → es → en', () => {
  it('ScopeSwitcher: button, open panel, search and favourites — but never a league’s own name', () => {
    const leagues = [
      { id: 'L1', name: 'Its Just Too Deep!', sport: 'NFL', platform: 'sleeper', isCommissioner: false },
      { id: 'L2', name: 'Peach Bowl', sport: 'NFL', platform: 'espn', isCommissioner: false },
    ] as never
    const view = () => <ScopeSwitcher leagues={leagues} scopeValue={null} label="All leagues" selectedLeagueId={null} favoriteIds={[]} />
    const { rerender } = render(view())
    expect(text()).toContain('All leagues')
    expect(text()).toContain('Viewing')

    h.language = 'es'
    rerender(view())
    expect(text()).toContain('Todas las ligas')
    expect(text()).toContain('Viendo')
    fireEvent.click(screen.getByRole('button', { name: /Viendo/ }))
    expect(text()).toContain('¿Qué ligas?')
    expect(text()).toContain('Las favoritas se guardan en este dispositivo.')
    expect(screen.getByPlaceholderText('Busca una liga, deporte o plataforma')).toBeTruthy()
    expect(screen.getByRole('dialog').getAttribute('aria-label')).toBe('Elige qué ligas ver')
    expect(screen.getAllByLabelText(/^Añadir .* a favoritas$/).length).toBe(2)
    // League names are user content and stay exactly as written.
    expect(text()).toContain('Its Just Too Deep!')
    expect(text()).not.toMatch(/Which leagues|Favorites are saved|Viewing/)

    h.language = 'en'
    rerender(view())
    expect(text()).toContain('Which leagues?')
  })

  it('ScopeSwitcher leaves a selected league’s name alone in Spanish', () => {
    h.language = 'es'
    render(<ScopeSwitcher leagues={[] as never} scopeValue={null} label="Dynasty leagues" selectedLeagueId="L9" favoriteIds={[]} />)
    expect(text()).toContain('Dynasty leagues') // a league literally named this is not "Ligas de Dynasty"
    expect(text()).toContain('Liga')
  })

  it('SyncNowButton: chip label, hint, and the home panel', () => {
    const { rerender } = render(<SyncNowButton eligibleCount={12} />)
    expect(screen.getByRole('button').textContent).toContain('Sync now')
    h.language = 'es'
    rerender(<SyncNowButton eligibleCount={12} />)
    expect(screen.getByRole('button').textContent).toContain('Sincronizar')
    expect(screen.getByRole('button').getAttribute('title')).toBe('Trae la actividad nueva de tus ligas conectadas')
    cleanup()
    render(<SyncNowButton variant="panel" eligibleCount={12} syncAge={{ label: '4m ago', stale: false }} />)
    expect(text()).toContain('Tus 12 ligas')
    expect(text()).toContain('Actualizado hace 4 min')
    // The panel is a status row now: no "out of date?" question, no read-only plumbing (2026-10-08).
    expect(text()).not.toMatch(/desactualizadas|Pick up|Leagues out of date|We only read|Solo leemos/)
    cleanup()
    h.language = 'en'
    render(<SyncNowButton variant="panel" eligibleCount={1} syncAge={{ label: '3d ago', stale: true }} />)
    expect(text()).toContain('Your 1 league')
    expect(text()).toContain('Updated 3d ago')
    expect(text()).not.toMatch(/out of date/i)
    expect(document.querySelector('.af-syncnow-panel')?.getAttribute('data-stale')).toBe('true')
    cleanup()
    // Titled with every league the reader has — the rail's and the pager's count — not the syncable one.
    render(<SyncNowButton variant="panel" eligibleCount={57} totalLeagues={65} syncAge={{ label: '35m ago', stale: false }} />)
    expect(text()).toContain('Your 65 leagues')
    expect(text()).not.toContain('57')
    cleanup()
    // Leagues, none to sync (native or paused): no "import a league" told to someone who has leagues.
    render(<SyncNowButton variant="panel" eligibleCount={0} totalLeagues={7} />)
    expect(text()).toContain('Your 7 leagues')
    expect(text()).toContain('Nothing to sync right now.')
    expect(text()).not.toMatch(/Import a league/)
  })

  it('CoreLeagueContextBar: import chip, sync chip, surface, league type and decision chip', () => {
    const view = () => (
      <CoreLeagueContextBar
        leagueId="L1"
        leagueName="Loyal Dynasty Playas!"
        platform="sleeper"
        coverageHref="/core?league=L1#coverage"
        syncLabel="4m ago"
        syncStale={false}
        gameDayActive={false}
        surface="matchup"
      />
    )
    const { rerender } = render(view())
    expect(text()).toContain('SLEEPER import · what’s on file')
    expect(text()).toContain('Synced 4m ago')
    expect(text()).toContain('League type')

    h.language = 'es'
    rerender(view())
    expect(text()).toContain('Importación de SLEEPER · qué hay registrado')
    expect(text()).toContain('Sincronizado hace 4 min')
    expect(text()).toContain('Chimmy · Enfrentamiento')
    expect(text()).toContain('Tipo de liga')
    expect(text()).toContain('Análisis de la liga')
    expect(screen.getByRole('link', { name: /Importación de SLEEPER/ }).getAttribute('title')).toBe('Qué hay registrado de esta importación')
    expect(text()).not.toMatch(/\bimport ·|Synced|League type|League insights|what’s on file/)

    h.language = 'en'
    rerender(view())
    expect(text()).toContain('Synced 4m ago')
  })

  it('SourceActionLink: visible label and tooltip, and the read-only note', () => {
    const view = () => (
      <>
        <SourceActionLink platform="sleeper" sourceLeagueId="1313579997843161088" leagueName="Loyal Dynasty Playas!" action="matchup" />
        <ReadOnlyLeagueNote />
      </>
    )
    const { rerender } = render(view())
    expect(screen.getByRole('link').textContent).toBe('View Matchup in Loyal Dynasty Playas!')

    h.language = 'es'
    rerender(view())
    const link = screen.getByRole('link')
    expect(link.textContent).toBe('Ver el enfrentamiento en Loyal Dynasty Playas!')
    expect(link.getAttribute('title')).toBe('Ver el enfrentamiento en Loyal Dynasty Playas!')
    expect(text()).toContain('AllFantasy analiza y recomienda.')

    h.language = 'en'
    rerender(view())
    expect(screen.getByRole('link').textContent).toBe('View Matchup in Loyal Dynasty Playas!')
  })
})
