/**
 * The league Trades tab's completed history (Guap, 2026-09-25: "retire it, link to /core").
 *
 * 🛑 AN IMPORTED LEAGUE'S LOG IS RETIRED. It merged `/api/league/trade-grades` — the completed
 * ledger graded on REALIZED POINTS — with the panel's own completed provider trades (the one grade),
 * so the same trade was listed twice and one copy read "COMPLETED · EVEN" beside a board grading it
 * F. The ledger is no longer read at all; an imported league's history is linked to the Trade Center.
 *
 * ⚠ A NATIVE LEAGUE KEEPS ITS LOG: native trades never reach `transactionFact`, so the Trade Center
 * cannot show them. Retiring it there would delete the only place they are listed.
 *
 * Harness from `trades-tab-trade-block-note.test.tsx`.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { TradesTab } from '@/app/league/[leagueId]/tabs/TradesTab'
import type { UserLeague } from '@/app/dashboard/types'
import type { LeagueTradeHistoryItem } from '@/components/league/types'

vi.mock('next-auth/react', () => ({
  useSession: () => ({ data: { user: { id: 'user-a' } } }),
}))
vi.mock('@/lib/dashboard/open-chimmy-with-prompt', () => ({ openChimmyWithPrompt: vi.fn() }))

const base = {
  id: 'league-2',
  name: 'Draft Junkies',
  sport: 'NFL',
  leagueType: 'dynasty',
  isDynasty: true,
  bestBallMode: false,
  guillotineMode: false,
  keeperPhaseActive: false,
  leagueVariant: null,
}
const imported = { ...base, platform: 'sleeper' } as unknown as UserLeague
const native = { ...base, platform: null } as unknown as UserLeague

const DONE: LeagueTradeHistoryItem = {
  id: 'done-1',
  direction: 'complete',
  partnerName: 'Cold Takes FC',
  timestamp: '2026-09-20T12:00:00.000Z',
  sent: [{ id: 's1', label: 'CeeDee Lamb', sublabel: 'WR', headshotUrl: null, accent: 'blue' }],
  received: [{ id: 'r1', label: 'Bijan Robinson', sublabel: 'RB', headshotUrl: null, accent: 'teal' }],
  status: 'accepted',
  viewerIsReceiver: false,
  viewerIsProposer: true,
  viewerIsCommissioner: false,
} as unknown as LeagueTradeHistoryItem

let fetchMock: ReturnType<typeof vi.fn>
function panel(body: Record<string, unknown>) {
  fetchMock = vi.fn().mockImplementation(async (input: RequestInfo | URL) => {
    const url = String(input)
    if (url.includes('/trades/rosters')) return { ok: true, json: async () => ({ rosters: [] }) }
    return { ok: true, json: async () => ({ activeTrades: [], activeCount: 0, tradeBlock: [], ...body }) }
  })
  global.fetch = fetchMock as unknown as typeof fetch
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('TradesTab — completed history', () => {
  it('an imported league links its history to the Trade Center and lists no log here', async () => {
    panel({ historyTrades: [DONE], source: 'sleeper' })
    render(<TradesTab league={imported} teams={[]} />)
    const card = await screen.findByTestId('league-trade-history-link')
    expect(card).toHaveTextContent('Completed trades')
    expect(card.querySelector('a')?.getAttribute('href')).toBe('/core/trades?league=league-2')
    expect(screen.queryByText('League trade log')).not.toBeInTheDocument()
    expect(screen.queryByText(/History ·/)).not.toBeInTheDocument()
  })

  /* With an open offer the tab is not empty, so only the imported-league gate keeps the log away. */
  it('an imported league with an open offer still shows no log, only the offer and the link', async () => {
    const OPEN = { ...DONE, id: 'open-1', direction: 'incoming', status: 'pending', viewerIsReceiver: true, viewerIsProposer: false }
    panel({ activeTrades: [OPEN], activeCount: 1, historyTrades: [DONE] })
    render(<TradesTab league={imported} teams={[]} />)
    await screen.findByTestId('league-trade-history-link')
    await waitFor(() => expect(screen.getByText('Your trades')).toBeInTheDocument())
    expect(screen.queryByText('League trade log')).not.toBeInTheDocument()
  })

  it('never reads the realized-points ledger', async () => {
    panel({ historyTrades: [DONE] })
    render(<TradesTab league={imported} teams={[]} />)
    await screen.findByTestId('league-trade-history-link')
    const urls = fetchMock.mock.calls.map((c) => String(c[0]))
    expect(urls.some((u) => u.includes('/api/league/trade-grades'))).toBe(false)
    expect(urls.some((u) => u.includes('/api/league/trades-panel'))).toBe(true)
  })

  it('an imported league with nothing open says so, without claiming it has never traded', async () => {
    panel({ historyTrades: [DONE] })
    render(<TradesTab league={imported} teams={[]} />)
    await waitFor(() => expect(screen.getByText('No open trades right now')).toBeInTheDocument())
    expect(screen.queryByText('No trades in this league yet')).not.toBeInTheDocument()
  })

  it('a native league keeps its log, because the Trade Center cannot show native trades', async () => {
    panel({ historyTrades: [DONE], source: 'native' })
    render(<TradesTab league={native} teams={[]} />)
    await waitFor(() => expect(screen.getByText('League trade log')).toBeInTheDocument())
    expect(screen.queryByTestId('league-trade-history-link')).not.toBeInTheDocument()
    expect(screen.getAllByText(/Bijan Robinson/).length).toBeGreaterThan(0)
  })
})
