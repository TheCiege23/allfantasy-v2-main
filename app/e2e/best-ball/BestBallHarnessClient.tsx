'use client'

import { useEffect, useState } from 'react'
import type { UserLeague } from '@/app/dashboard/types'
import { NativeLeagueWorkspace } from '@/components/league/native/NativeLeagueWorkspace'
import { getLeagueTabsForViewer } from '@/app/league/[leagueId]/LeagueTabs'
import { BestBallTab } from '@/app/league/[leagueId]/tabs/BestBallTab'
// The Best Ball panel, not the whole WarRoomTab: WarRoomTab's import graph reaches lib/prisma.ts
// (hooks/useLeagueWarRoomCompanion → lib/draft-room), which throws at module load on a dev server with no
// DATABASE_URL — and a harness server must have none. WarRoomTab mounts exactly this panel for a best ball league.
import { BestBallWarRoomPanel } from '@/app/league/[leagueId]/tabs/best-ball/BestBallWarRoomPanel'
import { BEST_BALL_API, BEST_BALL_LEAGUE_ID, type BestBallHarnessScreen } from './fixtures'
// LeagueShell loads /core's palette itself (the workspace does not), so the harness must too.
import '@/components/core-app/af-core.css'

/**
 * Answers the screen's /api/ reads in the browser from ./fixtures.ts (the first matching route wins: exact
 * pathname, every `query` entry equal). Everything else under /api/ gets a 503, so a widget the fixtures do not
 * feed shows its own error state and nothing reaches a route or a database. Installed synchronously during the
 * first render, before any child effect fetches.
 */
function installBestBallHarnessFetch() {
  if (typeof window === 'undefined') return
  const w = window as typeof window & { __bbHarnessFetch?: boolean }
  if (w.__bbHarnessFetch) return
  w.__bbHarnessFetch = true
  const real = window.fetch.bind(window)
  window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url, window.location.href)
    if (url.origin !== window.location.origin || !url.pathname.startsWith('/api/')) return real(input, init)
    const hit = BEST_BALL_API.find((r) => r.path === url.pathname && Object.entries(r.query ?? {}).every(([k, v]) => url.searchParams.get(k) === v))
    const status = hit ? 200 : 503
    return new Response(JSON.stringify(hit ? hit.body : { error: 'harness: no fixture' }), { status, headers: { 'Content-Type': 'application/json' } })
  }
}

/** The tab list LeagueShell gives a hosted best ball league: the general list, Draft HQ, then Best Ball. */
function bestBallTabs() {
  const base = getLeagueTabsForViewer('NFL', false)
  if (!base.some((t) => t.id === 'draft')) base.push({ id: 'draft', label: 'Draft HQ' })
  const idx = base.findIndex((t) => t.id === 'redraft')
  const bb = { id: 'bestball', label: 'Best Ball' }
  return idx >= 0 ? [...base.slice(0, idx + 1), bb, ...base.slice(idx + 1)] : [bb, ...base]
}

/**
 * Harness only (app/e2e is 404 in production): the real workspace frame around the real Best Ball tab (opened on
 * one of its four sub-tabs) or the real War Room tab, which adds the Best Ball War Room panel for this league.
 */
export default function BestBallHarnessClient({ screen }: { screen: BestBallHarnessScreen }) {
  useState(() => installBestBallHarnessFetch())
  const [activeTab, setActiveTab] = useState(screen === 'war_room' ? 'war_room' : 'bestball')
  const league = {
    id: BEST_BALL_LEAGUE_ID,
    name: 'Underdog Summer Best Ball',
    platform: 'allfantasy',
    sport: 'NFL',
    format: 'redraft',
    scoring: 'Half PPR',
    teamCount: 12,
    season: 2026,
    lifecycleState: 'in_season',
    currentWeek: 10,
    leagueType: 'redraft',
    leagueVariant: null,
    isDynasty: false,
    bestBallMode: true,
    isCommissioner: false,
  } as unknown as UserLeague

  // Open the sub-tab the frame asks for, the way a manager would: by pressing it once the data is in.
  useEffect(() => {
    if (screen === 'war_room' || screen === 'lineup') return
    let tries = 0
    const id = window.setInterval(() => {
      const btn = document.querySelector<HTMLButtonElement>(`[data-testid="bestball-sub-${screen}"]`)
      if (btn || ++tries > 50) {
        btn?.click()
        window.clearInterval(id)
      }
    }, 100)
    return () => window.clearInterval(id)
  }, [screen])

  const body = activeTab === 'war_room'
    ? <div className="p-4"><BestBallWarRoomPanel leagueId={BEST_BALL_LEAGUE_ID} /></div>
    : activeTab === 'bestball'
      ? <BestBallTab leagueId={BEST_BALL_LEAGUE_ID} sport="NFL" />
      : <p data-testid="bb-harness-other-tab">Not part of this harness.</p>
  return (
    <NativeLeagueWorkspace
      native
      league={league}
      leagues={[league]}
      tabs={bestBallTabs()}
      activeTab={activeTab}
      isCommissioner={false}
      onSelectTab={setActiveTab}
      onOpenSettings={() => setActiveTab('bestball')}
      leftPanel={null}
      rightPanel={null}
    >
      {body}
    </NativeLeagueWorkspace>
  )
}
