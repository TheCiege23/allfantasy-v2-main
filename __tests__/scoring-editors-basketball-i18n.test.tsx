/**
 * The NBA and NCAAB scoring editors in both languages, stat names included (2026-10-05).
 *
 * 🛑 EVERYTHING ON THEM WAS ENGLISH: the chrome and every category, stat name and helper line, plus
 * the preset descriptions and warnings the API serves. Same shape as the football editors
 * (`scoring-editors-football-i18n`): the shared `lsScore.*` keys for the chrome, `translateStat` with
 * `BASKETBALL_STATS_ES` for the stat text, and a guard over the REAL category modules and preset
 * registries so a new stat cannot ship as one English line in a Spanish editor.
 */
import React from 'react'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, within } from '@testing-library/react'

import { translations } from '@/lib/i18n/translations'
import { BASKETBALL_STATS_ES } from '@/lib/i18n/scoring-stats/basketball'
import { NBA_SCORING_CATEGORIES, NBA_PREMIUM_SCORING } from '@/lib/nba-scoring/NbaScoringCategories'
import { NCAAB_SCORING_CATEGORIES, NCAAB_PREMIUM_SCORING } from '@/lib/ncaab-scoring/NcaabScoringCategories'
import { getNbaScoringPresets } from '@/lib/nba-scoring/NbaScoringPresets'
import { getNcaabScoringPresets } from '@/lib/ncaab-scoring/NcaabScoringPresets'

const lang = vi.hoisted(() => ({ language: 'en' as 'en' | 'es' }))
vi.mock('@/components/i18n/LanguageProviderClient', async () => {
  const { translations: dict } = await import('@/lib/i18n/translations')
  const t = (k: string) => dict[lang.language]?.[k] ?? dict.en[k] ?? k
  return { useLanguage: () => ({ language: lang.language, t, setLanguage: () => {} }), useOptionalLanguage: () => ({ language: lang.language, t }) }
})
vi.mock('@/components/subscription/SubscriptionGateModal', () => ({ SubscriptionGateModal: () => null }))

import { NbaScoringSettingsPanel } from '@/components/league-settings/NbaScoringSettingsPanel'
import { NcaabScoringSettingsPanel } from '@/components/league-settings/NcaabScoringSettingsPanel'

const NBA_CATS = [...NBA_SCORING_CATEGORIES, NBA_PREMIUM_SCORING]
const NCAAB_CATS = [...NCAAB_SCORING_CATEGORIES, NCAAB_PREMIUM_SCORING]
const PRESETS = [...getNbaScoringPresets(), ...getNcaabScoringPresets()]

/** Every English string the editors render from lib: categories, stats, helpers, preset prose. */
const SOURCE = [...new Set([
  ...[...NBA_CATS, ...NCAAB_CATS].flatMap((c) => [c.label, ...c.rows.flatMap((r) => [r.label, ...(r.helper ? [r.helper] : [])])]),
  ...PRESETS.flatMap((p) => [p.description, ...(p.warning ? [p.warning] : [])]),
])]
/** Spanish spells these the same. */
const SAME_BY_DESIGN = new Set(['General'])

describe('🛑 every basketball stat the editors show has Spanish', () => {
  it('read from the real category modules and preset registries', () => {
    expect(SOURCE.length).toBeGreaterThanOrEqual(80) // the scan must see the real modules
    expect(SOURCE).toEqual(expect.arrayContaining(['Points Scored', 'Tempo-Adjusted Bonus', 'Rare in college but supported']))
    expect(SOURCE.filter((s) => !(s in BASKETBALL_STATS_ES))).toEqual([])
  })
  it('…and the Spanish is not the English left in place', () => {
    expect(SOURCE.filter((s) => BASKETBALL_STATS_ES[s] === s && !SAME_BY_DESIGN.has(s))).toEqual([])
  })
  it('the table carries no row for a stat that no longer exists', () => {
    expect(Object.keys(BASKETBALL_STATS_ES).filter((s) => !SOURCE.includes(s))).toEqual([])
  })
})

describe('every chrome key the editors name exists in BOTH languages', () => {
  const ROOT = resolve(__dirname, '../components/league-settings')
  const keys = [...new Set(['NbaScoringSettingsPanel.tsx', 'NcaabScoringSettingsPanel.tsx'].flatMap((f) =>
    [...readFileSync(resolve(ROOT, f), 'utf8').matchAll(/['"`](lsScore\.[A-Za-z0-9_.]+)['"`]/g)].map((m) => m[1]!)))]
  it('🛑 read from the files', () => {
    expect(keys.length).toBeGreaterThanOrEqual(26)
    expect(keys).toEqual(expect.arrayContaining(['lsScore.subtitle.nba', 'lsScore.subtitle.ncaab', 'lsScore.premium.advancedMetrics', 'lsScore.savedLeagueWide']))
    expect(keys.filter((k) => !translations.en[k])).toEqual([])
    expect(keys.filter((k) => !translations.es[k])).toEqual([])
  })
  it('placeholders match across languages', () => {
    const ph = (s: string) => (s.match(/\{\{\w+\}\}/g) ?? []).sort().join()
    expect(keys.filter((k) => ph(translations.en[k]!) !== ph(translations.es[k]!))).toEqual([])
  })
})

/* ---------------------------------------------------------------------------------------------- */

function stubFetch(route: 'nba-scoring' | 'ncaab-scoring', presetKey: string) {
  const presets = route === 'nba-scoring' ? getNbaScoringPresets() : getNcaabScoringPresets()
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    expect(String(url)).toContain(`/${route}`)
    return { ok: true, status: 200, json: async () => ({ isPremium: false, presets, config: { presetKey, rules: {}, premiumFeaturesUsed: false } }) }
  }))
}

/** The chrome the editors used to print. Word-bounded, case-sensitive, per text node / attribute. */
const FORMER_ENGLISH = [
  'Scoring Settings', 'Set custom scoring values', 'Scoring values for this league', 'Scoring Preset', 'Custom', 'AllFantasy specialty leagues',
  'Only the commissioner', 'Premium Feature', 'require a premium subscription', 'Upgrade', 'stats', 'Click value to edit', 'Save Scoring', 'Reset',
  'Loading', 'Tournament', 'Guillotine',
]
/** Every basketball English string Spanish actually changes — none may survive as a whole text node or aria-label. */
const STAT_ENGLISH = new Set(SOURCE.filter((s) => !SAME_BY_DESIGN.has(s)))

function englishIn(el: HTMLElement): string[] {
  const parts: string[] = []
  const w = el.ownerDocument.createTreeWalker(el, NodeFilter.SHOW_TEXT)
  for (let n = w.nextNode(); n; n = w.nextNode()) parts.push(n.nodeValue ?? '')
  for (const e of el.querySelectorAll('[title],[aria-label]')) parts.push(e.getAttribute('title') ?? '', e.getAttribute('aria-label') ?? '')
  const chrome = FORMER_ENGLISH.filter((x) => new RegExp(`(^|[^A-Za-z])${x.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}($|[^A-Za-z])`).test(parts.join(' | ')))
  const stats = parts.map((p) => p.trim()).filter((p) => STAT_ENGLISH.has(p))
  return [...chrome, ...stats]
}

/** Click every category tab by its SPANISH name, scanning each one. */
function walkTabs(r: ReturnType<typeof render>, cats: { label: string; rows: { label: string }[] }[]) {
  for (const cat of cats) {
    fireEvent.click(r.getByRole('button', { name: BASKETBALL_STATS_ES[cat.label] }))
    const head = `${BASKETBALL_STATS_ES[cat.label]} (${cat.rows.length} estadísticas)`
    expect(r.container.textContent, head).toContain(head)
    for (const row of cat.rows) expect(r.getAllByText(BASKETBALL_STATS_ES[row.label]!).length, row.label).toBeGreaterThan(0)
    expect(englishIn(r.container), cat.label).toEqual([])
  }
}

describe('🛑 the basketball editors read Spanish in Spanish', () => {
  afterEach(() => { lang.language = 'en'; vi.unstubAllGlobals(); cleanup() })

  it('NBA, as commissioner on a platform preset — warning, description, every tab, the premium card', async () => {
    lang.language = 'es'
    stubFetch('nba-scoring', 'sleeper_default')
    const r = render(<NbaScoringSettingsPanel leagueId="l1" isCommissioner />)
    await r.findByText('Puntuación de NBA')
    const text = r.container.textContent ?? ''
    for (const s of ['Define valores de puntuación personalizados para tu liga de NBA.', 'Preset de puntuación', 'Personalizado',
      'Este preset se basa en el formato predeterminado de Sleeper. Las ligas especiales (Zombie, Survivor, Torneo, Guillotina, Big Brother)',
      'Categorías de puntuación NBA compatibles con Sleeper', '0.5 pts por punto anotado (predeterminado de AF)', 'Guardar puntuación']) {
      expect(text, s).toContain(s)
    }
    walkTabs(r, NBA_CATS)
    expect(r.container.textContent).toContain('Las métricas de puntuación avanzadas requieren una suscripción premium.')
    expect(within(r.container).getByRole('button', { name: 'Mejorar' })).toBeTruthy()
  })

  it('NCAAB, as commissioner — its subtitle, the college-only helper, every tab', async () => {
    lang.language = 'es'
    stubFetch('ncaab-scoring', 'sleeper_compatible')
    const r = render(<NcaabScoringSettingsPanel leagueId="l1" isCommissioner />)
    await r.findByText('Puntuación de NCAAB')
    const text = r.container.textContent ?? ''
    for (const s of ['tu liga de baloncesto universitario', 'Sleeper no admite hoy ligas fantasy de NCAAB.', 'Puntuación NCAAB compatible con Sleeper.']) {
      expect(text, s).toContain(s)
    }
    walkTabs(r, NCAAB_CATS)
    fireEvent.click(r.getByRole('button', { name: 'Bonos' }))
    expect(r.container.textContent).toContain('Poco común en universitario, pero se admite')
  })

  it('read-only viewers', async () => {
    lang.language = 'es'
    stubFetch('ncaab-scoring', 'af_default')
    const r = render(<NcaabScoringSettingsPanel leagueId="l1" />)
    await r.findByText('Solo el comisionado puede editar la puntuación.')
    expect(r.container.textContent).toContain('Valores de puntuación de esta liga (solo lectura).')
    expect(r.container.textContent).toContain('Puntuación NCAAB equilibrada')
    expect(englishIn(r.container)).toEqual([])
  })

  it('…and both still read English in English', async () => {
    stubFetch('nba-scoring', 'sleeper_default')
    const n = render(<NbaScoringSettingsPanel leagueId="l1" isCommissioner />)
    await n.findByText('NBA Scoring Settings')
    for (const s of ['Set custom scoring values for your NBA league.', 'Custom', 'General (4 stats)', 'Points Scored', '0.5 pts per point scored (AF default)',
      "This scoring preset is based on Sleeper's default format.", 'Save Scoring']) {
      expect(n.container.textContent, s).toContain(s)
    }
    cleanup()
    vi.unstubAllGlobals()
    stubFetch('ncaab-scoring', 'af_default')
    const c = render(<NcaabScoringSettingsPanel leagueId="l1" isCommissioner />)
    await c.findByText('NCAAB Scoring Settings')
    expect(c.container.textContent).toContain('Set custom scoring values for your college basketball league.')
    expect(c.container.textContent).not.toMatch(/\blsScore\./)
  })
})
