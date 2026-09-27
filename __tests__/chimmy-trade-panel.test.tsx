import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { ChimmyTrades } from '@/components/core-app/comms/ChimmyTrades'
import { importedTradeTimelineRows } from '@/lib/core-app/importedTradeTimeline'
afterEach(() => { cleanup(); vi.unstubAllGlobals() })

/*
 * 🛑 THE ONE GRADE IN CHIMMY'S TRADE ANSWERS (2026-09-27). Completed trades here showed the REALIZED
 * letter — the second grade retired from every other surface — a graded provider trade read "Grade
 * unavailable", and the Ask-Chimmy question never carried the grade, so the answer was not anchored
 * to it. Pinned below.
 */
const ONE_GRADE = {
  graded: true, letter: 'D', partnerLetter: 'B', percentDiff: -25, label: 'Slightly favors opponent', sideAdvantage: 'opponent',
  action: 'counter', recommendation: 'x', giveValue: 2000, getValue: 1500, giveMarket: 2000, getMarket: 1500,
  basis: 'Dynasty · 12 teams', scoringApplied: true, needApplied: false, needGap: null, moves: [],
  lines: [
    { side: 'give', name: 'Woody Marks', marketValue: 2000, leagueValue: 2000 },
    { side: 'get', name: '2027 Round 3', marketValue: 1500, leagueValue: 1500 },
  ],
}
const GRADED_ROWS = importedTradeTimelineRows([{
  transactionId: 'SL1:tx-77', season: 2026, week: 2, rosterIds: ['1', '2'], yourSide: 'unknown', playersIn: 0, playersOut: 1, picks: 1,
  partnerTeamName: null, at: new Date('2026-05-22T12:00:00Z'),
  players: [
    { manager: 'Hoovi', isYou: false, received: [], picks: ['2027 round 3'] },
    { manager: 'Nicolodeon', isYou: false, received: [{ sleeperId: 'wm', name: 'Woody Marks', position: 'RB', team: 'HOU' }], picks: [] },
  ],
  leagueGrade: ONE_GRADE,
} as never])
/** The realized-points ledger for the same trade: Hoovi's side REALIZED an "A" — which must not be drawn. */
const LEDGER = { supported: true, grades: { fetchedAt: '2026-09-20T00:00:00Z', staleAsOf: null, missing: [], trades: [{
  id: 'SL1:tx-77', season: '2026', week: 2, hasPendingPicks: false,
  sides: [
    { rosterId: 1, managerName: 'Hoovi', teamName: 'Hoovi', ownerId: null, currentGrade: 'A', cumulativeNet: 17.8,
      playersIn: [], playersOut: [{ name: 'Woody Marks', creditedBySeason: { '2026': 12 } }], picksIn: [{ label: '2027 3rd', resolved: null }], picksOut: [] },
    { rosterId: 2, managerName: 'Nicolodeon', teamName: 'Nicolodeon', ownerId: null, currentGrade: 'F', cumulativeNet: -17.8,
      playersIn: [{ name: 'Woody Marks', creditedBySeason: { '2026': 12 } }], playersOut: [], picksIn: [], picksOut: [] },
  ],
}] } }

function stubPanel(over: { center?: Record<string, unknown>; ledger?: unknown } = {}) {
  const fetcher = vi.fn(async (url: string) => ({ ok: true, json: async () =>
    url.includes('trades-panel') ? { activeTrades: [], historyTrades: [], ...over.center }
      : url.includes('view=') ? { proposals: [], nextCursor: null }
        : over.ledger ?? { supported: false } }))
  vi.stubGlobal('fetch', fetcher)
  return fetcher
}

it('shows each team’s ONE grade on completed trades, realized points as a fact, and never the realized letter', async () => {
  const onAsk = vi.fn()
  const fetcher = stubPanel({ center: { importedHistory: { rows: GRADED_ROWS, available: true } }, ledger: LEDGER })
  render(<ChimmyTrades leagueId="league" onAsk={onAsk} />)
  fireEvent.click(screen.getByRole('button', { name: /Trade intelligence/ }))
  await screen.findByText('League grade: Hoovi D · Nicolodeon B')
  expect(fetcher.mock.calls.some(([url]) => url.includes('trades-panel') && url.includes('history=1'))).toBe(true)
  expect(screen.getByText('Hoovi sent: Woody Marks (2,000)')).toBeTruthy()
  expect(screen.getByText('Nicolodeon sent: 2027 round 3 (1,500)')).toBeTruthy()
  expect(screen.getByText('Nicolodeon got the better end — Hoovi got 1,500 in league value for 2,000.')).toBeTruthy()
  expect(screen.getByText(/Realized so far: Hoovi net 17\.8 fantasy points · Nicolodeon net -17\.8 fantasy points/)).toBeTruthy()
  expect(screen.queryByText(/Realized grade/)).toBeNull()
  const card = screen.getByText('League grade: Hoovi D · Nicolodeon B').closest('article')!
  fireEvent.click(card.querySelector('button')!)
  expect(onAsk).toHaveBeenCalledWith(expect.stringContaining("The AllFantasy grade on this league's values today is Hoovi D (got 1,500 for 2,000) and Nicolodeon B."))
})

it('a graded provider trade shows both letters instead of "Grade unavailable", and hands the grade to Chimmy', async () => {
  const onAsk = vi.fn()
  const done = { id: 'sleeper:tx-9', direction: 'complete', partnerName: 'sharpshoooter', status: 'completed_on_sleeper', sent: [{ label: 'DK Metcalf' }], received: [{ label: '2027 2nd' }],
    leagueGrade: { ...ONE_GRADE, letter: 'D', partnerLetter: 'B' }, leagueGradeSide: 'viewer', currentGrade: 'D' }
  stubPanel({ center: { historyTrades: [done] } })
  render(<ChimmyTrades leagueId="league" onAsk={onAsk} />)
  fireEvent.click(screen.getByRole('button', { name: /Trade intelligence/ }))
  await screen.findByText(/League grade: you D · sharpshoooter B/)
  const card = screen.getByText(/League grade: you D · sharpshoooter B/).closest('article')!
  expect(card.textContent).not.toContain('Grade unavailable')
  fireEvent.click(card.querySelector('button')!)
  expect(onAsk).toHaveBeenCalledWith(expect.stringContaining('is my side D (got 1,500 for 2,000) and sharpshoooter B'))
})

it('when the graded history cannot be read, the ledger is shown WITHOUT its realized letter', async () => {
  stubPanel({ center: { importedHistory: { rows: [], available: false } }, ledger: LEDGER })
  render(<ChimmyTrades leagueId="league" onAsk={() => {}} />)
  fireEvent.click(screen.getByRole('button', { name: /Trade intelligence/ }))
  await screen.findByText(/2026 · Week 2/)
  expect(screen.queryByText(/Realized grade/)).toBeNull()
  expect(screen.getAllByText(/League grade unavailable right now/)).toHaveLength(2)
  expect(screen.getByText(/Realized so far: net 17\.8 fantasy points/)).toBeTruthy()
})
it('loads every proposal page in the selected league and offers a grounded question', async () => {
  const onAsk = vi.fn()
  const fetcher = vi.fn(async (url: string) => ({ ok: true, json: async () => url.includes('view=proposals') ? {
    proposals: [{ id: url.includes('cursor=') ? 'two' : 'one', title: url.includes('cursor=') ? 'Second offer' : 'My offer', status: 'proposed', involvesYou: true, assets: ['Player A'], grade: 'B', explanation: 'Balanced under this league scoring.' }],
    nextCursor: url.includes('cursor=') ? null : 'one',
  } : url.includes('view=draft-proposals') ? { proposals: [], nextCursor: null } : { supported: false } }))
  vi.stubGlobal('fetch', fetcher)
  render(<ChimmyTrades leagueId="selected-league" onAsk={onAsk} />)
  expect(fetcher).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole('button', { name: /Trade intelligence/ }))
  await screen.findByText('Second offer')
  expect(fetcher.mock.calls.every(([url]) => url.includes('leagueId=selected-league'))).toBe(true)
  fireEvent.click(screen.getAllByRole('button', { name: 'Ask Chimmy' })[0])
  expect(onAsk).toHaveBeenCalledWith(expect.stringContaining("this league's rules"))
})
it('aborts the old league request when its panel unmounts', async () => {
  let signal: AbortSignal | undefined
  vi.stubGlobal('fetch', vi.fn((_url, options) => { signal = options.signal; return new Promise(() => {}) }))
  const { unmount } = render(<ChimmyTrades leagueId="old-league" onAsk={() => {}} />)
  fireEvent.click(screen.getByRole('button', { name: /Trade intelligence/ }))
  await waitFor(() => expect(signal).toBeDefined())
  unmount()
  expect(signal!.aborted).toBe(true)
})
it('renders draft-pick verdicts and sends their league context to Chimmy', async () => {
  const onAsk = vi.fn()
  vi.stubGlobal('fetch', vi.fn(async (url: string) => ({ ok: true, json: async () => url.includes('view=draft-proposals') ? {
    proposals: [{ id: 'draft-one', title: 'Alpha → Beta', status: 'pending', involvesYou: true, assets: ['Alpha offers pick 2.01', 'Beta offers pick 4.01'], grade: 'ACCEPT', explanation: 'Receiver-side draft-capital verdict: You receive an earlier pick.' }], nextCursor: null,
  } : url.includes('view=proposals') ? { proposals: [], nextCursor: null } : url.includes('trades-panel') ? { activeTrades: [], historyTrades: [] } : { supported: false } })))
  render(<ChimmyTrades leagueId="league" onAsk={onAsk} />)
  fireEvent.click(screen.getByRole('button', { name: /Trade intelligence/ }))
  await screen.findByText(/Draft-capital verdict ACCEPT/)
  const draftArticle = screen.getByText('Alpha → Beta').closest('article')!
  fireEvent.click(draftArticle.querySelector('button')!)
  expect(onAsk).toHaveBeenCalledWith(expect.stringContaining("this league's exact draft rules"))
})
it('includes general league offers and processed trade grades with explanations', async () => {
  const offer = { id: 'native', partnerName: 'Rivals', status: 'pending', sent: [{ label: 'Player A' }], received: [{ label: 'Player B' }], viewerIsReceiver: true, decisionCoveragePct: 95, proposalGrade: 'A', decisionRecommendation: 'Improves your starting lineup.' }
  vi.stubGlobal('fetch', vi.fn(async (url: string) => ({ ok: true, json: async () => url.includes('trades-panel') ? { activeTrades: [offer], historyTrades: [{ ...offer, id: 'done', status: 'processed', currentPricingComplete: true, currentGrade: 'B' }] } : url.includes('view=proposals') ? { proposals: [], nextCursor: null } : { supported: false } })))
  render(<ChimmyTrades leagueId="league" onAsk={() => {}} />)
  fireEvent.click(screen.getByRole('button', { name: /Trade intelligence/ }))
  await screen.findByText(/Current proposal grade A/)
  expect(screen.getByText('Improves your starting lineup.')).toBeTruthy()
  expect(screen.getByText(/Current market grade B/)).toBeTruthy()
})
it('withholds letters when trade coverage is incomplete and reports a failed provider scan', async () => {
  vi.stubGlobal('fetch', vi.fn(async (url: string) => ({ ok: true, json: async () => url.includes('trades-panel') ? { activeTrades: [{ id: 'thin', partnerName: 'Rivals', sent: [], received: [], proposalGrade: 'A', decisionCoveragePct: 20 }], pending: { scanned: false, reason: 'Provider unavailable' } } : url.includes('view=proposals') ? { proposals: [], nextCursor: null } : { supported: false } })))
  render(<ChimmyTrades leagueId="league" onAsk={() => {}} />)
  fireEvent.click(screen.getByRole('button', { name: /Trade intelligence/ }))
  await screen.findByText('Provider unavailable')
  expect(screen.queryByText(/Current proposal grade A/)).toBeNull()
  expect(screen.getByText(/Verified valuation coverage is incomplete/)).toBeTruthy()
})
