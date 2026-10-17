/**
 * The generic scoring panel (`components/app/settings/ScoringSettingsPanel.tsx`) in both languages
 * (2026-10-06). It is what the NBA editor hands off to in a category league, and what the app
 * shell's league-settings tab renders.
 *
 * 🛑 ALL OF ITS COPY WAS ENGLISH: the heading, empty/loading/error states, the edit toggle, the
 * commissioner-access line, the category-league card (record-mode sentence, lower/higher wins, the
 * percentage note), the summary tiles, the table's column heads, On/Off, Changed, the editing
 * buttons, both toasts and the inputs' aria-labels.
 *
 * Left as they are on purpose: the stat column is derived from the raw stat key (with the key
 * printed beneath it), the category list is abbreviations (PTS, FG%), and sport / variant / format /
 * template ids are identifiers. The e2e specs assert the English heading and test ids, which stay
 * byte-identical.
 */
import React from 'react'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, waitFor } from '@testing-library/react'

import { translations } from '@/lib/i18n/translations'

const h = vi.hoisted(() => ({ language: 'en' as 'en' | 'es', config: null as unknown, toastError: vi.fn(), toastSuccess: vi.fn() }))
vi.mock('@/components/i18n/LanguageProviderClient', async () => {
  const { translations: dict } = await import('@/lib/i18n/translations')
  const t = (k: string) => dict[h.language]?.[k] ?? dict.en[k] ?? k
  return { useLanguage: () => ({ language: h.language, t, setLanguage: () => {} }), useOptionalLanguage: () => ({ language: h.language, t }) }
})
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: () => {}, push: () => {} }) }))
vi.mock('sonner', () => ({ toast: { error: h.toastError, success: h.toastSuccess } }))
vi.mock('@/hooks/useLeagueSectionData', () => ({
  useLeagueSectionData: () => ({ data: h.config, loading: false, error: null, reload: async () => {} }),
}))

import ScoringSettingsPanel from '@/components/app/settings/ScoringSettingsPanel'

const POINTS = {
  leagueId: 'l1', sport: 'NBA', leagueVariant: null, formatType: 'points', templateId: 'nba_points_default',
  rules: [
    { statKey: 'three_pointers_made', pointsValue: 1, multiplier: 1, enabled: true, defaultPointsValue: 1, defaultEnabled: true, isOverridden: false },
    { statKey: 'rebounds', pointsValue: 2, multiplier: 1, enabled: true, defaultPointsValue: 1.2, defaultEnabled: true, isOverridden: true },
  ],
}
const CATEGORY = {
  ...POINTS, formatType: 'h2h_categories',
  categoryScoring: { mode: 'h2h', presetId: 'nba_9cat', recordMode: 'each', categories: [{ id: 'pts', label: 'PTS', direction: 'higher' }, { id: 'to', label: 'TO', direction: 'lower' }] },
}

function stubPermission(ok: boolean) {
  vi.stubGlobal('fetch', vi.fn(async (_url: string, init?: { method?: string }) =>
    init?.method === 'PUT' ? { ok: false, json: async () => ({}) } : { ok }))
}

/** The English the panel used to print. Word-bounded, case-sensitive, per text node / attribute. */
const FORMER_ENGLISH = [
  'Scoring Settings', 'Select a league', 'Loading', 'Failed to load', 'Cancel', 'Edit scoring', 'format', 'Checking commissioner access',
  'Each category counts', 'Season totals', 'The team winning', 'lower wins', 'higher wins', 'Percentage categories', 'Template',
  'Enabled categories', 'Overrides', 'Category', 'Enabled', 'Points', 'Multiplier', 'Default', 'On', 'Off', 'Changed',
  'Reset to defaults', 'Save scoring', 'enabled', 'points',
]
function englishIn(el: HTMLElement): string[] {
  const parts: string[] = []
  const w = el.ownerDocument.createTreeWalker(el, NodeFilter.SHOW_TEXT)
  for (let n = w.nextNode(); n; n = w.nextNode()) parts.push(n.nodeValue ?? '')
  for (const e of el.querySelectorAll('[title],[aria-label]')) parts.push(e.getAttribute('title') ?? '', e.getAttribute('aria-label') ?? '')
  // The raw stat keys (points, rebounds) are identifiers printed on purpose — drop those nodes.
  const hay = parts.filter((p) => !/^[a-z_]+$/.test(p.trim())).join(' | ')
  return FORMER_ENGLISH.filter((x) => new RegExp(`(^|[^A-Za-z])${x.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}($|[^A-Za-z])`).test(hay))
}

describe('every key the panel names exists in BOTH languages', () => {
  const keys = [...new Set([...readFileSync(resolve(__dirname, '../components/app/settings/ScoringSettingsPanel.tsx'), 'utf8')
    .matchAll(/['"`](scorePanel\.[A-Za-z0-9_.]+)['"`]/g)].map((m) => m[1]!))]
  it('🛑 read from the file', () => {
    expect(keys.length).toBeGreaterThanOrEqual(32)
    expect(keys).toEqual(expect.arrayContaining(['scorePanel.record.each', 'scorePanel.pctNote', 'scorePanel.aria.points', 'scorePanel.toast.saveFailed']))
    expect(keys.filter((k) => !translations.en[k])).toEqual([])
    expect(keys.filter((k) => !translations.es[k])).toEqual([])
  })
  it('placeholders match across languages', () => {
    const ph = (s: string) => (s.match(/\{\{\w+\}\}/g) ?? []).sort().join()
    expect(keys.filter((k) => ph(translations.en[k]!) !== ph(translations.es[k]!))).toEqual([])
  })
})

describe('🛑 the panel reads Spanish in Spanish', () => {
  afterEach(() => { h.language = 'en'; h.toastError.mockClear(); h.toastSuccess.mockClear(); vi.unstubAllGlobals(); cleanup() })

  it('a points league, as commissioner — tiles, table, then editing, a failed save’s toast', async () => {
    h.language = 'es'
    h.config = POINTS
    stubPermission(true)
    const r = render(<ScoringSettingsPanel leagueId="l1" />)
    const edit = await r.findByText('Editar puntuación')
    let text = r.container.textContent ?? ''
    for (const s of ['Ajustes de puntuación', 'NBA · formato points', 'Plantilla', 'Categorías activas', 'Valores modificados', 'Categoría', 'Activa',
      'Puntos', 'Multiplicador', 'Predeterminado', 'Sí · 1', 'Modificado']) {
      expect(text, s).toContain(s)
    }
    expect(r.container.querySelector('[aria-label="rebounds activa"]')).not.toBeNull()
    expect(r.container.querySelector('[aria-label="Puntos de rebounds"]')).not.toBeNull()
    expect(englishIn(r.container)).toEqual([])
    fireEvent.click(edit)
    text = r.container.textContent ?? ''
    for (const s of ['Cancelar', 'Restablecer valores predeterminados', 'Guardar puntuación']) expect(text, s).toContain(s)
    expect(englishIn(r.container)).toEqual([])
    fireEvent.click(r.getByText('Guardar puntuación'))
    await waitFor(() => expect(h.toastError).toHaveBeenCalledWith('No se pudieron guardar los valores modificados'))
  })

  it('a category league — the record sentence, lower/higher wins, the percentage note', async () => {
    h.language = 'es'
    h.config = CATEGORY
    stubPermission(false)
    const r = render(<ScoringSettingsPanel leagueId="l1" />)
    await r.findByTestId('category-scoring-settings')
    const text = r.container.textContent ?? ''
    for (const s of ['Cada categoría cuenta para el récord.', 'PTS (gana el mayor)', 'TO (gana el menor)', 'Las categorías de porcentaje usan']) {
      expect(text, s).toContain(s)
    }
    expect(englishIn(r.container)).toEqual([])
    for (const [mode, s] of [['roto', 'Los totales de la temporada'], ['most', 'Gana el enfrentamiento el equipo']] as const) {
      cleanup()
      h.config = { ...CATEGORY, categoryScoring: { ...CATEGORY.categoryScoring, recordMode: mode } }
      const m = render(<ScoringSettingsPanel leagueId="l1" />)
      await m.findByTestId('category-scoring-settings')
      expect(m.container.textContent).toContain(s)
    }
  })

  it('no league selected', () => {
    h.language = 'es'
    const r = render(<ScoringSettingsPanel leagueId="" />)
    expect(r.container.textContent).toContain('Selecciona una liga para ver la puntuación.')
    expect(englishIn(r.container)).toEqual([])
  })

  it('…and it still reads English in English, byte for byte where the e2e specs look', async () => {
    h.config = POINTS
    stubPermission(true)
    const r = render(<ScoringSettingsPanel leagueId="l1" />)
    await r.findByText('Edit scoring')
    expect(r.getByRole('heading', { name: 'Scoring Settings' })).toBeTruthy()
    for (const s of ['NBA · format points', 'Enabled categories', 'On · 1', 'Changed']) expect(r.container.textContent, s).toContain(s)
    expect(r.container.querySelector('[aria-label="rebounds points"]')).not.toBeNull()
    expect(r.container.querySelector('[aria-label="rebounds enabled"]')).not.toBeNull()
    expect(r.container.textContent).not.toMatch(/\bscorePanel\./)
  })
})
