import { describe, expect, it } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import React from 'react'

import NotificationCenter from '@/components/decision-os/NotificationCenter'
import { notificationFromSignal } from '@/lib/decision-os/notifications'
import { SEVERITY_RANK, type DecisionOsAttentionSignal } from '@/lib/decision-os/attentionSignals'

const NOW = new Date('2026-07-09T12:00:00Z')

function signal(o: Partial<DecisionOsAttentionSignal> & Pick<DecisionOsAttentionSignal, 'id' | 'leagueId' | 'severity' | 'type'>): DecisionOsAttentionSignal {
  return {
    priorityScore: SEVERITY_RANK[o.severity],
    title: 'Title',
    explanation: 'Explanation text',
    recommendedAction: null,
    timestamp: NOW.toISOString(),
    source: 'league_health_engine',
    ...o,
  }
}

const LEAGUE_NAMES = new Map([['league-1', 'Dynasty Warriors']])

describe('NotificationCenter', () => {
  it('renders an honest empty state and no unread badge when there are no notifications', () => {
    render(<NotificationCenter notifications={[]} leagueNameById={LEAGUE_NAMES} />)
    expect(screen.getByTestId('notification-center-empty')).toBeInTheDocument()
    expect(screen.queryByTestId('notification-center-unread-count')).not.toBeInTheDocument()
  })

  it('renders real notifications with league name, body, recommended action, and a unique id-based test-id', () => {
    const n = notificationFromSignal(
      signal({ id: 'a', leagueId: 'league-1', severity: 'high', type: 'low_league_health', explanation: 'Overall status is at_risk.', recommendedAction: 'Review League Health.' }),
    )
    render(<NotificationCenter notifications={[n]} leagueNameById={LEAGUE_NAMES} />)

    const item = screen.getByTestId(`notification-center-item-${n.id}`)
    expect(item).toHaveAttribute('data-severity', 'high')
    expect(item).toHaveTextContent('Dynasty Warriors')
    expect(item).toHaveTextContent('Overall status is at_risk.')
    expect(item).toHaveTextContent('Review League Health.')
    expect(screen.getByTestId('notification-center-unread-count')).toHaveTextContent('1')
  })

  it('gives two notifications that share a severity distinct, non-colliding test-ids', () => {
    const a = notificationFromSignal(signal({ id: 'a', leagueId: 'league-1', severity: 'high', type: 'low_league_health' }))
    const b = notificationFromSignal(signal({ id: 'b', leagueId: 'league-1', severity: 'high', type: 'draft_approaching' }))
    render(<NotificationCenter notifications={[a, b]} leagueNameById={LEAGUE_NAMES} />)

    expect(screen.getByTestId(`notification-center-item-${a.id}`)).toBeInTheDocument()
    expect(screen.getByTestId(`notification-center-item-${b.id}`)).toBeInTheDocument()
  })

  it('renders "All leagues" for a notification with no leagueId (a daily brief notification)', () => {
    const n = notificationFromSignal(signal({ id: 'a', leagueId: 'league-1', severity: 'high', type: 'low_league_health' }))
    render(<NotificationCenter notifications={[{ ...n, leagueId: null }]} leagueNameById={LEAGUE_NAMES} />)
    expect(screen.getByTestId(`notification-center-item-${n.id}`)).toHaveTextContent('All leagues')
  })

  it('marking a notification read decrements the unread count and removes the "mark read" button', () => {
    const n = notificationFromSignal(signal({ id: 'a', leagueId: 'league-1', severity: 'high', type: 'low_league_health' }))
    render(<NotificationCenter notifications={[n]} leagueNameById={LEAGUE_NAMES} />)

    expect(screen.getByTestId('notification-center-unread-count')).toHaveTextContent('1')
    fireEvent.click(screen.getByTestId(`notification-center-mark-read-${n.id}`))

    expect(screen.queryByTestId('notification-center-unread-count')).not.toBeInTheDocument()
    expect(screen.queryByTestId(`notification-center-mark-read-${n.id}`)).not.toBeInTheDocument()
    // Still visible, just marked read — dismissing is a separate action.
    expect(screen.getByTestId(`notification-center-item-${n.id}`)).toBeInTheDocument()
  })

  it('dismissing a notification removes it from the list and shows the empty state once none remain', () => {
    const n = notificationFromSignal(signal({ id: 'a', leagueId: 'league-1', severity: 'high', type: 'low_league_health' }))
    render(<NotificationCenter notifications={[n]} leagueNameById={LEAGUE_NAMES} />)

    fireEvent.click(screen.getByTestId(`notification-center-dismiss-${n.id}`))

    expect(screen.queryByTestId(`notification-center-item-${n.id}`)).not.toBeInTheDocument()
    expect(screen.getByTestId('notification-center-empty')).toBeInTheDocument()
  })

  it('shows a formatted timestamp derived from the notification\'s real createdAt', () => {
    const n = notificationFromSignal(signal({ id: 'a', leagueId: 'league-1', severity: 'high', type: 'low_league_health', timestamp: '2026-03-05T12:00:00Z' }))
    render(<NotificationCenter notifications={[n]} leagueNameById={LEAGUE_NAMES} />)
    expect(screen.getByTestId(`notification-center-item-${n.id}`)).toHaveTextContent('Mar 5')
  })

  it('counts only genuinely unread, non-dismissed notifications in the unread badge', () => {
    const a = notificationFromSignal(signal({ id: 'a', leagueId: 'league-1', severity: 'critical', type: 'low_league_health' }))
    const b = notificationFromSignal(signal({ id: 'b', leagueId: 'league-1', severity: 'high', type: 'draft_approaching' }))
    render(<NotificationCenter notifications={[a, b]} leagueNameById={LEAGUE_NAMES} />)

    expect(screen.getByTestId('notification-center-unread-count')).toHaveTextContent('2')
    fireEvent.click(screen.getByTestId(`notification-center-mark-read-${a.id}`))
    expect(screen.getByTestId('notification-center-unread-count')).toHaveTextContent('1')
  })
})
