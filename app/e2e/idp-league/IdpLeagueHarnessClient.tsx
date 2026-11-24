'use client'

import { useMemo, useState } from 'react'
import { SessionProvider } from 'next-auth/react'
import type { UserLeague } from '@/app/dashboard/types'
import { NativeLeagueWorkspace } from '@/components/league/native/NativeLeagueWorkspace'
import IDPHome from '@/components/idp/IDPHome'
import { IDPTeamDashboard } from '@/app/idp/components/IDPTeamDashboard'
import { IDPMatchupView } from '@/app/idp/components/IDPMatchupView'
import { getLeagueTabsForViewer, localizeLeagueTabs, type TabDef } from '@/app/league/[leagueId]/LeagueTabs'
import { applyMatchupPrimaryTab, shouldUseMatchupInsteadOfDraft } from '@/lib/matchup-center/tabTransition'
import { useLanguage } from '@/components/i18n/LanguageProviderClient'
import {
  IDP_HARNESS_USER_ID,
  IDP_LEAGUE_ID,
  IDP_SEASON,
  IDP_WEEK,
  SHELL_TAB_FOR,
  installIdpLeagueHarnessFetch,
  isPreseason,
  leagueNameFor,
  lineupFor,
  playerMapFor,
  type IdpLeagueHarnessMood,
  type IdpLeagueHarnessTab,
} from './fixtures'
// LeagueShell loads /core's palette itself (the workspace does not), so the harness must too.
import '@/components/core-app/af-core.css'
// ScoresTab's own stylesheet (its `rdt-bridge` frame around IDPMatchupView).
import '@/app/league/[leagueId]/tabs/redraft-tailwind-tabs.css'

/**
 * The tab list LeagueShell builds for a native NFL IDP league (`tabDefs`, the non-core branch: an `idp` variant is a
 * specialty variant, so not nflRedraftCore). NFL's base tabs have no `redraft`, so IDP + Defense Hub go first; then
 * Settings; Matchup replaces Draft once the draft is done (applyMatchupPrimaryTab); then the workspace wrap.
 */
function tabsFor(league: UserLeague, isCommissioner: boolean, t: (key: string) => string): TabDef[] {
  const base = getLeagueTabsForViewer('NFL', isCommissioner)
  if (!base.some((tab) => tab.id === 'draft')) base.push({ id: 'draft', label: 'Draft HQ' })
  const withIdp = [{ id: 'idp', label: 'IDP' }, { id: 'defense_hub', label: 'Defense Hub' }, ...base]
  const withSettings = [...withIdp, { id: 'settings', label: 'Settings' }]
  return [
    { id: 'native_home', label: 'League home' },
    { id: 'decide', label: 'Decide' },
    { id: 'draft_intel', label: 'Live Intel' },
    ...localizeLeagueTabs(applyMatchupPrimaryTab(withSettings, shouldUseMatchupInsteadOfDraft(league)), t),
    { id: 'legacy', label: 'Legacy' },
    { id: 'activity', label: 'Activity' },
    { id: 'news', label: 'News' },
  ]
}

/** Harness only (app/e2e is 404 in production). Real components; data from ./fixtures.ts. */
export default function IdpLeagueHarnessClient({ tab, mood }: { tab: IdpLeagueHarnessTab; mood: IdpLeagueHarnessMood }) {
  const shellTab = SHELL_TAB_FOR[tab]
  // Synchronously, during the first render, so it is in place before any child effect fetches.
  useState(() => {
    installIdpLeagueHarnessFetch(mood)
    // The workspace restores the last section opened in this league (`af:league-section:<id>`) unless the URL names a
    // ?view=/?tab=. Without this, the first harness tab visited would win every later visit in the same browser.
    try { window.localStorage.setItem(`af:league-section:${IDP_LEAGUE_ID}`, shellTab) } catch { /* storage is optional */ }
  })
  const [activeTab, setActiveTab] = useState<string>(shellTab)
  const { t } = useLanguage()
  const preseason = isPreseason(mood)
  const league: UserLeague = {
    id: IDP_LEAGUE_ID,
    name: leagueNameFor(mood),
    platform: 'allfantasy',
    sport: 'NFL',
    format: 'redraft',
    scoring: 'PPR',
    teamCount: 12,
    season: IDP_SEASON,
    lifecycleState: preseason ? 'pre_draft' : 'in_season',
    currentWeek: preseason ? null : IDP_WEEK,
    leagueType: 'redraft',
    leagueVariant: 'idp',
    isDynasty: false,
    isCommissioner: false,
  } as UserLeague
  const tabs = useMemo(() => tabsFor(league, false, t), [league.lifecycleState, t]) // eslint-disable-line react-hooks/exhaustive-deps
  const players = useMemo(() => playerMapFor(mood), [mood])
  const { starterIds, benchIds } = useMemo(() => lineupFor(mood), [mood])

  const body =
    activeTab === 'idp' ? (
      // LeagueShell renderTab: `case 'idp': return <IDPHome leagueId={leagueId} />`
      <IDPHome leagueId={league.id} />
    ) : activeTab === 'roster' ? (
      // TeamTab's db-source branch: <IDPTeamDashboard … starterIds={dbParts.starters} benchIds={[...bench, ...taxi, ...ir]} />
      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto px-4 py-4 lg:px-6">
        <IDPTeamDashboard
          leagueId={league.id}
          week={preseason ? 1 : IDP_WEEK}
          sport="NFL"
          players={players}
          playersLoading={false}
          idpViewMode="full"
          positionMode="standard"
          starterIds={starterIds}
          benchIds={benchIds}
          onOffensePlayerClick={() => {}}
        />
      </div>
    ) : activeTab === 'scores' ? (
      // ScoresTab's Matchups pane for an IDP league.
      <div className="rdt-bridge min-h-0 flex-1 overflow-y-auto p-4 md:p-5">
        <IDPMatchupView leagueId={league.id} sport="NFL" live />
      </div>
    ) : (
      <p data-testid="idp-league-harness-other-tab">Not part of this harness.</p>
    )

  return (
    // On /e2e routes the app's SessionProvider holds a null session; IDPMatchupView and useIdpTeamCap wait for a user.
    <SessionProvider
      session={{ user: { id: IDP_HARNESS_USER_ID, name: 'Harness', email: null, image: null }, expires: '2099-01-01T00:00:00.000Z' } as never}
      refetchInterval={0}
      refetchOnWindowFocus={false}
    >
      <NativeLeagueWorkspace
        native
        league={league}
        leagues={[league]}
        tabs={tabs}
        activeTab={activeTab}
        isCommissioner={false}
        onSelectTab={setActiveTab}
        onOpenSettings={() => setActiveTab('settings')}
        seasonFacts={{ totalWeeks: 17, playoffStartWeek: 15, currentWeek: preseason ? null : IDP_WEEK, draftComplete: !preseason }}
        leftPanel={null}
        rightPanel={null}
        // LeagueShell's own shell props for a native (non-immersive) league: the workspace owns the full viewport.
        layoutMode="balanced-three-panel"
        rootClassName="af-core af-league-workspace h-[100dvh] min-h-0"
      >
        {/* LeagueShell's <main> and scroll frame for a native league. */}
        <main
          className="af-lsk-main relative z-[1] flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden"
          data-testid="league-command-center-surface"
          data-league-variant="idp"
        >
          <div className="flex min-h-0 flex-1 flex-col overflow-y-auto [scrollbar-gutter:stable]">{body}</div>
        </main>
      </NativeLeagueWorkspace>
    </SessionProvider>
  )
}
