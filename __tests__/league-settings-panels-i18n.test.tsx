/**
 * League-settings panels speak English in English (2026-10-04).
 *
 * 🛑 34 keys used by five panels — co-owner, division, dues, history, member — existed ONLY in
 * lib/i18n/translations-es-parity.ts. The provider resolves the reader's language, then English,
 * then the KEY ITSELF, so an English commissioner read "history.noSeasons", "member.selectManager",
 * "division.autoAssign"… as the interface. Same class as the commissioner control panel (#2032).
 *
 * The guard reads every components/league-settings file for its t('…') calls and requires each key
 * in both dictionaries — the check that would have caught all of these.
 */
import React from 'react'
import { readdirSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { render } from '@testing-library/react'

import { translations } from '@/lib/i18n/translations'

const lang = vi.hoisted(() => ({ language: 'en' as 'en' | 'es' }))
/* The provider's own resolution: the language, then English, then the key itself. */
vi.mock('@/components/i18n/LanguageProviderClient', async () => {
  const { translations: dict } = await import('@/lib/i18n/translations')
  const t = (k: string) => dict[lang.language]?.[k] ?? dict.en[k] ?? k
  return { useLanguage: () => ({ language: lang.language, t, setLanguage: () => {} }), useOptionalLanguage: () => ({ language: lang.language, t }) }
})

import { LeagueHistoryPanel } from '@/components/league-settings/LeagueHistoryPanel'

const DIR = resolve(__dirname, '../components/league-settings')
/*
 * CommissionerControlPanel's `commControl.*` keys get their English in #2032, which carries its own
 * equivalent guard (commissioner-control-panel-i18n). Excluded here only until that lands, so this
 * change does not depend on it.
 */
const PENDING_ELSEWHERE = new Set(['CommissionerControlPanel.tsx'])

function keysByFile(): Map<string, string[]> {
  const out = new Map<string, string[]>()
  const walk = (dir: string) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, e.name)
      if (e.isDirectory()) walk(p)
      else if (/\.tsx?$/.test(e.name) && !PENDING_ELSEWHERE.has(e.name)) {
        const keys = [...new Set([...readFileSync(p, 'utf8').matchAll(/\bt\(\s*['"]([A-Za-z0-9_]+\.[A-Za-z0-9_.]+)['"]/g)].map((m) => m[1]!))]
        if (keys.length) out.set(p.slice(DIR.length + 1).replace(/\\/g, '/'), keys)
      }
    }
  }
  walk(DIR)
  return out
}

describe('every key a league-settings panel uses resolves in both languages', () => {
  it('🛑 read from the panels’ own source — a key English lacks renders as the raw key', () => {
    const files = keysByFile()
    // The scan must see the five panels and their real calls, or it asserts nothing.
    for (const f of ['CoOwnerSettingsPanel.tsx', 'DivisionSettingsCommissionerPanel.tsx', 'LeagueDuesTrackerPanel.tsx', 'LeagueHistoryPanel.tsx', 'MemberSettingsCommissionerPanel.tsx']) {
      expect(files.has(f), f).toBe(true)
    }
    const missing = (lng: 'en' | 'es') => [...files].flatMap(([f, keys]) => keys.filter((k) => !translations[lng][k]).map((k) => `${f}: ${k}`))
    expect(missing('en')).toEqual([])
    expect(missing('es')).toEqual([])
  })
})

describe('a panel, rendered', () => {
  it('shows words, not keys, in English — and Spanish in Spanish', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({ seasons: [] }) })))
    lang.language = 'en'
    const en = render(<LeagueHistoryPanel leagueId="l1" />)
    await en.findByText('No past seasons found.')
    expect(en.container.textContent).toContain('History fills in as seasons are completed')
    expect(en.container.textContent).not.toMatch(/\bhistory\.[a-zA-Z]/)
    en.unmount()
    lang.language = 'es'
    const es = render(<LeagueHistoryPanel leagueId="l1" />)
    await es.findByText('No se encontraron temporadas históricas.')
    lang.language = 'en'
    vi.unstubAllGlobals()
  })
})
