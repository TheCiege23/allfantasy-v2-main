'use client'

import { useEffect, useState, type ReactNode } from 'react'
import type { UserLeague } from '@/app/dashboard/types'
import { NativeLeagueWorkspace } from '@/components/league/native/NativeLeagueWorkspace'
import { DecideHome } from '@/components/decide/DecideHome'
import { DraftIntelHome } from '@/components/decide/DraftIntelHome'
import { LegacyHome } from '@/components/decide/LegacyHome'
import { CommissionerOperationsWorkspace } from '@/components/league-home/CommissionerOperationsWorkspace'
// LeagueShell loads /core's palette itself (the workspace does not), so the harness must too.
import '@/components/core-app/af-core.css'
import {
  DECK_SPORTS,
  VIEWER_TEAM_ID,
  deckTeams,
  healthSummaryResponse,
  thisWeekResponse,
  tradesPanelResponse,
  weeklyChecklistResponse,
  type DeckSport,
  type DeckState,
} from './fixtures'

export type DeckTab = 'decide' | 'draft_intel' | 'legacy' | 'commissioner'

const TABS = [
  { id: 'native_home', label: 'League home' }, { id: 'decide', label: 'Decision OS' }, { id: 'draft_intel', label: 'Live Intel' },
  { id: 'legacy', label: 'Legacy' }, { id: 'standings', label: 'Standings' }, { id: 'league_chat', label: 'League Chat' },
  { id: 'commissioner', label: 'Commissioner' }, { id: 'settings', label: '⚙ Settings' },
]

/**
 * Answers the deck's own fetches from the fixtures, so the real components run with no database and no
 * provider. Installed during the first render — before any child effect — and only on this harness page.
 * The Sleeper-only feeds answer exactly what their routes answer for a league AllFantasy runs
 * (`supported: false`, an empty draft list), so the frames show what a native redraft league sees.
 * Anything not listed answers 404; writes are refused.
 */
function installFixtureFetch(sport: DeckSport, state: DeckState) {
  const w = window as unknown as { __rdDeckFetch?: boolean; __rdDeckKey?: string; fetch: typeof fetch }
  w.__rdDeckKey = `${sport}:${state}`
  if (w.__rdDeckFetch) return
  w.__rdDeckFetch = true
  const real = w.fetch.bind(window)
  w.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url
    if (!url.startsWith('/api/')) return real(input, init)
    const [s, st] = String(w.__rdDeckKey).split(':') as [DeckSport, DeckState]
    const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
    if (String(init?.method ?? 'GET').toUpperCase() !== 'GET') return json({ error: 'Harness: writes are disabled.' }, 409)
    const path = url.split('?')[0]
    const now = new Date()
    if (path === '/api/league/this-week') return json(thisWeekResponse(s, now.getTime()))
    if (path === '/api/league/trades-panel') return json(tradesPanelResponse(s))
    if (path === '/api/decision-os/manager-intelligence') return json({ recommendations: null, managerDna: null })
    if (['/api/league/matchup-center', '/api/league/waiver-intel', '/api/league/trade-finder', '/api/league/commissioner-pulse', '/api/league/history'].includes(path)) {
      return json({ supported: false, platform: 'allfantasy' })
    }
    if (path === '/api/draft/intel') return json({ linked: false, scope: 'league', drafts: [] })
    if (path.endsWith('/health-summary')) return json(healthSummaryResponse(st, now))
    if (path.endsWith('/weekly-checklist')) return json(weeklyChecklistResponse(s, `e2e-redraft-deck-${s.toLowerCase()}`, st, now))
    return json({ error: 'not in harness' }, 404)
  }
}

type Props = { tab: DeckTab; sport: DeckSport; state: DeckState; leagueType: string }

/** Harness only (app/e2e is 404 in production): the real workspace chrome around one real deck tab. */
export default function RedraftDeckHarnessClient(props: Props) {
  // The capture script switches tab / sport in place (window.__rdDeckGo) rather than reloading per frame.
  const [view, setView] = useState({ tab: props.tab, sport: props.sport, state: props.state })
  const { sport, state } = view
  if (typeof window !== 'undefined') installFixtureFetch(sport, state)
  const [activeTab, setActiveTab] = useState<string>(props.tab)
  useEffect(() => {
    const w = window as unknown as { __rdDeckGo?: (next: { tab: DeckTab; sport: DeckSport; state?: DeckState }) => void }
    w.__rdDeckGo = (next) => {
      installFixtureFetch(next.sport, next.state ?? 'season')
      setView({ tab: next.tab, sport: next.sport, state: next.state ?? 'season' })
      setActiveTab(next.tab)
    }
    return () => {
      delete w.__rdDeckGo
    }
  }, [])
  const cfg = DECK_SPORTS[sport]
  const league = {
    id: `e2e-redraft-deck-${sport.toLowerCase()}`,
    name: 'Sunday Night Redraft',
    platform: 'allfantasy',
    sport,
    format: 'redraft',
    scoring: 'Half PPR',
    teamCount: 12,
    season: 2026,
    lifecycleState: 'in_season',
    status: 'in_season',
    currentWeek: cfg.week,
    leagueType: props.leagueType,
    tradeDeadlineWeek: cfg.deadline,
    playoffStartWeek: cfg.playoffStart,
    isCommissioner: true,
  } as unknown as UserLeague
  const teams = deckTeams()
  const tab = activeTab as DeckTab
  // The same wrapper LeagueShell puts around these three tabs.
  const scroll = (node: ReactNode) => <div className="flex min-h-0 flex-1 flex-col overflow-y-auto px-4 py-4 lg:px-6">{node}</div>
  // A remount per sport/state, so each frame's fetches run against its own fixtures.
  const key = `${tab}:${sport}:${state}`
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
      seasonFacts={{ totalWeeks: cfg.total, playoffStartWeek: cfg.playoffStart, draftComplete: true }}
      leftPanel={null}
      rightPanel={null}
    >
      <div data-testid="redraft-deck-harness" data-tab={tab} data-sport-key={sport} style={{ display: 'contents' }} key={key}>
        {tab === 'decide'
          ? scroll(<DecideHome league={league} teams={teams} userTeamId={VIEWER_TEAM_ID} isCommissioner onOpenTab={setActiveTab} />)
          : tab === 'draft_intel'
            ? scroll(<DraftIntelHome league={league} leagueId={league.id} />)
            : tab === 'legacy'
              ? scroll(<LegacyHome league={league} leagueId={league.id} />)
              : tab === 'commissioner'
                ? (
                    <CommissionerOperationsWorkspace
                      league={league}
                      leagueId={league.id}
                      isCommissioner
                      isOwner
                      hasActiveRedraftSeason
                      onOpenSettings={() => setActiveTab('settings')}
                      onOpenTab={setActiveTab}
                    />
                  )
                : <p className="nl-eyebrow" style={{ padding: 24 }}>Harness: “{activeTab}” is not part of this deck fixture.</p>}
      </div>
    </NativeLeagueWorkspace>
  )
}
