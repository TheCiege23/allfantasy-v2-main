import AfCoreShell from '@/components/core-app/AfCoreShell'
import { TradesBoard } from '@/components/core-app/boards/TradesBoard'
import { TradeCenter } from '@/components/core-app/screens/TradeCenter'
import type { StripLeague } from '@/components/core-app/screens/TradeLeagueStrip'
import type { BoardTrade, TradeWindowRow, TradesBoardData } from '@/lib/core-app/tradesBoard'

/**
 * DB-free render of the /core/trades guide (2026-11-13) inside the real AfCoreShell: the headline and
 * chips, offers waiting, Check a trade, the embedded trades list, the market and the folded league
 * list. Every figure is SAMPLE data. Production is refused by app/e2e/layout.tsx.
 *
 *   /e2e/trades-guide            two leagues with new trades, two deadlines within a week
 *   /e2e/trades-guide?quiet=1    no trades on file anywhere
 *
 * The offer tiles and the market read live APIs, so in this harness they show their loading or
 * empty states; the rest is rendered from the sample below.
 */
const asset = (id: string, name: string, value: number, kind: 'player' | 'pick' = 'player') => ({
  id,
  kind,
  name,
  position: kind === 'player' ? 'WR' : null,
  team: null,
  imageUrl: null,
  value,
})

const trade = (id: string, from: string, to: string, letter: BoardTrade['letter'], share: number): BoardTrade => ({
  transactionId: id,
  season: 2026,
  week: 10,
  at: '2026-11-11T18:00:00.000Z',
  fromName: from,
  toName: to,
  sent: [asset(`${id}-a`, 'Sample 2027 1st', 2875, 'pick'), asset(`${id}-b`, 'Sample 2027 2nd', 1614, 'pick')],
  received: [asset(`${id}-c`, 'Sample Receiver', 2798)],
  letter,
  sharePct: share,
  withheldReason: null,
  breakdown: [`${from} came out ahead on this league’s values.`],
})

const row = (id: string, name: string, over: Partial<TradeWindowRow>): TradeWindowRow => ({
  leagueId: id,
  leagueName: name,
  platform: 'sleeper',
  logoUrl: null,
  deadlineWeek: 11,
  noDeadline: false,
  weeksLeft: 1,
  regularSeasonLength: 14,
  tradesOnFile: 0,
  latest: null,
  href: '#',
  reasoning: '',
  ...over,
})

const BOARD: TradesBoardData = {
  pending: [],
  windows: [
    row('a', 'Sample Dynasty A', { tradesOnFile: 19, latest: trade('t1', 'SampleManagerOne', 'SampleManagerTwo', 'A', 63), freshTrade: true }),
    row('b', 'Sample Keeper B', { tradesOnFile: 4, latest: trade('t2', 'SampleManagerThree', 'You', 'B', 54), freshTrade: true, weeksLeft: 0, deadlineWeek: 10 }),
    row('c', 'Sample Redraft C', { tradesOnFile: 2, latest: trade('t3', 'SampleManagerFour', 'SampleManagerFive', 'C', 51), weeksLeft: 3, deadlineWeek: 13 }),
    row('d', 'Sample Best Ball D', { weeksLeft: 4, deadlineWeek: 14 }),
  ],
  considered: 12,
  deadlineUnknown: 3,
  currentWeek: 10,
}
const QUIET: TradesBoardData = {
  ...BOARD,
  windows: BOARD.windows.map((w) => ({ ...w, tradesOnFile: 0, latest: null, freshTrade: false, weeksLeft: 4, deadlineWeek: 14 })),
}

const LEAGUES: StripLeague[] = [
  { id: 'a', name: 'Sample Dynasty A', platform: 'sleeper', mark: 'S', meta: 'NFL · 12 teams' },
  { id: 'b', name: 'Sample Keeper B', platform: 'sleeper', mark: 'S', meta: 'NFL · 12 teams' },
  { id: 'c', name: 'Sample Redraft C', platform: 'espn', mark: 'E', meta: 'NFL · 10 teams' },
  { id: 'd', name: 'Sample Best Ball D', platform: 'fantrax', mark: 'F', meta: 'NFL · 12 teams' },
]

export default async function TradesGuideHarnessPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const sp = await searchParams
  const data = sp.quiet === '1' ? QUIET : BOARD
  return (
    <AfCoreShell
      active="trades"
      leagues={[]}
      selectedLeagueId={null}
      syncAge={{ label: 'just now', stale: false }}
      syncEligibleCount={0}
      comms={{ leagues: [], chimmyTokenCost: null, dockable: false, supportEmail: null }}
    >
      <div data-testid="trades-guide-harness">
        <TradeCenter
          viewerId={null}
          league={null}
          leagues={LEAGUES}
          board={<TradesBoard data={data} allHref="#" totalLeagues={LEAGUES.length} embedded language="en" />}
          boardData={data}
        />
      </div>
    </AfCoreShell>
  )
}
