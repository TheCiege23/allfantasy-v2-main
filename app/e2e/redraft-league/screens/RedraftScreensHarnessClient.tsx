'use client'

import { useEffect, useState, type ReactNode } from 'react'
import type { LeagueTeam } from '@prisma/client'
import type { LeagueTeamSlot, UserLeague } from '@/app/dashboard/types'
import { NativeLeagueWorkspace } from '@/components/league/native/NativeLeagueWorkspace'
import { NativeLineupScreen } from '@/components/league/native/screens/NativeLineupScreen'
import { NativeMatchupScreen } from '@/components/league/native/screens/NativeMatchupScreen'
import { NativeWaiversScreen } from '@/components/league/native/screens/NativeWaiversScreen'
import { NativeTradesScreen } from '@/components/league/native/screens/NativeTradesScreen'
import { NativeStandingsScreen } from '@/components/league/native/screens/NativeStandingsScreen'
import { PlayersTab } from '@/app/league/[leagueId]/tabs/PlayersTab'
// LeagueShell loads /core's palette itself (the workspace does not), so the harness must too.
import '@/components/core-app/af-core.css'
import {
  MANAGERS,
  SPORTS,
  forecastResponse,
  matchupResponse,
  playoffRuntimeResponse,
  rosterResponse,
  scoreboardResponse,
  seedsResponse,
  standingsResponse,
  teamPlayers,
  tradesResponse,
  waiverClaimsResponse,
  waiverHistoryResponse,
  waiverPlayersResponse,
  waiverSettingsResponse,
  waiverStateResponse,
  type HarnessSport,
  type HarnessStage,
} from './fixtures'

export type HarnessTab = 'roster' | 'matchups' | 'waivers' | 'trades' | 'standings' | 'players'

const TABS = [
  { id: 'native_home', label: 'League home' }, { id: 'roster', label: 'My Team' }, { id: 'matchups', label: 'Matchups' },
  { id: 'players', label: 'Players' }, { id: 'waivers', label: 'Waivers' }, { id: 'trades', label: 'Trades' },
  { id: 'standings', label: 'Standings' }, { id: 'league_chat', label: 'League Chat' }, { id: 'settings', label: '⚙ Settings' },
]

/**
 * Answers the screens' own fetches from the fixtures, so the real components run with no database and no
 * provider. Installed during the first render — before any child effect — and only on this harness page.
 * Anything not listed answers 404, which every optional card already treats as "nothing to show".
 */
function installFixtureFetch(sport: HarnessSport, stage: HarnessStage) {
  const w = window as unknown as { __rdHarnessFetch?: boolean; __rdHarnessKey?: string; fetch: typeof fetch }
  w.__rdHarnessKey = `${sport}:${stage}`
  // The workspace restores each league's last-open section from localStorage (NativeLeagueWorkspace), which
  // would replace the tab a capture asked for with whatever the previous frame left there. Forget it.
  try {
    for (const k of Object.keys(window.localStorage)) if (k.startsWith('af:league-section:e2e-redraft-')) window.localStorage.removeItem(k)
  } catch {
    /* storage is optional */
  }
  if (w.__rdHarnessFetch) return
  w.__rdHarnessFetch = true
  const real = w.fetch.bind(window)
  w.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url
    if (!url.startsWith('/api/')) return real(input, init)
    const [s, st] = String(w.__rdHarnessKey).split(':') as [HarnessSport, HarnessStage]
    const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
    const method = String(init?.method ?? 'GET').toUpperCase()
    if (method !== 'GET' && !url.includes('rolling-insights/batch')) return json({ error: 'Harness: writes are disabled.' }, 409)
    const path = url.split('?')[0]
    if (path === '/api/league/roster') return json(rosterResponse(s))
    if (path.endsWith('/matchup-center')) return json(matchupResponse(s))
    if (path.endsWith('/scoring/matchups')) return json(scoreboardResponse(s))
    if (path.endsWith('/scoring/standings')) return json(standingsResponse(s))
    if (path.endsWith('/season-forecast')) return json(forecastResponse())
    if (path.endsWith('/scoring/playoff-seeds')) return json(seedsResponse())
    if (path === '/api/redraft/playoff-runtime') return json(playoffRuntimeResponse(s, st))
    if (path.endsWith('/claims') && url.includes('type=history')) return json(waiverHistoryResponse(s))
    if (path.endsWith('/claims')) return json(waiverClaimsResponse(s))
    if (path.endsWith('/settings') && path.includes('/waiver-wire/')) return json(waiverSettingsResponse(s))
    if (path.endsWith('/players') && path.includes('/waiver-wire/')) return json(waiverPlayersResponse(s))
    if (path.endsWith('/state') && path.includes('/waiver-wire/')) return json(waiverStateResponse())
    if (path.endsWith('/watchlist')) return json({ playerIds: [`${s.toLowerCase()}-fa-1`] })
    if (path === '/api/league/trades-panel') return json(tradesResponse(s))
    if (path === '/api/redraft/season') return json({ season: { id: 'harness-season' } })
    if (path === '/api/redraft/players') return json({ players: waiverPlayersResponse(s).players })
    if (path === '/api/sleeper/players') {
      const q = new URL(url, window.location.origin).searchParams.get('sport') === 'nba' ? 'NBA' : 'NFL'
      const map: Record<string, unknown> = {}
      for (const p of waiverPlayersResponse(q).players) map[p.id] = { id: p.id, name: p.name, position: p.position, team: p.team }
      return json(map)
    }
    if (path === '/api/players/rolling-insights/batch') return json({ bySleeperId: {} })
    return json({ error: 'not in harness' }, 404)
  }
}

type Props = { tab: HarnessTab; sport: HarnessSport; stage: HarnessStage; leagueType: string; leagueVariant: string | null }

/** Harness only (app/e2e is 404 in production): the real workspace chrome around one real native screen. */
export default function RedraftScreensHarnessClient(props: Props) {
  // The capture script switches tab / sport / stage in place (window.__rdHarnessGo) rather than reloading
  // the page for every frame: a dev-mode reload costs far more than the render being photographed.
  const [view, setView] = useState({ tab: props.tab, sport: props.sport, stage: props.stage })
  const { sport, stage } = view
  const { leagueType, leagueVariant } = props
  useState(() => {
    if (typeof window !== 'undefined') installFixtureFetch(sport, stage)
    return true
  })
  if (typeof window !== 'undefined') installFixtureFetch(sport, stage)
  const [activeTab, setActiveTab] = useState<string>(props.tab)
  useEffect(() => {
    const w = window as unknown as { __rdHarnessGo?: (next: { tab: HarnessTab; sport: HarnessSport; stage?: HarnessStage }) => void }
    w.__rdHarnessGo = next => {
      installFixtureFetch(next.sport, next.stage ?? 'season')
      setView({ tab: next.tab, sport: next.sport, stage: next.stage ?? 'season' })
      setActiveTab(next.tab)
    }
    return () => {
      delete w.__rdHarnessGo
    }
  }, [])
  const cfg = SPORTS[sport]
  const league: UserLeague = {
    id: `e2e-redraft-${sport.toLowerCase()}`,
    name: 'Sunday Night Redraft',
    platform: 'allfantasy',
    sport,
    format: 'redraft',
    scoring: 'Half PPR',
    teamCount: 12,
    season: 2026,
    lifecycleState: stage === 'playoffs' ? 'playoffs' : 'in_season',
    currentWeek: stage === 'playoffs' ? cfg.playoffStart : cfg.week,
    leagueType,
    leagueVariant,
    tradeDeadlineWeek: cfg.deadline,
    playoffStartWeek: cfg.playoffStart,
    isCommissioner: true,
    settings: { playoff_team_count: 6, playoff_byes: 2, playoff_start_week: cfg.playoffStart, playoff_weeks: 3, playoff_reseed: false, playoff_lower_bracket: 'consolation', lineupLockMode: cfg.daily ? 'daily' : 'weekly' },
  } as UserLeague
  const userTeam = { id: 'team-0', leagueId: league.id, teamName: MANAGERS[0], wins: 5, losses: 3, ties: 0, pointsFor: 1042.6, currentRank: 3 } as unknown as LeagueTeam
  const teams = MANAGERS.map((teamName, i) => ({ id: `team-${i}`, rosterId: `r-${i}`, teamName, ownerName: teamName, players: teamPlayers(sport, i).starters.map(p => p.id) })) as unknown as LeagueTeamSlot[]
  const go = (id: string) => setActiveTab(id === 'roster' ? 'roster' : id)
  let body: ReactNode = <p data-testid="redraft-screens-harness-empty">Pick a tab.</p>
  if (activeTab === 'roster') body = <NativeLineupScreen league={league} userTeam={userTeam} onSelectTab={go} />
  else if (activeTab === 'matchups') body = <NativeMatchupScreen league={league} onSelectTab={go} />
  else if (activeTab === 'waivers') body = <NativeWaiversScreen league={league} />
  else if (activeTab === 'trades') body = <NativeTradesScreen league={league} teams={teams} />
  else if (activeTab === 'standings') body = <NativeStandingsScreen league={league} isCommissioner onSelectTab={go} />
  else if (activeTab === 'players') body = <div className="flex min-h-0 flex-1 flex-col overflow-y-auto px-4 py-4 lg:px-6"><PlayersTab league={league} onPlayerClick={() => {}} sport={sport} /></div>
  return (
    <NativeLeagueWorkspace
      native
      league={league}
      leagues={[league]}
      tabs={TABS}
      activeTab={activeTab}
      isCommissioner
      onSelectTab={setActiveTab}
      onOpenSettings={() => setActiveTab('settings')}
      seasonFacts={{ totalWeeks: cfg.totalWeeks, playoffStartWeek: cfg.playoffStart, draftComplete: true }}
      leftPanel={null}
      rightPanel={null}
    >
      <div key={`${activeTab}-${sport}-${stage}`} data-testid="redraft-screens-harness" data-harness-tab={activeTab} data-harness-sport={sport}>{body}</div>
    </NativeLeagueWorkspace>
  )
}
