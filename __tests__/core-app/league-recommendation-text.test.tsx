// @vitest-environment jsdom
/**
 * The league bar's recommendation follows the language switch (2026-10-04).
 *
 * The bar shows the top Decision OS recommendation's first action and rationale, which the manager
 * builders write in English. This suite scans those builders so a new sentence without Spanish fails
 * here, pins the assumption that the bar is fed by the MANAGER builders, and renders the real bar
 * component switching en -> es -> en.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { cleanup, render, screen } from '@testing-library/react'
import { leagueRecommendationText } from '@/lib/core-app/leagueRecommendationText'

const h = vi.hoisted(() => ({ language: 'en' as 'en' | 'es' }))
vi.mock('@/components/i18n/LanguageProviderClient', () => ({
  useOptionalLanguage: () => ({ language: h.language, setLanguage: () => {}, t: (k: string) => k }),
}))

import { CoreLeagueRecommendation } from '@/components/core-app/CoreLeagueContextBar'

afterEach(() => {
  cleanup()
  h.language = 'en'
})

const RECS = 'lib/decision-os/phase6/recommendations/recommendations.ts'

/** Every action / rationale / expectedImpact literal in the manager builders. */
function managerSentences(): string[] {
  const src = readFileSync(resolve(process.cwd(), RECS), 'utf8').replace(/\r\n/g, '\n')
  const start = src.indexOf('function buildEngagementBoost(')
  const end = src.indexOf('function buildRetentionIntervention(')
  expect(start).toBeGreaterThan(0)
  expect(end).toBeGreaterThan(start)
  const section = src.slice(start, end)
  return [...section.matchAll(/(?:action|rationale|expectedImpact)\s*:\s*(['"`])((?:\\.|(?!\1)[^\\])*?)\1/g)].map((m) => m[2]!)
}

describe('leagueRecommendationText', () => {
  it('🛑 every sentence the manager builders write has Spanish', () => {
    const sentences = managerSentences()
    expect(sentences.length).toBeGreaterThanOrEqual(40) // the scan must see the real set
    const untranslated = sentences.filter((s) => leagueRecommendationText(s, 'es') === s)
    expect(untranslated).toEqual([])
  })

  it('🛑 the bar is fed by the MANAGER builders — the set this translator covers', () => {
    const intel = readFileSync(resolve(process.cwd(), 'lib/decision-os/dashboard-intelligence.ts'), 'utf8')
    expect(intel).toMatch(/assembleManagerRecommendations\(/)
    expect(intel).not.toMatch(/assembleCommissionerRecommendations\(|assemblePlatformRecommendations\(/)
  })

  it('leaves English untouched and passes unknown text through', () => {
    expect(leagueRecommendationText('Research fair market value before proposing', 'en')).toBe('Research fair market value before proposing')
    expect(leagueRecommendationText('something new', 'es')).toBe('something new')
    expect(leagueRecommendationText(null, 'es')).toBe('')
  })
})

describe('the league bar recommendation follows en → es → en', () => {
  it('action and rationale', () => {
    const view = () => (
      <CoreLeagueRecommendation
        leagueName="Loyal Dynasty Playas!"
        surface="home"
        recommendation={{ action: 'Research fair market value before proposing', rationale: 'Reduces one-sided proposals that get rejected' }}
      />
    )
    const { rerender } = render(view())
    expect(screen.getByText('Research fair market value before proposing')).toBeTruthy()

    h.language = 'es'
    rerender(view())
    expect(screen.getByText('Investiga el valor justo de mercado antes de proponer')).toBeTruthy()
    expect(screen.getByText('Reduce las propuestas desequilibradas que terminan rechazadas')).toBeTruthy()
    expect(screen.getByRole('button').textContent).toBe('Preguntar a Chimmy')

    h.language = 'en'
    rerender(view())
    expect(screen.getByText('Reduces one-sided proposals that get rejected')).toBeTruthy()
  })
})
