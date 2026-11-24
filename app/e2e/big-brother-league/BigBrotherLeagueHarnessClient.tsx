'use client'

import { useState } from 'react'
import type { UserLeague } from '@/app/dashboard/types'
import { NativeLeagueWorkspace } from '@/components/league/native/NativeLeagueWorkspace'
import { BigBrotherHome } from '@/components/big-brother/BigBrotherHome'
import { BigBrotherCommandDashboard } from '@/components/big-brother/BigBrotherCommandDashboard'
import type { BigBrotherView } from '@/components/big-brother/types'
import { normalizeBigBrotherShellLeague } from '@/lib/big-brother/shellLeague'
import { BB_SEASON, BIG_BROTHER_LEAGUE_ID, installBigBrotherHarnessFetch, leagueNameFor, type BigBrotherHarnessMood } from './fixtures'
// LeagueShell loads /core's palette itself (the workspace does not), so the harness must too.
import '@/components/core-app/af-core.css'

const BB_CORE = [
  { id: 'big_brother', label: 'Big Brother' },
  { id: 'bb_hoh', label: 'HOH' },
  { id: 'bb_veto', label: 'Veto' },
  { id: 'bb_voting', label: 'Voting' },
  { id: 'bb_jury', label: 'Jury' },
  { id: 'bb_twists', label: 'Twists' },
  { id: 'bb_history', label: 'History' },
]

/**
 * The tab list LeagueShell builds for a native NFL Big Brother league: NFL's base tabs have no `redraft`, so the
 * house block (plus Command for a commissioner) goes first; Settings after them; then the workspace wrap (League home,
 * Decide, Live Intel ahead, Legacy / Activity / News behind).
 */
function tabsFor(isCommissioner: boolean) {
  const base = [
    ...BB_CORE,
    ...(isCommissioner ? [{ id: 'bb_command', label: 'Command' }] : []),
    { id: 'home', label: 'Home' }, { id: 'draft', label: 'Draft' }, { id: 'roster', label: 'My Team' },
    { id: 'matchups', label: 'Matchups' }, { id: 'schedule', label: 'Schedule' }, { id: 'players', label: 'Players' },
    { id: 'waivers', label: 'Waivers' }, { id: 'trades', label: 'Trades' }, { id: 'standings', label: 'Standings' },
    { id: 'war_room', label: 'AF Legacy' }, { id: 'league_chat', label: 'League Chat' },
    ...(isCommissioner ? [{ id: 'commissioner', label: 'Commissioner' }] : []),
    { id: 'settings', label: 'Settings' },
  ]
  return [
    { id: 'native_home', label: 'League home' }, { id: 'decide', label: 'Decide' }, { id: 'draft_intel', label: 'Live Intel' },
    ...base,
    { id: 'legacy', label: 'Legacy' }, { id: 'activity', label: 'Activity' }, { id: 'news', label: 'News' },
  ]
}

/** LeagueShell's `bbView` for each house tab. */
const VIEW_BY_TAB: Record<string, BigBrotherView> = {
  big_brother: 'house', bb_hoh: 'hoh', bb_veto: 'veto', bb_voting: 'voting', bb_jury: 'jury', bb_twists: 'twists', bb_history: 'history',
}

/** Harness only (app/e2e is 404 in production). Real components; data from ./fixtures.ts. */
export default function BigBrotherLeagueHarnessClient({ tab, mood }: { tab: string; mood: BigBrotherHarnessMood }) {
  // Synchronously, during the first render, so it is in place before any child effect fetches.
  useState(() => {
    installBigBrotherHarnessFetch(mood)
    // The workspace restores the last section opened in this league (`af:league-section:<id>`) unless the URL names a
    // ?view=/?tab=. Without this, the first harness tab visited would win every later visit in the same browser.
    try { window.localStorage.setItem(`af:league-section:${BIG_BROTHER_LEAGUE_ID}`, tab) } catch { /* storage is optional */ }
  })
  const [activeTab, setActiveTab] = useState<string>(tab)
  const isCommissioner = mood === 'commissioner'
  const preseason = mood === 'empty'
  const week = mood === 'jury_finale' ? 11 : mood === 'evicted_viewer' ? 6 : 5
  // Canonical creation writes the type and leaves the variant null; LeagueShell normalizes it for the client.
  const league: UserLeague = normalizeBigBrotherShellLeague({
    id: BIG_BROTHER_LEAGUE_ID,
    name: leagueNameFor(mood),
    platform: 'allfantasy',
    sport: 'NFL',
    format: 'redraft',
    scoring: 'Half PPR',
    teamCount: 12,
    season: BB_SEASON,
    lifecycleState: preseason ? 'pre_draft' : 'in_season',
    currentWeek: preseason ? null : week,
    leagueType: 'big_brother',
    leagueVariant: null,
    isDynasty: false,
    isCommissioner,
  })
  if (league.leagueVariant !== 'big_brother') throw new Error('harness league is not a Big Brother league')

  const view = VIEW_BY_TAB[activeTab]
  const body = view ? (
    <BigBrotherHome leagueId={league.id} initialView={view} isCommissioner={isCommissioner} shellNav />
  ) : activeTab === 'bb_command' ? (
    isCommissioner ? (
      <BigBrotherCommandDashboard leagueId={league.id} />
    ) : (
      <div className="rounded-xl border border-white/[0.08] bg-[#0a1228]/80 p-6 text-center text-sm text-white/55">
        Commissioner tools only.
      </div>
    )
  ) : (
    <p data-testid="big-brother-harness-other-tab">Not part of this harness.</p>
  )
  return (
    <NativeLeagueWorkspace
      native
      league={league}
      leagues={[league]}
      tabs={tabsFor(isCommissioner)}
      activeTab={activeTab}
      isCommissioner={isCommissioner}
      onSelectTab={setActiveTab}
      onOpenSettings={() => setActiveTab('settings')}
      seasonFacts={{ totalWeeks: 17, playoffStartWeek: 15, currentWeek: preseason ? null : week, draftComplete: !preseason }}
      leftPanel={null}
      rightPanel={null}
      // LeagueShell's own shell props for a native (non-immersive) league: the workspace owns the full viewport.
      layoutMode="balanced-three-panel"
      rootClassName="af-core af-league-workspace h-[100dvh] min-h-0"
    >
      {/* LeagueShell's <main> and scroll frame for a native league; BigBrotherHome has no scroll frame of its own. */}
      <main
        className="af-lsk-main relative z-[1] flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden"
        data-testid="league-command-center-surface"
        data-league-variant="big_brother"
      >
        <div className="flex min-h-0 flex-1 flex-col overflow-y-auto [scrollbar-gutter:stable]">{body}</div>
      </main>
    </NativeLeagueWorkspace>
  )
}
