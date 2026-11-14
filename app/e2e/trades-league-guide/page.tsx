import AfCoreShell from '@/components/core-app/AfCoreShell'
import { TradeCenter } from '@/components/core-app/screens/TradeCenter'
import { Trades } from '@/components/core-app/screens/Trades'
import type { StripLeague } from '@/components/core-app/screens/TradeLeagueStrip'
import type { TradeRecord, TradesData } from '@/lib/core-app/trades'
import type { TradeDeadlineCountdown } from '@/lib/trade-deadline/tradeDeadlineCountdown'

/**
 * DB-free render of ONE league's Trades tab (2026-11-13) inside the real AfCoreShell: the deadline
 * headline, the short league switcher, the builder with its actions under it, the "More ways to find a
 * trade" fold, and the completed-trade history. Every figure is SAMPLE data. Production is refused by
 * app/e2e/layout.tsx.
 *
 *   /e2e/trades-league-guide              deadline after week 11, one week left
 *   /e2e/trades-league-guide?state=last   the last week to trade
 *   /e2e/trades-league-guide?state=closed the deadline has passed
 *   /e2e/trades-league-guide?state=open   no deadline
 *
 * The rosters, offers and finder read live APIs, so in this harness they show their loading or empty
 * states; the header, switcher and history are rendered from the sample below.
 */
const LEAGUES: StripLeague[] = Array.from({ length: 16 }, (_, i) => ({
  id: `l${i}`,
  name: i === 0 ? 'Sample Guillotine League' : `Sample League ${i}`,
  platform: i % 4 === 3 ? 'espn' : 'sleeper',
  mark: i % 4 === 3 ? 'E' : 'S',
  meta: i === 0 ? 'NFL · 18 teams' : 'NFL · 12 teams',
}))

const NOTE = (net: number) =>
  `Realized under this league's scoring: net ${net.toFixed(1)} fantasy points while the assets were held. This result grade does not claim a team-needs or playoff-probability adjustment.`

const BASIS =
  'Guilly value: projected points per week above the free agent a team can still add for the same starting slot in this league’s lineup, scored on this league’s rules, over the 6.5 weeks a team can expect to survive with 14 of 18 teams left'

const grade = (letter: 'A' | 'B' | 'C' | 'D' | 'F', partner: 'A' | 'B' | 'C' | 'D' | 'F', get: number, give: number) => ({
  graded: true,
  letter,
  partnerLetter: partner,
  getValue: get,
  giveValue: give,
  sharePct: Math.round((get / (get + give)) * 100),
  lines: [],
  moves: [],
  label: 'Fair',
  basis: BASIS,
  frozenAt: '2026-10-11T12:00:00.000Z',
  frozenBasis: 'first_graded',
  pricedAsOf: '2026-10-11T12:00:00.000Z',
  tradeAt: '2026-09-12T12:00:00.000Z',
  guillotine: true,
})

const trade = (id: string, week: number, partner: string, mine: string, theirs: string, net: number, g: ReturnType<typeof grade>): TradeRecord =>
  ({
    leagueGrade: {
      ...g,
      percentDiff: Math.round(((g.getValue - g.giveValue) / Math.max(g.getValue, g.giveValue)) * 100),
      lines: [
        { side: 'get', name: mine, leagueValue: g.getValue },
        { side: 'give', name: theirs, leagueValue: g.giveValue },
      ],
    },
    transactionId: `sleeper:${id}`,
    season: 2026,
    week,
    rosterIds: ['1', '2'],
    yourSide: 'in',
    playersIn: 1,
    playersOut: 1,
    picks: 0,
    partnerTeamName: partner,
    at: new Date('2026-09-12T12:00:00Z'),
    players: [
      { manager: 'You', isYou: true, received: [{ sleeperId: `${id}1`, name: mine, position: 'QB', team: null }], grade: net > 0 ? 'A' : 'D', gradeBasis: 'Realized', gradeNote: NOTE(net) },
      { manager: partner, isYou: false, received: [{ sleeperId: `${id}2`, name: theirs, position: 'WR', team: null }], grade: net > 0 ? 'F' : 'B', gradeBasis: 'Realized', gradeNote: NOTE(-net) },
    ],
  }) as unknown as TradeRecord

const HISTORY: TradesData = {
  league: { id: 'l0', name: 'Sample Guillotine League', platform: 'sleeper', sourceLink: null },
  gradingContext: { available: true, data: { leagueName: 'Sample Guillotine League', format: 'guillotine', teamCount: 18 } },
  canonicalHistory: true,
  history: {
    available: true,
    data: [
      trade('t1', 10, 'SampleManagerOne', 'Sample Receiver', 'Sample Sender', 21.4, grade('C', 'C', 19, 21)),
      trade('t2', 8, 'SampleManagerTwo', 'Sample Tight End', 'Sample Running Back', -30.3, grade('B', 'C', 72, 61)),
      trade('t3', 1, 'SampleManagerThree', 'Sample Quarterback', 'Sample Wideout', 113.9, grade('A', 'F', 65, 18)),
    ],
  },
  historyNotice: 'Trade history checked with Sleeper. Grades updated 2026-11-14T04:17:38.300Z.',
  inbox: { available: false, reason: 'n/a' },
  sent: { available: false, reason: 'n/a' },
  grades: { available: false, reason: 'n/a' },
  deadline: { available: true, data: { week: 11, regularSeasonLength: 14, none: false } },
  agentIdeas: { available: false, reason: 'No trade last night was near-even and good for both rosters.' },
} as unknown as TradesData

const COUNTDOWN: Record<string, TradeDeadlineCountdown> = {
  weeks: { state: 'weeks', deadlineWeek: 11, currentWeek: 10, weeksLeft: 1 },
  last: { state: 'weeks', deadlineWeek: 11, currentWeek: 11, weeksLeft: 0 },
  closed: { state: 'closed', by: 'week', deadlineWeek: 9, closesAtIso: null },
  open: { state: 'none' },
}

export default async function TradesLeagueGuideHarnessPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const sp = await searchParams
  const state = typeof sp.state === 'string' && sp.state in COUNTDOWN ? sp.state : 'weeks'
  return (
    <AfCoreShell
      active="trades"
      leagues={[]}
      selectedLeagueId={null}
      syncAge={{ label: 'just now', stale: false }}
      syncEligibleCount={0}
      comms={{ leagues: [], chimmyTokenCost: null, dockable: false, supportEmail: null }}
    >
      <div data-testid="trades-league-guide-harness">
        <TradeCenter
          viewerId={null}
          league={{ id: 'l0', name: 'Sample Guillotine League', format: 'guillotine', teamCount: 18 }}
          platform="sleeper"
          sourceLink={{ href: '#', label: 'Open in Sleeper', platformLabel: 'Sleeper', screen: 'trade', external: true, candidate: null } as never}
          deadlineWeek={11}
          deadlineCountdown={COUNTDOWN[state]}
          leagues={LEAGUES}
          history={<Trades data={HISTORY} hidePending />}
          completedHistory={[]}
        />
      </div>
    </AfCoreShell>
  )
}
