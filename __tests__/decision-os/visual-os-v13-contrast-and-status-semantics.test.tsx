/**
 * Fantasy OS Suite — Phase V1.3: Visual OS Contrast and Status-Semantics Sweep.
 *
 * Two things this file proves:
 *
 * 1. The `OverallStatus` decision is enforced: `MissionControlCard.tsx` and
 *    `CommissionerHubPageClient.tsx`'s `LeagueHealthDashboard` both call the SAME shared
 *    `decisionOsHealthStatusToneClasses` for the same real domain (traced back to one function,
 *    `monitorLeagueHealth()`), rather than two independent color tables for the same real fact.
 * 2. The known light-pastel contrast classes found and fixed this phase no longer exist in the
 *    migrated source files — source-scan convention (matching `commissioner-hub-command-center-wiring.test.ts`
 *    and `commissioner-hub-league-health-tone-consolidation.test.ts`'s own approach), since several of
 *    these files are not fully rendered in tests.
 */
import fs from 'node:fs'
import path from 'node:path'
import React from 'react'
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { decisionOsHealthStatusToneClasses } from '@/components/decision-os/DecisionOsCardPrimitives'
import MissionControlCard from '@/components/decision-os/MissionControlCard'
import type { MissionControlSnapshot } from '@/lib/decision-os/missionControl'
import type { LeagueHealthResult } from '@/lib/league-health'
import type { DecisionOsLeagueHealthResult } from '@/lib/decision-os/leagueHealthAlignment'

function readSource(...segments: string[]): string {
  return fs.readFileSync(path.join(process.cwd(), ...segments), 'utf8')
}

describe('OverallStatus — one shared mapping, not two independent tables (Phase V1.3)', () => {
  it('MissionControlCard and CommissionerHubPageClient both call the same decisionOsHealthStatusToneClasses', () => {
    const missionControlSource = readSource('components', 'decision-os', 'MissionControlCard.tsx')
    const commissionerHubSource = readSource('app', 'commissioner-hub', 'CommissionerHubPageClient.tsx')

    expect(missionControlSource).toContain('decisionOsHealthStatusToneClasses(engine.overallStatus)')
    expect(commissionerHubSource).toContain('decisionOsHealthStatusToneClasses(snapshot.overallStatus)')

    // The lossy, 4-tone-collapsing version this phase retired must actually be gone, not just unused.
    expect(missionControlSource).not.toContain('OVERALL_STATUS_TONE')
    expect(missionControlSource).not.toContain('overallStatusToneClasses')
  })

  it('decisionOsHealthStatusToneClasses produces identical output for the same real status value, called independently', () => {
    for (const status of ['excellent', 'healthy', 'watch', 'at_risk', 'critical'] as const) {
      const a = decisionOsHealthStatusToneClasses(status)
      const b = decisionOsHealthStatusToneClasses(status)
      expect(a).toBe(b)
    }
  })

  it('preserves all 5 real, meaningful health states as visually distinct — the unification did not collapse the domain', () => {
    const classes = ['excellent', 'healthy', 'watch', 'at_risk', 'critical'].map((s) =>
      decisionOsHealthStatusToneClasses(s),
    )
    expect(new Set(classes).size).toBe(5)
  })
})

function makeEngine(o: Partial<LeagueHealthResult> = {}): LeagueHealthResult {
  return {
    leagueHealthScore: 70, engagementScore: 70, fairnessScore: 70, sustainabilityScore: 70,
    confidencePct: 80, overallStatus: 'healthy', biggestStrengths: [], biggestProblems: [],
    urgentAlerts: [], earlyWarningSignals: [], inactiveManagerNotes: [], transactionHealthNotes: [],
    waiverHealthNotes: [], tradeHealthNotes: [], rosterBalanceNotes: [], commissionerHealthNotes: [],
    interventionRecommendations: [], summary: 'League health: 70/100 (healthy).',
    generatedAt: '2026-07-10T12:00:00.000Z', healthTrend: 'stable', churnRiskScore: 10, disputeRiskScore: 0,
    abandonmentRiskScore: 0, engagementDropoffFlags: [], ...o,
  }
}

function makeSnapshot(o: Partial<MissionControlSnapshot> = {}): MissionControlSnapshot {
  const engine = makeEngine()
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
    leagueId: 'league-v13', generatedAt: '2026-07-10T12:00:00.000Z',
    leagueHealth: { available: true, result }, trend: { available: false, reason: 'no_snapshots' },
    managerCounts: { activeManagers: 10, inactiveManagers: 0 },
    activity: { tradeCount: 3, waiverClaimCount: 12, draftPickCount: 0, rosterActivityCount: 8 },
    managersAtRetentionRisk: [],
    recommendedActions: [{ priority: 'urgent', message: 'ALERT: real urgent action.' }],
    fieldProvenance: result.fieldProvenance,
    ...o,
  }
}

describe('MissionControlCard — urgent-priority badge uses the shared tone system (Phase V1.3)', () => {
  it('renders the urgent badge readable, routed through decisionOsToneClasses, not a hardcoded rose-300', () => {
    render(<MissionControlCard snapshot={makeSnapshot()} />)
    const badge = screen.getByText('urgent')
    expect(badge.className).not.toContain('rose-300')
    expect(badge.className).toContain('status-danger')
  })
})

describe('Phase V1.3 retired low-contrast classes — source-scan (files not fully rendered in tests)', () => {
  const RETIRED_PATTERNS = [
    'text-amber-300', 'text-emerald-300', 'text-violet-300', 'text-cyan-300', 'text-rose-300',
  ]

  it('CommissionerHubPageClient.tsx no longer USES (as opposed to documents in a comment) any retired light-pastel text class', () => {
    const source = readSource('app', 'commissioner-hub', 'CommissionerHubPageClient.tsx')
    const codeOnly = source
      .split('\n')
      .map((line) => line.replace(/\/\/.*/, ''))
      .join('\n')
      .replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
    for (const pattern of RETIRED_PATTERNS) {
      expect(codeOnly).not.toContain(`"${pattern}`)
      expect(codeOnly).not.toContain(` ${pattern}"`)
      expect(codeOnly).not.toContain(` ${pattern} `)
    }
  })

  it('LeagueTab.tsx no longer USES (as opposed to documents in a comment) the retired amber-50/amber-200/cyan-300/yellow-100 value classes', () => {
    const source = readSource('app', 'league', '[leagueId]', 'tabs', 'LeagueTab.tsx')
    // Strip `//` line comments before asserting, so this test can't false-positive on the phase's own
    // explanatory comments (which deliberately quote the retired class names for documentation).
    const codeOnly = source
      .split('\n')
      .map((line) => line.replace(/\/\/.*/, ''))
      .join('\n')
    expect(codeOnly).not.toContain('text-amber-50/95')
    expect(codeOnly).not.toContain('text-amber-200"')
    expect(codeOnly).not.toContain("'text-cyan-300'")
    expect(codeOnly).not.toContain('text-yellow-100')
  })

  it('LeagueContextCard.tsx, TodaysBriefCard.tsx, and both command-center error banners no longer use text-rose-300/text-emerald-300', () => {
    const files = [
      ['components', 'decision-os', 'LeagueContextCard.tsx'],
      ['components', 'decision-os', 'TodaysBriefCard.tsx'],
      ['components', 'decision-os', 'CommissionerCommandCenterSection.tsx'],
      ['components', 'decision-os', 'ManagerCommandCenterSection.tsx'],
    ]
    for (const segments of files) {
      const source = readSource(...segments)
      expect(source).not.toContain('text-rose-300')
      expect(source).not.toContain('text-emerald-300')
    }
  })

  it('NotificationCenter.tsx unread-count badge uses text-content-inverse, not the theme-broken text-white', () => {
    const source = readSource('components', 'decision-os', 'NotificationCenter.tsx')
    expect(source).toContain('text-content-inverse')
    expect(source).not.toMatch(/text-white"/)
  })
})

describe('Phase V1.3 — focus-ring coverage not regressed', () => {
  it('every file touched this phase that had .focus-ring in V1.2 still has it', () => {
    const files = [
      ['app', 'commissioner-hub', 'CommissionerHubPageClient.tsx'],
      ['app', 'league', '[leagueId]', 'tabs', 'LeagueTab.tsx'],
      ['components', 'decision-os', 'NotificationCenter.tsx'],
    ]
    for (const segments of files) {
      const source = readSource(...segments)
      expect(source).toContain('focus-ring')
    }
  })
})
