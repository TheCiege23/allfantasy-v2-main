'use client'

import { useEffect, useState } from 'react'
import type { UserLeague } from '@/app/dashboard/types'
import type { SubPanelContext } from '@/app/league/[leagueId]/components/LeagueSettingsSubPanels'
import { NativeLeagueWorkspace } from '@/components/league/native/NativeLeagueWorkspace'
import { LeagueSettingsHomeContainer } from '@/components/league-settings/home/LeagueSettingsHomeContainer'
// LeagueShell loads /core's palette itself (the workspace does not), so the harness must too.
import '@/components/core-app/af-core.css'
import { MANAGERS, SPORTS, draftSettingsResponse, rosterSettingsResponse, type HarnessSport } from './fixtures'

export type HarnessRole = 'commissioner' | 'member'

const TABS = [
  { id: 'native_home', label: 'League home' }, { id: 'roster', label: 'My Team' }, { id: 'matchups', label: 'Matchups' },
  { id: 'players', label: 'Players' }, { id: 'waivers', label: 'Waivers' }, { id: 'trades', label: 'Trades' },
  { id: 'standings', label: 'Standings' }, { id: 'league_chat', label: 'League Chat' }, { id: 'settings', label: '⚙ Settings' },
]

/**
 * Answers the settings page's own GETs from the fixtures; every write is refused and anything not listed
 * answers 404, which each optional panel already treats as "nothing to show". Installed during the first
 * render — before any child effect — and only on this harness page.
 */
function installFixtureFetch(sport: HarnessSport) {
  const w = window as unknown as { __rdSettingsFetch?: boolean; __rdSettingsSport?: HarnessSport; fetch: typeof fetch }
  w.__rdSettingsSport = sport
  try {
    for (const k of Object.keys(window.localStorage)) if (k.startsWith('af:league-section:e2e-rd-settings-')) window.localStorage.removeItem(k)
  } catch {
    /* storage is optional */
  }
  if (w.__rdSettingsFetch) return
  w.__rdSettingsFetch = true
  const real = w.fetch.bind(window)
  w.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url
    if (!url.startsWith('/api/')) return real(input, init)
    const s = w.__rdSettingsSport ?? 'NFL'
    const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
    if (String(init?.method ?? 'GET').toUpperCase() !== 'GET') return json({ error: 'Harness: writes are disabled.' }, 409)
    const path = url.split('?')[0]
    if (path.endsWith('/roster-settings')) return json(rosterSettingsResponse(s))
    if (path.endsWith('/draft/settings')) return json(draftSettingsResponse(s))
    return json({ error: 'not in harness' }, 404)
  }
}

type Props = { sport: HarnessSport; role: HarnessRole; leagueType: string; leagueVariant: string | null }

/** Harness only (app/e2e is 404 in production): the real workspace around the real League Settings page. */
export default function RedraftSettingsHarnessClient(props: Props) {
  // The capture script switches sport / role in place (window.__rdSettingsGo): a dev-mode reload per frame
  // costs far more than the render being photographed.
  const [view, setView] = useState({ sport: props.sport, role: props.role })
  const { sport, role } = view
  const { leagueType, leagueVariant } = props
  if (typeof window !== 'undefined') installFixtureFetch(sport)
  useEffect(() => {
    const w = window as unknown as { __rdSettingsGo?: (next: { sport: HarnessSport; role: HarnessRole }) => void }
    w.__rdSettingsGo = next => {
      installFixtureFetch(next.sport)
      setView({ sport: next.sport, role: next.role })
    }
    return () => {
      delete w.__rdSettingsGo
    }
  }, [])

  const cfg = SPORTS[sport]
  const commissioner = role === 'commissioner'
  const dynasty = leagueType === 'dynasty'
  const id = `e2e-rd-settings-${sport.toLowerCase()}`
  const settings = { playoff_team_count: 6, playoff_byes: 2, playoff_start_week: cfg.playoffStart, trade_review_mode: 'league_vote', inviteCode: 'RDHARNESS' }
  const display = {
    id,
    name: 'Sunday Night Redraft',
    platform: 'allfantasy',
    sport,
    format: dynasty ? 'dynasty' : 'redraft',
    scoring: 'Points',
    teamCount: 12,
    season: 2026,
    lifecycleState: 'in_season',
    currentWeek: cfg.week,
    leagueType,
    leagueVariant,
    isDynasty: dynasty,
    tradeDeadlineWeek: cfg.deadline,
    playoffStartWeek: cfg.playoffStart,
    isCommissioner: commissioner,
    settings,
  } as unknown as UserLeague
  const teams = MANAGERS.map((teamName, i) => ({
    id: `team-${i}`,
    leagueId: id,
    teamName,
    ownerName: teamName,
    claimedByUserId: i < 11 ? `user-${i}` : null,
    isCoCommissioner: i === 3,
  }))
  const ctx = {
    league: {
      id,
      name: display.name,
      sport,
      platform: 'allfantasy',
      platformLeagueId: id,
      userId: 'user-0',
      leagueType,
      leagueVariant,
      isDynasty: dynasty,
      leagueSize: 12,
      waiverType: cfg.waiverType,
      waiverBudget: 100,
      tradeDeadlineWeek: cfg.deadline,
      playoffTeams: 6,
      playoffStartWeek: cfg.playoffStart,
      scoringPresetId: null,
      settings,
      teams,
      invites: [],
    },
    displayLeague: display,
    userId: 'user-0',
    userTeam: null,
    sleeperLeagueId: null,
    platformLeagueId: id,
    isCommissioner: commissioner,
    isHeadCommissioner: commissioner,
    sleeperMemberMap: {},
    onGoToDraftTab: () => {},
  } as unknown as SubPanelContext

  return (
    <NativeLeagueWorkspace
      native
      league={display}
      leagues={[display]}
      tabs={TABS}
      activeTab="settings"
      isCommissioner={commissioner}
      onSelectTab={() => {}}
      onOpenSettings={() => {}}
      seasonFacts={{ totalWeeks: cfg.totalWeeks, playoffStartWeek: cfg.playoffStart, draftComplete: true }}
      leftPanel={null}
      rightPanel={null}
    >
      <div key={`${sport}-${role}`} data-testid="redraft-settings-harness" data-harness-sport={sport} data-harness-role={role}>
        <LeagueSettingsHomeContainer ctx={ctx} onExit={() => {}} />
      </div>
    </NativeLeagueWorkspace>
  )
}
