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

import { TradeInbox, toPickedAssets } from '@/components/core-app/screens/TradeInbox'
import { assetValues, importedTradeTimelineRows, pickKey } from '@/lib/core-app/importedTradeTimeline'

const imported = {
  transactionId: 'league:old-trade', at: new Date('2023-09-10T12:00:00Z'), rosterIds: ['1', '2'],
  players: [
    { isYou: true, manager: 'Your team', received: [{ sleeperId: 'p1', name: 'Incoming Receiver', position: 'WR', headshotUrl: 'https://img.example/receiver.png' }],
      picks: ['2024 round 2'], grade: 'B', gradeBasis: 'Realized', gradeNote: 'Net 120 league points while held.' },
    { isYou: false, manager: 'Other team', received: [{ sleeperId: 'p2', name: 'Outgoing Runner', position: 'RB' }], picks: [] },
  ],
} as never

/** THE grade from `players[0]`'s side: it SENT Outgoing Runner and RECEIVED Incoming Receiver + the pick. */
const GRADE = {
  graded: true, letter: 'B', partnerLetter: 'D', percentDiff: 20, label: 'Slightly favors you', sideAdvantage: 'you',
  action: 'accept', recommendation: 'Favors you on league value.', giveValue: 4000, getValue: 5000, giveMarket: 4000, getMarket: 5000,
  basis: 'Dynasty · Superflex · 12 teams · PPR', scoringApplied: true, needApplied: false, needGap: null, moves: [],
  lines: [
    { side: 'give', name: 'Outgoing Runner', marketValue: 4000, leagueValue: 4000 },
    { side: 'get', name: 'Incoming Receiver', marketValue: 3200, leagueValue: 3200 },
    { side: 'get', name: '2024 Round 2', marketValue: 1800, leagueValue: 1800 },
  ],
}

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
  it('keeps provider-qualified player IDs when an offer is loaded into the builder', async () => {
    const asset = { playerId: '42', name: 'Same Name', position: 'DB', team: 'SEA', isPick: false, pickYear: null, pickRound: null, faabAmount: null }
    expect(toPickedAssets([asset], 'yahoo').picked[0]).toMatchObject({ playerId: null, providerIdentity: { provider: 'yahoo', id: '42', position: 'DB' } })
    expect(toPickedAssets([asset]).picked[0]).not.toHaveProperty('providerIdentity')
    const response = panel([])
    response.data.pendingOffers = [{ provider: 'sleeper', transactionId: 'offer', direction: 'incoming', partnerName: 'Partner', proposedAt: null, give: [asset], get: [] }] as never
    fetchTradesPanel.mockResolvedValue(response)
    const onLoad = vi.fn()
    render(<TradeInbox leagueId="L" onLoad={onLoad} />)
    fireEvent.click(await screen.findByRole('button', { name: /Load into builder/ }))
    expect(onLoad.mock.calls[0][0][0]).toMatchObject({ providerIdentity: { provider: 'sleeper', id: '42' } })
  })
  it('keeps a long completed history compact and allows browsing and collapsing it', async () => {
    fetchTradesPanel.mockResolvedValue(panel([], Array.from({ length: 12 }, (_, i) => row({ id: `old-${i}`, status: 'completed_on_sleeper', partnerName: `History ${i}`, timestamp: new Date(Date.UTC(2026, 8, 26 - i)).toISOString() }))))
    const { container } = render(<TradeInbox leagueId="L" onLoad={() => {}} />)
    await screen.findByText('History 0')
    expect(screen.queryByText('History 11')).toBeNull()
    expect(container.querySelectorAll('.af-tc-timeline-row')).toHaveLength(5)
    fireEvent.click(screen.getByRole('button', { name: 'Show more trades' }))
    fireEvent.click(screen.getByRole('button', { name: 'Show more trades' }))
    expect(screen.getByText('History 11')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Show fewer trades' }))
    expect(screen.queryByText('History 11')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Show more trades' }))
    fireEvent.click(screen.getByRole('button', { name: 'Completed', exact: true }))
    expect(container.querySelectorAll('.af-tc-timeline-row')).toHaveLength(5)
  })
  it('renders archived completed trades with the correct sides and separates realized results from decision grades', async () => {
    fetchTradesPanel.mockResolvedValue(panel([]))
    const { container } = render(<TradeInbox leagueId="L" onLoad={() => {}} importedHistory={[imported]} />)
    const outcome = await screen.findByText(/Realized outcome: B/)
    expect(outcome.textContent).toContain('Net 120 league points while held.')
    const row = container.querySelector('.af-tc-timeline-row')!
    const [sideA, sideB] = row.querySelectorAll('.af-tc-timeline-assets > div')
    // Each column holds what its named team RECEIVED — the KeepTradeCut "Team 1 gets…" reading.
    expect(sideA.querySelector('span')!.textContent).toBe('Your team received')
    expect([...sideA.querySelectorAll('.af-tc-timeline-asset-name b')].map((b) => b.textContent)).toEqual(['Incoming Receiver', '2024 round 2'])
    expect(sideB.querySelector('span')!.textContent).toBe('Other team received')
    expect([...sideB.querySelectorAll('.af-tc-timeline-asset-name b')].map((b) => b.textContent)).toEqual(['Outgoing Runner'])
    // No grade on the record: no letter is invented, and no value is drawn beside any asset.
    expect(row.querySelectorAll('.af-tc-timeline-grades strong')[0].textContent).toBe('—')
    expect(row.querySelectorAll('.af-tc-timeline-grades strong')[1].textContent).toBe('—')
    expect(row.querySelectorAll('.af-tc-timeline-assetlist em')).toHaveLength(0)
    fireEvent.click(screen.getByRole('button', { name: 'Completed', exact: true }))
    expect(container.querySelectorAll('.af-tc-timeline-row')).toHaveLength(1)
  })
  /*
   * 🛑 THE REGRESSION (2026-09-27): 30+ completed trades rendered "— → —" with no value on any asset
   * and no reason, while the record carried THE grade. Each team's letter, each asset's league value,
   * a headshot and the grade's own "why" must reach the screen.
   */
  it('draws each team its letter, every asset its value and face, and the grade’s reasons', async () => {
    fetchTradesPanel.mockResolvedValue(panel([]))
    const graded = { ...(imported as object), leagueGrade: GRADE } as never
    const { container } = render(<TradeInbox leagueId="L" onLoad={() => {}} importedHistory={[graded]} />)
    await screen.findByText(/Realized outcome: B/)
    const row = container.querySelector('.af-tc-timeline-row')!
    const teams = [...row.querySelectorAll('.af-tc-timeline-grades[data-mode="teams"] > div')]
    expect(teams.map((t) => [t.querySelector('span')!.textContent, t.querySelector('strong')!.textContent])).toEqual([
      ['Your team', 'B'],
      ['Other team', 'D'],
    ])
    const [sideA, sideB] = row.querySelectorAll('.af-tc-timeline-assets > div')
    // Your team's B sits over what Your team got (5,000), not over what it gave away (4,000).
    expect([...sideA.querySelectorAll('em')].map((e) => e.textContent)).toEqual(['3,200', '1,800'])
    expect([...sideB.querySelectorAll('em')].map((e) => e.textContent)).toEqual(['4,000'])
    expect(sideA.querySelector('img')!.getAttribute('src')).toBe('https://img.example/receiver.png')
    const why = row.querySelector('.af-tc-timeline-why')!.textContent!
    expect(why).toContain('Your team got the better end of it — 5,000 in league value for 4,000.')
    expect(why).toContain('Graded on this league\'s values today (Dynasty · Superflex · 12 teams · PPR).')
  })
  it('mirrors the grade when the viewer is the SECOND side of the record, so no team gets the other’s letter', async () => {
    fetchTradesPanel.mockResolvedValue(panel([]))
    const base = imported as unknown as { players: Array<Record<string, unknown>> }
    const flipped = {
      ...(imported as object),
      leagueGrade: GRADE,
      players: [{ ...base.players[0], isYou: false }, { ...base.players[1], isYou: true }],
    } as never
    const { container } = render(<TradeInbox leagueId="L" onLoad={() => {}} importedHistory={[flipped]} />)
    await screen.findByText('Other team ↔ Your team')
    const teams = [...container.querySelectorAll('.af-tc-timeline-grades[data-mode="teams"] > div')]
    expect(teams.map((t) => [t.querySelector('span')!.textContent, t.querySelector('strong')!.textContent])).toEqual([
      ['Other team', 'D'],
      ['Your team', 'B'],
    ])
    // Other team's D sits over what Other team received.
    const [sideA] = container.querySelectorAll('.af-tc-timeline-assets > div')
    expect(sideA.querySelector('span')!.textContent).toBe('Other team received')
    expect([...sideA.querySelectorAll('.af-tc-timeline-asset-name b')].map((b) => b.textContent)).toEqual(['Outgoing Runner'])
    expect([...sideA.querySelectorAll('em')].map((e) => e.textContent)).toEqual(['4,000'])
  })
  it('a withheld grade says why and draws no letter', async () => {
    fetchTradesPanel.mockResolvedValue(panel([]))
    const withheld = { ...(imported as object), leagueGrade: { graded: false, reason: '1 asset has no value on this league\'s chart', basis: null } } as never
    const { container } = render(<TradeInbox leagueId="L" onLoad={() => {}} importedHistory={[withheld]} />)
    await screen.findByText(/Not graded: 1 asset has no value/)
    expect(container.querySelector('.af-tc-timeline-grades[data-mode="teams"]')).toBeNull()
  })
  it('matches values by name, then pairs what is left one-for-one, and never guesses past that', () => {
    const lines = [
      { side: 'get' as const, name: 'Ja’Marr Chase', marketValue: 9000, leagueValue: 9100 },
      { side: 'get' as const, name: '2027 Pick 1.04', marketValue: 3000, leagueValue: 3050 },
      { side: 'give' as const, name: 'Someone Else', marketValue: 1, leagueValue: 1 },
    ]
    expect(assetValues([{ id: 'pick:0', label: '2027 round 1' }, { id: 'p', label: "Ja'Marr Chase" }], lines, 'get')).toEqual([3050, 9100])
    // Two unmatched assets against one unmatched line: no pairing, no guessed number.
    expect(assetValues([{ id: 'a', label: 'X' }, { id: 'b', label: 'Y' }], lines.slice(1), 'get')).toEqual([null, null])
    // A used pick is priced as the player drafted with it.
    expect(assetValues([{ id: 'pick:0', label: '2026 round 1', gradedAs: 'Someone Else' }], lines, 'give')).toEqual([1])
  })
  /*
   * HailShiva, CaliMike85 ↔ Manifest Destiny (reported 2026-10-01). The ledger names picks "2027 round 2",
   * the grader "2027 1st", and the two lists run in different orders — so the positional fallback put
   * the 1st's 3,034 beside the 2nd, under a sentence calling the 1st the most valuable asset.
   */
  it('prices each pick by its year and round, whatever order and spelling the two sides use', () => {
    const lines = [
      { side: 'get' as const, name: 'Malik Willis', marketValue: 2020, leagueValue: 2020 },
      { side: 'get' as const, name: 'Omar Cooper', marketValue: 1676, leagueValue: 1676 },
      { side: 'get' as const, name: 'Malachi Fields', marketValue: 1370, leagueValue: 1370 },
      { side: 'get' as const, name: '2027 1st', marketValue: 3034, leagueValue: 3034 },
      { side: 'get' as const, name: '2027 2nd', marketValue: 1559, leagueValue: 1559 },
      { side: 'get' as const, name: '2028 4th', marketValue: 804, leagueValue: 804 },
    ]
    const assets = [
      { id: 'p1', label: 'Malik Willis' },
      { id: 'p2', label: 'Omar Cooper' },
      { id: 'p3', label: 'Malachi Fields' },
      { id: 'pick:0:2027 round 2', label: '2027 round 2' },
      { id: 'pick:1:2027 round 1', label: '2027 round 1' },
      { id: 'pick:2:2028 round 4', label: '2028 round 4' },
    ]
    expect(assetValues(assets, lines, 'get')).toEqual([2020, 1676, 1370, 1559, 3034, 804])
  })
  it('reads one year and round out of every pick spelling, and none out of a player', () => {
    expect(pickKey('2027 round 1')).toBe('2027:1')
    expect(pickKey('2027 Round 12')).toBe('2027:12')
    expect(pickKey('2027 1st')).toBe('2027:1')
    expect(pickKey('2027 Mid 2nd')).toBe('2027:2')
    expect(pickKey('2028 4th')).toBe('2028:4')
    expect(pickKey('2027 Pick 1.04')).toBe('2027:1')
    expect(pickKey('Malik Willis')).toBeNull()
    expect(pickKey('2027 Pick')).toBeNull()
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
  it('keeps resolved-pick values when a live duplicate still prices the original picks', async () => {
    const resolvedGrade = { ...GRADE, letter: 'A', partnerLetter: 'F', percentDiff: 45,
      giveValue: 1456, getValue: 2631, lines: [
        { side: 'give', name: 'Zachariah Branch', marketValue: 910, leagueValue: 910 },
        { side: 'give', name: 'Chris Brazzell', marketValue: 546, leagueValue: 546 },
        { side: 'get', name: '2027 2nd', marketValue: 1584, leagueValue: 1584 },
        { side: 'get', name: '2027 3rd', marketValue: 1047, leagueValue: 1047 },
      ] }
    const history = { transactionId: 'league:pick-trade', at: new Date('2026-05-19T12:00:00Z'), rosterIds: ['1', '2'],
      leagueGrade: resolvedGrade, players: [
        { isYou: true, manager: 'You', received: [], picks: ['2027 2nd', '2027 3rd'], pickDrafted: [null, null] },
        { isYou: false, manager: 'Hoovi', received: [], picks: ['2026 2nd', '2026 3rd'], pickDrafted: ['Zachariah Branch', 'Chris Brazzell'] },
      ] } as never
    fetchTradesPanel.mockResolvedValue(panel([], [row({ id: 'sleeper:pick-trade', status: 'completed_on_sleeper',
      leagueGradeSide: 'viewer', leagueGrade: { ...GRADE, letter: 'F', partnerLetter: 'A', giveValue: 5401, getValue: 2631 },
      currentGrade: 'F', currentValueGiven: 5401, currentValueReceived: 2631 })]))
    const { container } = render(<TradeInbox leagueId="L" onLoad={() => {}} importedHistory={[history]} />)
    await screen.findByText('Partner FC')
    const trade = container.querySelector('.af-tc-timeline-row')!
    expect([...trade.querySelectorAll('.af-tc-timeline-grades strong')].map(node => node.textContent)).toEqual(['A', 'F'])
    expect(trade.textContent).toContain('Drafted Zachariah Branch')
    expect(trade.textContent).toContain('910')
    expect(trade.textContent).toContain('546')
    expect(trade.textContent).toContain('1,456')
    expect(trade.textContent).not.toContain('5,401')
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
