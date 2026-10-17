/**
 * Milestone 32 (owner decision 2026-09-29): manager characterisation is shown to
 * nobody. The product layer advertised it twice — a "Psychology AI" dashboard
 * widget ("Manager behavior and rivalry tendencies") on the dashboard and league
 * surfaces, and a "Psychological Profiles" discovery link. Neither may be offered.
 *
 * Each check has a positive control (other widgets/links are present), so it cannot
 * pass by returning nothing.
 */
import { describe, expect, it } from 'vitest'
import {
  getAIDashboardWidgetByFeatureKey,
  getAIDashboardWidgets,
  getAIDashboardWidgetsForSurface,
  getAIToolDiscoveryLinks,
  getAIToolDiscoveryLinksByCategory,
} from '@/lib/ai-product-layer'

const PSYCH = /psycholog|manager behavior/i

describe('AI product layer — no psychology widget or link', () => {
  it('no dashboard widget on any surface is a psychology widget', () => {
    const all = getAIDashboardWidgets()
    expect(all.some((w) => w.featureKey === 'trade_analyzer')).toBe(true)
    for (const surface of ['app', 'dashboard', 'league'] as const) {
      const widgets = getAIDashboardWidgetsForSurface(surface, { leagueId: 'league-1' })
      expect(widgets.length).toBeGreaterThan(0)
      expect(widgets.filter((w) => PSYCH.test(`${w.id} ${w.label} ${w.description} ${w.featureKey}`))).toEqual([])
    }
    expect(all.filter((w) => PSYCH.test(`${w.id} ${w.label} ${w.description} ${w.featureKey}`))).toEqual([])
    expect(getAIDashboardWidgetByFeatureKey('psychological_profiles')).toBeNull()
  })

  it('no discovery link is a psychology link', () => {
    const links = getAIToolDiscoveryLinks({ source: 'search' })
    expect(links.some((l) => l.featureKey === 'trade_analyzer')).toBe(true)
    expect(links.filter((l) => PSYCH.test(`${l.label} ${l.description} ${l.featureKey}`))).toEqual([])
    expect(getAIToolDiscoveryLinksByCategory('governance')).toEqual([])
  })
})
