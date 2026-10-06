/**
 * The league settings editors — draft, roster, playoff — in both languages (2026-10-05).
 *
 * 🛑 THEIR OWN COPY WAS ENGLISH: the draft panel's time-per-pick and round options, draft types,
 * pause range, draft-order list (Empty, re-assign, Fill with AI), keepers block, rookie-order modes
 * and preview (incl. the Champion / Runner-Up badges), messages; the roster editor's title, totals,
 * template and import blocks, category headings, row controls' labels, read-only rows; the playoff
 * editor's format header, current-format line, premium / week badges, impact preview, messages.
 * Stage names, template names and slot labels come from the API and stay as the server sends them.
 *
 * The guard reads every `lsEd.` key the files name plus the timer and category keys built at
 * runtime. The renders mount each editor from fixture data and scan each TEXT NODE, title and
 * aria-label for the English the editors used to print.
 */
import React from 'react'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, waitFor } from '@testing-library/react'

import { translations } from '@/lib/i18n/translations'

const lang = vi.hoisted(() => ({ language: 'en' as 'en' | 'es' }))
vi.mock('@/components/i18n/LanguageProviderClient', async () => {
  const { translations: dict } = await import('@/lib/i18n/translations')
  const t = (k: string) => dict[lang.language]?.[k] ?? dict.en[k] ?? k
  return { useLanguage: () => ({ language: lang.language, t, setLanguage: () => {} }), useOptionalLanguage: () => ({ language: lang.language, t }) }
})
vi.mock('@/components/subscription/SubscriptionGateModal', () => ({ SubscriptionGateModal: () => null }))
vi.mock('@/lib/draft-room/emitLeagueDraftRoomRevalidate', () => ({ emitLeagueDraftRoomRevalidate: () => {} }))

import { DraftSettingsCommissionerPanel } from '@/components/league-settings/DraftSettingsCommissionerPanel'
import { RosterSettingsEditor } from '@/components/league-settings/RosterSettingsEditor'
import { PlayoffSettingsEditor } from '@/components/league-settings/PlayoffSettingsEditor'

const ROOT = resolve(__dirname, '../components/league-settings')
const FILES = ['DraftSettingsCommissionerPanel.tsx', 'RosterSettingsEditor.tsx', 'PlayoffSettingsEditor.tsx',
  ...['ReadOnlyRosterRow', 'ResetToDefaultButton', 'RosterRowControl', 'RosterSectionRenderer'].map((f) => `roster/${f}.tsx`)]
const TIMERS = [30, 60, 90, 120, 300, 600, 3600, 14400, 28800, 43200, 86400]
const CATEGORIES = ['offense', 'flex', 'kicker', 'dst', 'idp', 'bench', 'reserve', 'college']

describe('every key the editors name exists in BOTH languages', () => {
  const keys = [...new Set(FILES.flatMap((f) => [...readFileSync(resolve(ROOT, f), 'utf8').matchAll(/['"`](lsEd\.[A-Za-z0-9_.]+)['"`]/g)].map((m) => m[1]!)))]
  it('🛑 read from the files', () => {
    expect(keys.length).toBeGreaterThanOrEqual(90) // the scan must see the real keys
    expect(keys).toEqual(expect.arrayContaining(['lsEd.dr.w2fDesc', 'lsEd.ro.importMapping', 'lsEd.po.intro', 'lsEd.ro.decrease']))
    expect(keys.filter((k) => !translations.en[k])).toEqual([])
    expect(keys.filter((k) => !translations.es[k])).toEqual([])
  })
  it('the keys built at runtime — timer options and category headings', () => {
    const draft = readFileSync(resolve(ROOT, FILES[0]!), 'utf8')
    for (const s of TIMERS) expect(draft, String(s)).toContain(String(s))
    const runtime = [...TIMERS.map((s) => `lsEd.dr.timer.s${s}`), ...CATEGORIES.map((c) => `lsEd.ro.cat.${c}`)]
    expect(runtime.filter((k) => !translations.en[k] || !translations.es[k])).toEqual([])
  })
  it('placeholders match across languages', () => {
    const ph = (s: string) => (s.match(/\{\{\w+\}\}/g) ?? []).sort().join()
    expect(keys.filter((k) => ph(translations.en[k]!) !== ph(translations.es[k]!))).toEqual([])
  })
})

/* ---------------------------------------------------------------------------------------------- */

const SLOT_DEFS = [
  { key: 'QB', label: 'QB', shortLabel: 'QB', color: '', category: 'offense', defaultCount: 1, minCount: 0, maxCount: 3 },
  { key: 'K', label: 'K', shortLabel: 'K', color: '', category: 'kicker', defaultCount: 1, minCount: 0, maxCount: 2 },
  { key: 'BN', label: 'BN', shortLabel: 'BN', color: '', category: 'bench', defaultCount: 6, minCount: 0, maxCount: 10 },
]
function stubFetch(opts: { commissioner?: boolean } = {}) {
  const commissioner = opts.commissioner ?? true
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: { method?: string }) => {
    const u = String(url)
    const body =
      u.includes('/draft/settings') ? {
        isCommissioner: true, config: { draft_type: 'snake', rounds: 15, timer_seconds: 90 }, draftStatus: 'pre_draft', slowDraftPauseEnabled: true,
        teams: [{ position: 1, teamName: 'Aces', ownerName: 'Pat', avatarUrl: null, isEmpty: false }, { position: 2, teamName: null, ownerName: null, avatarUrl: null, isEmpty: true }],
      }
      : u.includes('rookie-draft-order') ? {
        mode: 'worst_to_first', enabled: false, season: 2027, slots: [
          { slot: 1, teamName: 'Bees', ownerName: 'Lee', avatarUrl: null, orderLabel: '2-11', isPlayoffTeam: false, playoffFinish: null },
          { slot: 11, teamName: 'Cats', ownerName: 'Max', avatarUrl: null, orderLabel: '#2', isPlayoffTeam: true, playoffFinish: 'Runner-Up' },
          { slot: 12, teamName: 'Aces', ownerName: 'Pat', avatarUrl: null, orderLabel: '#1', isPlayoffTeam: true, playoffFinish: 'Champion' },
        ],
      }
      : u.includes('/roster-settings') ? {
        isCommissioner: commissioner, slotDefs: SLOT_DEFS, config: { templateKey: 'standard', slots: { QB: 1, K: 1, BN: 6 }, isCustom: false },
        templates: [{ key: 'standard', label: 'Standard', slots: { QB: 1, K: 1, BN: 6 } }], unifiedConfig: { rosterMatchesTemplate: false, rosterWarnings: [] }, sport: 'MLB',
      }
      : u.includes('/playoff-settings') && init?.method === 'PUT' ? { adjustment: { changes: ['server change line'], newPlayoffStartWeek: 14, newPlayoffWeeks: 4, newChampionshipWeek: 17 } }
      : u.includes('/playoff-settings') ? {
        isPremium: false, sport: 'NFL',
        stages: [
          { id: 'wc', label: 'StageA', description: 'stage a', premium: true, additionalWeeks: 1, timing: 'Jan', shortensSeason: false, defaultEnabled: false },
          { id: 'div', label: 'StageB', description: 'stage b', premium: false, additionalWeeks: 2, shortensSeason: false, defaultEnabled: false },
        ],
        config: { sport: 'NFL', includedStages: ['div'], startMode: 'auto', adjustedPlayoffStartWeek: 14, adjustedPlayoffWeeks: 4, premiumFeaturesUsed: false },
      }
      : {}
    return { ok: true, status: 200, json: async () => body }
  }))
}

/** The English the editors used to print. Word-bounded, case-sensitive, per text node / attribute. */
const FORMER_ENGLISH = [
  'Seconds', 'Minute', 'Minutes', 'Hour', 'Hours', 'Snake', 'Linear', 'Auction', 'Pause From', 'to', 'Rounds', 'Fill with AI', 'Empty', 'Click to re-assign',
  'Set Keepers', 'Click below', 'Set Players', 'Auto-calculated', 'Draft Order Mode', 'Non-playoff teams', 'Rookie Draft Order Preview', 'Non-Playoff', 'Playoff Teams',
  'Champion', 'Runner-Up', 'Set draft time', 'This is relative', 'Draft settings saved', 'Loading', 'Roster Settings', 'Set lineup slots', 'Starters', 'Bench/Reserve',
  'Current roster no longer', 'Template', 'Roster template', 'Custom', 'Apply Template', 'Import Mapping', 'Source platform', 'Imported slot JSON', 'Preview Import',
  'Apply Import', 'Only commissioners', 'Reset to League Default', 'Reset', 'Read only', 'Decrease', 'Increase', 'Offense', 'Kicker', 'Bench', 'Save',
  'Playoff Format', 'Configure which', 'Current', 'stage(s) enabled', 'Playoffs start Week', 'week', 'weeks', 'Timing', 'Available with AF Commissioner',
  'Schedule impact preview', 'Playoff start', 'Playoff weeks', 'Championship', 'Save playoff settings', 'Fill all empty draft slots',
]
function englishIn(el: HTMLElement): string[] {
  const parts: string[] = []
  const w = el.ownerDocument.createTreeWalker(el, NodeFilter.SHOW_TEXT)
  for (let n = w.nextNode(); n; n = w.nextNode()) parts.push(n.nodeValue ?? '')
  for (const e of el.querySelectorAll('[title],[aria-label]')) parts.push(e.getAttribute('title') ?? '', e.getAttribute('aria-label') ?? '')
  const hay = parts.join(' | ')
  return FORMER_ENGLISH.filter((x) => new RegExp(`(^|[^A-Za-z])${x.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}($|[^A-Za-z])`).test(hay))
}

describe('🛑 the editors read Spanish in Spanish', () => {
  afterEach(() => { lang.language = 'en'; vi.unstubAllGlobals(); cleanup() })

  it('the draft panel — options, order list, keepers, the rookie order preview and its badges', async () => {
    lang.language = 'es'
    stubFetch()
    const r = render(<DraftSettingsCommissionerPanel leagueId="l1" />)
    await r.findByText('Vista previa del orden del draft de novatos 2027')
    const text = r.container.textContent ?? ''
    for (const s of ['Define la hora del draft', 'Según tu zona horaria local', 'Serpiente', 'Lineal', 'Subasta', '90 segundos', '8 horas', '15 rondas',
      'Pausar desde', 'Llenar con IA', 'Vacío', '(Haz clic para reasignar)', 'Definir jugadores keeper/dynasty', 'Definir jugadores',
      'Calculado automáticamente para la temporada 2027', 'Modo de orden del draft', 'Sin playoffs', 'Equipos de playoffs', 'Campeón', 'Subcampeón']) {
      expect(text, s).toContain(s)
    }
    expect(r.container.querySelector('[title="Llenar todos los puestos vacíos del draft con rivales de IA"]')).not.toBeNull()
    expect(englishIn(r.container)).toEqual([])
  })

  it('the roster editor, as commissioner — totals, template, import, categories, row controls', async () => {
    lang.language = 'es'
    stubFetch()
    const r = render(<RosterSettingsEditor leagueId="l1" />)
    await r.findByText('Ajustes de plantilla')
    const text = r.container.textContent ?? ''
    for (const s of ['Define los puestos de la alineación', 'Titulares:', 'Banca/Reserva:', 'La plantilla actual ya no coincide', 'Plantilla base', 'Personalizada',
      'Aplicar plantilla', 'Mapeo de importación', 'Plataforma de origen', 'JSON de puestos importados', 'Vista previa de la importación', 'Aplicar importación',
      'Principal', 'Ofensiva', 'Pateador', 'Banca', 'Guardar', 'Restablecer al predeterminado de la liga']) {
      expect(text, s).toContain(s)
    }
    expect(r.container.querySelector('[aria-label="Reducir QB"]')).not.toBeNull()
    expect(r.container.querySelector('[aria-label="Aumentar QB"]')).not.toBeNull()
    expect(englishIn(r.container)).toEqual([])
    // A bad import payload reports in Spanish.
    fireEvent.change(r.container.querySelector('#roster-import-json')!, { target: { value: '{"QB": "x"}' } })
    fireEvent.click(r.getByText('Vista previa de la importación'))
    await r.findByText('El puesto importado QB debe ser numérico')
  })

  it('the roster editor, read-only', async () => {
    lang.language = 'es'
    stubFetch({ commissioner: false })
    const r = render(<RosterSettingsEditor leagueId="l1" />)
    await r.findByText('Solo los comisionados pueden editar los ajustes de plantilla.')
    expect(r.getAllByText('Solo lectura').length).toBeGreaterThan(0)
    expect(englishIn(r.container)).toEqual([])
  })

  it('the playoff editor — header, current format, badges, then a toggled stage’s impact preview', async () => {
    lang.language = 'es'
    stubFetch()
    const r = render(<PlayoffSettingsEditor leagueId="l1" />)
    await r.findByText('Formato de playoffs — NFL')
    let text = r.container.textContent ?? ''
    for (const s of ['Configura qué fases de la postemporada real', 'Actual: 1 fase(s) activada(s)', '· Los playoffs empiezan la semana 14', 'Premium',
      '+1 semana', '+2 semanas', 'Momento: Jan', 'Disponible con la suscripción AF Commissioner']) {
      expect(text, s).toContain(s)
    }
    expect(englishIn(r.container)).toEqual([])
    fireEvent.click(r.getByText('StageB'))
    await r.findByText('Vista previa del impacto en el calendario')
    text = r.container.textContent ?? ''
    for (const s of ['Inicio de playoffs', 'Semanas de playoffs', 'Final', 'Guardar ajustes de playoffs']) expect(text, s).toContain(s)
    expect(englishIn(r.container)).toEqual([])
  })

  it('…and the editors still read English in English', async () => {
    stubFetch()
    const d = render(<DraftSettingsCommissionerPanel leagueId="l1" />)
    await d.findByText('2027 Rookie Draft Order Preview')
    for (const s of ['90 Seconds', '15 Rounds', 'Snake', 'Fill with AI', 'Auto-calculated for 2027 season', 'Champion', 'Runner-Up']) expect(d.container.textContent, s).toContain(s)
    cleanup()
    const p = render(<PlayoffSettingsEditor leagueId="l1" />)
    await p.findByText('Playoff Format — NFL')
    expect(p.container.textContent).toContain('Current: 1 stage(s) enabled')
    expect(p.container.textContent).toContain('+1 week')
    await waitFor(() => expect(p.container.textContent).not.toMatch(/\blsEd\./))
  })
})
