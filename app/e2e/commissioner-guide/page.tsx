import { notFound } from 'next/navigation'
import AfCoreShell from '@/components/core-app/AfCoreShell'
import { CommissionerOverview } from '@/components/core-app/screens/CommissionerOverview'
// ⚠ TYPES ONLY: lib/core-app/commissionerOverview.ts is `server-only` and reads Prisma.
import type { CommissionerOverviewData, OverviewLeagueCard, OverviewQueueRow } from '@/lib/core-app/commissionerOverview'

/**
 * DB-free render of the all-leagues Commissioner Hub guide (2026-11-13), the REAL screen inside the REAL
 * shell, on SAMPLE data shaped like a commissioner of many leagues: a few with real work, many off-season.
 * Production is refused by app/e2e/layout.tsx; this check is the redundant second guard.
 *
 *   /e2e/commissioner-guide             ← things waiting
 *   /e2e/commissioner-guide?view=clear  ← nothing waiting
 */
const counts = { zombie: 5, tournament: 2, survivor: 2, c2c: 0, guillotine: 15, efl: 0 }

const card = (over: Partial<OverviewLeagueCard> & Pick<OverviewLeagueCard, 'leagueId' | 'name'>): OverviewLeagueCard => ({
  variant: null,
  platform: 'sleeper',
  sub: 'Sleeper · 12 managers · Redraft',
  activity: { active: 12, total: 12, tone: 'good' },
  needsYou: 0,
  worst: null,
  topItem: null,
  offSeason: false,
  sync: { label: 'Synced', tone: 'good' },
  href: `/core/commissioner?league=${over.leagueId}`,
  ...over,
})

const LEAGUES: OverviewLeagueCard[] = [
  card({ leagueId: 'L1', name: 'Sample Dynasty League', needsYou: 2, worst: 'bad', topItem: '2 teams with nobody running them', activity: { active: 10, total: 12, tone: 'warn' } }),
  card({ leagueId: 'L2', name: 'Sample Office League', platform: 'espn', sub: 'ESPN · 10 managers · Redraft', needsYou: 1, worst: 'warn', topItem: '1 trade awaiting your review', activity: { active: 10, total: 10, tone: 'good' } }),
  card({ leagueId: 'L3', name: 'Sample Keeper League', platform: 'yahoo', sub: 'Yahoo · 12 managers · Keeper', needsYou: 1, worst: 'bad', topItem: 'Synced 9 days ago — re-sync to check it', activity: { reason: 'Not measured: this league’s data is too old to judge' }, sync: { label: 'Synced 9d ago', tone: 'warn' } }),
  card({ leagueId: 'L4', name: 'Sample Redraft League', platform: 'native', sub: 'AllFantasy · 12 managers · Redraft · created Oct 3', activity: { active: 0, total: 12, tone: 'muted' }, offSeason: true, sync: { label: 'Runs on AllFantasy', tone: 'good' } }),
  card({ leagueId: 'L5', name: 'Sample Redraft League', platform: 'native', sub: 'AllFantasy · 12 managers · Redraft · created Oct 7', activity: { active: 0, total: 12, tone: 'muted' }, offSeason: true, sync: { label: 'Runs on AllFantasy', tone: 'good' } }),
  card({ leagueId: 'L6', name: 'Sample Zombie League', platform: 'native', sub: 'AllFantasy · 8 managers · Zombie', activity: { active: 0, total: 8, tone: 'muted' }, offSeason: true, sync: { label: 'Runs on AllFantasy', tone: 'good' } }),
]

const QUEUE: OverviewQueueRow[] = [
  { id: 'L1:a', severity: 'bad', source: 'health', title: '2 teams with nobody running them', detail: 'Unowned: Open Team 4, Open Team 9. Fill them before the trade deadline.', due: null, action: { label: 'Replace a manager', href: '#', external: false }, leagueId: 'L1', leagueName: 'Sample Dynasty League' },
  { id: 'L3:s', severity: 'bad', source: 'issue', title: 'Synced 9 days ago — re-sync to check it', detail: 'Until it syncs, nothing in it can be checked — inactive managers and lineups included.', due: null, action: { label: 'Re-sync', href: '#', external: false }, leagueId: 'L3', leagueName: 'Sample Keeper League' },
  { id: 'L2:t', severity: 'warn', source: 'review', title: '1 trade awaiting your review', detail: 'Sample Rivals ⇄ Sample Chasers. It processes in 2 days unless you act.', due: 'Sun', action: { label: 'Review trade', href: '#', external: false }, leagueId: 'L2', leagueName: 'Sample Office League' },
  { id: 'L1:q', severity: 'warn', source: 'health', title: '2 managers with no moves in 14 days', detail: 'No trade, waiver claim or roster move in 14 days: sample_quiet, sample_away.', due: null, action: { label: 'Replace a manager', href: '#', external: false }, leagueId: 'L1', leagueName: 'Sample Dynasty League' },
]

function data(view: string): CommissionerOverviewData {
  const clear = view === 'clear'
  const leagues = clear ? LEAGUES.map((l) => ({ ...l, needsYou: 0, worst: null, topItem: null })) : LEAGUES
  return {
    runCount: 51,
    formatCounts: counts,
    leagues,
    stats: [],
    queue: clear ? [] : QUEUE,
    activityChecked: 5,
    mentions: [],
    broadcastLeagueIds: ['L4', 'L5', 'L6'],
    ownsAny: true,
    tournament: { count: 1, show: true },
    partial: false,
    ladder: clear
      ? []
      : [
          { id: 'q1', leagueId: 'L1', leagueName: 'Sample Dynasty League', manager: 'sample_quiet', step: 'warn', daysQuiet: 16, href: '#' },
          { id: 'q2', leagueId: 'L1', leagueName: 'Sample Dynasty League', manager: 'sample_away', step: 'nudge', daysQuiet: 9, href: '#' },
        ],
    ladderLeagues: 2,
    summary: clear
      ? { todo: 0, trades: 0, quiet: 0, resync: 0, leaguesWithNothing: leagues.length }
      : { todo: QUEUE.length, trades: 1, quiet: 2, resync: 1, leaguesWithNothing: 3 },
  } as CommissionerOverviewData
}

export default async function CommissionerGuideHarnessPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  if (process.env.NODE_ENV === 'production') notFound()
  const sp = await searchParams
  return (
    <AfCoreShell
      active="commissioner"
      leagues={[]}
      selectedLeagueId={null}
      nativeLeague={false}
      syncAge={{ label: 'just now', stale: false }}
      syncEligibleCount={0}
      scope={{ value: 'all', label: 'All leagues', favoriteIds: [], leagues: [] }}
      comms={{ leagues: [], chimmyTokenCost: null, dockable: false, supportEmail: null }}
    >
      <div data-testid="commissioner-guide-fixture">
        <CommissionerOverview data={data(sp.view ?? '')} />
      </div>
    </AfCoreShell>
  )
}
