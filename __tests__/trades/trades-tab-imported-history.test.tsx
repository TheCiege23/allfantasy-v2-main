/**
 * The league Trades tab's completed history.
 *
 * HISTORY OF THIS SUITE, because the rule changed twice:
 *  - 2026-09-25 (Guap: "retire it, link to /core"): an imported league's log merged
 *    `/api/league/trade-grades` — the completed ledger graded on REALIZED POINTS — with the panel's
 *    one-grade copies, so the same trade was listed twice and one copy read "COMPLETED · EVEN" beside
 *    a board grading it F. The log was retired for imported leagues and linked to the Trade Center.
 *  - 2026-09-27 (Guap: "bring them back, graded"): the history now carries THE grade, from the same
 *    rows the Trade Center builds, so it is back — ONE letter per side, never the realized one.
 *
 * 🛑 WHAT MUST STAY TRUE THROUGH BOTH: the realized-points ledger is never read, and no trade appears
 * twice. ⚠ A NATIVE league keeps its log: native trades never reach `transactionFact`.
 *
 * Harness from `trades-tab-trade-block-note.test.tsx`.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import { TradesTab } from '@/app/league/[leagueId]/tabs/TradesTab'
import type { UserLeague } from '@/app/dashboard/types'
import type { LeagueTradeHistoryItem } from '@/components/league/types'
import { importedTradeTimelineRows } from '@/lib/core-app/importedTradeTimeline'

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

/** THE grade from Hoovi's side (players[0]): Hoovi SENT Woody Marks, RECEIVED a 2027 3rd. */
const GRADE = {
  graded: true, letter: 'D', partnerLetter: 'B', percentDiff: -25, label: 'Slightly favors opponent', sideAdvantage: 'opponent',
  action: 'counter', recommendation: 'x', giveValue: 2000, getValue: 1500, giveMarket: 2000, getMarket: 1500,
  basis: 'Dynasty · Superflex · 12 teams · PPR', scoringApplied: true, needApplied: false, needGap: null, moves: [],
  lines: [
    { side: 'give', name: 'Woody Marks', marketValue: 2000, leagueValue: 2000 },
    { side: 'get', name: '2027 Round 3', marketValue: 1500, leagueValue: 1500 },
  ],
}
const HISTORY_ROWS = importedTradeTimelineRows([
  {
    transactionId: 'SL1:tx-77', season: 2026, week: 2, rosterIds: ['1', '2'], yourSide: 'unknown', playersIn: 0, playersOut: 1, picks: 1,
    partnerTeamName: null, at: new Date('2026-05-22T12:00:00Z'),
    players: [
      { manager: 'Hoovi', isYou: false, received: [], picks: ['2027 round 3'], grade: 'C', gradeBasis: 'Realized', gradeNote: 'net -17.8' },
      { manager: 'Nicolodeon', isYou: false, received: [{ sleeperId: 'wm', name: 'Woody Marks', position: 'RB', team: 'HOU' }], picks: [] },
    ],
    leagueGrade: GRADE,
  } as never,
])

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
  /*
   * 🛑 THE REGRESSION THIS FIXES (2026-09-27): an imported league's completed trades showed no grade
   * anywhere on the league page. Each side now reads THE letter, each asset its league value, and the
   * row says why — the same letters the Trade Center shows for the same trade.
   */
  it('an imported league lists its completed trades, each side graded, each asset valued, with the reason', async () => {
    panel({ historyTrades: [], importedHistory: { rows: HISTORY_ROWS, available: true }, source: 'sleeper' })
    render(<TradesTab league={imported} teams={[]} />)
    await screen.findByText('League trade log')
    expect(screen.getByText('Hoovi')).toBeInTheDocument()
    expect(screen.getByText('Nicolodeon')).toBeInTheDocument()
    expect(screen.getByText('Woody Marks · 2,000')).toBeInTheDocument()
    expect(screen.getByText('2027 round 3 · 1,500')).toBeInTheDocument()
    const letters = screen.getAllByText(/^[ABCDF]$/).map((n) => n.textContent)
    expect(letters).toEqual(['D', 'B'])
    // Each column is what that manager GOT: Hoovi's D is for the 3rd (1,500), not Woody Marks.
    expect(screen.getByText('Hoovi').closest('.min-w-0')!.textContent).toContain('2027 round 3 · 1,500')
    expect(screen.getByText('Nicolodeon').closest('.min-w-0')!.textContent).toContain('Woody Marks · 2,000')
    expect(screen.getByText('Side A gets')).toBeInTheDocument()
    expect(screen.queryByText(/Side A sends/)).not.toBeInTheDocument()
    expect(screen.getByText('Nicolodeon got the better end — Hoovi got 1,500 in league value for 2,000.')).toBeInTheDocument()
    // The realized-points letter is the one that contradicted the board; it must not come back.
    expect(screen.queryByText(/net -17\.8/)).not.toBeInTheDocument()
    // The Trade Center link stays, for photos and the full breakdown.
    expect(screen.getByTestId('league-trade-history-link').querySelector('a')?.getAttribute('href')).toBe('/core/trades?league=league-2')
  })

  it('asks for the graded history on a full load', async () => {
    panel({ importedHistory: { rows: [], available: true } })
    render(<TradesTab league={imported} teams={[]} />)
    await waitFor(() => expect(fetchMock).toHaveBeenCalled())
    const panelUrl = fetchMock.mock.calls.map((c) => String(c[0])).find((u) => u.includes('/api/league/trades-panel'))
    expect(panelUrl).toContain('history=1')
  })

  it('lists a trade once when this season’s live read and the history both hold it', async () => {
    const LIVE = { ...DONE, id: 'sleeper:tx-77', status: 'completed_on_sleeper', partnerName: 'Live copy' }
    panel({ historyTrades: [LIVE], importedHistory: { rows: HISTORY_ROWS, available: true } })
    render(<TradesTab league={imported} teams={[]} />)
    await screen.findByText('League trade log')
    expect(screen.getAllByText('Woody Marks · 2,000')).toHaveLength(1)
    expect(screen.queryByText('Live copy')).not.toBeInTheDocument()
  })

  it('your own completed trades appear under History with your letter', async () => {
    const mine = importedTradeTimelineRows([{ transactionId: 'SL1:tx-1', rosterIds: ['1', '2'], at: new Date('2026-05-22T12:00:00Z'),
      players: [
        { manager: 'Hoovi', isYou: true, received: [], picks: ['2027 round 3'] },
        { manager: 'Nicolodeon', isYou: false, received: [{ sleeperId: 'wm', name: 'Woody Marks', position: 'RB', team: 'HOU' }], picks: [] },
      ],
      leagueGrade: GRADE } as never])
    panel({ importedHistory: { rows: mine, available: true } })
    render(<TradesTab league={imported} teams={[]} />)
    fireEvent.click(await screen.findByRole('button', { name: /History · 1/ }))
    // A completed trade keeps its frozen original grade (frozenCompletedGrade.ts), so the label no longer says "today".
    expect(screen.getByText('Each trade keeps its original grade on this league’s values — priced at the time of the trade where a market record covers that date — the same grade as the Trade Center')).toBeInTheDocument()
  })

  it('an unreadable history leaves the live rows and never invents an empty log', async () => {
    panel({ historyTrades: [], importedHistory: { rows: [], available: false } })
    render(<TradesTab league={imported} teams={[]} />)
    await waitFor(() => expect(screen.getByText('No open trades right now')).toBeInTheDocument())
    expect(screen.queryByText('League trade log')).not.toBeInTheDocument()
  })

  it('never reads the realized-points ledger', async () => {
    panel({ historyTrades: [DONE], importedHistory: { rows: HISTORY_ROWS, available: true } })
    render(<TradesTab league={imported} teams={[]} />)
    await screen.findByText('League trade log')
    const urls = fetchMock.mock.calls.map((c) => String(c[0]))
    expect(urls.some((u) => u.includes('/api/league/trade-grades'))).toBe(false)
    expect(urls.some((u) => u.includes('/api/league/trades-panel'))).toBe(true)
  })

  it('an imported league with nothing open and no history says so, without claiming it has never traded', async () => {
    panel({ historyTrades: [], importedHistory: { rows: [], available: true } })
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
