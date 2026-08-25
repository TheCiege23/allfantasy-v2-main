import React from 'react'
import { describe, expect, it, vi } from 'vitest'
import { render } from '@testing-library/react'

import { DashDraftsBand } from '@/components/core-app/screens/DashDraftsBand'
import { DashUserOs } from '@/components/core-app/screens/DashUserOs'
import type { DraftHqAllData, DraftHqAllRow } from '@/lib/core-app/draftHqAll'
import type { UserOsSnapshot } from '@/lib/decision-os/userOs'

/**
 * Two bands shipped with their render-nothing rules written only in header
 * comments. A comment is not a contract, and one of these gates was CHANGED
 * this week — the user-os card could print "Inactive" about a manager from an
 * empty event store, because its gate was an OR. These pin both.
 *
 * UserOsCard is stubbed: this file is about the GATE, not the card's own
 * rendering, which has its own suite.
 */

vi.mock('@/components/decision-os/UserOsCard', () => ({
  default: ({ variant }: { variant?: string }) => (
    <div data-testid="user-os-card" data-variant={variant} />
  ),
}))

const NOW = new Date('2026-08-24T20:00:00Z')

function draft(over: Partial<DraftHqAllRow> = {}): DraftHqAllRow {
  return {
    leagueId: 'l1',
    leagueName: 'Guillotine League 26',
    platform: 'sleeper',
    imageUrl: null,
    phase: 'live',
    rawStatus: 'drafting',
    draftType: 'snake',
    rounds: 15,
    teamCount: 18,
    yourSlot: 4,
    picksMade: 22,
    pickExpiresAt: new Date(NOW.getTime() + 45 * 60_000).toISOString(),
    ...over,
  }
}

const drafts = (rows: DraftHqAllRow[]): DraftHqAllData => ({ rows }) as DraftHqAllData

describe('DashDraftsBand', () => {
  it('renders nothing when the read failed — never claims you have no drafts', () => {
    // A home that cannot read drafts must not assert there are none.
    expect(render(<DashDraftsBand data={null} now={NOW} />).container.innerHTML).toBe('')
  })

  it('renders nothing when no draft is live, whatever else is on file', () => {
    const { container } = render(
      <DashDraftsBand
        data={drafts([draft({ phase: 'upcoming' }), draft({ leagueId: 'l2', phase: 'complete' })])}
        now={NOW}
      />,
    )
    expect(container.innerHTML).toBe('')
  })

  it('shows the row’s own status rather than flattening everything to LIVE', () => {
    // A paused draft under a chip reading LIVE would be a confident lie.
    const { container } = render(
      <DashDraftsBand data={drafts([draft({ rawStatus: 'paused' })])} now={NOW} />,
    )
    expect(container.textContent).toContain('PAUSED')
  })

  it('says a timer is absent rather than inventing a countdown', () => {
    const { container } = render(
      <DashDraftsBand data={drafts([draft({ pickExpiresAt: null })])} now={NOW} />,
    )
    expect(container.textContent).toContain('no pick timer reported')
    expect(container.textContent).not.toMatch(/\d+\s?min on the pick clock/)
  })

  it('renders a coarse pick clock when the timer is real', () => {
    const { container } = render(<DashDraftsBand data={drafts([draft()])} now={NOW} />)
    expect(container.textContent).toMatch(/on the pick clock/)
  })

  it('never states a slot it does not know', () => {
    const { container } = render(
      <DashDraftsBand data={drafts([draft({ yourSlot: null, picksMade: null })])} now={NOW} />,
    )
    expect(container.textContent).not.toContain('Your slot')
    expect(container.textContent).toContain('No picks recorded yet')
  })

  it('caps the visible cards and says how many more there are', () => {
    const many = Array.from({ length: 7 }, (_, i) => draft({ leagueId: `l${i}` }))
    const { container } = render(<DashDraftsBand data={drafts(many)} now={NOW} />)
    expect(container.querySelectorAll('.af-drafts-card').length).toBe(4)
    expect(container.textContent).toContain('+3 more in Draft HQ')
  })
})

function snapshot(over: Record<string, unknown> = {}): UserOsSnapshot {
  return {
    available: true,
    activitySummary: {
      tradeEventCount: 0,
      waiverEventCount: 0,
      lineupEventCount: 0,
      draftEventCount: 0,
    },
    leagueTrend: { available: true, direction: 'decreasing' },
    ...over,
  } as unknown as UserOsSnapshot
}

describe('DashUserOs — the gate that could call a manager inactive', () => {
  it('renders nothing when the pipeline is degraded', () => {
    expect(
      render(<DashUserOs snapshot={null} leagueId="l1" leagueName="X" />).container.innerHTML,
    ).toBe('')
    expect(
      render(
        <DashUserOs snapshot={snapshot({ available: false })} leagueId="l1" leagueName="X" />,
      ).container.innerHTML,
    ).toBe('')
  })

  it('renders nothing without a league to anchor to', () => {
    const { container } = render(
      <DashUserOs snapshot={snapshot()} leagueId={null} leagueName={null} />,
    )
    expect(container.innerHTML).toBe('')
  })

  it('⚠ renders NOTHING on zero events, even when a league trend is readable', () => {
    /*
     * The bug this pins. The gate was an OR, so a readable trend alone let the
     * card through with every count at zero — and the participation chip then
     * reads "Inactive" with a warning triangle. That is a claim about the
     * MANAGER assembled from a coverage gap: the event store is nearly empty
     * in production, so zero events means "not ingested", not "did nothing".
     */
    const { container } = render(
      <DashUserOs snapshot={snapshot()} leagueId="l1" leagueName="Bla bla bla" />,
    )
    expect(container.innerHTML).toBe('')
  })

  it('renders once a single real event exists', () => {
    const { container } = render(
      <DashUserOs
        snapshot={snapshot({
          activitySummary: {
            tradeEventCount: 0,
            waiverEventCount: 0,
            lineupEventCount: 3,
            draftEventCount: 0,
          },
        })}
        leagueId="l1"
        leagueName="Bla bla bla"
      />,
    )
    expect(container.querySelector('[data-testid="user-os-card"]')).toBeTruthy()
    expect(container.textContent).toContain('Bla bla bla')
  })

  it('renders the self-view variant, not the commissioner one', () => {
    const { container } = render(
      <DashUserOs
        snapshot={snapshot({
          activitySummary: {
            tradeEventCount: 2,
            waiverEventCount: 0,
            lineupEventCount: 0,
            draftEventCount: 0,
          },
        })}
        leagueId="l1"
        leagueName="X"
      />,
    )
    expect(container.querySelector('[data-testid="user-os-card"]')?.getAttribute('data-variant')).toBe(
      'dashboard',
    )
  })
})
