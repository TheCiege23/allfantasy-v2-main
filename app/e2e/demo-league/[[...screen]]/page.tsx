import { notFound } from 'next/navigation'
import { DemoBanner } from '@/components/demo-league/DemoBanner'
import { DemoNav } from '@/components/demo-league/DemoNav'
import { DemoOverview, DemoTeamScreen, DemoTradesScreen } from '@/components/demo-league/DemoScreens'
import { DemoTradeEvaluator } from '@/components/demo-league/DemoTradeEvaluator'
import { buildDemoLeagueView } from '@/lib/demo-league/view'
import type { SourceSnapshot } from '@/lib/demo-league/source'

/**
 * DB-free harness for the demo league screens (404 in production via app/e2e/layout.tsx).
 *
 * The "source" below is SAMPLE data with invented real-looking names. It goes through the
 * real `buildDemoLeagueView`, so what renders here is exactly what the anonymizer emits —
 * not a hand-written mock of its output.
 */
const NFL = [
  ['Josh Allen', 'QB', 'BUF'], ['Bijan Robinson', 'RB', 'ATL'], ["Ja'Marr Chase", 'WR', 'CIN'], ['Sam LaPorta', 'TE', 'DET'],
  ['Jalen Hurts', 'QB', 'PHI'], ['Breece Hall', 'RB', 'NYJ'], ['Puka Nacua', 'WR', 'LAR'], ['Trey McBride', 'TE', 'ARI'],
  ['Lamar Jackson', 'QB', 'BAL'], ['Jahmyr Gibbs', 'RB', 'DET'], ['CeeDee Lamb', 'WR', 'DAL'], ['George Kittle', 'TE', 'SF'],
  ['Joe Burrow', 'QB', 'CIN'], ['Saquon Barkley', 'RB', 'PHI'], ['Justin Jefferson', 'WR', 'MIN'], ['Brock Bowers', 'TE', 'LV'],
  ['C.J. Stroud', 'QB', 'HOU'], ["De'Von Achane", 'RB', 'MIA'], ['Amon-Ra St. Brown', 'WR', 'DET'], ['Mark Andrews', 'TE', 'BAL'],
  ['Patrick Mahomes', 'QB', 'KC'], ['Kyren Williams', 'RB', 'LAR'], ['Garrett Wilson', 'WR', 'NYJ'], ['Dalton Kincaid', 'TE', 'BUF'],
] as const

function sampleSource(): SourceSnapshot {
  const teams = Array.from({ length: 12 }, (_, i) => ({
    key: `sample-team-${String(i + 1).padStart(2, '0')}`,
    externalId: String(i + 1),
    ownerName: `Sample Real Owner ${i + 1}`,
    teamName: `Sample Real Team ${i + 1}`,
    avatarUrl: null,
    platformUserId: `sample-user-${i + 1}`,
    claimedByUserId: null,
    wins: 0, losses: 0, ties: 0, pointsFor: 0, pointsAgainst: 0, currentRank: null,
    isOrphan: false,
  }))
  const weekRows: SourceSnapshot['weekRows'] = []
  for (let week = 1; week <= 10; week++) {
    for (let m = 0; m < 6; m++) {
      const a = (m + week) % 12
      const b = (11 - m + week) % 12
      const scored = week < 10
      const pa = scored ? 95 + ((a * 13 + week * 7) % 45) + 0.4 : week === 10 && m < 3 ? 40 + m * 11.3 : 0
      const pb = scored ? 95 + ((b * 17 + week * 5) % 45) + 0.8 : week === 10 && m < 3 ? 35 + m * 9.1 : 0
      weekRows.push({ seasonYear: 2026, week, rosterId: String(a + 1), matchupId: m + 1, pointsFor: pa, pointsAgainst: pb, win: pa > pb ? 1 : 0 })
      weekRows.push({ seasonYear: 2026, week, rosterId: String(b + 1), matchupId: m + 1, pointsFor: pb, pointsAgainst: pa, win: pb > pa ? 1 : 0 })
    }
  }
  const player = (i: number) => {
    const p = NFL[i % NFL.length]!
    return { name: p[0], position: p[1], team: p[2], headshotUrl: null }
  }
  const rosters = teams.map((t, i) => ({
    teamKey: t.key,
    starters: [player(i * 2), player(i * 2 + 1), player(i * 2 + 5)],
    bench: [player(i * 2 + 9), player(i * 2 + 13)],
    emptyStarterSlots: i === 4 ? 1 : 0,
  }))
  const now = Date.now()
  return {
    league: {
      id: 'sample-league', name: 'Sample Real League Name', platform: 'sleeper', platformLeagueId: 'sample-pid', sport: 'NFL',
      season: 2026, scoring: 'ppr', leagueType: 'dynasty', isDynasty: true, leagueSize: 12,
      starters: ['QB', 'RB', 'RB', 'WR', 'WR', 'TE', 'FLEX', 'SUPER_FLEX'], playoffTeams: 6, playoffStartWeek: 15,
      tradeDeadlineWeek: 11, waiverType: 'FAAB', lastSyncedAt: new Date(now - 7 * 60_000), avatarUrl: null, logoUrl: null, userId: 'sample-commish',
    },
    teams,
    users: [],
    weekRows,
    rosters,
    trades: [0, 1, 2].map((k) => ({
      id: `t${k}`, leagueId: 'sample-league', leagueName: '', leagueAvatarUrl: null, platformLeagueId: 'sample-pid',
      acceptedAt: new Date(now - (k + 1) * 4 * 86_400_000).toISOString(), partial: false, verdict: null,
      sides: [
        { rosterId: String(k + 2), managerName: 'x', teamName: null, avatarUrl: null, received: [{ kind: 'player' as const, playerId: null, name: player(k + 3).name, position: player(k + 3).position, team: player(k + 3).team, headshotUrl: null, teamLogoUrl: null }], grade: null, gradeBasis: null, gradeReason: '' },
        { rosterId: String(k + 7), managerName: 'y', teamName: null, avatarUrl: null, received: [{ kind: 'player' as const, playerId: null, name: player(k + 11).name, position: player(k + 11).position, team: player(k + 11).team, headshotUrl: null, teamLogoUrl: null }, { kind: 'pick' as const, playerId: null, name: '2027 round 2', position: null, team: null, headshotUrl: null, teamLogoUrl: null }], grade: null, gradeBasis: null, gradeReason: '' },
      ],
    })),
    openAlertHeadlines: [],
    tradeCountThisSeason: 3,
  } as unknown as SourceSnapshot
}

export default async function DemoLeagueHarness(props: { params: Promise<{ screen?: string[] }> }) {
  if (process.env.NODE_ENV === 'production') notFound()
  const { screen = [] } = await props.params
  const src = sampleSource()
  const { view } = buildDemoLeagueView(src, new Map(src.teams.map((t, i) => [t.key, i])))

  let body
  if (screen[0] === 'teams') {
    const team = view.teams.find((t) => t.slot === Number(screen[1] ?? 1))
    if (!team) notFound()
    body = <DemoTeamScreen view={view} team={team} />
  } else if (screen[0] === 'trades') {
    body = <DemoTradesScreen view={view} />
  } else if (screen[0] === 'trade-evaluator') {
    body = <DemoTradeEvaluator teams={view.teams} rosters={view.rosters.map((r) => ({ slot: r.slot, players: [...r.starters, ...r.bench].map((p) => ({ name: p.name, position: p.position })) }))} />
  } else {
    body = <DemoOverview view={view} />
  }

  return (
    <div className="af-surface min-h-dvh" data-demo-league="1">
      <DemoBanner />
      <DemoNav />
      <main className="mx-auto max-w-6xl px-4 pb-16 pt-4 sm:px-6">{body}</main>
    </div>
  )
}
