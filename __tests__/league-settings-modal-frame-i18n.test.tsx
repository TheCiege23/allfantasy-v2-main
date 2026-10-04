/**
 * The league settings modal's frame, in both languages (2026-10-04).
 *
 * 🛑 THE FRAME WAS ENGLISH-ONLY. Header ("League Settings"), the USER / GENERAL / AI pills, the
 * USER tab, every card title and description across the GENERAL / COMMISH / AI / IDP grids, the
 * sub-panel bar, the aria-labels, and — the one most readers meet — the imported-league summary
 * ("How this league runs", its rows, the read-only note, "Edit on Sleeper →"). 547 of the owner's
 * 557 leagues are imports, so for most leagues that summary IS the settings window.
 *
 * Cards carry dictionary KEYS now. The guard reads every `lsModal.` key the file names (card
 * definitions included, which no t('…') scan would see) and requires it in both dictionaries.
 * The renders mock the modal's children — sub-panels, commissioner shell, toggles — so what is
 * asserted is the frame itself, rendered for real.
 */
import React from 'react'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render } from '@testing-library/react'

import { translations } from '@/lib/i18n/translations'

const lang = vi.hoisted(() => ({ language: 'en' as 'en' | 'es' }))
/* The provider's own resolution: the language's dictionary, then English, then the key itself. */
vi.mock('@/components/i18n/LanguageProviderClient', async () => {
  const { translations: dict } = await import('@/lib/i18n/translations')
  const t = (k: string) => dict[lang.language]?.[k] ?? dict.en[k] ?? k
  return { useLanguage: () => ({ language: lang.language, t, setLanguage: () => {} }), useOptionalLanguage: () => ({ language: lang.language, t }) }
})
vi.mock('@/app/league/[leagueId]/components/LeagueSettingsSubPanels', () => ({ SettingsSubPanelBody: () => <div data-testid="sub-panel-body" /> }))
vi.mock('@/app/league/[leagueId]/components/CommissionerLeagueSettingsShell', () => ({ CommissionerLeagueSettingsShell: () => <div data-testid="commish-shell" /> }))
vi.mock('@/components/i18n/LanguageToggle', () => ({ default: () => <div data-testid="language-toggle" /> }))
vi.mock('@/components/theme/ThemeModeSelect', () => ({ ThemeModeSelect: () => <div data-testid="theme-select" /> }))
vi.mock('@/hooks/useSubscriptionGate', () => ({ SubscriptionGateProvider: ({ children }: { children: React.ReactNode }) => <>{children}</> }))

import { LeagueSettingsModal } from '@/app/league/[leagueId]/components/LeagueSettingsModal'

const SRC = readFileSync(resolve(__dirname, '../app/league/[leagueId]/components/LeagueSettingsModal.tsx'), 'utf8')
const KEYS = [...new Set([...SRC.matchAll(/['"](lsModal\.[A-Za-z0-9_.]+)['"]/g)].map((m) => m[1]!))]

describe('every lsModal key the frame names exists in BOTH languages', () => {
  it('🛑 read from the file — card definitions included', () => {
    expect(KEYS.length).toBeGreaterThanOrEqual(90) // the scan must see the real keys (measured: 96)
    expect(KEYS).toEqual(expect.arrayContaining(['lsModal.card.auditLog', 'lsModal.imported.readOnly', 'lsModal.tabUser']))
    expect(KEYS.filter((k) => !translations.en[k])).toEqual([])
    expect(KEYS.filter((k) => !translations.es[k])).toEqual([])
  })
  it('placeholders match across languages', () => {
    const ph = (s: string) => (s.match(/\{\{\w+\}\}/g) ?? []).sort().join()
    expect(KEYS.filter((k) => ph(translations.en[k]!) !== ph(translations.es[k]!))).toEqual([])
  })
})

/* ---------------------------------------------------------------------------------------------- */

function league(platform: string) {
  return {
    id: 'l1', platform, platformLeagueId: 'p1', leagueSize: 12, isDynasty: false, scoring: 'PPR', status: 'in_season', avatarUrl: null,
    settings: { roster_positions: ['QB', 'RB', 'WR'], settings: { waiver_type: 1, playoff_teams: 6 } },
  }
}
const display = { id: 'l1', name: 'Test League', season: 2026, teamCount: 12, format: 'Redraft', scoring: 'PPR Superflex', status: 'in_season', avatarUrl: null }

function renderModal(platform: string, extra: Record<string, unknown> = {}) {
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, json: async () => ({}) })))
  vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: true, addEventListener: () => {}, removeEventListener: () => {} })))
  return render(
    <LeagueSettingsModal
      open
      onClose={() => {}}
      league={league(platform) as never}
      displayLeague={display as never}
      userId="u1"
      userTeam={null}
      sleeperLeagueId="s1"
      isCommissioner={false}
      isHeadCommissioner={false}
      sleeperMemberMap={{} as never}
      onGoToDraftTab={() => {}}
      {...extra}
    />,
  )
}

/** The English the frame used to print. Word-bounded, case-sensitive, per text node. */
const FORMER_ENGLISH = [
  'League Settings', 'USER', 'How this league runs', 'Platform', 'Season', 'Teams', 'Format', 'Scoring', 'Status',
  'Playoff teams', 'Roster construction', 'Rolling priority', 'in season', 'imported from', 'read-only mirror',
  'Edit on', 'Language', 'Theme', 'Use the home icon', 'My Team', 'Discord Sync', 'View league general settings',
  'Notifications', 'Invite', 'Manage Co Owners', 'Draft Results', 'League History', 'Audit Log', 'Weekly',
  'Analyze any trade', 'Close settings', 'User settings',
]
function englishIn(el: HTMLElement): string[] {
  const parts: string[] = []
  const w = el.ownerDocument.createTreeWalker(el, NodeFilter.SHOW_TEXT)
  for (let n = w.nextNode(); n; n = w.nextNode()) parts.push(n.nodeValue ?? '')
  for (const e of el.querySelectorAll('[aria-label],[title]')) parts.push(e.getAttribute('aria-label') ?? '', e.getAttribute('title') ?? '')
  const hay = parts.join(' | ')
  return FORMER_ENGLISH.filter((x) => new RegExp(`(^|[^A-Za-z])${x.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}($|[^A-Za-z])`).test(hay))
}

describe('🛑 the frame reads Spanish in Spanish', () => {
  afterEach(() => { lang.language = 'en'; vi.unstubAllGlobals(); cleanup(); try { localStorage.clear() } catch { /* ignore */ } })

  it('an imported league — the summary most leagues show', async () => {
    lang.language = 'es'
    const r = renderModal('sleeper')
    await r.findByText('Cómo funciona esta liga')
    for (const s of ['Ajustes de la liga', 'USUARIO', 'GENERAL', 'IA ✨', 'Plataforma', 'Temporada', 'Equipos', 'Formato', 'Puntuación', 'Estado',
      'en temporada', 'Waivers', 'Prioridad rotativa', 'Equipos en playoffs', 'Composición de la plantilla', 'Editar en Sleeper →']) {
      expect(r.container.ownerDocument.body.textContent, s).toContain(s)
    }
    expect(r.container.ownerDocument.body.textContent).toContain('Esta liga está importada de Sleeper, así que sus reglas son un reflejo de solo lectura')
    expect(englishIn(r.container.ownerDocument.body)).toEqual([])
  })

  it('the USER tab', async () => {
    lang.language = 'es'
    const r = renderModal('sleeper')
    fireEvent.click(await r.findByText('USUARIO'))
    await r.findByText('Idioma')
    expect(r.container.ownerDocument.body.textContent).toContain('Tema')
    expect(r.container.ownerDocument.body.textContent).toContain('Usa el icono de inicio')
    expect(englishIn(r.container.ownerDocument.body)).toEqual([])
  })

  it('the GENERAL card grid (a native league, viewed by a member) and a card’s sub-panel title', async () => {
    lang.language = 'es'
    const r = renderModal('manual')
    await r.findByText('Mi equipo')
    for (const s of ['Sincronizar Discord', 'Ver los ajustes generales de la liga', 'Notificaciones', 'Invitar', 'Gestionar co-propietarios',
      'Resultados del draft', 'Historial de la liga', 'Registro de auditoría']) {
      expect(r.container.ownerDocument.body.textContent, s).toContain(s)
    }
    expect(englishIn(r.container.ownerDocument.body)).toEqual([])
    fireEvent.click(r.getByText('Registro de auditoría'))
    await r.findByTestId('sub-panel-body')
    expect(r.getAllByText('Registro de auditoría').length).toBeGreaterThanOrEqual(2) // card + the sub-panel bar's title
  })

  it('the AI card grid', async () => {
    lang.language = 'es'
    const r = renderModal('manual')
    fireEvent.click(await r.findByText('IA ✨'))
    await r.findByText('Analizador de trades con IA')
    expect(r.container.ownerDocument.body.textContent).toContain('Power Rankings con IA')
    expect(englishIn(r.container.ownerDocument.body)).toEqual([])
  })

  it('…and still reads English in English, byte for byte where it is pinned', async () => {
    const r = renderModal('sleeper')
    await r.findByText('How this league runs')
    for (const s of ['League Settings', 'USER', 'AI ✨', 'Rolling priority', 'Playoff teams', 'Roster construction', 'Edit on Sleeper →']) {
      expect(r.container.ownerDocument.body.textContent, s).toContain(s)
    }
    expect(r.container.ownerDocument.body.textContent).toContain(
      'This league is imported from Sleeper, so its rules are a read-only mirror — AllFantasy never changes your source league. To change how the league runs, edit it on Sleeper and it syncs here.',
    )
    expect(r.container.ownerDocument.body.textContent).not.toMatch(/\blsModal\./)
  })
})
