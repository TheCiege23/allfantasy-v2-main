/**
 * Item #6 on screen: an open timeline row says what the trade does to the manager's lineup, and a
 * settled row never does.
 *
 * ⚠ RENDERED, NOT GREPPED. Every other TradeInbox suite asserts on the component's SOURCE text,
 * which would stay green if the line were computed and never mounted.
 */
import { render, screen, fireEvent } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const fetchTradesPanel = vi.fn()
vi.mock('@/components/core-app/screens/tradesPanelFetch', () => ({
  fetchTradesPanel: (...args: unknown[]) => fetchTradesPanel(...args),
}))

import { TradeInbox } from '@/components/core-app/screens/TradeInbox'
import { importedTradeTimelineRows } from '@/lib/core-app/importedTradeTimeline'

const imported = {
  transactionId: 'league:old-trade', at: new Date('2023-09-10T12:00:00Z'), rosterIds: ['1', '2'],
  players: [
    { isYou: true, manager: 'Your team', received: [{ sleeperId: 'p1', name: 'Incoming Receiver', position: 'WR' }],
      picks: ['2024 round 2'], grade: 'B', gradeBasis: 'Realized', gradeNote: 'Net 120 league points while held.' },
    { isYou: false, manager: 'Other team', received: [{ sleeperId: 'p2', name: 'Outgoing Runner', position: 'RB' }], picks: [] },
  ],
} as never

const IMPACT = {
  unit: 'league_points_week',
  week: 3,
  startingPointsBefore: 70,
  startingPointsAfter: 73.1,
  startingPointsDelta: 3.1,
  blockedReason: null,
  unpricedExcluded: 0,
  depthChanges: [{ position: 'RB', rosteredBefore: 3, rosteredAfter: 2 }],
}

function row(overrides: Record<string, unknown>) {
  return {
    id: 'r',
    direction: 'incoming',
    partnerName: 'Partner FC',
    status: 'pending',
    sent: [{ id: 'a', label: 'Out Guy' }],
    received: [{ id: 'b', label: 'In Guy' }],
    timestamp: '2026-09-15T12:00:00.000Z',
    ...overrides,
  }
}

function panel(activeTrades: unknown[], historyTrades: unknown[] = []) {
  return {
    ok: true,
    status: 200,
    data: {
      activeTrades,
      historyTrades,
      pending: { scanned: true, reason: null, platform: 'sleeper', leagueUrl: null, weeksUnanswered: 0 },
      pendingOffers: [],
    },
  }
}

describe('TradeInbox — lineup effect line', () => {
  it('renders archived completed trades with the correct sides and separates realized results from decision grades', async () => {
    fetchTradesPanel.mockResolvedValue(panel([]))
    const { container } = render(<TradeInbox leagueId="L" onLoad={() => {}} importedHistory={[imported]} />)
    const outcome = await screen.findByText(/Realized outcome: B/)
    expect(outcome.textContent).toContain('Net 120 league points while held.')
    const row = container.querySelector('.af-tc-timeline-row')!
    expect(row.textContent).toContain('Your team sentOutgoing Runner')
    expect(row.textContent).toContain('Other team sentIncoming Receiver, 2024 round 2')
    expect(row.querySelectorAll('.af-tc-timeline-grades strong')[0].textContent).toBe('—')
    expect(row.querySelectorAll('.af-tc-timeline-grades strong')[1].textContent).toBe('—')
    fireEvent.click(screen.getByRole('button', { name: 'Completed', exact: true }))
    expect(container.querySelectorAll('.af-tc-timeline-row')).toHaveLength(1)
  })
  it('does not infer send direction from multi-party received arrays', () => {
    expect(importedTradeTimelineRows([{ ...imported as object, rosterIds: ['1', '2', '3'] } as never])).toEqual([])
  })
  it('prefers the live provider timeline row when the archive has the same transaction', async () => {
    fetchTradesPanel.mockResolvedValue(panel([], [row({ id: 'sleeper:old-trade', status: 'completed_on_sleeper', partnerName: 'Current row' })]))
    const { container } = render(<TradeInbox leagueId="L" onLoad={() => {}} importedHistory={[imported]} />)
    await screen.findByText('Current row')
    expect(container.querySelectorAll('.af-tc-timeline-row')).toHaveLength(1)
  })
  beforeEach(() => {
    fetchTradesPanel.mockReset()
  })

  it('shows the gain on an open offer, with a direction for styling', async () => {
    fetchTradesPanel.mockResolvedValue(panel([row({ id: 'open', rosterImpact: IMPACT })]))
    render(<TradeInbox leagueId="L" onLoad={() => {}} />)

    const line = await screen.findByText(
      "Your projected week 3 starting lineup gains 3.1 pts under your league's scoring · roster RB −1.",
    )
    expect(line.getAttribute('data-direction')).toBe('up')
    expect(line.className).toBe('af-tc-timeline-lineup')
  })

  it('says it could not be worked out rather than saying nothing', async () => {
    fetchTradesPanel.mockResolvedValue(panel([row({ id: 'open', rosterImpact: null })]))
    render(<TradeInbox leagueId="L" onLoad={() => {}} />)

    const line = await screen.findByText('Lineup effect unavailable for this league right now.')
    expect(line.getAttribute('data-direction')).toBe('unknown')
  })

  it('renders no lineup line on a row that never asked for one', async () => {
    fetchTradesPanel.mockResolvedValue(panel([row({ id: 'open' })]))
    const { container } = render(<TradeInbox leagueId="L" onLoad={() => {}} />)

    await screen.findAllByText('Partner FC')
    expect(container.querySelector('.af-tc-timeline-lineup')).toBeNull()
  })

  it('🛑 renders no lineup line on a SETTLED row, even if the row carries one', async () => {
    /*
     * A completed or declined offer is no longer a decision. Its roster already holds the result,
     * so a "gains 3.1 pts" beside it would describe a choice the manager can no longer make.
     */
    fetchTradesPanel.mockResolvedValue(
      panel(
        [],
        [
          row({ id: 'done', status: 'completed_on_sleeper', rosterImpact: IMPACT }),
          row({ id: 'nope', status: 'rejected', rosterImpact: IMPACT }),
        ],
      ),
    )
    const { container } = render(<TradeInbox leagueId="L" onLoad={() => {}} />)

    await screen.findAllByText('Partner FC')
    // [control] both settled rows actually rendered — otherwise the absence below is vacuous.
    expect(container.querySelectorAll('.af-tc-timeline-row')).toHaveLength(2)
    expect(container.querySelector('.af-tc-timeline-lineup')).toBeNull()
  })
})
