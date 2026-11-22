'use client'

import { useRef, useState } from 'react'
import type { UserLeague, UserLeagueTeam } from '@/app/dashboard/types'
import { NativeLeagueWorkspace } from '@/components/league/native/NativeLeagueWorkspace'
import { NativeLeagueHome } from '@/components/league/native/NativeLeagueHome'
import { NflRedraftLeagueHomeDashboard } from '@/components/league-home/NflRedraftLeagueHomeDashboard'
import { DraftTab } from '@/app/league/[leagueId]/tabs/DraftTab'
import { explainRuleChange } from '@/lib/league-rules-explainer/explain'
import { normalizeToSupportedSport } from '@/lib/sport-scope'
import type { MatchupCenterPayload, MatchupPlayerSlot } from '@/lib/matchup-center/types'
import '@/components/core-app/af-core.css'

export type HarnessScreen = 'home' | 'football-home' | 'draft'

type Props = { screen: HarnessScreen; sport: string; phase: string; week: number | null; empty: boolean; grades: boolean; commissioner: boolean }

const LEAGUE_ID = 'e2e-redraft-league'

/** HARNESS FIXTURE — invented names and numbers for visual review only; nothing here is real data. */
const TEAM_NAMES = ['Fourth & Long', 'Waiver Wire Wizards', 'Gridiron Ghosts', 'Bench Mob', 'Late Round Picks', 'Sunday Scaries', 'Taco Tuesday', 'The Replacements', 'Monday Misery', 'Hail Marys', 'Overtime Owls', 'Last Place Legends']
/** Points scale per sport, so a fixture score looks like that sport's score. */
const SCALE: Record<string, number> = { NFL: 1, NCAAF: 1, NBA: 6, NCAAB: 3, NHL: 0.42, MLB: 2.1, SOCCER: 0.6 }
const STARTERS: Record<string, [string, string][]> = {
  NFL: [['B. Robinson', 'RB'], ['J. Chase', 'WR'], ['J. Allen', 'QB'], ['T. Kelce', 'TE']],
  NCAAF: [['C. Ward', 'QB'], ['A. Jeanty', 'RB'], ['T. Hunter', 'WR'], ['C. Loveland', 'TE']],
  NBA: [['N. Jokic', 'C'], ['L. Doncic', 'PG'], ['J. Tatum', 'SF'], ['A. Edwards', 'SG']],
  NCAAB: [['C. Flagg', 'F'], ['D. Harper', 'G'], ['A. Bailey', 'F'], ['K. Knueppel', 'G']],
  NHL: [['C. McDavid', 'C'], ['N. MacKinnon', 'C'], ['C. Makar', 'D'], ['I. Shesterkin', 'G']],
  MLB: [['S. Ohtani', 'DH'], ['A. Judge', 'OF'], ['B. Witt Jr.', 'SS'], ['T. Skubal', 'SP']],
  SOCCER: [['E. Haaland', 'FW'], ['M. Salah', 'FW'], ['B. Saka', 'MF'], ['W. Saliba', 'DF']],
}

/** Season shape per sport (total weeks, playoff start, trade deadline) — the foundation capture's. */
const SEASON: Record<string, [number, number, number]> = { NFL: [17, 15, 12], NCAAF: [15, 13, 9], NBA: [21, 19, 16], NCAAB: [18, 16, 12], NHL: [22, 20, 17], MLB: [26, 24, 20], SOCCER: [38, 35, 26] }

type FetchFn = typeof window.fetch

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}

function buildTeams(week: number): UserLeagueTeam[] {
  const played = Math.max(0, week - 1)
  return TEAM_NAMES.map((teamName, i) => {
    const wins = Math.max(0, Math.round(played * (1 - i / 11)))
    return {
      id: `team-${i + 1}`,
      externalId: `roster-${i + 1}`,
      teamName,
      ownerName: `Manager ${i + 1}`,
      avatarUrl: null,
      role: i === 0 ? 'commissioner' : 'member',
      isOrphan: false,
      claimedByUserId: `user-${i + 1}`,
      draftPosition: i + 1,
      wins,
      losses: played - wins,
      ties: 0,
      pointsFor: Math.round((played * (128 - i * 3.1)) * 10) / 10,
      pointsAgainst: Math.round((played * (112 + i * 1.7)) * 10) / 10,
      currentRank: i + 1,
      faabRemaining: 100 - i * 4,
      waiverPriority: 12 - i,
      divisionId: null,
    }
  })
}

function slot(name: string, position: string, points: number, scale: number, status: MatchupPlayerSlot['gameStatus']): MatchupPlayerSlot {
  return { playerId: name, name, position, team: null, opponent: null, headshotUrl: null, currentPoints: Math.round(points * scale * 10) / 10, projectedPoints: Math.round(18 * scale * 10) / 10, hasRealProjection: true, injuryStatus: null, newsBlurb: null, weatherSummary: null, gameStatus: status, gameLabel: '', aiInsight: null }
}

function matchup(sport: string, week: number, teams: UserLeagueTeam[]): MatchupCenterPayload {
  const scale = SCALE[sport] ?? 1
  const names = STARTERS[sport] ?? STARTERS.NFL!
  const side = (t: UserLeagueTeam, points: number, projected: number, remaining: number) => ({
    projectedTotalIncludesFallback: false, rosterId: t.externalId, teamName: t.teamName, avatarUrl: null,
    record: { wins: t.wins, losses: t.losses, ties: t.ties }, winPct: 0, totalPoints: Math.round(points * scale * 10) / 10,
    projectedTotal: Math.round(projected * scale * 10) / 10, starters: [] as MatchupPlayerSlot[], remainingStarters: remaining,
  })
  const left = side(teams[0]!, 98.6, 121.4, 3)
  left.starters = names.map(([n, p], i) => slot(n, p, [31.2, 24.8, 22.1, 0][i] ?? 0, scale, i < 3 ? 'final' : 'upcoming'))
  const right = side(teams[2]!, 87.2, 109.5, 1)
  return {
    leagueId: LEAGUE_ID, season: 2026, week, sport, matchupStatus: 'live', conceptOverlay: null, left, right,
    winProbabilityLeft: 0.64,
    insights: { matchupEdge: '', startSit: '', weather: '', injuryNews: '', swingPlayers: [], riskLevel: 'low', floorVsCeiling: '' },
    partialData: false, refreshIntervalMs: 60_000,
  }
}

function lastWeek(sport: string, week: number) {
  const scale = SCALE[sport] ?? 1
  const pts = [154.8, 101.2, 133.0, 132.6, 118.4, 96.0, 121.7, 88.3, 109.9, 140.2, 99.5, 112.0]
  const rows = TEAM_NAMES.map((teamName, i) => {
    const opp = i % 2 === 0 ? i + 1 : i - 1
    const me = pts[i]! * scale
    const them = pts[opp]! * scale
    return { rosterId: `roster-${i + 1}`, teamName, totalPoints: Math.round(me * 10) / 10, opponentRosterId: `roster-${opp + 1}`, opponentName: TEAM_NAMES[opp], winLoss: me > them ? 'W' : 'L', status: 'final' }
  })
  return { season: 2026, week, matchups: rows }
}

/**
 * Answers only the endpoints the three screens read; everything else is a 404, which every one of
 * those components already treats as "no data". Installed during render (before any child effect).
 */
function installFetchStub(props: Props, sport: string, week: number, teams: UserLeagueTeam[]) {
  const w = window as unknown as { __afRedraftHarnessFetch?: FetchFn; __afRealFetch?: FetchFn }
  const real = w.__afRealFetch ?? window.fetch.bind(window)
  w.__afRealFetch = real
  const now = Date.now()
  const stub: FetchFn = async (input, init) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
    if (!url.startsWith('/api/')) return real(input, init)
    const path = url.split('?')[0]!
    const method = (init?.method ?? 'GET').toUpperCase()
    if (props.empty) return json({}, 404)
    if (path.endsWith('/rules-explainer')) {
      if (method === 'POST') return json({ ok: true })
      const line = explainRuleChange({ key: 'tradeDeadlineWeek', before: 12, after: 13 }, { sport })
      const at = new Date(now - 3_600_000).toISOString()
      return json({ supported: true, sport, format: 'redraft', isCommissioner: props.commissioner, sections: [], showRulesPopup: false, pendingChanges: line ? [{ lastEventId: 'ev-1', firstAt: at, lastAt: at, eventIds: ['ev-1'], lines: [line] }] : [], history: [], latestEvent: { id: 'ev-1', createdAt: at } })
    }
    if (path.endsWith('/matchup-center')) return json({ payload: matchup(sport, week, teams) })
    if (path === '/api/redraft/roster') return json({ week, roster: { lineupValidation: { issues: [{ code: 'starter_injury_risk', severity: 'warning', playerName: (STARTERS[sport] ?? STARTERS.NFL!)[1]![0] }] } } })
    if (path.includes('/api/waiver-wire/leagues/')) return json({ settings: { nextRunAt: new Date(now + 26 * 3_600_000).toISOString() } })
    if (path.endsWith('/scoring/matchups')) return json(lastWeek(sport, Math.max(1, week - 1)))
    if (path.endsWith('/draft/session')) return json({ session: { status: props.phase === 'pre_draft' ? 'scheduled' : 'completed' } })
    if (path.endsWith('/draft-grades')) {
      if (!props.grades) return json({ rows: [] })
      const letters = ['A', 'A-', 'B+', 'B+', 'B', 'B', 'B-', 'C+', 'C+', 'C', 'C-', 'D']
      return json({ rows: TEAM_NAMES.map((_, i) => ({ rosterId: `roster-${((i * 5) % 12) + 1}`, grade: letters[i], score: 92 - i * 4 })) })
    }
    return json({}, 404)
  }
  w.__afRedraftHarnessFetch = stub
  window.fetch = stub
}

export default function RedraftLeagueHarnessClient(props: Props) {
  const sport = normalizeToSupportedSport(props.sport)
  const predraft = props.phase === 'pre_draft'
  const week = predraft ? 1 : (props.week ?? 9)
  const teams = useRef(buildTeams(predraft ? 1 : week)).current
  const installed = useRef(false)
  if (typeof window !== 'undefined' && !installed.current) {
    installFetchStub(props, sport, week, teams)
    installed.current = true
  }
  const initialTab = props.screen === 'home' ? 'native_home' : props.screen === 'football-home' ? 'home' : 'draft'
  const [activeTab, setActiveTab] = useState(initialTab)
  const draftDate = useRef(new Date(Date.now() + (2 * 86_400 + 4 * 3600 + 12 * 60) * 1000).toISOString()).current
  const league: UserLeague = {
    id: LEAGUE_ID,
    name: 'Sunday Night Redraft',
    platform: 'allfantasy',
    sport,
    format: 'redraft',
    scoring: sport === 'NFL' || sport === 'NCAAF' ? 'Half PPR' : 'Points',
    teamCount: 12,
    season: 2026,
    status: predraft ? 'pre_draft' : props.phase,
    lifecycleState: props.phase,
    currentWeek: predraft ? null : week,
    leagueType: 'redraft',
    tradeDeadlineWeek: (SEASON[sport] ?? SEASON.NFL!)[2],
    draftDate: predraft ? draftDate : null,
    isCommissioner: props.commissioner,
    settings: { playoff_structure: { playoff_team_count: 6, playoff_start_week: (SEASON[sport] ?? SEASON.NFL!)[1] }, scoring_type: 'points' },
  } as UserLeague
  const [totalWeeks, playoffStart, deadline] = SEASON[sport] ?? SEASON.NFL!
  const TABS = [
    { id: 'native_home', label: 'League home' }, { id: 'home', label: 'Home' }, { id: 'roster', label: 'My Team' },
    { id: 'matchups', label: 'Matchups' }, { id: 'waivers', label: 'Waivers' }, { id: 'trades', label: 'Trades' },
    { id: 'draft', label: 'Draft' }, { id: 'standings', label: 'Standings' }, { id: 'league_chat', label: 'League Chat' },
    { id: 'settings', label: '⚙ Settings' },
  ]
  const body =
    activeTab === 'home' ? (
      <NflRedraftLeagueHomeDashboard league={league} leagueId={LEAGUE_ID} teamSlots={teams} userTeamName={teams[0]!.teamName} isCommissioner={props.commissioner} draftDateIso={league.draftDate ?? null} hasActiveRedraftSeason={!predraft} onOpenSettings={() => {}} onOpenTab={setActiveTab} />
    ) : activeTab === 'draft' ? (
      <DraftTab league={league} teams={teams} isOwner={props.commissioner} isCommissioner={props.commissioner} onOpenLeagueSettings={() => {}} />
    ) : (
      <NativeLeagueHome league={league} teams={teams} userTeamId={teams[0]!.id} isCommissioner={props.commissioner} draftDateIso={league.draftDate ?? null} snapshot={null} settingsOpen={false} onOpenSettings={() => {}} onSelectTab={setActiveTab} />
    )
  return (
    <NativeLeagueWorkspace
      native
      league={league}
      leagues={[league]}
      tabs={TABS}
      activeTab={activeTab}
      isCommissioner={props.commissioner}
      onSelectTab={setActiveTab}
      onOpenSettings={() => {}}
      seasonFacts={{ totalWeeks, playoffStartWeek: playoffStart, tradeDeadlineWeek: deadline, ...(predraft ? {} : { draftComplete: true }) }}
      leftPanel={null}
      rightPanel={null}
    >
      {body}
    </NativeLeagueWorkspace>
  )
}
