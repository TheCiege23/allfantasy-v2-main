import { describe, expect, it } from 'vitest'
import { extractHeadline } from '../../../sdk-runtime/react/src/presentationHelpers'
import type { WidgetPresentationData } from '../../../sdk-runtime/react/src/types'
import type { SeverityDefinition } from '../../../lib/decision-os/presentation/types'

const SEVERITY: SeverityDefinition = {
  token: 'positive',
  priority: 5,
  displayColorToken: 'success',
  iconToken: 'check',
  animationToken: 'none',
}

function makeLeagueData(overrides: Partial<WidgetPresentationData> = {}): WidgetPresentationData {
  return {
    entityId: 'league_001',
    entityType: 'league',
    healthScore: 82,
    healthSeverity: SEVERITY,
    archetype: 'balanced_league',
    archetypeLabel: 'Balanced League',
    retentionRisk: 'low',
    engagementTier: 'active',
    badges: [],
    topRecommendations: [],
    metrics: [],
    benchmarkSummary: null,
    completeness: 100,
    version: '7.0.0',
    ...overrides,
  } as WidgetPresentationData
}

function makeManagerData(): WidgetPresentationData {
  return {
    entityId: 'manager_001',
    entityType: 'manager',
    healthScore: 74,
    healthSeverity: SEVERITY,
    primaryIdentity: 'strategist',
    identityLabel: 'Strategist',
    retentionRisk: 'low',
    engagementScore: 74,
    badges: [],
    topRecommendations: [],
    metrics: [],
    completeness: 100,
    version: '7.0.0',
  } as WidgetPresentationData
}

function makePlatformData(): WidgetPresentationData {
  return {
    entityId: 'platform',
    entityType: 'platform',
    platformHealthScore: 91,
    platformHealthSeverity: SEVERITY,
    platformEngagementTier: 'high',
    leagueCount: 100,
    managerCount: 1200,
    badges: [],
    topRecommendations: [],
    metrics: [],
    archetypeDistribution: [],
    interventions: [],
    completeness: 100,
    version: '7.0.0',
  } as WidgetPresentationData
}

describe('extractHeadline', () => {
  it('league: selects healthScore/healthSeverity, labels "League Health"', () => {
    const headline = extractHeadline(makeLeagueData({ healthScore: 82 }))
    expect(headline.score).toBe(82)
    expect(headline.severity).toBe(SEVERITY)
    expect(headline.label).toBe('League Health')
  })

  it('manager: selects healthScore/healthSeverity, labels "Manager Health"', () => {
    const headline = extractHeadline(makeManagerData())
    expect(headline.score).toBe(74)
    expect(headline.label).toBe('Manager Health')
  })

  it('platform: selects platformHealthScore/platformHealthSeverity, labels "Platform Health"', () => {
    const headline = extractHeadline(makePlatformData())
    expect(headline.score).toBe(91)
    expect(headline.label).toBe('Platform Health')
  })

  it('never recomputes the score — returns the exact same reference/value that arrived', () => {
    const data = makeLeagueData({ healthScore: 37 })
    const headline = extractHeadline(data)
    expect(headline.score).toBe(data.healthScore)
    expect(headline.severity).toBe((data as { healthSeverity: SeverityDefinition }).healthSeverity)
  })

  it('is deterministic', () => {
    const data = makeLeagueData()
    expect(extractHeadline(data)).toEqual(extractHeadline(data))
  })
})
