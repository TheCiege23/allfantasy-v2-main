import React from 'react'
import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'

import { ReceiptsCard } from '@/components/core-app/screens/ReceiptsCard'
import type { DecisionReceiptsData } from '@/lib/core-app/decisionReceipts'
import { hasFeatureAccessForPlans } from '@/lib/subscription/feature-access'
import { CORE_DEPTH } from '@/lib/core-app/coreDepthAccess'

/*
 * The home Receipts card's link to the full log (owner, 2026-11-28). The summary stays free; the link
 * goes to /core/decisions (My Decisions, AF Pro + AF Supreme — `decision_log_history`), which draws its
 * own lock from the server's paywall read. When the server says locked, the link names the plan, so a
 * free viewer sees a lock — not a page that fails.
 */

const data: DecisionReceiptsData = {
  trades: [
    {
      id: 't1', leagueId: 'af-1', leagueName: 'Ice Kings', season: '2026', week: 3, createdIso: '2026-09-10T00:00:00.000Z',
      counterparty: 'Gridiron Vultures', got: ['Jahmyr Gibbs'], gave: ['Sam LaPorta'], gotPoints: 88.4, gavePoints: 20,
      netPoints: 68.4, outcome: 'ahead', ongoing: false, unsettledPicks: 0, href: '/core/trades?league=af-1',
    },
  ],
  tooEarly: 0,
  uncoveredLeagues: 0,
}

describe('Receipts card → the full decision log', () => {
  it('the summary is free and always links to /core/decisions', () => {
    render(<ReceiptsCard data={data} />)
    const link = screen.getByTestId('receipts-full-log-link')
    expect(link.getAttribute('href')).toBe('/core/decisions')
    expect(link.getAttribute('data-locked')).toBeNull()
    expect(link.textContent).toContain('See all your decisions')
    expect(screen.getByText('+68.4 pts')).toBeTruthy()
  })

  it('locked (server read): the link shows the lock and names the plan that opens it', () => {
    render(<ReceiptsCard data={data} fullLog={{ unlocked: false, planName: 'AF Pro' }} />)
    const link = screen.getByTestId('receipts-full-log-link')
    expect(link.getAttribute('href')).toBe('/core/decisions')
    expect(link.getAttribute('data-locked')).toBe('true')
    expect(link.textContent).toContain('🔒')
    expect(link.textContent).toContain('AF Pro — see all your decisions')
  })

  it('unlocked: the plain link, no lock', () => {
    render(<ReceiptsCard data={data} fullLog={{ unlocked: true, planName: 'AF Pro' }} />)
    const link = screen.getByTestId('receipts-full-log-link')
    expect(link.getAttribute('data-locked')).toBeNull()
    expect(link.textContent).not.toContain('🔒')
  })

  it('the lock it shows is the My Decisions rule: AF Pro and AF Supreme only', () => {
    expect(CORE_DEPTH.decision_history.featureId).toBe('decision_log_history')
    const opens = (plans: Parameters<typeof hasFeatureAccessForPlans>[0]) =>
      hasFeatureAccessForPlans(plans, plans.length ? 'active' : 'none', 'decision_log_history')
    expect([opens([]), opens(['pro']), opens(['commissioner']), opens(['war_room']), opens(['supreme'])]).toEqual([
      false, true, false, false, true,
    ])
  })
})
