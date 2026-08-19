import React from 'react'
import { render, screen, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import LeaguePulseCard from '@/components/decision-os/LeaguePulseCard'
import {
  buildCommissionerLeaguePulse,
  buildDashboardLeaguePulse,
  buildLeagueHomePulse,
} from '@/lib/decision-os/league-pulse'
import type { CommissionerLeagueHealthSnapshot } from '@/lib/commissioner-hub/commissionerHubHealth'
import type { ManagerDnaProfile } from '@/lib/decision-os/phase6/dna/types'

const now = new Date('2026-07-01T16:00:00.000Z')

function snapshot(over: Partial<CommissionerLeagueHealthSnapshot> = {}): CommissionerLeagueHealthSnapshot {
  return {
    leagueId: 'league-1',
    leagueName: 'Test League',
    sport: 'NFL',
    leagueType: 'redraft',
    season: 2026,
    status: 'in_season',
    teamCount: 12,
    currentWeek: 4,
    generatedAt: now.toISOString(),
    source: 'database',
    dataConfidence: 'high',
    healthScore: 82,
    engagementScore: 78,
    fairnessScore: 80,
    sustainabilityScore: 84,
    overallStatus: 'healthy',
    healthTrend: 'stable',
    summary: 'Existing deterministic health summary.',
    metrics: {
      inactiveTeams: 0,
      missedLineups: 0,
      tradeActivity: 4,
      waiverActivity: 12,
      leagueEngagement: 78,
      commissionerActions: 2,
      pendingWaiverClaims: 1,
      pendingTrades: 0,
      openAiAlerts: 0,
      chatMessagesLast7Days: 18,
      activeManagers: 12,
      injuredStarters: 1,
      lineupSubmissionRate: 1,
      projectionCoveragePct: 92,
      lowConfidenceProjectionStarters: 0,
    },
    alerts: [],
    recommendations: ['Post a weekly recap.'],
    actions: [
      {
        key: 'settings',
        label: 'Review settings',
        description: 'Confirm commissioner settings before the next scoring window.',
        href: '/league/league-1/settings',
        enabled: true,
        requiresConfirmation: false,
        tone: 'standard',
      },
    ],
    assistantQuestions: [],
    nflDataCoverage: null,
    ...over,
  }
}

describe('League Pulse Decision OS premium experience', () => {
  it('uses an honest insufficient-data fallback instead of unsupported claims', () => {
    const pulse = buildDashboardLeaguePulse({ connectedLeagues: [], entryCount: 0, now })

    expect(pulse.status).toBe('insufficient-data')
    expect(pulse.insufficientData?.missing).toContain('Connected league')
    expect(pulse.derivation).toContain('Stopped before making unsupported claims')
    expect(pulse.nextAction.label).toBe('Connect a league')
  })

  it('Phase 8.3 — dashboard League Pulse surfaces real Manager DNA deterministically, same pattern as League Home/Commissioner Hub', () => {
    const baseInput = {
      now,
      connectedLeagues: [
        { id: 'league-1', name: 'Family League', sport: 'NFL', lifecycleState: 'in_season' },
      ],
      entryCount: 1,
    }
    const withoutDna = buildDashboardLeaguePulse(baseInput)

    const realDna: ManagerDnaProfile = {
      managerId: 'user-1',
      leagueId: 'league-1',
      primaryIdentity: 'serial_trader',
      confidence: 0.66,
      decisionStyle: 'reactive',
      transactionStyle: 'trade_dominant',
      riskTendency: 'risk_taking',
      engagementReliability: 'reliable',
      traits: [],
      derivation: ['trade spike pattern'],
      warnings: [],
      completeness: 80,
    }
    const withDna = buildDashboardLeaguePulse({ ...baseInput, managerDna: realDna })

    expect(withoutDna.evidence).toEqual(
      expect.not.arrayContaining([expect.objectContaining({ label: 'Manager engagement' })]),
    )
    expect(withDna.evidence).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ label: 'Manager engagement', value: '66% confidence' }),
      ]),
    )
    expect(withDna.derivation).toContain(
      'Included the real Phase 6 Manager DNA signal already resolved for this viewer',
    )
    // Deterministic: confidence is computed from the base evidence set, unaffected by the extra row.
    expect(withDna.confidence).toBe(withoutDna.confidence)
    expect(withDna.headline).toBe(withoutDna.headline)
    expect(withDna.status).toBe(withoutDna.status)

    const unknownDna: ManagerDnaProfile = { ...realDna, primaryIdentity: 'unknown', confidence: 0 }
    const withUnknownDna = buildDashboardLeaguePulse({ ...baseInput, managerDna: unknownDna })
    expect(withUnknownDna.evidence).toEqual(
      expect.not.arrayContaining([expect.objectContaining({ label: 'Manager engagement' })]),
    )
  })

  it('derives league-home risk from team ownership and standings evidence', () => {
    const pulse = buildLeagueHomePulse({
      now,
      isCommissioner: true,
      league: {
        id: 'league-1',
        name: 'Family League',
        sport: 'NFL',
        teamCount: 4,
        lifecycleState: 'in_season',
      },
      teams: [
        { id: 'team-1', teamName: 'Alpha', claimedByUserId: 'user-1', pointsFor: 600 },
        { id: 'team-2', teamName: 'Bravo', claimedByUserId: 'user-2', pointsFor: 455 },
        { id: 'team-3', teamName: 'Charlie', claimedByUserId: 'user-3', pointsFor: 410 },
        { id: 'team-4', teamName: 'Open Team', isOrphan: true, pointsFor: 390 },
      ],
    })

    expect(pulse.headline).toContain('1 manager slot')
    expect(pulse.evidence).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ label: 'Open manager slots', value: '1' }),
        expect.objectContaining({ label: 'Points spread' }),
      ]),
    )
    expect(pulse.nextAction.label).toBe('Invite managers')
    expect(pulse.confidence).toBeGreaterThanOrEqual(70)
  })

  it('Phase 8.1 — surfaces real Manager DNA as an extra evidence row when provided, without changing anything else', () => {
    const baseInput = {
      now,
      isCommissioner: true,
      league: {
        id: 'league-1',
        name: 'Family League',
        sport: 'NFL',
        teamCount: 4,
        lifecycleState: 'in_season',
      },
      teams: [
        { id: 'team-1', teamName: 'Alpha', claimedByUserId: 'user-1', pointsFor: 600 },
        { id: 'team-2', teamName: 'Bravo', claimedByUserId: 'user-2', pointsFor: 455 },
        { id: 'team-3', teamName: 'Charlie', claimedByUserId: 'user-3', pointsFor: 410 },
        { id: 'team-4', teamName: 'Open Team', isOrphan: true, pointsFor: 390 },
      ],
    }

    const withoutDna = buildLeagueHomePulse(baseInput)

    const realDna: ManagerDnaProfile = {
      managerId: 'user-1',
      leagueId: 'league-1',
      primaryIdentity: 'committed_grinder',
      confidence: 0.82,
      decisionStyle: 'decisive',
      transactionStyle: 'balanced',
      riskTendency: 'neutral',
      engagementReliability: 'reliable',
      traits: [],
      derivation: ['high engagement, no negative patterns'],
      warnings: [],
      completeness: 90,
    }
    const withDna = buildLeagueHomePulse({ ...baseInput, managerDna: realDna })

    // Omitted managerDna → byte-identical to before this ticket (no regression).
    expect(withoutDna.evidence).toEqual(
      expect.not.arrayContaining([expect.objectContaining({ label: 'Manager engagement' })]),
    )
    // Real managerDna → one additional, real evidence row — nothing else recomputed.
    expect(withDna.evidence).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ label: 'Manager engagement', value: '82% confidence' }),
      ]),
    )
    expect(withDna.derivation).toContain('Included the real Phase 6 Manager DNA signal already resolved for this viewer')
    // The core deterministic score/status/headline are UNCHANGED by adding the evidence row.
    expect(withDna.headline).toBe(withoutDna.headline)
    expect(withDna.status).toBe(withoutDna.status)

    // An 'unknown' identity (insufficient real data) must NOT be surfaced as evidence — no fabrication.
    const unknownDna: ManagerDnaProfile = { ...realDna, primaryIdentity: 'unknown', confidence: 0 }
    const withUnknownDna = buildLeagueHomePulse({ ...baseInput, managerDna: unknownDna })
    expect(withUnknownDna.evidence).toEqual(
      expect.not.arrayContaining([expect.objectContaining({ label: 'Manager engagement' })]),
    )
  })

  it('aggregates commissioner health snapshots into one action-oriented pulse', () => {
    const pulse = buildCommissionerLeaguePulse({
      now,
      snapshots: [
        snapshot(),
        snapshot({
          leagueId: 'league-2',
          healthScore: 62,
          engagementScore: 58,
          metrics: {
            ...snapshot().metrics,
            inactiveTeams: 2,
            missedLineups: 1,
            pendingTrades: 2,
          },
          alerts: ['Two teams have not set lineups.'],
        }),
      ],
    })

    expect(pulse.headline).toContain('commissioner signal')
    expect(pulse.evidence).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ label: 'Managed leagues', value: '2' }),
        expect.objectContaining({ label: 'Inactive teams', value: '2' }),
      ]),
    )
    expect(pulse.nextAction.label).toBe('Review settings')
    expect(pulse.derivation.join(' ')).toContain('deterministic commissioner health scores')
  })

  it('Phase 8.2 — commissioner League Pulse surfaces real Manager DNA the same way League Home does, deterministically', () => {
    const baseInput = { now, snapshots: [snapshot()] }
    const withoutDna = buildCommissionerLeaguePulse(baseInput)

    const realDna: ManagerDnaProfile = {
      managerId: 'user-1',
      leagueId: 'league-1',
      primaryIdentity: 'waiver_hawk',
      confidence: 0.74,
      decisionStyle: 'methodical',
      transactionStyle: 'waiver_dominant',
      riskTendency: 'neutral',
      engagementReliability: 'reliable',
      traits: [],
      derivation: ['waiver aggression streak'],
      warnings: [],
      completeness: 85,
    }
    const withDna = buildCommissionerLeaguePulse({ ...baseInput, managerDna: realDna })

    // Omitted managerDna → byte-identical to before this ticket (no regression).
    expect(withoutDna.evidence).toEqual(
      expect.not.arrayContaining([expect.objectContaining({ label: 'Manager engagement' })]),
    )
    // Real managerDna → one additional, real evidence row — nothing else recomputed.
    expect(withDna.evidence).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ label: 'Manager engagement', value: '74% confidence' }),
      ]),
    )
    expect(withDna.derivation).toContain(
      'Included the real Phase 6 Manager DNA signal already resolved for this commissioner',
    )
    // Deterministic: the aggregate health score, status, and headline are unchanged by adding the evidence row.
    expect(withDna.headline).toBe(withoutDna.headline)
    expect(withDna.status).toBe(withoutDna.status)
    expect(withDna.metrics).toEqual(withoutDna.metrics)

    // An 'unknown' identity (insufficient real data) must NOT be surfaced as evidence — no fabrication.
    const unknownDna: ManagerDnaProfile = { ...realDna, primaryIdentity: 'unknown', confidence: 0 }
    const withUnknownDna = buildCommissionerLeaguePulse({ ...baseInput, managerDna: unknownDna })
    expect(withUnknownDna.evidence).toEqual(
      expect.not.arrayContaining([expect.objectContaining({ label: 'Manager engagement' })]),
    )
  })

  it('renders confidence, evidence, decision path, and next action without raw backend ids', () => {
    const pulse = buildCommissionerLeaguePulse({ now, snapshots: [snapshot()] })

    render(<LeaguePulseCard pulse={pulse} variant="commissioner" />)

    const card = screen.getByTestId('league-pulse-card-commissioner')
    expect(within(card).getByText('League Pulse')).toBeInTheDocument()
    expect(within(card).getByText(`${pulse.confidenceLabel} confidence`)).toBeInTheDocument()
    expect(within(card).getByText('Based on')).toBeInTheDocument()
    expect(within(card).getByText('Why am I seeing this?')).toBeInTheDocument()
    expect(within(card).getByText('Decision path')).toBeInTheDocument()
    expect(within(card).getByText('Next action')).toBeInTheDocument()
    expect(card.textContent).not.toContain('league-1')
  })
})
