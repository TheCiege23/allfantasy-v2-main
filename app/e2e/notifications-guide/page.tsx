import AfCoreShell from '@/components/core-app/AfCoreShell'
import { NotificationsCenter } from '@/components/core-app/screens/NotificationsCenter'
import type { NotificationRow, NotificationsCenterData } from '@/lib/core-app/notificationsCenter'

/**
 * DB-free render of /core/notifications (2026-11-14) inside the real AfCoreShell: the unread count
 * with Mark all read, each sport's news folded into one row per day, a lineup alert read one line per
 * league, and the window said once under the list. Every row is SAMPLE data. Production is refused
 * by app/e2e/layout.tsx.
 *
 *   /e2e/notifications-guide           a busy account, nothing due right now
 *   /e2e/notifications-guide?act=1     the same, with one item that needs action
 */
const DELIVERED = { delivery: { mobile: { status: 'accepted' }, desktop: { status: 'suppressed' }, email: { status: 'suppressed' }, sms: { status: 'suppressed' } } }

function ago(mins: number): string {
  return new Date(Date.now() - mins * 60_000).toISOString()
}

let n = 0
function row(mins: number, over: Partial<NotificationRow>): NotificationRow {
  n += 1
  return {
    id: `sample-${n}`,
    kind: 'lineups',
    title: 'Sample notice',
    detail: 'Sample detail',
    leagueId: 'sample-league-1',
    leagueName: 'Sample Dynasty League',
    platform: 'sleeper',
    createdAt: ago(mins),
    read: false,
    severity: 'warn',
    meta: DELIVERED,
    action: { label: 'Review lineup', href: '/core/my-team?league=sample-league-1', external: false },
    ...over,
  }
}

function news(mins: number, sport: string, headline: string, over: Partial<NotificationRow> = {}): NotificationRow {
  return row(mins, {
    kind: 'news',
    type: 'sports_news',
    title: `${sport} news`,
    detail: `${headline} — via ESPN`,
    leagueId: null,
    leagueName: null,
    platform: null,
    severity: 'info',
    meta: { ...DELIVERED, sport, source: 'ESPN' },
    // A stand-in link: sample rows must not name a real outlet's host (the outbound-host census reads this file).
    action: { label: 'Read on ESPN', href: '#sample-story', external: true },
    ...over,
  })
}

function rows(): NotificationRow[] {
  n = 0
  return [
    news(1, 'NCAAF', 'Sample receiver sets a conference record'),
    row(3, {
      title: '🚨 Sample Runner is OUT — your lineup options',
      severity: 'bad',
      detail: [
        'Sample Dynasty League: start Sample Back in place of Sample Runner.',
        'Sample Keeper League: start Sample Tight End in place of Sample Runner.',
        'Sample Redraft League: start Sample Receiver in place of Sample Runner.',
        'Sample Best Ball League: start Sample Flex in place of Sample Runner.',
      ].join('\n'),
    }),
    news(13, 'NCAAF', 'Tracking a sample receiver’s record-setting season'),
    news(21, 'NCAAF', 'Sample school makes a late call at quarterback'),
    row(24, { title: 'NYJ: injury update', detail: 'Sample Receiver nears clearance and is expected to play Sunday.', leagueName: 'Sample Keeper League', leagueId: 'sample-league-2', action: { label: 'Review lineup', href: '/core/my-team?league=sample-league-2', external: false } }),
    news(34, 'NHL', 'Two sample stars out with injuries'),
    row(46, { title: '🚨 Sample Defenseman is OUT — your lineup options', severity: 'bad', detail: 'Sample Hockey League: no bench player can come in — check free agents.', leagueName: 'Sample Hockey League', platform: 'sleeper' }),
    news(240, 'NFL', 'Sources: a sample team made an early trade call', { type: 'breaking_news', title: '🚨 NFL Trade (report)', severity: 'warn' }),
    ...['Sample State faces Sample Tech', 'Sample U hosts Sample College', 'No. 10 Sample square off', 'Sample A&M visits Sample State', 'Sample guard leads Sample U after 30 points', 'Sample Bears take on the Sample Longhorns'].map(
      (h, i) => news(540 + i, 'NCAAB', h),
    ),
    news(560, 'NBA', 'A sample forward searches for answers after a quiet night', { read: true }),
    row(1500, { kind: 'trades', title: 'Trade accepted', detail: 'Your trade with Sample Manager went through.', severity: 'info', read: true, action: { label: 'Review trade', href: '/core/trades?league=sample-league-1', external: false } }),
  ]
}

function data(act: boolean): NotificationsCenterData {
  const rest = rows()
  return {
    actToday: act
      ? [row(0, { id: 'issue:sample', title: 'Set your lineup', detail: 'Sleeper › Lineup · locks in 1h 04m', severity: 'bad', action: { label: 'Fix it', href: '/core/my-team?league=sample-league-1', external: false } })]
      : [],
    rest,
    counts: { all: rest.length, trades: 1, waivers: 0, lineups: 3, mentions: 0, drafts: 0, commissioner: 0, news: rest.filter((r) => r.kind === 'news').length },
    unread: 2108,
    listed: 60,
    olderNotListed: 6393,
    push: { delivered: [], suppressedCount: 0, suppressedLeagues: 0, suppressedReason: null },
    leagueId: null,
    mentionsAvailable: false,
  }
}

export default async function NotificationsGuideHarnessPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const sp = await searchParams
  return (
    <AfCoreShell
      active="notifications"
      leagues={[]}
      selectedLeagueId={null}
      syncAge={{ label: 'just now', stale: false }}
      syncEligibleCount={0}
      comms={{ leagues: [], chimmyTokenCost: null, dockable: false, supportEmail: null }}
    >
      <div data-testid="notifications-guide-harness">
        <NotificationsCenter data={data(sp.act === '1')} />
      </div>
    </AfCoreShell>
  )
}
