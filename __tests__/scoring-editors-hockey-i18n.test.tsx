/**
 * The NHL scoring editor in both languages, stat names included (2026-10-05).
 *
 * 🛑 EVERYTHING ON IT WAS ENGLISH: the chrome (incl. the Skaters / Goalies / Global / Advanced group
 * dividers and the league-wide notice) and every category, stat name and helper line, plus the
 * preset descriptions and warnings the API serves. Same shape as `scoring-editors-football-i18n`:
 * shared `lsScore.*` keys for the chrome, `translateStat` with `HOCKEY_STATS_ES` for the stat text,
 * and a guard over the REAL category module and preset registry.
 */
import React from 'react'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, within } from '@testing-library/react'

import { translations } from '@/lib/i18n/translations'
import { HOCKEY_STATS_ES } from '@/lib/i18n/scoring-stats/hockey'
import { NHL_ALL_SCORING_CATEGORIES } from '@/lib/nhl-scoring/NhlScoringCategories'
import { getNhlScoringPresets } from '@/lib/nhl-scoring/NhlScoringPresets'

const lang = vi.hoisted(() => ({ language: 'en' as 'en' | 'es' }))
vi.mock('@/components/i18n/LanguageProviderClient', async () => {
  const { translations: dict } = await import('@/lib/i18n/translations')
  const t = (k: string) => dict[lang.language]?.[k] ?? dict.en[k] ?? k
  return { useLanguage: () => ({ language: lang.language, t, setLanguage: () => {} }), useOptionalLanguage: () => ({ language: lang.language, t }) }
})
vi.mock('@/components/subscription/SubscriptionGateModal', () => ({ SubscriptionGateModal: () => null }))

import { NhlScoringSettingsPanel } from '@/components/league-settings/NhlScoringSettingsPanel'

const CATS = NHL_ALL_SCORING_CATEGORIES

/** Every English string the editor renders from lib: categories, stats, helpers, preset prose. */
const SOURCE = [...new Set([
  ...CATS.flatMap((c) => [c.label, ...c.rows.flatMap((r) => [r.label, ...(r.helper ? [r.helper] : [])])]),
  ...getNhlScoringPresets().flatMap((p) => [p.description, ...(p.warning ? [p.warning] : [])]),
])]

describe('🛑 every hockey stat the editor shows has Spanish', () => {
  it('read from the real category module and preset registry', () => {
    expect(SOURCE.length).toBeGreaterThanOrEqual(100) // the scan must see the real module
    expect(SOURCE).toEqual(expect.arrayContaining(['Gordie Howe Hat Trick', 'Goalie xGA', 'Per 2-minute minor']))
    expect(SOURCE.filter((s) => !(s in HOCKEY_STATS_ES))).toEqual([])
  })
  it('…and the Spanish is not the English left in place', () => {
    expect(SOURCE.filter((s) => HOCKEY_STATS_ES[s] === s)).toEqual([])
  })
  it('the table carries no row for a stat that no longer exists', () => {
    expect(Object.keys(HOCKEY_STATS_ES).filter((s) => !SOURCE.includes(s))).toEqual([])
  })
})

describe('every chrome key the editor names exists in BOTH languages', () => {
  const keys = [...new Set([...readFileSync(resolve(__dirname, '../components/league-settings/NhlScoringSettingsPanel.tsx'), 'utf8')
    .matchAll(/['"`](lsScore\.[A-Za-z0-9_.]+)['"`]/g)].map((m) => m[1]!))]
  it('🛑 read from the file', () => {
    expect(keys.length).toBeGreaterThanOrEqual(30)
    expect(keys).toEqual(expect.arrayContaining(['lsScore.group.skaters', 'lsScore.premium.nhlAnalytics', 'lsScore.loadingEllipsis', 'lsScore.notice.specialtyFormats']))
    expect(keys.filter((k) => !translations.en[k])).toEqual([])
    expect(keys.filter((k) => !translations.es[k])).toEqual([])
  })
  it('placeholders match across languages', () => {
    const ph = (s: string) => (s.match(/\{\{\w+\}\}/g) ?? []).sort().join()
    expect(keys.filter((k) => ph(translations.en[k]!) !== ph(translations.es[k]!))).toEqual([])
  })
})

/* ---------------------------------------------------------------------------------------------- */

function stubFetch(presetKey: string) {
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    expect(String(url)).toContain('/nhl-scoring')
    return { ok: true, status: 200, json: async () => ({ isPremium: false, presets: getNhlScoringPresets(), config: { presetKey, rules: {}, premiumFeaturesUsed: false } }) }
  }))
}

/** The chrome the editor used to print. Word-bounded, case-sensitive, per text node / attribute. */
const FORMER_ENGLISH = [
  'Scoring Settings', 'Customize scoring values', 'Scoring values for this league', 'Scoring Preset', 'Custom', 'AllFantasy specialty leagues',
  'Only the commissioner', 'Premium Feature', 'Advanced analytics scoring', 'Upgrade', 'stats', 'Click value to edit', 'Save Scoring', 'Reset',
  'Loading', 'This scoring configuration', 'all players', 'all league types', 'specialty formats', 'Skaters', 'Goalies', 'Global',
]
const STAT_ENGLISH = new Set(SOURCE)

function englishIn(el: HTMLElement): string[] {
  const parts: string[] = []
  const w = el.ownerDocument.createTreeWalker(el, NodeFilter.SHOW_TEXT)
  for (let n = w.nextNode(); n; n = w.nextNode()) parts.push(n.nodeValue ?? '')
  for (const e of el.querySelectorAll('[title],[aria-label]')) parts.push(e.getAttribute('title') ?? '', e.getAttribute('aria-label') ?? '')
  const chrome = FORMER_ENGLISH.filter((x) => new RegExp(`(^|[^A-Za-z])${x.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}($|[^A-Za-z])`).test(parts.join(' | ')))
  const stats = parts.map((p) => p.trim()).filter((p) => STAT_ENGLISH.has(p))
  return [...chrome, ...stats]
}

describe('🛑 the hockey editor reads Spanish in Spanish', () => {
  afterEach(() => { lang.language = 'en'; vi.unstubAllGlobals(); cleanup() })

  it('as commissioner on a platform preset — notice, group dividers, warning, every tab, the premium card', async () => {
    lang.language = 'es'
    stubFetch('sleeper_compatible')
    const r = render(<NhlScoringSettingsPanel leagueId="l1" isCommissioner />)
    await r.findByText('Puntuación de NHL')
    const text = r.container.textContent ?? ''
    for (const s of ['Esta configuración de puntuación se aplica a todos los jugadores y a todos los tipos de liga de esta liga, incluidos los formatos especiales.',
      'Patinadores', 'Porteros', 'Generales', 'Sleeper no admite hoy ligas fantasy de hockey.', 'Puntuación NHL compatible con Sleeper.', 'Personalizado',
      'Bono sumado al valor del gol', 'Guardar puntuación']) {
      expect(text, s).toContain(s)
    }
    expect(r.container.querySelector('input[aria-label="Gol"]')).not.toBeNull()
    for (const cat of CATS) {
      fireEvent.click(r.getByRole('button', { name: HOCKEY_STATS_ES[cat.label] }))
      const head = `${HOCKEY_STATS_ES[cat.label]} (${cat.rows.length} estadísticas)`
      expect(r.container.textContent, head).toContain(head)
      for (const row of cat.rows) expect(r.getAllByText(HOCKEY_STATS_ES[row.label]!).length, row.label).toBeGreaterThan(0)
      expect(englishIn(r.container), cat.label).toEqual([])
    }
    expect(r.container.textContent).toContain('La puntuación con analítica avanzada (Corsi, Fenwick, xG, xA, GSAA, etc.)')
    expect(within(r.container).getByRole('button', { name: 'Mejorar' })).toBeTruthy()
  })

  it('read-only viewers', async () => {
    lang.language = 'es'
    stubFetch('af_default')
    const r = render(<NhlScoringSettingsPanel leagueId="l1" />)
    await r.findByText('Solo el comisionado puede editar la puntuación.')
    expect(r.container.textContent).toContain('Puntuación NHL equilibrada')
    expect(englishIn(r.container)).toEqual([])
  })

  it('…and it still reads English in English', async () => {
    stubFetch('sleeper_compatible')
    const r = render(<NhlScoringSettingsPanel leagueId="l1" isCommissioner />)
    await r.findByText('NHL Scoring Settings')
    for (const s of ['This scoring configuration applies to all players and all league types in this league — including specialty formats.',
      'Skaters', 'Goalies', 'Global', 'Offense (15 stats)', 'Bonus on top of goal value', 'Sleeper does not currently support fantasy hockey leagues.', 'Save Scoring']) {
      expect(r.container.textContent, s).toContain(s)
    }
    expect(r.container.textContent).not.toMatch(/\blsScore\./)
  })
})
