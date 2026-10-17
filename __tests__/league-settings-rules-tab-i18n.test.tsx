/**
 * The settings Rules tab — league type, devy hub, best ball — in both languages (2026-10-06).
 *
 * 🛑 ALL THREE PANELS WROTE THEIR OWN COPY IN ENGLISH: the league-type card's heading, badge, the
 * per-type hints, its sentences, buy-in and buttons; the devy hub's command-center header, its
 * eleven tabs and every tab's card, and the devy ↔ NFL exchange-rate card with its warnings; the
 * best ball panel's sections, every row label and option, the underdog notes and the sport line.
 *
 * They use useOptionalLanguage, not useLanguage: the league-type card also renders in the import
 * flow and in tests with no provider, where it now falls back to the English dictionary. Left in
 * English on purpose: names and copy that come from shared lib modules (league-type labels, the
 * grade explainer, DEVY_BRIDGE_CAVEAT, the best-ball sport profile's name and notes) and the
 * league-creation wizard section the devy hub embeds.
 */
import React from 'react'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render } from '@testing-library/react'

import { translations } from '@/lib/i18n/translations'

const lang = vi.hoisted(() => ({ language: 'en' as 'en' | 'es' }))
vi.mock('@/components/i18n/LanguageProviderClient', async () => {
  const { translations: dict } = await import('@/lib/i18n/translations')
  const t = (k: string) => dict[lang.language]?.[k] ?? dict.en[k] ?? k
  return { useLanguage: () => ({ language: lang.language, t, setLanguage: () => {} }), useOptionalLanguage: () => ({ language: lang.language, t }) }
})
vi.mock('@/components/league-creation-wizard/DevyLeagueSetupSection', () => ({ DevyLeagueSetupSection: () => <div data-testid="devy-setup" /> }))

import { LeagueTypeConfirm } from '@/components/league/LeagueTypeConfirm'
import { DevyLeagueSettingsHub } from '@/components/devy/settings/DevyLeagueSettingsHub'
import { BestBallSettingsCommissionerPanel } from '@/components/league-settings/BestBallSettingsCommissionerPanel'

const ROOT = resolve(__dirname, '..')
const FILES = ['components/league/LeagueTypeConfirm.tsx', 'components/devy/settings/DevyLeagueSettingsHub.tsx', 'components/league-settings/BestBallSettingsCommissionerPanel.tsx']
const HINT_TYPES = ['redraft', 'dynasty', 'keeper', 'best_ball', 'guillotine', 'survivor', 'survivor_guillotine', 'tournament', 'devy', 'c2c', 'efl', 'zombie', 'pirate', 'salary_cap', 'big_brother']
const DEVY_TABS = ['league', 'rosters', 'pool', 'drafts', 'promotions', 'trading', 'scoring', 'assets', 'chimmy', 'tools', 'danger']

describe('every key the Rules tab names exists in BOTH languages', () => {
  const keys = [...new Set(FILES.flatMap((f) => [...readFileSync(resolve(ROOT, f), 'utf8').matchAll(/['"`](lsRules\.[A-Za-z0-9_.]+)['"`]/g)].map((m) => m[1]!)))]
  it('🛑 read from the files', () => {
    expect(keys.length).toBeGreaterThanOrEqual(100) // the scan must see the real keys
    expect(keys).toEqual(expect.arrayContaining(['lsRules.lt.setToTail', 'lsRules.dv.intro', 'lsRules.xr.outOfRange', 'lsRules.bb.profileLine']))
    expect(keys.filter((k) => !translations.en[k])).toEqual([])
    expect(keys.filter((k) => !translations.es[k])).toEqual([])
  })
  it('the keys built at runtime — the type hints and the devy tabs', () => {
    const runtime = [...HINT_TYPES.map((t) => `lsRules.lt.hint.${t}`), ...DEVY_TABS.map((t) => `lsRules.dv.tab.${t}`)]
    expect(runtime.filter((k) => !translations.en[k] || !translations.es[k])).toEqual([])
    const lt = readFileSync(resolve(ROOT, FILES[0]!), 'utf8')
    for (const t of HINT_TYPES) expect(lt, t).toContain(`'${t}'`)
  })
  it('placeholders match across languages', () => {
    const ph = (s: string) => (s.match(/\{\{\w+\}\}/g) ?? []).sort().join()
    expect(keys.filter((k) => ph(translations.en[k]!) !== ph(translations.es[k]!))).toEqual([])
  })
})

/* ---------------------------------------------------------------------------------------------- */

function stubFetch() {
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    const u = String(url)
    const body = u.includes('/league-type') ? {
      leagueId: 'l1', leagueName: null, storedType: 'redraft', canConfirm: true, rankableType: null, confirmation: null,
      suggestion: { suggested: 'tournament', confidence: 'medium', reasons: ['server reason'], detectedBuyIn: 20, looksNonCompetitive: false },
    } : u.includes('/bestball') ? {
      league: { settings: { mode: 'underdog', contestStructure: 'tournament', matchupFormat: 'cumulative', playoffFormat: 'advancement', tieRule: 'points_for', scoringPeriod: 'weekly' } },
    } : {}
    return { ok: true, status: 200, json: async () => body }
  }))
}
function devyCtx() {
  return { league: { id: 'l1', sport: 'NFL', settings: {}, userId: 'u1' }, isCommissioner: true } as never
}

/** The English the panels used to print. Word-bounded, case-sensitive, per text node / attribute. */
const FORMER_ENGLISH = [
  'League type', 'What kind of league', 'Confirmed', 'Decides your trade grades', 'Fresh draft each year', 'Rosters carry over', 'Lineups set themselves',
  'Many leagues, one bracket', 'Winners steal from losers', 'This league', 'is graded as', 'Sleeper can’t describe', 'League format', 'Buy-in',
  'Confirm format', 'Update format', 'Your commissioner can confirm',
  'Devy command center', 'Multi-year prospect development', 'This league is built', 'Save changes', 'Rosters & slots', 'Devy pool', 'Drafts & picks',
  'Promotions', 'Trading', 'Future assets', 'AI / Chimmy', 'Commissioner', 'Danger zone', 'Taxi and Devy are separate', 'Enforce separate', 'Devy player pool',
  'This controls which', 'Filters', 'Annual rookie', 'Future pick trading', 'Promotion rules', 'Trading rules', 'Supports players', 'Uses your sport scoring',
  'Future rookie and devy picks', 'Ask about devy', 'Should I draft', 'Commissioner tools', 'Overrides', 'Advanced / danger zone', 'Disabling devy',
  // Not bare 'exchange rate' / 'Tournament': DEVY_BRIDGE_CAVEAT and the league-type option labels (lib, left on
  // purpose) use those words, so the entries name the panels' own former wording instead.
  'Devy ↔ NFL exchange rate', 'Leave this empty', 'Market units per devy point', 'not set', 'Clear', 'At this rate', 'compare that with', 'That is not a number',
  'Outside the accepted range', 'Not set',
  'Operating Mode', 'Mode', 'Standard', 'Underdog-style', 'Contest', 'Contest structure', 'Season-long', 'Tournament / advancement', 'Scoring model', 'Cumulative points',
  'Head-to-head', 'Playoff format', 'Advancement', 'No playoffs', 'Scoring period', 'Weekly', 'Daily', 'Tiebreaker', 'Total points scored', 'Season Structure',
  'Regular season length', 'Playoff teams', 'Advancement rounds', 'In-Season Restrictions', 'Manual substitutions', 'Underdog-style locks', 'Sport Profile',
  'starter slots', 'recommended roster spots', 'scoring', 'Save Best Ball settings', 'Loading',
]
function englishIn(el: HTMLElement): string[] {
  const parts: string[] = []
  const w = el.ownerDocument.createTreeWalker(el, NodeFilter.SHOW_TEXT)
  for (let n = w.nextNode(); n; n = w.nextNode()) parts.push(n.nodeValue ?? '')
  for (const e of el.querySelectorAll('[placeholder],[title],[aria-label]')) parts.push(e.getAttribute('placeholder') ?? '', e.getAttribute('title') ?? '', e.getAttribute('aria-label') ?? '')
  const hay = parts.join(' | ')
  return FORMER_ENGLISH.filter((x) => new RegExp(`(^|[^A-Za-z])${x.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}($|[^A-Za-z])`).test(hay))
}

describe('🛑 the Rules tab reads Spanish in Spanish', () => {
  afterEach(() => { lang.language = 'en'; vi.unstubAllGlobals(); cleanup() })

  it('the league-type card — the ask, the hints, the buy-in, the pirate follow-up', async () => {
    lang.language = 'es'
    stubFetch()
    const r = render(<LeagueTypeConfirm leagueId="l1" alwaysShow />)
    await r.findByText('¿Qué tipo de liga es esta?')
    const text = () => r.container.textContent ?? ''
    for (const s of ['Decide las notas de tus trades', 'Esta liga se califica como', 'Sleeper no puede describir formatos', 'Draft nuevo cada año',
      'Muchas ligas, un solo bracket', 'Los ganadores roban a los perdedores', 'Inscripción (opcional)', 'Confirmar formato']) expect(text(), s).toContain(s)
    expect(r.container.querySelector('[aria-label="Formato de la liga"]')).not.toBeNull()
    expect(englishIn(r.container)).toEqual([])
    fireEvent.click(r.getByText('Los ganadores roban a los perdedores'))
    await r.findByText('¿Se mantienen las plantillas?')
    expect(englishIn(r.container)).toEqual([])
  })

  it('the devy hub — the header and every one of its eleven tabs', () => {
    lang.language = 'es'
    const r = render(<DevyLeagueSettingsHub ctx={devyCtx()} />)
    for (const s of ['Centro de mando devy', 'Desarrollo de prospectos a varios años', 'Guardar cambios']) expect(r.container.textContent, s).toContain(s)
    const tabs = ['Plantillas y puestos', 'Grupo devy', 'Drafts y picks', 'Ascensos', 'Trades', 'Puntuación', 'Activos futuros', 'IA / Chimmy', 'Comisionado', 'Zona de peligro']
    for (const label of tabs) {
      fireEvent.click(r.getAllByText(label)[0]!)
      expect(englishIn(r.container), label).toEqual([])
    }
    // The trades tab carries the exchange-rate card.
    fireEvent.click(r.getAllByText('Trades')[0]!)
    for (const s of ['Tipo de cambio devy ↔ NFL', 'Unidades de mercado por punto devy', 'Sin definir — los trades mixtos']) expect(r.container.textContent, s).toContain(s)
    expect(r.container.querySelector('input[placeholder="sin definir"]')).not.toBeNull()
  })

  it('the exchange-rate card — preview, not-a-number, out-of-range', () => {
    lang.language = 'es'
    const r = render(<DevyLeagueSettingsHub ctx={devyCtx()} />)
    fireEvent.click(r.getAllByText('Trades')[0]!)
    const input = r.container.querySelector('input[placeholder="sin definir"]') as HTMLInputElement
    fireEvent.change(input, { target: { value: '2' } })
    expect(r.container.textContent).toContain('A este tipo, el mejor prospecto de tu tablero devy vale alrededor de')
    expect(r.container.textContent).toContain('Borrar')
    fireEvent.change(input, { target: { value: 'abc' } })
    expect(r.container.textContent).toContain('Eso no es un número')
    fireEvent.change(input, { target: { value: '999999' } })
    expect(r.container.textContent).toContain('Fuera del rango aceptado de')
    expect(r.container.textContent).not.toMatch(/\{\{(min|max)\}\}/)
    expect(englishIn(r.container)).toEqual([])
  })

  it('the best ball panel — sections, options, underdog notes, the sport line', async () => {
    lang.language = 'es'
    stubFetch()
    const r = render(<BestBallSettingsCommissionerPanel leagueId="l1" sport="NFL" canEdit />)
    await r.findByText('Modo de juego')
    const text = r.container.textContent ?? ''
    for (const s of ['Estilo Underdog', 'El estilo Underdog desactiva', 'Competición y puntuación', 'Torneo / avance', 'Puntos acumulados', 'Avance',
      'Semanal', 'Puntos totales anotados', 'Estructura de la temporada', 'Rondas de avance', 'Restricciones en temporada', 'Sustituciones manuales',
      'El estilo Underdog bloquea', 'Perfil de deporte:', 'puestos titulares', 'puntuación semanal', 'Guardar ajustes de Best Ball']) {
      expect(text, s).toContain(s)
    }
    expect(r.container.querySelector('[aria-label="Sustituciones manuales"]')).not.toBeNull()
    expect(englishIn(r.container)).toEqual([])
  })

  it('…and all three still read English in English', async () => {
    stubFetch()
    const lt = render(<LeagueTypeConfirm leagueId="l1" alwaysShow />)
    await lt.findByText('What kind of league is this?')
    expect(lt.container.textContent).toContain('This league is graded as')
    expect(lt.container.textContent).toContain('. Sleeper can’t describe formats like zombie or tournament leagues, so confirm it here.')
    cleanup()
    const bb = render(<BestBallSettingsCommissionerPanel leagueId="l1" sport="NFL" canEdit />)
    await bb.findByText('Operating Mode')
    expect(bb.container.textContent).toMatch(/\d+ starter slots · \d+ recommended roster spots · weekly scoring/)
    expect(bb.container.textContent).not.toMatch(/\blsRules\./)
  })
})
