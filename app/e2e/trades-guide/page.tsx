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

/** The other side's letter: the grade's own mirror on league value (A↔F, B↔D, C↔C). */
const MIRROR = { A: 'F', B: 'D', C: 'C', D: 'B', F: 'A' } as const

const trade = (
  id: string,
  from: string,
  to: string,
  letter: BoardTrade['letter'],
  share: number,
  /** What `from` got and gave, in league value — consistent with the letter (A/B: got more). */
  values: { get: number; give: number } = { get: 4489, give: 2798 },
): BoardTrade => ({
  transactionId: id,
  season: 2026,
  week: 10,
  at: '2026-11-11T18:00:00.000Z',
  fromName: from,
  toName: to,
  // `received` is what `from` got; `sent` went to `to`. Values add up to `values`.
  received: [asset(`${id}-a`, 'Sample 2027 1st', Math.round(values.get * 0.64), 'pick'), asset(`${id}-b`, 'Sample 2027 2nd', values.get - Math.round(values.get * 0.64), 'pick')],
  sent: [asset(`${id}-c`, 'Sample Receiver', values.give)],
  letter,
  partnerLetter: letter ? MIRROR[letter] : null,
  getValue: letter ? values.get : null,
  giveValue: letter ? values.give : null,
  sharePct: letter ? share : null,
  withheldReason: letter ? null : 'Sample Receiver has no value on this league’s chart yet.',
  breakdown: letter
    ? [
        `${from} came out ahead on this league’s values.`,
        `The most valuable asset was Sample 2027 1st, and ${from} got it.`,
        'Graded on this league’s values at the time of the trade (Nov 11) (Dynasty · Superflex · 12 teams · PPR).',
      ]
    : [],
})

/** An ungraded trade prints a dash on every asset, as the loader does (`valuesOnTheGrade`). */
const unpriced = (t: BoardTrade): BoardTrade =>
  t.letter ? t : { ...t, sent: t.sent.map((a) => ({ ...a, value: null })), received: t.received.map((a) => ({ ...a, value: null })) }

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
    row('b', 'Sample Keeper B', { tradesOnFile: 4, latest: trade('t2', 'SampleManagerThree', 'You', 'B', 54, { get: 3300, give: 2900 }), freshTrade: true, weeksLeft: 0, deadlineWeek: 10 }),
    row('c', 'Sample Redraft C', { tradesOnFile: 2, latest: trade('t3', 'SampleManagerFour', 'SampleManagerFive', 'C', 51, { get: 2972, give: 3015 }), weeksLeft: 3, deadlineWeek: 13 }),
    row('e', 'Sample Dynasty E', { tradesOnFile: 7, latest: unpriced(trade('t4', 'SampleManagerSix', 'SampleManagerSeven', null, 0)), weeksLeft: 2, deadlineWeek: 12 }),
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
