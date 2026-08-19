/**
 * Fantasy OS Suite — Phase V1.2: Visual OS Consistency Completion.
 *
 * Formalizes `.focus-ring` (an already-existing, already-widely-adopted design-system utility — 20+
 * usages across dashboard/referral/subscription components before this phase) as the ONE shared
 * focus-ring primitive for Decision OS surfaces, rather than inventing a new class. Proves the class is
 * actually present on the real interactive elements this phase added it to, not just documented as
 * intended.
 */
import React from 'react'
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import CommissionerLeagueSwitcher from '@/components/decision-os/CommissionerLeagueSwitcher'
import ManagerLeagueSwitcher from '@/components/decision-os/ManagerLeagueSwitcher'
import NotificationCenter from '@/components/decision-os/NotificationCenter'
import LeaguePulseCard from '@/components/decision-os/LeaguePulseCard'
import type { LeaguePulseViewModel } from '@/lib/decision-os/league-pulse'
import type { DecisionOsNotification } from '@/lib/decision-os/notifications'

const LEAGUES = [{ id: 'league-1', name: 'Test League' }]

describe('focus-ring adoption — League Switchers', () => {
  it('CommissionerLeagueSwitcher list items carry .focus-ring', () => {
    render(<CommissionerLeagueSwitcher leagues={LEAGUES} onSelect={() => {}} />)
    expect(screen.getByTestId('league-switcher-item-league-1').className).toContain('focus-ring')
  })

  it('ManagerLeagueSwitcher list items carry .focus-ring', () => {
    render(<ManagerLeagueSwitcher leagues={LEAGUES} />)
    expect(screen.getByTestId('manager-league-switcher-item-league-1').className).toContain('focus-ring')
  })
})

function makeNotification(o: Partial<DecisionOsNotification> = {}): DecisionOsNotification {
  return {
    id: 'notif-1',
    leagueId: 'league-1',
    severity: 'high',
    title: 'Test',
    body: 'Test body',
    recommendedAction: null,
    createdAt: '2026-07-10T00:00:00.000Z',
    source: 'attention_signal',
    ...o,
  } as DecisionOsNotification
}

describe('focus-ring adoption — Notification Center alert-row actions', () => {
  it('Mark read and Dismiss buttons both carry .focus-ring', () => {
    render(
      <NotificationCenter
        notifications={[makeNotification()]}
        leagueNameById={new Map([['league-1', 'Test League']])}
      />,
    )
    expect(screen.getByTestId('notification-center-mark-read-notif-1').className).toContain('focus-ring')
    expect(screen.getByTestId('notification-center-dismiss-notif-1').className).toContain('focus-ring')
  })
})

describe('focus-ring adoption — League Pulse primary recommendation action', () => {
  it('the "Continue" next-action button carries .focus-ring', () => {
    const pulse: LeaguePulseViewModel = {
      id: 'pulse-1',
      title: 'League Pulse',
      eyebrow: 'Decision OS',
      status: 'healthy',
      statusLabel: 'Healthy',
      headline: 'Steady',
      summary: 'No action needed.',
      why: 'Derived from real activity.',
      confidence: 80,
      confidenceLabel: 'High',
      evidence: [],
      derivation: [],
      metrics: [],
      nextAction: { label: 'Keep monitoring', detail: 'No action required.', href: '/somewhere' },
      lastUpdatedIso: '2026-07-10T00:00:00.000Z',
    }
    render(<LeaguePulseCard pulse={pulse} />)
    expect(screen.getByText('Continue').closest('a')?.className).toContain('focus-ring')
  })
})
