'use client'

import { useEffect, useMemo, useState } from 'react'
import { NflRedraftLeagueHomeDashboard } from '@/components/league-home/NflRedraftLeagueHomeDashboard'
import { ConceptIntroVideoOverlay } from '@/components/league/ConceptIntroVideoOverlay'
import type { UserLeague, UserLeagueTeam } from '@/app/dashboard/types'

const leagueId = 'g32-redraft-e2e-league'
const tabs = ['Home', 'Draft', 'Roster', 'Matchups', 'Waivers', 'Trades', 'Standings', 'League Chat', 'Commissioner']

function makeTeams(): UserLeagueTeam[] {
  return Array.from({ length: 12 }, (_, index) => ({
    id: index < 9 ? `team-${index + 1}` : '',
    externalId: String(index + 1),
    teamName: index === 0 ? 'Commissioner Alpha' : `Manager ${index + 1}`,
    ownerName: index < 9 ? `Owner ${index + 1}` : '',
    avatarUrl: null,
    role: index === 0 ? 'commissioner' : 'member',
    isOrphan: index >= 9,
    claimedByUserId: index < 9 ? `user-${index + 1}` : null,
    draftPosition: index + 1,
    wins: 0,
    losses: 0,
    ties: 0,
    pointsFor: 0,
    pointsAgainst: 0,
    currentRank: null,
    faabRemaining: null,
    waiverPriority: null,
    divisionId: null,
  }))
}

export default function G32NflRedraftLeagueHomeHarness() {
  const [commissioner, setCommissioner] = useState(true)
  const [mode, setMode] = useState<'dark' | 'light'>('dark')
  const [activeTab, setActiveTab] = useState('home')
  const [settingsPanel, setSettingsPanel] = useState<string | null>(null)
  const [introOpen, setIntroOpen] = useState(false)
  const teams = useMemo(() => makeTeams(), [])
  const league = useMemo(
    () =>
      ({
        id: leagueId,
        name: 'G32 NFL Redraft',
        platform: 'allfantasy',
        sport: 'NFL',
        format: 'redraft',
        scoring: 'Half PPR',
        teamCount: 12,
        season: 2026,
        status: 'pre_draft',
        leagueType: 'redraft',
        draftDate: '2026-08-20T23:00:00.000Z',
      }) as UserLeague,
    [],
  )

  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    setCommissioner(params.get('role') !== 'manager')
    setMode(params.get('mode') === 'light' ? 'light' : 'dark')
    setIntroOpen(params.get('playIntro') === '1')
  }, [])

  useEffect(() => {
    const onReplay = (event: Event) => {
      const detail = (event as CustomEvent<{ leagueId?: string }>).detail
      if (detail?.leagueId && detail.leagueId !== leagueId) return
      setIntroOpen(true)
    }

    window.addEventListener('af:replay-league-intro', onReplay)
    return () => window.removeEventListener('af:replay-league-intro', onReplay)
  }, [])

  return (
    <main
      className={mode === 'light' ? 'min-h-screen bg-[#f7f8fc] text-slate-950' : 'min-h-screen bg-[#050814] text-white'}
      data-mode={mode}
    >
      <div className="mx-auto flex min-h-screen max-w-7xl flex-col gap-3 p-4" data-testid="g32-league-home-harness">
        <header className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-white/10 bg-white/[0.04] p-3">
          <div>
            <p className="text-[11px] font-black uppercase tracking-[0.2em] text-cyan-200/75">E2E League Home</p>
            <h1 className="text-xl font-black">G32 NFL Redraft</h1>
          </div>
          <button
            type="button"
            onClick={() => setCommissioner((value) => !value)}
            className="rounded-xl border border-white/15 px-3 py-2 text-xs font-bold text-white/80"
            data-testid="g32-toggle-role"
          >
            {commissioner ? 'Commissioner view' : 'Manager view'}
          </button>
        </header>

        <nav className="flex gap-2 overflow-x-auto rounded-2xl border border-white/10 bg-white/[0.035] p-2" aria-label="G32 league tabs">
          {tabs.filter((tab) => commissioner || tab !== 'Commissioner').map((tab) => (
            <button
              key={tab}
              type="button"
              className="shrink-0 rounded-xl border border-white/10 px-3 py-2 text-xs font-bold text-white/80"
              onClick={() => setActiveTab(tab.toLowerCase().replace(/\s+/g, '_'))}
            >
              {tab}
            </button>
          ))}
        </nav>

        <NflRedraftLeagueHomeDashboard
          league={league}
          leagueId={leagueId}
          teamSlots={teams}
          userTeamName={commissioner ? 'Commissioner Alpha' : 'Manager 2'}
          isCommissioner={commissioner}
          draftDateIso={league.draftDate ?? null}
          onOpenSettings={setSettingsPanel}
          onOpenTab={setActiveTab}
        />

        <aside className="rounded-2xl border border-white/10 bg-white/[0.035] p-3 text-xs text-white/65" data-testid="g32-active-tab">
          Active tab: {activeTab}
        </aside>

        {settingsPanel !== null ? (
          <div
            role="dialog"
            aria-modal="true"
            aria-label="League settings"
            className="fixed inset-4 z-[70] overflow-y-auto rounded-3xl border border-white/15 bg-[#070b16] p-5 shadow-2xl md:inset-10"
            data-testid="g32-settings-modal"
          >
            <button
              type="button"
              onClick={() => setSettingsPanel(null)}
              className="float-right rounded-xl border border-white/15 px-3 py-2 text-xs font-bold text-white/70"
            >
              Close
            </button>
            <h2 className="text-2xl font-black">League settings</h2>
            <div className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {[
                'General',
                'Draft',
                'Roster',
                'Scoring',
                'Waivers',
                'Trades',
                'Playoffs',
                'Members',
                'Notifications',
                'Permissions',
                'Commissioner Intelligence',
                'Decision OS',
                'League Health',
                'Trade Health',
                'Manager Engagement',
                'Fair Play Monitoring',
                'Draft Readiness',
                'Automation',
                'Advanced Rule Support',
                'Weekly League Report',
              ].map((label) => (
                <div key={label} className="rounded-xl border border-white/10 bg-white/[0.04] px-3 py-2 text-sm font-semibold text-white/80">
                  {label}
                </div>
              ))}
            </div>
          </div>
        ) : null}
      </div>

      <ConceptIntroVideoOverlay
        open={introOpen}
        conceptLabel="Redraft"
        videoSrc="/media/league-intros/redraft-league-intro.mp4"
        onDismiss={() => setIntroOpen(false)}
      />
    </main>
  )
}
