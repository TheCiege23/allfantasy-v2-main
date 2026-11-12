'use client'

import AfCoreShell from '@/components/core-app/AfCoreShell'
import { DecisionQueue } from '@/components/core-app/home/DecisionQueue'
import { HomeHeadline, type HeadlineChip } from '@/components/core-app/home/HomeHeadline'
import { HomeCommishCard } from '@/components/core-app/home/HomeCommishCard'
import { HomeSeasonPulse } from '@/components/core-app/home/HomeSeasonPulse'
import { buildSeasonPulse, foldInjuredStarters } from '@/lib/core-app/homeGuide'
import type { CoreIssue } from '@/lib/core-app/outstandingIssues'

/**
 * Harness only (app/e2e is 404 in production). SAMPLE data throughout — league names, players and
 * counts are invented to exercise every tier and card, not read from anywhere.
 */
const NOW = Date.parse('2026-11-12T21:00:00Z')
const HOUR = 3_600_000
const NOW_ISO = new Date(NOW).toISOString()

function row(over: Partial<CoreIssue> & Pick<CoreIssue, 'id' | 'title' | 'meta'>): CoreIssue {
  return {
    severity: 'warn',
    glyph: '!',
    leagueId: over.id,
    leagueName: null,
    platform: 'sleeper',
    deadline: null,
    action: null,
    ...over,
  }
}

const SAMPLE_ISSUES: CoreIssue[] = [
  row({
    id: 'slot',
    severity: 'bad',
    glyph: '□',
    title: '1 empty starting slot — Sample IDP Dynasty',
    meta: 'Sleeper › Lineup · a slot with nobody in it scores zero · Checked 21:27 UTC · 2026-11-12',
    leagueName: 'Sample IDP Dynasty',
    action: { label: 'Fill the slot', href: '#', external: false },
    parts: { kind: 'empty-slot', count: 1, leagueName: 'Sample IDP Dynasty', platform: 'Sleeper', checkedAt: null },
  }),
  row({
    id: 'draft',
    severity: 'bad',
    glyph: '▤',
    title: 'Draft is live — Sample Rookie League',
    meta: 'Sleeper › Draft · on the clock now',
    leagueName: 'Sample Rookie League',
    action: { label: 'Open draft room', href: '#', external: false },
    parts: { kind: 'drafting', leagueName: 'Sample Rookie League', platform: 'Sleeper' },
  }),
  ...[
    { id: 'o1', league: 'Sample Dynasty A', who: 'Sample Receiver', at: 68 },
    { id: 'o2', league: 'Sample Pro League', who: 'Sample Receiver', at: 68, platform: 'espn' },
    { id: 'o3', league: 'Sample Dynasty B', who: 'Sample Cornerback', at: 60 },
  ].map((o) =>
    row({
      id: o.id,
      severity: 'bad',
      title: `${o.who} · WR · Out — ${o.league}`,
      meta: 'Sleeper › Lineup · Week 10 · Listed Out in your starting lineup',
      leagueName: o.league,
      platform: o.platform ?? 'sleeper',
      deadline: new Date(NOW + o.at * HOUR),
      action: { label: `Review ${o.who}`, href: '#', external: false },
      parts: {
        kind: 'starter-out',
        leagueName: o.league,
        platform: 'Sleeper',
        flaggedCount: 1,
        flagged: { name: o.who, slot: 'WR', status: 'Out' },
        week: 10,
        kickoffAt: null,
        checkedAt: null,
      },
    }),
  ),
  row({
    id: 'bb',
    severity: 'warn',
    title: 'Best ball roster coverage — Sample Best Ball',
    meta: 'The eligible roster does not cover QB. Check free agents; your lineup is set for you.',
    leagueName: 'Sample Best Ball',
    deadline: new Date(NOW + 70 * HOUR),
    action: { label: 'Check free agents', href: '#', external: false },
    parts: { kind: 'best-ball', leagueName: 'Sample Best Ball', missing: ['QB'] },
  }),
  row({
    id: 'stale',
    severity: 'warn',
    title: 'League data out of date — Sample ESPN League',
    meta: 'ESPN › Sync · last read 3d ago',
    platform: 'espn',
    leagueName: 'Sample ESPN League',
    parts: { kind: 'stale', leagueName: 'Sample ESPN League', platform: 'ESPN', lastReadAgo: '3d', actionPlatform: null },
  }),
]

const SAMPLE_PULSE = buildSeasonPulse(
  [
    ['Sample Dynasty A', 1, 12, 8, 1],
    ['Sample Pro League', 2, 18, 7, 2],
    ['Sample IDP Dynasty', 4, 14, 6, 3],
    ['Sample Dynasty B', 7, 12, 4, 5],
    ['Sample Best Ball', 11, 12, 2, 7],
    ['Sample Guillotine', 9, 10, 3, 6],
  ].map(([name, rank, teams, wins, losses], i) => ({
    id: `p${i}`,
    name: String(name),
    platform: 'sleeper',
    teams: Number(teams),
    standing: { rank: Number(rank), wins: Number(wins), losses: Number(losses), ties: 0 },
  })),
)

export default function HomeGuideHarnessClient({ commissioner, empty }: { commissioner: boolean; empty: boolean }) {
  const issues = empty ? [] : foldInjuredStarters(SAMPLE_ISSUES, true)
  const chips: HeadlineChip[] = [
    { key: 'lineups', count: empty ? 0 : 4, href: '#' },
    { key: 'injuries', count: empty ? 0 : 3, href: '#' },
    { key: 'trades', count: 2, href: '#' },
    ...(commissioner ? [{ key: 'run' as const, count: empty ? 0 : 3, href: '#' }] : []),
  ]
  return (
    <AfCoreShell
      active="home"
      leagues={[]}
      selectedLeagueId={null}
      syncAge={{ label: 'just now', stale: false }}
      syncEligibleCount={0}
      comms={{ leagues: [], chimmyTokenCost: null, dockable: false, supportEmail: null }}
    >
      <div data-testid="home-guide-harness">
        <HomeHeadline
          weekLabel="NFL WK 10"
          leagueCount={82}
          openCount={issues.length}
          chips={chips}
          streakDays={27}
          firstVisit
        />
        <DecisionQueue issues={issues} scopeLabel="All leagues" scopeKey="harness" nowIso={NOW_ISO} showCount={false} />
        {commissioner ? (
          <HomeCommishCard
            runCount={51}
            stats={[
              { value: '22', label: 'need a commissioner', tone: 'accent' },
              { value: '14', label: 'managers inactive', tone: 'bad' },
              { value: '1', label: 'trade awaiting review', tone: 'plain' },
              { value: '0', label: 'leagues need a re-sync', tone: 'good' },
            ]}
            risks={
              empty
                ? []
                : [
                    {
                      id: 'r1',
                      severity: 'bad',
                      title: '3 managers have not set a lineup in 2 weeks',
                      detail: 'Their opponents are getting free wins. Nudge them, or line up replacements before the trade deadline.',
                      leagueName: 'Sample Commish League',
                      action: { label: 'Review managers', href: '#', external: false },
                    },
                    {
                      id: 'r2',
                      severity: 'warn',
                      title: 'Trade waiting on your review',
                      detail: 'Sample Team A sends a 2027 1st for Sample RB. Value gap: 31%.',
                      leagueName: 'Sample Keeper League',
                      action: { label: 'Review trade', href: '#', external: false },
                    },
                    {
                      id: 'r3',
                      severity: 'info',
                      title: 'Dues unpaid',
                      detail: '2 of 12 teams have not paid. AllFantasy tracks dues only — it never holds money.',
                      leagueName: 'Sample Money League',
                      action: null,
                    },
                  ]
            }
            partial={false}
          />
        ) : null}
        <HomeSeasonPulse pulse={SAMPLE_PULSE} />
      </div>
    </AfCoreShell>
  )
}
