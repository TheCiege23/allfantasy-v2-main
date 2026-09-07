'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import LeagueHeader from '@/components/league/LeagueHeader'
import LeagueTabs from '@/components/league/LeagueTabs'
import ChatBar from '@/components/league/ChatBar'
import BottomNav from '@/components/league/BottomNav'
import DraftTab from '@/components/league/tabs/DraftTab'
import TeamTab from '@/components/league/tabs/TeamTab'
import PlayersTab from '@/components/league/tabs/PlayersTab'
import LeagueTab from '@/components/league/tabs/LeagueTab'
import IntroVideoModal from '@/components/league/IntroVideoModal'
import type { LeagueHomeData, LeagueTopTab } from '@/components/league/types'
import LeagueStatusBar from '@/components/league/LeagueStatusBar'
import LeagueTypeConfirm from '@/components/league/LeagueTypeConfirm'
import CommissionerControlsPanel from '@/components/league/CommissionerControlsPanel'
import AuditLogViewer from '@/components/league/AuditLogViewer'
import LeagueFeed from '@/components/league-feed/LeagueFeed'
import { useLeagueLifecycleApiSync } from '@/hooks/useLeagueLifecycleApiSync'

const TOP_TABS: LeagueTopTab[] = ['DRAFT', 'TEAM', 'PLAYERS', 'LEAGUE']

function safeTab(value: string | null | undefined, fallback: LeagueTopTab): LeagueTopTab {
  if (!value) return fallback
  const upper = value.toUpperCase() as LeagueTopTab
  return TOP_TABS.includes(upper) ? upper : fallback
}

export default function LeagueHomeClient({
  data,
}: {
  data: LeagueHomeData
}) {
  const router = useRouter()
  const pathname = usePathname() ?? ""
  const searchParams = useSearchParams()
  const [activeTab, setActiveTab] = useState<LeagueTopTab>(data.activeTab)
  const [showIntroVideo, setShowIntroVideo] = useState(Boolean(data.introVideo?.shouldAutoOpen))
  /** Bumps audit log + league activity feed after commissioner actions. */
  const [leagueLiveRefresh, setLeagueLiveRefresh] = useState(0)

  const updateTab = useCallback(
    (tab: LeagueTopTab) => {
      setActiveTab(tab)
      const next = new URLSearchParams(searchParams?.toString() ?? '')
      next.set('tab', tab)
      router.replace(`${pathname}?${next.toString()}`, { scroll: false })
    },
    [pathname, router, searchParams]
  )

  const resolvedTab = useMemo(() => safeTab(searchParams?.get('tab'), activeTab), [activeTab, searchParams])
  const needsTeamDot = data.roster.overRosterLimitBy > 0 || data.trades.activeTrades.length > 0

  const { lifecycle: lifecycleLive, permissions: lifecyclePermissions } = useLeagueLifecycleApiSync(
    data.league.id,
    data.league.lifecycle,
  )

  useEffect(() => {
    setShowIntroVideo(Boolean(data.introVideo?.shouldAutoOpen))
  }, [data.introVideo?.shouldAutoOpen])

  const closeIntroVideo = useCallback(async () => {
    setShowIntroVideo(false)
    if (!data.introVideo?.shouldAutoOpen) return
    try {
      await fetch(`/api/leagues/${data.league.id}/intro`, { method: 'POST' })
    } catch {
      // Non-blocking: modal close should not depend on persistence.
    }
  }, [data.introVideo?.shouldAutoOpen, data.league.id])

  return (
    <div className="min-h-screen bg-[#0B0F1E] text-white">
      <LeagueHeader league={data.league} />
      <LeagueTabs activeTab={resolvedTab} onChange={updateTab} showTeamDot={needsTeamDot} />

      <main className="mx-auto max-w-md px-4 pb-[148px] pt-5">
        <LeagueStatusBar snapshot={lifecycleLive} currentWeek={data.league.currentWeek} />
        <LeagueTypeConfirm leagueId={data.league.id} className="mb-3" />
        <CommissionerControlsPanel
          leagueId={data.league.id}
          season={data.league.season}
          leagueRole={data.leagueRole}
          lifecycle={lifecycleLive}
          permissionsFromApi={lifecyclePermissions}
          onSuccessfulAction={() => setLeagueLiveRefresh((n) => n + 1)}
        />
        <AuditLogViewer leagueId={data.league.id} refreshSignal={leagueLiveRefresh} />
        <LeagueFeed leagueId={data.league.id} refreshSignal={leagueLiveRefresh} />
        {resolvedTab === 'DRAFT' ? (
          <DraftTab
            teams={data.teamsInDraftOrder}
            season={data.league.season}
            settingsItems={data.settingsItems}
            scoringSections={data.scoringSections}
            variant={data.variant}
            summaryCards={data.draftSummaryCards}
            keeperDeclarations={data.keeperDeclarations}
            draftRecap={data.draftRecap}
          />
        ) : null}

        {resolvedTab === 'TEAM' ? (
          <TeamTab
            leagueId={data.league.id}
            roster={data.roster}
            variant={data.variant}
            leagueSize={data.league.leagueSize ?? data.standings.length ?? 12}
          />
        ) : null}

        {resolvedTab === 'PLAYERS' ? (
          <PlayersTab leagueId={data.league.id} players={data.players} trades={data.trades} />
        ) : null}

        {resolvedTab === 'LEAGUE' ? (
          <LeagueTab
            leagueId={data.league.id}
            season={data.league.season}
            currentWeek={data.league.currentWeek}
            standings={data.standings}
            activity={data.activity}
            bracket={data.bracket}
            storyline={data.storyline}
            matchupPreview={data.matchupPreview}
            powerRankings={data.powerRankings}
            constitution={data.constitution}
          />
        ) : null}
      </main>

      <ChatBar chat={data.chat} />
      <BottomNav active="fantasy" />
      {data.introVideo ? (
        <IntroVideoModal data={data.introVideo} open={showIntroVideo} onClose={closeIntroVideo} />
      ) : null}
    </div>
  )
}
