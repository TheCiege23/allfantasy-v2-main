/*
 * Your week absorbs the Command Center's Survivor signals (2026-11-14). Pins the mapping
 * (order, cap, unknown-league drop, de-dupe, tone) and that the guide renders the card only when
 * there is something in it — an account with no Survivor league sees the page exactly as before.
 */
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'

vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}))

import type { DecisionOsAttentionSignal } from '@/lib/decision-os/attentionSignals'
import { SEVERITY_RANK } from '@/lib/decision-os/attentionSignals'
import { WEEK_NEEDS_LIMIT, weekNeedsFromSignals } from '@/lib/core-app/weekNeeds'
import { WeekGuide } from '@/components/core-app/week/WeekGuide'
import type { WeekBoard } from '@/lib/core-app/weekBoard'

function signal(id: string, over: Partial<DecisionOsAttentionSignal> = {}): DecisionOsAttentionSignal {
  const severity = over.severity ?? 'medium'
  return {
    id,
    leagueId: 'L1',
    type: 'survivor_votes_due',
    severity,
    priorityScore: SEVERITY_RANK[severity],
    title: `Title ${id}`,
    explanation: `Explanation ${id}`,
    recommendedAction: null,
    timestamp: '2026-11-14T12:00:00.000Z',
    source: 'survivor',
    ...over,
  }
}

const LEAGUES = [
  { id: 'L1', name: 'Island One' },
  { id: 'L2', name: 'Island Two' },
]

describe('weekNeedsFromSignals', () => {
  it('orders by priority, labels the league and links into the shell', () => {
    const needs = weekNeedsFromSignals(
      [signal('a', { severity: 'low' }), signal('b', { severity: 'critical', leagueId: 'L2', recommendedAction: 'Cast your vote' })],
      LEAGUES,
    )
    expect(needs.map((n) => n.id)).toEqual(['b', 'a'])
    expect(needs[0]).toMatchObject({ leagueName: 'Island Two', detail: 'Cast your vote', tone: 'urgent', href: '/core?league=L2' })
    // With no recommended action the explanation is the detail, never an invented paraphrase.
    expect(needs[1]).toMatchObject({ detail: 'Explanation a', tone: 'info' })
  })

  it('drops a signal for a league the viewer does not have, and de-dupes by id', () => {
    const needs = weekNeedsFromSignals([signal('x', { leagueId: 'ELSEWHERE' }), signal('d'), signal('d')], LEAGUES)
    expect(needs.map((n) => n.id)).toEqual(['d'])
  })

  it('caps the list', () => {
    const many = Array.from({ length: WEEK_NEEDS_LIMIT + 4 }, (_, i) => signal(`s${i}`))
    expect(weekNeedsFromSignals(many, LEAGUES)).toHaveLength(WEEK_NEEDS_LIMIT)
  })
})

const BOARD = {
  week: 10,
  coinFlips: [],
  leaning: [],
  unprojected: [],
  eliminationWeeks: [],
} as unknown as WeekBoard

function renderGuide(needs: ReturnType<typeof weekNeedsFromSignals>): string {
  return renderToStaticMarkup(
    <WeekGuide board={BOARD} calendar={null} totalLeagues={2} allHref="/core/week?all=1" isCommissioner={false} needs={needs} />,
  )
}

describe('WeekGuide — Also needs you', () => {
  it('renders each signal with its league and an Open league link', () => {
    const html = renderGuide(weekNeedsFromSignals([signal('v', { recommendedAction: 'Vote before Tribal' })], LEAGUES))
    expect(html).toContain('data-testid="week-guide-needs"')
    expect(html).toContain('Also needs you')
    expect(html).toContain('Island One')
    expect(html).toContain('Vote before Tribal')
    expect(html).toContain('href="/core?league=L1"')
  })

  it('renders nothing extra when there are no signals', () => {
    expect(renderGuide([])).not.toContain('week-guide-needs')
  })
})
