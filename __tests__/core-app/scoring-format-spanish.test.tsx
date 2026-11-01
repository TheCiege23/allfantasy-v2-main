/**
 * The /core screens that print a league's scoring as stored read it through `scoringFormatText`
 * (the owner's ruling, __tests__/spanish-wording-rulings.test.tsx §9): Spanish translates the scoring
 * part, English is the stored string, unchanged.
 */
import React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { translations } from '@/lib/i18n/translations'

const lang = vi.hoisted(() => ({ language: 'en' as 'en' | 'es' }))
vi.mock('@/components/i18n/LanguageProviderClient', async (importOriginal) => {
  const real = await importOriginal<typeof import('@/components/i18n/LanguageProviderClient')>()
  const value = () => {
    const table = translations[lang.language] as Record<string, string>
    const t = (key: string) => table[key] ?? (translations.en as Record<string, string>)[key] ?? key
    return {
      language: lang.language,
      t,
      tInterpolate: (key: string, vars: Record<string, string | number>) =>
        t(key).replace(/\{\{(\w+)\}\}/g, (_m, k: string) => String(vars[k] ?? '')),
    }
  }
  return { ...real, useLanguage: value, useOptionalLanguage: value }
})
vi.mock('next-auth/react', () => ({
  useSession: () => ({ data: { user: { id: 'viewer-1' } }, status: 'authenticated' }),
}))
vi.mock('@/lib/core-app/draftPlanningActions', () => ({ saveDraftPlanningPreference: vi.fn(async () => ({ ok: true })) }))

import { DraftPreparation } from '@/components/core-app/screens/DraftPreparation'
import type { DraftPreparationData } from '@/lib/core-app/draftPreparation'
import PowerRankingsPage from '@/components/core-app/rankings/power/PowerRankingsPanel'
import { bucketLabel } from '@/components/core-app/portfolio/PortfolioBoard'

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  lang.language = 'en'
})

/* ── Draft preparation's context line ──────────────────────────────────────────────────────────── */

const prep = (scoring: string): DraftPreparationData => ({
  state: 'ready',
  reason: null,
  sessionId: 's',
  preferenceScope: 'viewer-s',
  context: {
    sport: 'NFL',
    season: 2026,
    leagueType: 'redraft',
    draftType: 'snake',
    teamCount: 12,
    scoring,
    scoringRules: { rec: 0.5 },
    rosterSlots: ['WR'],
    playerPool: 'all',
    purpose: 'standard',
  },
  observedAt: '2026-08-01T00:00:00Z',
  historical: false,
  players: [],
  comparisons: [],
  outlook: [],
  outlookReason: 'Insufficient data',
  keeperCosts: [],
  queue: { state: 'empty', count: 0, autopick: 'Your personal autopick is disabled.' },
  customRankingsEnabled: true,
})

describe('draft preparation: the benchmark context line', () => {
  beforeEach(() => localStorage.clear())

  it('Spanish names the scoring in Spanish', () => {
    lang.language = 'es'
    for (const [stored, shown] of [
      ['half_ppr', 'Medio PPR'],
      ['Half PPR Superflex TEP', 'Medio PPR Superflex TEP'],
      ['standard', 'Estándar'],
      ['ppr', 'ppr'],
    ] as const) {
      const { container, unmount } = render(<DraftPreparation data={prep(stored)} leagueId="l" />)
      expect(container.querySelector('.af-prep-context')?.textContent, stored).toContain(` · ${shown} · `)
      unmount()
    }
  })

  it('English prints the stored string', () => {
    for (const stored of ['half_ppr', 'Half PPR Superflex TEP', 'standard', 'ppr']) {
      const { container, unmount } = render(<DraftPreparation data={prep(stored)} leagueId="l" />)
      expect(container.querySelector('.af-prep-context')?.textContent, stored).toContain(` · ${stored} · `)
      unmount()
    }
  })
})

/* ── Power rankings: the league picker card and the hub header ─────────────────────────────────── */

function json(body: unknown, status = 200) {
  return Promise.resolve(new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } }))
}

function stubLeagues(scoring: string) {
  vi.stubGlobal(
    'fetch',
    vi.fn((input: RequestInfo | URL) => {
      const url = String(input)
      if (url.startsWith('/api/league/list'))
        return json({
          leagues: [
            { id: 'L1', name: 'Test League', platform: 'sleeper', platformLeagueId: '999', season: '2026', sport: 'NFL', leagueSize: 12, scoring },
          ],
        })
      if (url.startsWith('/api/rankings/league-v2'))
        return json({ leagueId: '999', leagueName: 'Test League', season: '2026', week: 6, phase: 'regular', isDynasty: true, isSuperFlex: true, computedAt: 0, teams: [] })
      return json({ error: 'unexpected' }, 404)
    }),
  )
}

describe('power rankings: the scoring on the league card and the hub header', () => {
  it('Spanish names the scoring in Spanish, in both places', async () => {
    lang.language = 'es'
    stubLeagues('Half PPR Superflex TEP')
    render(<PowerRankingsPage />)
    const card = await screen.findByRole('button', { name: /Test League/ })
    expect(card.textContent).toContain('12 equipos · Medio PPR Superflex TEP · Temporada 2026')
    expect(card.textContent).not.toContain('Half PPR')
    fireEvent.click(card)
    expect(await screen.findByText(/· Medio PPR Superflex TEP$/)).toBeTruthy()
  })

  it('English prints the stored string', async () => {
    stubLeagues('Half PPR Superflex TEP')
    render(<PowerRankingsPage />)
    const card = await screen.findByRole('button', { name: /Test League/ })
    expect(card.textContent).toContain('12 teams · Half PPR Superflex TEP · Season 2026')
    fireEvent.click(card)
    expect(await screen.findByText(/· Half PPR Superflex TEP$/)).toBeTruthy()
  })
})

/* ── Portfolio: the scoring bars ───────────────────────────────────────────────────────────────── */

describe('portfolio: the scoring buckets', () => {
  it('Spanish translates the scoring buckets and nothing else; English is unchanged', () => {
    expect(['ppr', 'half_ppr', 'standard', 'unknown'].map((k) => bucketLabel('scoring', k, 'es'))).toEqual([
      'PPR',
      'Medio PPR',
      'Estándar',
      'Rulebook not stored',
    ])
    expect(['ppr', 'half_ppr', 'standard', 'unknown'].map((k) => bucketLabel('scoring', k, 'en'))).toEqual([
      'PPR',
      'Half PPR',
      'Standard',
      'Rulebook not stored',
    ])
    // Other dimensions are not scoring labels: the board's own words, unchanged in either language.
    expect(bucketLabel('family', 'dynasty', 'es')).toBe('Dynasty')
    expect(bucketLabel('stage', 'in_season', 'es')).toBe('In season')
  })
})
