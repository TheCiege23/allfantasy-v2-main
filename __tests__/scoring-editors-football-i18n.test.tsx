/**
 * The NFL and NCAAF scoring editors in both languages, stat names included (2026-10-05).
 *
 * 🛑 EVERYTHING ON THEM WAS ENGLISH: the chrome (title, subtitle, preset chips, notices, premium
 * card, stat count, save controls, messages) and every category, stat name and helper line, plus the
 * preset descriptions and warnings the API serves from the preset registries.
 *
 * The category modules are server code too, so their English stays the source of truth; the stat
 * text goes through `translateStat` with `FOOTBALL_STATS_ES`. The guard below therefore reads the
 * REAL modules: a stat added to either sport without a Spanish row fails here, instead of shipping
 * as one English line in a Spanish editor. The renders click through every category tab.
 */
import React from 'react'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, within } from '@testing-library/react'

import { translations } from '@/lib/i18n/translations'
import { translateStat } from '@/lib/i18n/scoring-stats'
import { FOOTBALL_STATS_ES } from '@/lib/i18n/scoring-stats/football'
import { NFL_SCORING_CATEGORIES, NFL_PREMIUM_SCORING } from '@/lib/nfl-scoring/NflScoringCategories'
import { NCAAF_ALL_SCORING_CATEGORIES } from '@/lib/ncaaf-scoring/NcaafScoringCategories'
import { getNflScoringPresets } from '@/lib/nfl-scoring/NflScoringPresets'
import { getNcaafScoringPresets } from '@/lib/ncaaf-scoring/NcaafScoringPresets'

const lang = vi.hoisted(() => ({ language: 'en' as 'en' | 'es' }))
vi.mock('@/components/i18n/LanguageProviderClient', async () => {
  const { translations: dict } = await import('@/lib/i18n/translations')
  const t = (k: string) => dict[lang.language]?.[k] ?? dict.en[k] ?? k
  return { useLanguage: () => ({ language: lang.language, t, setLanguage: () => {} }), useOptionalLanguage: () => ({ language: lang.language, t }) }
})
vi.mock('@/components/subscription/SubscriptionGateModal', () => ({ SubscriptionGateModal: () => null }))

import { NflScoringSettingsPanel } from '@/components/league-settings/NflScoringSettingsPanel'
import { NcaafScoringSettingsPanel } from '@/components/league-settings/NcaafScoringSettingsPanel'

const NFL_CATS = [...NFL_SCORING_CATEGORIES, NFL_PREMIUM_SCORING]
const NCAAF_CATS = NCAAF_ALL_SCORING_CATEGORIES
const PRESETS = [...getNflScoringPresets(), ...getNcaafScoringPresets()]

/** Every English string the editors render from lib: categories, stats, helpers, preset prose. */
const SOURCE = [...new Set([
  ...[...NFL_CATS, ...NCAAF_CATS].flatMap((c) => [c.label, ...c.rows.flatMap((r) => [r.label, ...(r.helper ? [r.helper] : [])])]),
  ...PRESETS.flatMap((p) => [p.description, ...(p.warning ? [p.warning] : [])]),
])]
/** Spanish keeps these as they are on purpose. */
const SAME_BY_DESIGN = new Set(['IDP', 'Safety'])

describe('🛑 every football stat the editors show has Spanish', () => {
  it('read from the real category modules and preset registries', () => {
    expect(SOURCE.length).toBeGreaterThanOrEqual(180) // the scan must see the real modules
    expect(SOURCE).toEqual(expect.arrayContaining(['Passing Yards', 'Broken Tackles', 'Kick/Punt Return TD', '0.04 pts/yd (1 pt per 25 yds)']))
    expect(SOURCE.filter((s) => !(s in FOOTBALL_STATS_ES))).toEqual([])
  })
  it('…and the Spanish is not the English left in place', () => {
    expect(SOURCE.filter((s) => FOOTBALL_STATS_ES[s] === s && !SAME_BY_DESIGN.has(s))).toEqual([])
  })
  it('the table carries no row for a stat that no longer exists', () => {
    expect(Object.keys(FOOTBALL_STATS_ES).filter((s) => !SOURCE.includes(s))).toEqual([])
  })
  it('translateStat: Spanish only for es; English, other languages and unknown text pass through', () => {
    expect(translateStat('Passing Yards', 'es', FOOTBALL_STATS_ES)).toBe('Yardas por pase')
    expect(translateStat('Passing Yards', 'en', FOOTBALL_STATS_ES)).toBe('Passing Yards')
    expect(translateStat('Passing Yards', 'fr', FOOTBALL_STATS_ES)).toBe('Passing Yards')
    expect(translateStat('A stat added tomorrow', 'es', FOOTBALL_STATS_ES)).toBe('A stat added tomorrow')
  })
})

describe('every chrome key the editors name exists in BOTH languages', () => {
  const ROOT = resolve(__dirname, '../components/league-settings')
  const keys = [...new Set(['NflScoringSettingsPanel.tsx', 'NcaafScoringSettingsPanel.tsx'].flatMap((f) =>
    [...readFileSync(resolve(ROOT, f), 'utf8').matchAll(/['"`](lsScore\.[A-Za-z0-9_.]+)['"`]/g)].map((m) => m[1]!)))]
  it('🛑 read from the files', () => {
    expect(keys.length).toBeGreaterThanOrEqual(35)
    expect(keys).toEqual(expect.arrayContaining(['lsScore.statCount', 'lsScore.notice.ncaafTypes', 'lsScore.preset.afHalfPpr', 'lsScore.premium.nflAirYards']))
    expect(keys.filter((k) => !translations.en[k])).toEqual([])
    expect(keys.filter((k) => !translations.es[k])).toEqual([])
  })
  it('placeholders match across languages', () => {
    const ph = (s: string) => (s.match(/\{\{\w+\}\}/g) ?? []).sort().join()
    expect(keys.filter((k) => ph(translations.en[k]!) !== ph(translations.es[k]!))).toEqual([])
  })
})

/* ---------------------------------------------------------------------------------------------- */

function stubFetch(route: 'nfl-scoring' | 'ncaaf-scoring', presetKey: string) {
  const presets = route === 'nfl-scoring' ? getNflScoringPresets() : getNcaafScoringPresets()
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    expect(String(url)).toContain(`/${route}`)
    return { ok: true, status: 200, json: async () => ({ isPremium: false, presets, config: { presetKey, rules: {}, premiumFeaturesUsed: false } }) }
  }))
}

/** The chrome the editors used to print. Word-bounded, case-sensitive, per text node / attribute. */
const FORMER_ENGLISH = [
  'Scoring Settings', 'Customize scoring values', 'Scoring values for this league', 'Scoring Preset', 'Half PPR', 'Standard', 'Std', 'Custom',
  'AllFantasy specialty leagues', 'Only the commissioner', 'Premium Feature', 'requires a premium subscription', 'Advanced college football scoring',
  'Upgrade', 'stats', 'Click value to edit', 'Save Scoring', 'Reset', 'This scoring configuration', 'all players', 'league types', 'in this',
  'Guillotine', 'Tournament', 'Loading',
]
/** Every football English string Spanish actually changes — none may survive as a whole text node or aria-label. */
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
    fireEvent.click(r.getByRole('button', { name: FOOTBALL_STATS_ES[cat.label] }))
    const head = `${FOOTBALL_STATS_ES[cat.label]} (${cat.rows.length} estadísticas)`
    expect(r.container.textContent, head).toContain(head)
    for (const row of cat.rows) expect(r.getAllByText(FOOTBALL_STATS_ES[row.label]!).length, row.label).toBeGreaterThan(0)
    expect(englishIn(r.container), cat.label).toEqual([])
  }
}

describe('🛑 the football editors read Spanish in Spanish', () => {
  afterEach(() => { lang.language = 'en'; vi.unstubAllGlobals(); cleanup() })

  it('NFL, as commissioner on a platform preset — warning, description, every tab, the premium card', async () => {
    lang.language = 'es'
    stubFetch('nfl-scoring', 'sleeper_default')
    const r = render(<NflScoringSettingsPanel leagueId="l1" isCommissioner />)
    await r.findByText('Puntuación de NFL')
    const text = r.container.textContent ?? ''
    for (const s of ['Personaliza los valores de puntuación de tu liga.', 'Preset de puntuación', 'AllFantasy Medio PPR', 'AllFantasy Estándar', 'ESPN Estándar',
      'Personalizado', 'Este preset se basa en el formato PPR estándar de Sleeper.', 'Las ligas especiales de AllFantasy están optimizadas',
      'Puntuación PPR estándar de Sleeper', 'Haz clic en un valor para editarlo', 'Guardar puntuación', '1 punto cada 25 yardas (0.04 por yarda)']) {
      expect(text, s).toContain(s)
    }
    walkTabs(r, NFL_CATS)
    expect(r.container.textContent).toContain('Puntuar las yardas aéreas requiere una suscripción premium.')
    expect(within(r.container).getByRole('button', { name: 'Mejorar' })).toBeTruthy()
  })

  it('NCAAF, as commissioner — the league-wide notice, the CFBD helper, every tab, inputs labelled in Spanish', async () => {
    lang.language = 'es'
    stubFetch('ncaaf-scoring', 'sleeper_compatible')
    const r = render(<NcaafScoringSettingsPanel leagueId="l1" isCommissioner />)
    await r.findByText('Puntuación de NCAAF')
    const text = r.container.textContent ?? ''
    for (const s of ['a todos los jugadores y a todos los formatos', 'Esta configuración de puntuación se aplica a todos los jugadores y a todos los tipos de liga de NCAAF de esta liga',
      'Guillotina', 'Torneo', 'Sleeper no admite hoy ligas fantasy de NCAAF.', 'Puntuación NCAAF compatible con Sleeper.']) {
      expect(text, s).toContain(s)
    }
    expect(r.container.querySelector('input[aria-label="Yardas por pase"]')).not.toBeNull()
    walkTabs(r, NCAAF_CATS) // ends on Advanced, behind its premium card
    expect(r.container.textContent).toContain('La puntuación avanzada de fútbol americano universitario')
    fireEvent.click(r.getByRole('button', { name: 'Pateo' }))
    expect(r.container.textContent).toContain('CFBD solo da el total de aciertos e intentos.')
  })

  it('read-only viewers', async () => {
    lang.language = 'es'
    stubFetch('nfl-scoring', 'af_default')
    const r = render(<NflScoringSettingsPanel leagueId="l1" />)
    await r.findByText('Solo el comisionado puede editar la puntuación.')
    expect(r.container.textContent).toContain('Valores de puntuación de esta liga (solo lectura).')
    expect(r.container.textContent).toContain('Puntuación NFL equilibrada con 0.5 PPR')
    expect(englishIn(r.container)).toEqual([])
  })

  it('…and both still read English in English', async () => {
    stubFetch('nfl-scoring', 'sleeper_default')
    const n = render(<NflScoringSettingsPanel leagueId="l1" isCommissioner />)
    await n.findByText('NFL Scoring Settings')
    for (const s of ['AllFantasy Half PPR', 'ESPN Std', 'Custom', 'Passing (13 stats)', 'Passing Yards', '1 point every 25 yards (0.04 per yard)',
      "This preset is based on Sleeper's standard PPR format.", 'Save Scoring']) {
      expect(n.container.textContent, s).toContain(s)
    }
    cleanup()
    vi.unstubAllGlobals()
    stubFetch('ncaaf-scoring', 'af_default')
    const c = render(<NcaafScoringSettingsPanel leagueId="l1" isCommissioner />)
    await c.findByText('NCAAF Scoring Settings')
    expect(c.container.textContent).toContain(
      'This scoring configuration applies to all players and all NCAAF league types in this league — including Redraft, Dynasty, Keeper, Best Ball, Guillotine, Survivor, Zombie, Tournament, Devy, C2C, IDP, Superflex, and TE Premium.')
    expect(c.container.querySelector('input[aria-label="Passing Yards"]')).not.toBeNull()
    expect(c.container.textContent).not.toMatch(/\blsScore\./)
  })
})
