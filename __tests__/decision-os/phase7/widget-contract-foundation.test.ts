/**
 * Decision OS — Phase 7.3 Widget Contract Foundation tests.
 *
 * Covers: all 8 widget modes, tier restrictions, degraded states, API call
 * mapping, telemetry events, layout hints, privacy restrictions, validation
 * errors, deterministic ordering, no internal leakage.
 */

import { describe, expect, it } from 'vitest'
import {
  WIDGET_CONTRACT_VERSION,
  validateWidgetConfig,
  mapWidgetModeToApiCall,
  resolveAllowedSections,
  filterSectionsByTier,
  resolveWidgetLayoutHints,
  resolveWidgetPrivacyRestrictions,
  buildWidgetDegradedState,
  buildWidgetTelemetryEvent,
} from '../../../lib/decision-os/presentation/widget-contracts'
import type {
  WidgetConfig,
  WidgetMode,
  WidgetSection,
  WidgetDegradedReason,
  WidgetTelemetryEventType,
} from '../../../lib/decision-os/presentation/widget-contracts'
import type { IntelligenceTier } from '../../../lib/decision-os/behavioral/api/contracts'

// ── Fixtures ──────────────────────────────────────────────────────────────────

function makeTenant(overrides: Partial<WidgetConfig['tenantConfig']> = {}): WidgetConfig['tenantConfig'] {
  return {
    tenantId: 'tenant_abc123',
    apiKey: 'sk_live_very_secret_key',
    allowedOrigins: ['https://app.example.com'],
    rateLimitPerMinute: 60,
    featureFlags: {
      enableBenchmarkComparison: true,
      enableArchetypeLabel: true,
      enableBehavioralPatterns: true,
      enableCompanyIntelligence: false,
    },
    whiteLabelPlatform: null,
    ...overrides,
  }
}

function makeConfig(
  mode: WidgetMode,
  entityType: WidgetConfig['entityType'],
  entityId = 'entity_001',
  tenantOverrides: Partial<WidgetConfig['tenantConfig']> = {},
): WidgetConfig {
  return {
    mode,
    entityId,
    entityType,
    tenantConfig: makeTenant(tenantOverrides),
    presentationVersion: '7.0.0',
  }
}

// ── Version ───────────────────────────────────────────────────────────────────

describe('WIDGET_CONTRACT_VERSION', () => {
  it('is 7.3.0', () => {
    expect(WIDGET_CONTRACT_VERSION).toBe('7.3.0')
  })
})

// ── validateWidgetConfig — valid modes ────────────────────────────────────────

describe('validateWidgetConfig — all 8 modes produce valid results', () => {
  const validCases: Array<[WidgetMode, WidgetConfig['entityType']]> = [
    ['compact',        'league'],
    ['compact',        'manager'],
    ['compact',        'platform'],
    ['sidebar',        'league'],
    ['full_dashboard', 'league'],
    ['popup',          'league'],
    ['commissioner',   'league'],
    ['manager',        'manager'],
    ['mobile',         'league'],
    ['mobile',         'manager'],
    ['partner',        'league'],
  ]

  for (const [mode, entityType] of validCases) {
    it(`${mode}/${entityType} is valid`, () => {
      const result = validateWidgetConfig(makeConfig(mode, entityType))
      expect(result.valid).toBe(true)
      expect(result.errors).toHaveLength(0)
      expect(result.resolvedMode).toBe(mode)
      expect(result.resolvedEntityType).toBe(entityType)
    })
  }
})

// ── validateWidgetConfig — mode × entityType incompatibility ──────────────────

describe('validateWidgetConfig — invalid mode/entityType combos', () => {
  const invalidCases: Array<[WidgetMode, WidgetConfig['entityType']]> = [
    ['sidebar',        'manager'],
    ['sidebar',        'platform'],
    ['popup',          'manager'],
    ['popup',          'platform'],
    ['commissioner',   'manager'],
    ['commissioner',   'platform'],
    ['manager',        'league'],
    ['manager',        'platform'],
    ['full_dashboard', 'manager'],
  ]

  for (const [mode, entityType] of invalidCases) {
    it(`${mode}/${entityType} produces error`, () => {
      const result = validateWidgetConfig(makeConfig(mode, entityType))
      expect(result.valid).toBe(false)
      expect(result.errors.length).toBeGreaterThan(0)
      expect(result.errors.some(e => e.includes('entityType'))).toBe(true)
    })
  }
})

// ── validateWidgetConfig — missing required fields ────────────────────────────

describe('validateWidgetConfig — required fields', () => {
  it('errors on empty entityId', () => {
    const config = makeConfig('compact', 'league', '')
    const result = validateWidgetConfig(config)
    expect(result.valid).toBe(false)
    expect(result.errors.some(e => e.includes('entityId'))).toBe(true)
  })

  it('errors on empty tenantId', () => {
    const config = makeConfig('compact', 'league', 'e1', { tenantId: '' })
    const result = validateWidgetConfig(config)
    expect(result.valid).toBe(false)
    expect(result.errors.some(e => e.includes('tenantId'))).toBe(true)
  })

  it('errors on empty apiKey', () => {
    const config = makeConfig('compact', 'league', 'e1', { apiKey: '' })
    const result = validateWidgetConfig(config)
    expect(result.valid).toBe(false)
    expect(result.errors.some(e => e.includes('apiKey'))).toBe(true)
  })

  it('errors on rateLimitPerMinute < 1', () => {
    const config = makeConfig('compact', 'league', 'e1', { rateLimitPerMinute: 0 })
    const result = validateWidgetConfig(config)
    expect(result.valid).toBe(false)
    expect(result.errors.some(e => e.includes('rateLimitPerMinute'))).toBe(true)
  })
})

// ── validateWidgetConfig — no API key leakage ─────────────────────────────────

describe('validateWidgetConfig — security: no apiKey in output', () => {
  it('does not surface apiKey in validation result', () => {
    const config = makeConfig('commissioner', 'league', 'l1', {
      apiKey: 'sk_live_super_secret',
    })
    const result = validateWidgetConfig(config)
    const serialized = JSON.stringify(result)
    expect(serialized).not.toContain('sk_live_super_secret')
    expect(serialized).not.toContain('apiKey')
  })

  it('does not surface tenantId in allowedSections', () => {
    const config = makeConfig('commissioner', 'league')
    const result = validateWidgetConfig(config)
    const serialized = JSON.stringify(result)
    expect(serialized).not.toContain('tenant_abc123')
  })
})

// ── validateWidgetConfig — warnings ──────────────────────────────────────────

describe('validateWidgetConfig — warnings', () => {
  it('warns when partner mode has no whiteLabelPlatform', () => {
    const config = makeConfig('partner', 'league', 'l1', { whiteLabelPlatform: null })
    const result = validateWidgetConfig(config)
    expect(result.valid).toBe(true) // warning, not error
    expect(result.warnings.some(w => w.includes('whiteLabelPlatform'))).toBe(true)
  })

  it('warns on unexpected presentationVersion', () => {
    const config: WidgetConfig = {
      ...makeConfig('compact', 'league'),
      presentationVersion: '6.0.0',
    }
    const result = validateWidgetConfig(config)
    expect(result.valid).toBe(true)
    expect(result.warnings.some(w => w.includes('6.0.0'))).toBe(true)
  })

  it('no warning when whiteLabelPlatform is set for partner', () => {
    const config = makeConfig('partner', 'league', 'l1', { whiteLabelPlatform: 'sleeper' })
    const result = validateWidgetConfig(config)
    expect(result.warnings.some(w => w.includes('whiteLabelPlatform'))).toBe(false)
  })
})

// ── resolveAllowedSections — mode sections ────────────────────────────────────

describe('resolveAllowedSections — mode section maps', () => {
  it('compact includes health_score and badges', () => {
    const sections = resolveAllowedSections('compact')
    expect(sections).toContain('health_score')
    expect(sections).toContain('badges')
  })

  it('compact does NOT include retention_card or commissioner_workload', () => {
    const sections = resolveAllowedSections('compact')
    expect(sections).not.toContain('retention_card')
    expect(sections).not.toContain('commissioner_workload')
    expect(sections).not.toContain('benchmark_comparison')
  })

  it('sidebar includes health_score, retention_card, recommendations, metrics_grid, badges', () => {
    const sections = resolveAllowedSections('sidebar')
    expect(sections).toContain('health_score')
    expect(sections).toContain('retention_card')
    expect(sections).toContain('recommendations')
    expect(sections).toContain('metrics_grid')
    expect(sections).toContain('badges')
  })

  it('full_dashboard includes all 14 sections', () => {
    const sections = resolveAllowedSections('full_dashboard')
    const all: WidgetSection[] = [
      'health_score', 'retention_card', 'commissioner_workload', 'recommendations',
      'metrics_grid', 'archetype_label', 'benchmark_comparison', 'behavioral_patterns',
      'dna_identity', 'activity_heatmap', 'intervention_list', 'company_intelligence',
      'badges', 'graphs',
    ]
    for (const s of all) {
      expect(sections).toContain(s)
    }
  })

  it('popup includes only health_score, recommendations, badges', () => {
    const sections = resolveAllowedSections('popup')
    expect(sections).toContain('health_score')
    expect(sections).toContain('recommendations')
    expect(sections).toContain('badges')
    expect(sections).not.toContain('benchmark_comparison')
    expect(sections).not.toContain('retention_card')
    expect(sections).not.toContain('dna_identity')
  })

  it('commissioner includes commissioner_workload and archetype_label', () => {
    const sections = resolveAllowedSections('commissioner')
    expect(sections).toContain('commissioner_workload')
    expect(sections).toContain('archetype_label')
    expect(sections).toContain('retention_card')
    expect(sections).not.toContain('benchmark_comparison')
    expect(sections).not.toContain('dna_identity')
  })

  it('manager includes behavioral_patterns and dna_identity', () => {
    const sections = resolveAllowedSections('manager')
    expect(sections).toContain('behavioral_patterns')
    expect(sections).toContain('dna_identity')
    expect(sections).not.toContain('retention_card')
    expect(sections).not.toContain('commissioner_workload')
    expect(sections).not.toContain('benchmark_comparison')
  })

  it('mobile includes health_score, recommendations, badges only', () => {
    const sections = resolveAllowedSections('mobile')
    expect(sections).toContain('health_score')
    expect(sections).toContain('recommendations')
    expect(sections).toContain('badges')
    expect(sections.length).toBeLessThanOrEqual(4)
  })

  it('partner includes health_score and recommendations', () => {
    const sections = resolveAllowedSections('partner')
    expect(sections).toContain('health_score')
    expect(sections).toContain('recommendations')
  })
})

// ── resolveAllowedSections — determinism ─────────────────────────────────────

describe('resolveAllowedSections — determinism', () => {
  const modes: WidgetMode[] = [
    'compact', 'sidebar', 'full_dashboard', 'popup', 'commissioner', 'manager', 'mobile', 'partner',
  ]

  for (const mode of modes) {
    it(`${mode} returns same array on repeated calls`, () => {
      const a = resolveAllowedSections(mode)
      const b = resolveAllowedSections(mode)
      expect(a).toEqual(b)
    })
  }
})

// ── filterSectionsByTier — tier gates ────────────────────────────────────────

describe('filterSectionsByTier', () => {
  const allSections: WidgetSection[] = [
    'health_score', 'retention_card', 'commissioner_workload', 'recommendations',
    'metrics_grid', 'archetype_label', 'benchmark_comparison', 'behavioral_patterns',
    'dna_identity', 'activity_heatmap', 'intervention_list', 'company_intelligence',
    'badges', 'graphs',
  ]

  it('basic tier: only health_score and badges pass', () => {
    const result = filterSectionsByTier(allSections, 'basic')
    expect(result).toContain('health_score')
    expect(result).toContain('badges')
    expect(result).not.toContain('retention_card')
    expect(result).not.toContain('commissioner_workload')
    expect(result).not.toContain('benchmark_comparison')
    expect(result).not.toContain('behavioral_patterns')
    expect(result).not.toContain('dna_identity')
  })

  it('commissioner tier: includes retention_card, archetype_label, metrics_grid', () => {
    const result = filterSectionsByTier(allSections, 'commissioner')
    expect(result).toContain('health_score')
    expect(result).toContain('badges')
    expect(result).toContain('retention_card')
    expect(result).toContain('commissioner_workload')
    expect(result).toContain('archetype_label')
    expect(result).toContain('metrics_grid')
    expect(result).toContain('recommendations')
    expect(result).toContain('graphs')
    // Platform-only sections blocked
    expect(result).not.toContain('benchmark_comparison')
    expect(result).not.toContain('activity_heatmap')
    expect(result).not.toContain('intervention_list')
    expect(result).not.toContain('company_intelligence')
    // Manager-only sections blocked
    expect(result).not.toContain('behavioral_patterns')
    expect(result).not.toContain('dna_identity')
  })

  it('manager tier: includes behavioral_patterns and dna_identity', () => {
    const result = filterSectionsByTier(allSections, 'manager')
    expect(result).toContain('health_score')
    expect(result).toContain('badges')
    expect(result).toContain('behavioral_patterns')
    expect(result).toContain('dna_identity')
    expect(result).toContain('recommendations')
    expect(result).toContain('metrics_grid')
    expect(result).toContain('graphs')
    // Platform-only sections blocked
    expect(result).not.toContain('benchmark_comparison')
    expect(result).not.toContain('activity_heatmap')
    // Commissioner-only sections blocked for manager tier
    expect(result).not.toContain('retention_card')
    expect(result).not.toContain('commissioner_workload')
    expect(result).not.toContain('archetype_label')
  })

  it('platform tier: all sections pass', () => {
    const result = filterSectionsByTier(allSections, 'platform')
    expect(result).toHaveLength(allSections.length)
    for (const s of allSections) {
      expect(result).toContain(s)
    }
  })

  it('preserves input order', () => {
    const input: WidgetSection[] = ['badges', 'health_score', 'retention_card']
    const result = filterSectionsByTier(input, 'commissioner')
    expect(result[0]).toBe('badges')
    expect(result[1]).toBe('health_score')
    expect(result[2]).toBe('retention_card')
  })

  it('is deterministic', () => {
    const sections = resolveAllowedSections('commissioner')
    const a = filterSectionsByTier(sections, 'commissioner')
    const b = filterSectionsByTier(sections, 'commissioner')
    expect(a).toEqual(b)
  })

  it('benchmark_comparison requires platform tier specifically', () => {
    const tiers: IntelligenceTier[] = ['basic', 'commissioner', 'manager']
    for (const tier of tiers) {
      const result = filterSectionsByTier(['benchmark_comparison'], tier)
      expect(result).toHaveLength(0)
    }
    const platform = filterSectionsByTier(['benchmark_comparison'], 'platform')
    expect(platform).toContain('benchmark_comparison')
  })
})

// ── mapWidgetModeToApiCall ────────────────────────────────────────────────────

describe('mapWidgetModeToApiCall', () => {
  it('returns null for invalid config', () => {
    const config = makeConfig('sidebar', 'manager') // invalid entityType for sidebar
    expect(mapWidgetModeToApiCall(config)).toBeNull()
  })

  it('commissioner mode → /api/v1/intelligence/league', () => {
    const call = mapWidgetModeToApiCall(makeConfig('commissioner', 'league', 'l_123'))
    expect(call).not.toBeNull()
    expect(call!.endpoint).toBe('/api/v1/intelligence/league')
    expect(call!.view).toBe('presentation')
    expect(call!.requiredScopes).toContain('intelligence:league:read')
  })

  it('manager mode → /api/v1/intelligence/manager', () => {
    const call = mapWidgetModeToApiCall(makeConfig('manager', 'manager', 'm_456'))
    expect(call).not.toBeNull()
    expect(call!.endpoint).toBe('/api/v1/intelligence/manager')
    expect(call!.requiredScopes).toContain('intelligence:manager:read')
  })

  it('compact/league → /api/v1/intelligence/league', () => {
    const call = mapWidgetModeToApiCall(makeConfig('compact', 'league', 'l_x'))
    expect(call!.endpoint).toBe('/api/v1/intelligence/league')
    expect(call!.queryParams['view']).toBe('presentation')
  })

  it('compact/manager → /api/v1/intelligence/manager', () => {
    const call = mapWidgetModeToApiCall(makeConfig('compact', 'manager', 'm_y'))
    expect(call!.endpoint).toBe('/api/v1/intelligence/manager')
    expect(call!.requiredScopes).toContain('intelligence:manager:read')
  })

  it('compact/platform → /api/v1/intelligence/platform', () => {
    const call = mapWidgetModeToApiCall(makeConfig('compact', 'platform', 'platform'))
    expect(call!.endpoint).toBe('/api/v1/intelligence/platform')
    expect(call!.requiredScopes).toContain('intelligence:platform:basic')
  })

  it('sidebar → /api/v1/intelligence/league', () => {
    const call = mapWidgetModeToApiCall(makeConfig('sidebar', 'league', 'l_1'))
    expect(call!.endpoint).toBe('/api/v1/intelligence/league')
  })

  it('popup → /api/v1/intelligence/league', () => {
    const call = mapWidgetModeToApiCall(makeConfig('popup', 'league', 'l_2'))
    expect(call!.endpoint).toBe('/api/v1/intelligence/league')
  })

  it('mobile/league → /api/v1/intelligence/league', () => {
    const call = mapWidgetModeToApiCall(makeConfig('mobile', 'league', 'l_3'))
    expect(call!.endpoint).toBe('/api/v1/intelligence/league')
  })

  it('mobile/manager → /api/v1/intelligence/manager', () => {
    const call = mapWidgetModeToApiCall(makeConfig('mobile', 'manager', 'm_3'))
    expect(call!.endpoint).toBe('/api/v1/intelligence/manager')
  })

  it('all calls use view=presentation', () => {
    const modes: Array<[WidgetMode, WidgetConfig['entityType']]> = [
      ['compact', 'league'],
      ['sidebar', 'league'],
      ['popup', 'league'],
      ['commissioner', 'league'],
      ['manager', 'manager'],
      ['mobile', 'league'],
    ]
    for (const [mode, entityType] of modes) {
      const call = mapWidgetModeToApiCall(makeConfig(mode, entityType))
      expect(call).not.toBeNull()
      expect(call!.view).toBe('presentation')
    }
  })

  it('is deterministic — same config produces same call', () => {
    const config = makeConfig('commissioner', 'league', 'l_123')
    const a = mapWidgetModeToApiCall(config)
    const b = mapWidgetModeToApiCall(config)
    expect(a).toEqual(b)
  })

  it('does not expose apiKey in return value', () => {
    const config = makeConfig('commissioner', 'league', 'l_1', { apiKey: 'sk_live_do_not_expose' })
    const call = mapWidgetModeToApiCall(config)
    const serialized = JSON.stringify(call)
    expect(serialized).not.toContain('sk_live_do_not_expose')
    expect(serialized).not.toContain('apiKey')
  })
})

// ── resolveWidgetLayoutHints ──────────────────────────────────────────────────

describe('resolveWidgetLayoutHints', () => {
  it('compact: maxWidthPx <= 320, minWidthPx >= 120', () => {
    const hints = resolveWidgetLayoutHints('compact')
    expect(hints.minWidthPx).toBeGreaterThanOrEqual(120)
    expect(hints.maxWidthPx).not.toBeNull()
    expect(hints.maxWidthPx!).toBeLessThanOrEqual(320)
    expect(hints.scrollable).toBe(false)
  })

  it('sidebar: maxWidthPx <= 400, scrollable', () => {
    const hints = resolveWidgetLayoutHints('sidebar')
    expect(hints.scrollable).toBe(true)
    expect(hints.maxWidthPx).not.toBeNull()
    expect(hints.maxWidthPx!).toBeLessThanOrEqual(400)
  })

  it('full_dashboard: scrollable, no maxHeight constraint', () => {
    const hints = resolveWidgetLayoutHints('full_dashboard')
    expect(hints.scrollable).toBe(true)
    expect(hints.maxHeightPx).toBeNull()
  })

  it('popup: not scrollable, bounded height', () => {
    const hints = resolveWidgetLayoutHints('popup')
    expect(hints.scrollable).toBe(false)
    expect(hints.maxHeightPx).not.toBeNull()
  })

  it('commissioner: scrollable, min 400px wide', () => {
    const hints = resolveWidgetLayoutHints('commissioner')
    expect(hints.scrollable).toBe(true)
    expect(hints.minWidthPx).toBeGreaterThanOrEqual(400)
  })

  it('mobile: not scrollable, max 420px wide', () => {
    const hints = resolveWidgetLayoutHints('mobile')
    expect(hints.scrollable).toBe(false)
    expect(hints.maxWidthPx).not.toBeNull()
    expect(hints.maxWidthPx!).toBeLessThanOrEqual(420)
  })

  it('all modes have at least one breakpoint', () => {
    const modes: WidgetMode[] = [
      'compact', 'sidebar', 'full_dashboard', 'popup', 'commissioner', 'manager', 'mobile', 'partner',
    ]
    for (const mode of modes) {
      const hints = resolveWidgetLayoutHints(mode)
      expect(hints.breakpoints.length).toBeGreaterThan(0)
    }
  })

  it('hints contain no CSS class names', () => {
    const modes: WidgetMode[] = [
      'compact', 'sidebar', 'full_dashboard', 'popup', 'commissioner', 'manager', 'mobile', 'partner',
    ]
    for (const mode of modes) {
      const serialized = JSON.stringify(resolveWidgetLayoutHints(mode))
      expect(serialized).not.toMatch(/\b(flex|grid|block|inline|px-|py-|w-|h-|text-)\b/)
    }
  })
})

// ── resolveWidgetPrivacyRestrictions ──────────────────────────────────────────

describe('resolveWidgetPrivacyRestrictions', () => {
  it('partner mode: anonymizes manager + league IDs, requires consent banner', () => {
    const privacy = resolveWidgetPrivacyRestrictions('partner')
    expect(privacy.anonymizeManagerIds).toBe(true)
    expect(privacy.anonymizeLeagueIds).toBe(true)
    expect(privacy.requireConsentBanner).toBe(true)
    expect(privacy.suppressAbsoluteEventCounts).toBe(true)
  })

  it('commissioner mode: does not anonymize (commissioner sees their own league)', () => {
    const privacy = resolveWidgetPrivacyRestrictions('commissioner')
    expect(privacy.anonymizeManagerIds).toBe(false)
    expect(privacy.anonymizeLeagueIds).toBe(false)
  })

  it('full_dashboard mode: no event count suppression', () => {
    const privacy = resolveWidgetPrivacyRestrictions('full_dashboard')
    expect(privacy.suppressAbsoluteEventCounts).toBe(false)
  })

  it('compact mode: suppresses absolute event counts', () => {
    const privacy = resolveWidgetPrivacyRestrictions('compact')
    expect(privacy.suppressAbsoluteEventCounts).toBe(true)
    expect(privacy.maxEntitiesExposed).toBe(1)
  })

  it('manager mode: manager sees own identity (no manager anonymization)', () => {
    const privacy = resolveWidgetPrivacyRestrictions('manager')
    expect(privacy.anonymizeManagerIds).toBe(false)
  })
})

// ── buildWidgetDegradedState ──────────────────────────────────────────────────

describe('buildWidgetDegradedState', () => {
  const reasons: WidgetDegradedReason[] = [
    'insufficient_data',
    'unauthorized',
    'unavailable',
    'rate_limited',
    'config_invalid',
    'version_mismatch',
  ]

  for (const reason of reasons) {
    it(`${reason}: isDegraded=true, non-empty fallbackMessage`, () => {
      const state = buildWidgetDegradedState(reason, 50)
      expect(state.isDegraded).toBe(true)
      expect(state.reason).toBe(reason)
      expect(state.fallbackMessage.length).toBeGreaterThan(0)
      expect(state.completeness).toBe(50)
    })
  }

  it('unauthorized and config_invalid are not retryable', () => {
    expect(buildWidgetDegradedState('unauthorized', 0).retryable).toBe(false)
    expect(buildWidgetDegradedState('config_invalid', 0).retryable).toBe(false)
    expect(buildWidgetDegradedState('version_mismatch', 0).retryable).toBe(false)
  })

  it('insufficient_data, unavailable, rate_limited are retryable', () => {
    expect(buildWidgetDegradedState('insufficient_data', 30).retryable).toBe(true)
    expect(buildWidgetDegradedState('unavailable', 0).retryable).toBe(true)
    expect(buildWidgetDegradedState('rate_limited', 0).retryable).toBe(true)
  })

  it('clamps completeness to [0, 100]', () => {
    expect(buildWidgetDegradedState('unavailable', -5).completeness).toBe(0)
    expect(buildWidgetDegradedState('unavailable', 150).completeness).toBe(100)
  })

  it('is deterministic', () => {
    const a = buildWidgetDegradedState('unauthorized', 0)
    const b = buildWidgetDegradedState('unauthorized', 0)
    expect(a).toEqual(b)
  })

  it('fallbackMessage does not contain internal Decision OS terminology', () => {
    const internalTerms = ['behavioral', 'leagueBehavioral', 'managerBehavioral', 'platformBehavioral', 'derivedAt', 'lookbackDays']
    for (const reason of reasons) {
      const state = buildWidgetDegradedState(reason, 0)
      for (const term of internalTerms) {
        expect(state.fallbackMessage).not.toContain(term)
      }
    }
  })
})

// ── buildWidgetTelemetryEvent ─────────────────────────────────────────────────

describe('buildWidgetTelemetryEvent', () => {
  it('produces correct widgetId', () => {
    const config = makeConfig('commissioner', 'league', 'l_101')
    const event = buildWidgetTelemetryEvent(config, 'impression')
    expect(event.widgetId).toBe('widget_l_101_commissioner')
  })

  it('stamps contractVersion as WIDGET_CONTRACT_VERSION', () => {
    const event = buildWidgetTelemetryEvent(makeConfig('compact', 'league'), 'impression')
    expect(event.contractVersion).toBe(WIDGET_CONTRACT_VERSION)
  })

  it('tenantIdHash is not the raw tenantId', () => {
    const config = makeConfig('sidebar', 'league', 'l_x', { tenantId: 'my_raw_tenant_id' })
    const event = buildWidgetTelemetryEvent(config, 'impression')
    expect(event.tenantIdHash).not.toBe('my_raw_tenant_id')
    expect(event.tenantIdHash.length).toBeGreaterThan(0)
  })

  it('tenantIdHash is deterministic for same tenantId', () => {
    const config = makeConfig('sidebar', 'league', 'l_x', { tenantId: 'deterministic_id' })
    const a = buildWidgetTelemetryEvent(config, 'impression')
    const b = buildWidgetTelemetryEvent(config, 'impression', { timestamp: a.timestamp })
    expect(a.tenantIdHash).toBe(b.tenantIdHash)
  })

  it('tenantIdHash differs for different tenantIds', () => {
    const config1 = makeConfig('sidebar', 'league', 'l_x', { tenantId: 'tenant_aaa' })
    const config2 = makeConfig('sidebar', 'league', 'l_x', { tenantId: 'tenant_bbb' })
    const h1 = buildWidgetTelemetryEvent(config1, 'impression').tenantIdHash
    const h2 = buildWidgetTelemetryEvent(config2, 'impression').tenantIdHash
    expect(h1).not.toBe(h2)
  })

  it('does not expose apiKey in event', () => {
    const config = makeConfig('manager', 'manager', 'm_1', { apiKey: 'sk_live_secret_key' })
    const event = buildWidgetTelemetryEvent(config, 'impression')
    const serialized = JSON.stringify(event)
    expect(serialized).not.toContain('sk_live_secret_key')
    expect(serialized).not.toContain('apiKey')
  })

  it('accepts all eventType values', () => {
    const eventTypes: WidgetTelemetryEventType[] = [
      'impression', 'interaction', 'error', 'degraded', 'upgrade_prompt',
    ]
    const config = makeConfig('compact', 'league')
    for (const eventType of eventTypes) {
      const event = buildWidgetTelemetryEvent(config, eventType)
      expect(event.eventType).toBe(eventType)
    }
  })

  it('errorCode defaults to null', () => {
    const event = buildWidgetTelemetryEvent(makeConfig('compact', 'league'), 'impression')
    expect(event.errorCode).toBeNull()
  })

  it('errorCode is set when provided', () => {
    const event = buildWidgetTelemetryEvent(makeConfig('compact', 'league'), 'error', {
      errorCode: 'INTELLIGENCE_UNAVAILABLE',
    })
    expect(event.errorCode).toBe('INTELLIGENCE_UNAVAILABLE')
  })

  it('interactionTarget defaults to null', () => {
    const event = buildWidgetTelemetryEvent(makeConfig('commissioner', 'league'), 'impression')
    expect(event.interactionTarget).toBeNull()
  })

  it('interactionTarget is set when provided', () => {
    const event = buildWidgetTelemetryEvent(makeConfig('commissioner', 'league'), 'interaction', {
      interactionTarget: 'recommendations',
    })
    expect(event.interactionTarget).toBe('recommendations')
  })

  it('clamps completeness to [0, 100]', () => {
    const over = buildWidgetTelemetryEvent(makeConfig('compact', 'league'), 'impression', { completeness: 200 })
    const under = buildWidgetTelemetryEvent(makeConfig('compact', 'league'), 'impression', { completeness: -10 })
    expect(over.completeness).toBe(100)
    expect(under.completeness).toBe(0)
  })

  it('accepts custom timestamp', () => {
    const ts = '2026-07-01T12:00:00.000Z'
    const event = buildWidgetTelemetryEvent(makeConfig('compact', 'league'), 'impression', { timestamp: ts })
    expect(event.timestamp).toBe(ts)
  })

  it('sectionsRendered is empty by default', () => {
    const event = buildWidgetTelemetryEvent(makeConfig('compact', 'league'), 'impression')
    expect(event.sectionsRendered).toEqual([])
  })

  it('sectionsRendered passes through provided sections', () => {
    const sections: WidgetSection[] = ['health_score', 'badges']
    const event = buildWidgetTelemetryEvent(makeConfig('compact', 'league'), 'impression', {
      sectionsRendered: sections,
    })
    expect(event.sectionsRendered).toEqual(sections)
  })

  it('event output contains no internal Decision OS field names', () => {
    const event = buildWidgetTelemetryEvent(makeConfig('commissioner', 'league'), 'impression')
    const serialized = JSON.stringify(event)
    const internalTerms = ['derivedAt', 'lookbackDays', 'leagueBehavioral', 'managerBehavioral', 'platformBehavioral', 'behavioralIntelligence']
    for (const term of internalTerms) {
      expect(serialized).not.toContain(term)
    }
  })
})

// ── No React / CSS / Tailwind in contracts ────────────────────────────────────

describe('widget-contracts.ts — no frontend dependencies', () => {
  it('has no Tailwind class strings in sections or degraded states', () => {
    const reasons: WidgetDegradedReason[] = [
      'insufficient_data', 'unauthorized', 'unavailable', 'rate_limited', 'config_invalid', 'version_mismatch',
    ]
    for (const reason of reasons) {
      const state = buildWidgetDegradedState(reason, 0)
      const serialized = JSON.stringify(state)
      expect(serialized).not.toMatch(/\b(text-|bg-|border-|flex|grid|px-|py-)\b/)
    }
  })

  it('resolveAllowedSections returns only WidgetSection strings', () => {
    const sections = resolveAllowedSections('full_dashboard')
    const validSections: WidgetSection[] = [
      'health_score', 'retention_card', 'commissioner_workload', 'recommendations',
      'metrics_grid', 'archetype_label', 'benchmark_comparison', 'behavioral_patterns',
      'dna_identity', 'activity_heatmap', 'intervention_list', 'company_intelligence',
      'badges', 'graphs',
    ]
    for (const s of sections) {
      expect(validSections).toContain(s)
    }
  })
})

// ── validateWidgetConfig — resolves correct sections and scopes ───────────────

describe('validateWidgetConfig — resolves allowedSections and requiredScopes', () => {
  it('commissioner config resolves commissioner-scope sections', () => {
    const result = validateWidgetConfig(makeConfig('commissioner', 'league'))
    expect(result.allowedSections).toContain('commissioner_workload')
    expect(result.allowedSections).toContain('retention_card')
    expect(result.requiredScopes).toContain('intelligence:league:read')
  })

  it('manager config resolves manager-scope sections', () => {
    const result = validateWidgetConfig(makeConfig('manager', 'manager'))
    expect(result.allowedSections).toContain('behavioral_patterns')
    expect(result.allowedSections).toContain('dna_identity')
    expect(result.requiredScopes).toContain('intelligence:manager:read')
  })

  it('compact/platform config resolves platform:basic scope', () => {
    const result = validateWidgetConfig(makeConfig('compact', 'platform'))
    expect(result.requiredScopes).toContain('intelligence:platform:basic')
  })

  it('full_dashboard/league config resolves league:read scope', () => {
    const result = validateWidgetConfig(makeConfig('full_dashboard', 'league'))
    expect(result.requiredScopes).toContain('intelligence:league:read')
  })
})
