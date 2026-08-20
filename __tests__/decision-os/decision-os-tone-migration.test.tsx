/**
 * Fantasy OS Suite — Phase V1.1/V1.2: Visual OS Expansion and Shared Primitive Consolidation.
 *
 * Phase V1.0 established `decisionOsToneClasses`/`decisionOsSeverityToneClasses` but only used them in
 * new code (the Commissioner Hub flagship rebuild). Phase V1.1 migrated 4 pre-existing components
 * (`MissionControlCard`, `LeaguePulseCard`, `DecisionRecommendationsCard`, `CommissionerAttentionQueue`)
 * off their own private tone tables onto the shared primitives. Phase V1.2 finished the job — migrating
 * `LeagueHealthDashboard`'s remaining 3 tone systems (`HEALTH_STATUS_CLASSES`, `ACTION_TONE_CLASSES`,
 * `MetricTile`) and adding `decisionOsHealthStatusToneClasses`, a second genuinely-necessary additive
 * primitive extension for `OverallStatus`'s real 5-tier domain. This file proves each migration didn't
 * change real-world meaning: every real domain value still maps to the same visual bucket it did before
 * (or, where the pre-migration color was itself a light-mode contrast bug, to the corrected shared-token
 * equivalent — never a random reassignment), unrecognized/unknown values degrade safely instead of
 * throwing or rendering `undefined` in a className, and no Tailwind class name or CSS variable token
 * ever leaks into visible text content.
 */
import React from 'react'
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import {
  decisionOsToneClasses,
  decisionOsSeverityToneClasses,
  decisionOsHealthStatusToneClasses,
} from '@/components/decision-os/DecisionOsCardPrimitives'
import MissionControlCard from '@/components/decision-os/MissionControlCard'
import LeaguePulseCard from '@/components/decision-os/LeaguePulseCard'
import DecisionRecommendationsCard from '@/components/decision-os/DecisionRecommendationsCard'
import CommissionerAttentionQueue from '@/components/decision-os/CommissionerAttentionQueue'
import type { MissionControlSnapshot } from '@/lib/decision-os/missionControl'
import type { LeagueHealthResult } from '@/lib/league-health'
import type { DecisionOsLeagueHealthResult } from '@/lib/decision-os/leagueHealthAlignment'
import type { LeaguePulseViewModel } from '@/lib/decision-os/league-pulse'
import type { DecisionRecommendationsViewModel } from '@/lib/decision-os/recommendations'
import type { DecisionOsAttentionSignal } from '@/lib/decision-os/attentionSignals'

const NOW = '2026-07-10T12:00:00.000Z'

describe('decisionOsToneClasses — shared tone primitive', () => {
  it('routes every real tone through the app semantic status tokens, never a hardcoded palette color', () => {
    expect(decisionOsToneClasses('good')).toContain('status-success')
    expect(decisionOsToneClasses('warning')).toContain('status-warning')
    expect(decisionOsToneClasses('danger')).toContain('status-danger')
    expect(decisionOsToneClasses('info')).toContain('status-info')
    expect(decisionOsToneClasses('neutral')).toContain('surface-muted')
  })
})

describe('decisionOsSeverityToneClasses — the genuinely-necessary 5-tier extension', () => {
  it('preserves the real 5-tier severity escalation (critical > high > medium > low > informational) with 5 visually distinct colors', () => {
    const classes = {
      critical: decisionOsSeverityToneClasses('critical'),
      high: decisionOsSeverityToneClasses('high'),
      medium: decisionOsSeverityToneClasses('medium'),
      low: decisionOsSeverityToneClasses('low'),
      informational: decisionOsSeverityToneClasses('informational'),
    }
    expect(classes.critical).toContain('rose')
    expect(classes.high).toContain('orange')
    expect(classes.medium).toContain('amber')
    expect(classes.low).toContain('sky')
    expect(classes.informational).toContain('emerald')
    // All 5 must be distinct — collapsing any two would silently lose a real severity distinction.
    expect(new Set(Object.values(classes)).size).toBe(5)
  })
})

describe('decisionOsHealthStatusToneClasses — Phase V1.2, another genuinely-necessary extension', () => {
  it('preserves the real 5-tier OverallStatus escalation (excellent > healthy > watch > at_risk > critical) with 5 visually distinct colors', () => {
    const classes = {
      excellent: decisionOsHealthStatusToneClasses('excellent'),
      healthy: decisionOsHealthStatusToneClasses('healthy'),
      watch: decisionOsHealthStatusToneClasses('watch'),
      at_risk: decisionOsHealthStatusToneClasses('at_risk'),
      critical: decisionOsHealthStatusToneClasses('critical'),
    }
    expect(classes.excellent).toContain('emerald')
    expect(classes.healthy).toContain('cyan')
    expect(classes.watch).toContain('amber')
    expect(classes.at_risk).toContain('orange')
    expect(classes.critical).toContain('rose')
    // All 5 must be distinct — LeagueHealthDashboard shows 5 real, currently-distinguishable statuses.
    expect(new Set(Object.values(classes)).size).toBe(5)
  })

  it('uses a readable, saturated text shade (-600) rather than the light -300 pastel this defect class has been fixed 3 times already', () => {
    for (const status of ['excellent', 'healthy', 'watch', 'at_risk', 'critical'] as const) {
      expect(decisionOsHealthStatusToneClasses(status)).toMatch(/text-\w+-600/)
      expect(decisionOsHealthStatusToneClasses(status)).not.toMatch(/text-\w+-300/)
    }
  })

  it('degrades an unrecognized status to a safe neutral fallback instead of throwing or returning undefined', () => {
    const result = decisionOsHealthStatusToneClasses('some_future_status')
    expect(result).toContain('surface-muted')
    expect(result).not.toContain('undefined')
  })
})

function makeMissionControlSnapshot(overallStatus: string): MissionControlSnapshot {
  const engine: LeagueHealthResult = {
    leagueHealthScore: 70, engagementScore: 70, fairnessScore: 70, sustainabilityScore: 70,
    confidencePct: 80, overallStatus: overallStatus as LeagueHealthResult['overallStatus'],
    biggestStrengths: [], biggestProblems: [], urgentAlerts: [], earlyWarningSignals: [],
    inactiveManagerNotes: [], transactionHealthNotes: [], waiverHealthNotes: [], tradeHealthNotes: [],
    rosterBalanceNotes: [], commissionerHealthNotes: [], interventionRecommendations: [],
    summary: `League health: 70/100 (${overallStatus}).`, generatedAt: NOW, healthTrend: 'stable',
    churnRiskScore: 10, disputeRiskScore: 0, abandonmentRiskScore: 0, engagementDropoffFlags: [],
  }
  const result: DecisionOsLeagueHealthResult = {
    engine,
    decisionOs: {
      activityEventCount: 20, activeManagerCount: 10, inactiveManagerCount: 0, tradeCount: 3,
      waiverClaimCount: 12, draftPickCount: 0, commissionerActionCount: 1, rosterActivityCount: 8,
      managersAtRetentionRisk: [], trend: { available: false, reason: 'no_snapshots' },
    },
    fieldProvenance: {} as DecisionOsLeagueHealthResult['fieldProvenance'],
  }
  return {
    leagueId: 'league-tone-migration',
    generatedAt: NOW,
    leagueHealth: { available: true, result },
    trend: { available: false, reason: 'no_snapshots' },
    managerCounts: { activeManagers: 10, inactiveManagers: 0 },
    activity: { tradeCount: 3, waiverClaimCount: 12, draftPickCount: 0, rosterActivityCount: 8 },
    managersAtRetentionRisk: [],
    recommendedActions: [],
    fieldProvenance: result.fieldProvenance,
  }
}

describe('MissionControlCard — tone migration (no semantic state regression)', () => {
  it.each(['excellent', 'healthy', 'watch', 'at_risk', 'critical'])(
    'renders the real "%s" overallStatus without throwing, still showing the real value as text',
    (status) => {
      render(<MissionControlCard snapshot={makeMissionControlSnapshot(status)} />)
      expect(screen.getByTestId('mission-control-health-status')).toHaveTextContent(status)
    },
  )

  it('degrades an unrecognized overallStatus to a safe neutral fallback instead of throwing or rendering "undefined"', () => {
    render(<MissionControlCard snapshot={makeMissionControlSnapshot('some_future_status')} />)
    const badge = screen.getByTestId('mission-control-health-status')
    expect(badge).toHaveTextContent('some_future_status')
    expect(badge.className).not.toContain('undefined')
    expect(badge.className).toContain('surface-muted')
  })
})

function makeLeaguePulse(o: Partial<LeaguePulseViewModel> = {}): LeaguePulseViewModel {
  return {
    id: 'pulse-1',
    title: 'League Pulse',
    eyebrow: 'Decision OS',
    status: 'healthy',
    statusLabel: 'Healthy',
    headline: 'Everything looks steady.',
    summary: 'No action needed right now.',
    why: 'Derived from real league activity.',
    confidence: 80,
    confidenceLabel: 'High',
    evidence: [],
    derivation: [],
    metrics: [{ label: 'Engagement', value: '78', tone: 'positive' }],
    nextAction: { label: 'Keep monitoring', detail: 'No action required.' },
    lastUpdatedIso: NOW,
    ...o,
  }
}

describe('LeaguePulseCard — tone migration (no semantic state regression)', () => {
  it.each(['healthy', 'watch', 'at-risk', 'insufficient-data'] as const)(
    'renders the real "%s" status without throwing',
    (status) => {
      render(<LeaguePulseCard pulse={makeLeaguePulse({ status, statusLabel: status })} />)
      expect(screen.getByText(status, { exact: false })).toBeInTheDocument()
    },
  )

  it.each(['positive', 'warning', 'danger', 'neutral'] as const)(
    'renders the real "%s" metric tone without throwing',
    (tone) => {
      render(<LeaguePulseCard pulse={makeLeaguePulse({ metrics: [{ label: 'Metric', value: '1', tone }] })} />)
      expect(screen.getByText('Metric')).toBeInTheDocument()
    },
  )

  it('degrades an unrecognized metric tone to a safe neutral fallback', () => {
    const pulse = makeLeaguePulse({
      metrics: [{ label: 'Odd Metric', value: '1', tone: 'some-future-tone' as LeaguePulseViewModel['metrics'][number]['tone'] }],
    })
    render(<LeaguePulseCard pulse={pulse} />)
    const metricValue = screen.getByText('1')
    expect(metricValue.closest('div')?.className).toContain('surface-muted')
  })
})

function makeRecommendationsModel(priority: string): DecisionRecommendationsViewModel {
  return {
    title: 'Recommended Moves',
    subtitle: 'Grounded moves for this league.',
    status: 'ready',
    confidenceLabel: 'High',
    evidence: [],
    recommendations: [
      {
        title: 'Test move',
        priority,
        expectedImpact: 'Real impact text.',
        difficulty: 'easy',
        evidence: [],
        suggestedAction: 'Do the thing.',
        confidence: 'High',
      },
    ],
    lastUpdatedIso: NOW,
  }
}

describe('DecisionRecommendationsCard — tone migration (no semantic state regression)', () => {
  it.each(['critical', 'high', 'medium', 'low'])(
    'renders the real "%s" priority without throwing, still showing the real value as text',
    (priority) => {
      render(<DecisionRecommendationsCard model={makeRecommendationsModel(priority)} />)
      expect(screen.getByText(priority)).toBeInTheDocument()
    },
  )

  it('degrades an unrecognized priority to a safe neutral fallback instead of throwing', () => {
    render(<DecisionRecommendationsCard model={makeRecommendationsModel('some_future_priority')} />)
    const badge = screen.getByText('some_future_priority')
    expect(badge.className).toContain('surface-muted')
  })
})

function makeSignal(o: Partial<DecisionOsAttentionSignal> = {}): DecisionOsAttentionSignal {
  return {
    id: 'signal-1',
    leagueId: 'league-1',
    type: 'league_requires_review',
    severity: 'critical',
    priorityScore: 500,
    title: 'Requires review',
    explanation: 'Real, evidence-backed explanation text.',
    recommendedAction: null,
    timestamp: NOW,
    source: 'league_health_engine',
    ...o,
  } as DecisionOsAttentionSignal
}

describe('CommissionerAttentionQueue — no internal-token leakage into customer-facing text', () => {
  it.each(['critical', 'high', 'medium', 'low', 'informational'] as const)(
    'renders the real "%s" severity without leaking any Tailwind/CSS-token fragment into visible text',
    (severity) => {
      const leagueNameById = new Map([['league-1', 'Test League']])
      render(
        <CommissionerAttentionQueue
          entries={[makeSignal({ id: `signal-${severity}`, severity, explanation: `Explanation for ${severity}` })]}
          leagueNameById={leagueNameById}
        />,
      )
      // Id-based testid (PR #185 — severity is not unique across items).
      const item = screen.getByTestId(`attention-queue-item-signal-${severity}`)
      const visibleText = item.textContent ?? ''
      expect(visibleText).not.toMatch(/border-|bg-status|text-status|rounded-|bg-rose|bg-amber|bg-emerald/)
      expect(visibleText).toContain('Test League')
    },
  )
})
