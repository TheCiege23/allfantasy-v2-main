'use client'

import AfCoreShell from '@/components/core-app/AfCoreShell'
import { DecisionQueue } from '@/components/core-app/home/DecisionQueue'
import { HomeHeadline, type HeadlineChip } from '@/components/core-app/home/HomeHeadline'
import { HomeCommishCard } from '@/components/core-app/home/HomeCommishCard'
import { HomeSeasonPulse } from '@/components/core-app/home/HomeSeasonPulse'
import { buildSeasonPulse, foldInjuredStarters } from '@/lib/core-app/homeGuide'
import type { CoreIssue } from '@/lib/core-app/outstandingIssues'
import { buildInactiveLadder } from '@/lib/core-app/commissioner/inactiveLadder'
import { InactiveLadderList } from '@/components/core-app/commissioner/InactiveLadderList'
import { HomeFormatGuide } from '@/components/core-app/home/HomeFormatGuide'
import { HomePlatformCalendar, type CalendarDisplayRow } from '@/components/core-app/home/HomePlatformCalendar'
import { countFormats } from '@/lib/core-app/homeFormats'
import { buildPlatformCalendar } from '@/lib/core-app/platformCalendar'
import { scheduleLabel, type WaiverSchedule } from '@/lib/core-app/waiverRunClock'

/** SAMPLE leagues for the format guide — the format columns only, invented. */
const SAMPLE_FORMATS = countFormats([
  ...Array.from({ length: 40 }, () => ({ isDynasty: true, scoring: 'PPR Superflex' })),
  ...Array.from({ length: 12 }, () => ({ isDynasty: true, leagueVariant: 'DYNASTY_IDP', scoring: 'PPR TEP' })),
  ...Array.from({ length: 18 }, () => ({ leagueType: 'Redraft', scoring: 'PPR' })),
  ...Array.from({ length: 8 }, () => ({ leagueType: 'Redraft', guillotineMode: true })),
  ...Array.from({ length: 5 }, () => ({ leagueType: 'Redraft', bestBallMode: true })),
])

/** SAMPLE platform calendar — schedules invented; ESPN and Fantrax show the "not readable" state. */
const SAMPLE_CALENDAR: CalendarDisplayRow[] = buildPlatformCalendar(
  [
    ...Array.from({ length: 60 }, (_, i) => ({ id: `s${i}`, platform: 'sleeper' })),
    ...Array.from({ length: 12 }, (_, i) => ({ id: `e${i}`, platform: 'espn' })),
    ...Array.from({ length: 6 }, (_, i) => ({ id: `f${i}`, platform: 'fantrax' })),
  ],
  new Map<string, WaiverSchedule>([
    ...Array.from({ length: 41 }, (_, i) => [`s${i}`, { dayOfWeek: 3, time: '00:00', timeZone: 'America/Los_Angeles' }] as [string, WaiverSchedule]),
    ...Array.from({ length: 15 }, (_, i) => [`s${41 + i}`, { dayOfWeek: null, time: '03:00', timeZone: 'America/Los_Angeles' }] as [string, WaiverSchedule]),
  ]),
  Date.parse('2026-11-12T21:00:00Z'),
).map((r) => ({
  ...r,
  label: r.platform === 'sleeper' ? 'Sleeper' : r.platform === 'espn' ? 'ESPN' : 'Fantrax',
  serverLabels: r.waivers.map((w) => scheduleLabel(w.schedule)),
}))

/** SAMPLE managers for the inactive-manager ladder — invented names and quiet spells. */
const SAMPLE_LADDER = buildInactiveLadder(
  [
    {
      leagueId: 'c1',
      leagueName: 'Sample Commish League',
      hubHref: '#',
      replaceHref: '#',
      managers: [
        { name: 'Sample Manager A', status: 'inactive', lastActionAt: null },
        { name: 'Sample Manager B', status: 'inactive', lastActionAt: new Date(Date.parse('2026-11-12T21:00:00Z') - 16 * 86_400_000).toISOString() },
        { name: 'Sample Manager C', status: 'active', lastActionAt: new Date(Date.parse('2026-11-12T21:00:00Z') - 2 * 86_400_000).toISOString() },
      ],
    },
    {
      leagueId: 'c2',
      leagueName: 'Sample Keeper League',
      hubHref: '#',
      replaceHref: '#',
      managers: [
        { name: 'Sample Manager D', status: 'inactive', lastActionAt: new Date(Date.parse('2026-11-12T21:00:00Z') - 24 * 86_400_000).toISOString() },
        { name: 'Sample Manager E', status: 'active', lastActionAt: new Date(Date.parse('2026-11-12T21:00:00Z') - 9 * 86_400_000).toISOString() },
      ],
    },
  ],
  new Date('2026-11-12T21:00:00Z'),
)

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
                      title: '2 teams with nobody running them',
                      detail: 'No owner: Sample Team F, Sample Team G. Open orphan teams to assign them.',
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
            ladder={empty ? [] : SAMPLE_LADDER}
          />
        ) : null}
        <HomeSeasonPulse pulse={SAMPLE_PULSE} />
        <HomePlatformCalendar rows={SAMPLE_CALENDAR} nextKickoffIso="2026-11-15T18:00:00.000Z" />
        <HomeFormatGuide formats={SAMPLE_FORMATS} />
        {commissioner && !empty ? (
          /* The Commissioner Hub draws every rung, with the ladder explained; the home card shows three. */
          <section className="af3a-card af-hg-card" data-testid="hub-ladder">
            <InactiveLadderList entries={SAMPLE_LADDER} />
          </section>
        ) : null}
      </div>
    </AfCoreShell>
  )
}
