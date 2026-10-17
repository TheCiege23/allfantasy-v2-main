'use client'

import type { FormEvent, ReactNode } from 'react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import {
  LayoutDashboard,
  Trophy,
  Users,
  BarChart3,
  CalendarClock,
  Settings2,
  MessageSquare,
  Sparkles,
  Share2,
  AlertTriangle,
  ExternalLink,
  ChevronRight,
  ClipboardList,
  CreditCard,
  History,
  Copy,
  Megaphone,
} from 'lucide-react'
import { toast } from 'sonner'
import { useLanguage } from '@/components/i18n/LanguageProviderClient'
import { TournamentControlDashboard } from '@/components/tournament/TournamentControlDashboard'
import { KingBuffaloPresentedBy } from '@/components/tournament/KingBuffaloPresentedBy'
import { TournamentLeagueSettingsModalLegacy } from '@/components/tournament/TournamentLeagueSettingsModalLegacy'
import { TournamentApprovalsCenter } from '@/components/tournament/TournamentApprovalsCenter'
import { TournamentDraftSchedulePanel } from '@/components/tournament/TournamentDraftSchedulePanel'
import { TournamentEligibilityControl } from '@/components/tournament/TournamentEligibilityControl'
import {
  TournamentWarRoomAmbient,
  WarRoomHeroCard,
  WarRoomPanel,
  WarRoomStatOrb,
  WarRoomTabButton,
} from '@/components/tournament/TournamentWarRoomPrimitives'
import { TournamentSubscriptionTokensPanel } from '@/components/tournament/TournamentSubscriptionTokensPanel'
import { TournamentHistoryArchivePanel } from '@/components/tournament/TournamentHistoryArchivePanel'
import { TournamentAiOperationsCenter } from '@/components/tournament/TournamentAiOperationsCenter'
import type { DraftScheduleV1 } from '@/lib/tournament/draft-schedule-types'
import { DRAFT_PHASE_KEYS } from '@/lib/tournament/draft-schedule-types'
import type { AfPlanId } from '@/lib/tournament/af-premium-plans'
import type { AiAutomationV1State } from '@/lib/tournament/ai-automation-hub'
import { defaultAiAutomationV1 } from '@/lib/tournament/ai-automation-hub'

type TabId =
  | 'overview'
  | 'leagues'
  | 'standings'
  | 'drafts'
  | 'settings'
  | 'members'
  | 'chat'
  | 'ai'
  | 'media'
  | 'subscription'
  | 'approvals'
  | 'history'

type Summary = {
  tournament: { id: string; name: string; sport: string; season: number; status: string; lockedAt: string | null }
  settingsSnapshot?: {
    participantPoolSize: number
    qualificationWeeks: number
    draftType: string
    roundRedraftSchedule: number[]
    finalsRedraftEnabled: boolean
    bubbleWeekEnabled: boolean
    faabBudgetDefault: number
  }
  counts: {
    subLeagues: number
    expectedSubLeagues: number
    totalFilledTeams: number
    totalEmptySlots: number
    totalCapacity: number
    participants: number
    waitlisted: number
    activeParticipants: number
    eliminated: number
  }
  rounds: Array<{
    roundIndex: number
    phase: string
    name: string | null
    startWeek: number | null
    endWeek: number | null
    status: string
  }>
  scheduleHints: { qualificationWeeks: number; redraftWeeks: number[] }
  hub?: {
    visibility: string
    waitlistEnabled: boolean
    maxWaitlist: number | null
    eligibilityMode?: string
    draftScheduleV1?: unknown | null
    aiAutomationV1?: AiAutomationV1State
  }
  monetization?: {
    afPlan: AfPlanId | null
    afTokensRemaining: number
    subscriptionPlans: string[]
    subscriptionStatus: string
  }
  feederLeagues?: Array<{
    tournamentLeagueId: string
    leagueId: string
    name: string
    conferenceName: string
    filledSlots: number
    capacity: number
    shell: { homepage: boolean; leagueChat: boolean; draftBoard: boolean; rosterShell: boolean }
    inviteCode: string
    joinUrl: string
  }>
}

type AccessFlags = {
  isCreator: boolean
  canUseControlConsole: boolean
  canEditHubSettings: boolean
}

type LegacyStandingsSnapshot = {
  round: {
    id: string
    roundNumber: number
    roundType: string
    roundLabel: string
    weekStart: number
    weekEnd: number
    status: string
  }
  leagues: Array<{
    id: string
    name: string
    conferenceId: string | null
    roundId: string
    leagueId: string | null
    status: string
    teamSlots: number
    advancersCount: number
    participants: Array<{
      id: string
      participantId: string
      wins: number
      losses: number
      ties: number
      pointsFor: number
      leagueRank: number
      participant: {
        displayName: string
      }
    }>
  }>
}

type AnnouncementFeedItem = {
  id: string
  title: string | null
  body: string
  type: string
  pinned: boolean
  createdAt: string
}

export function TournamentCommissionerDashboard({ tournamentId }: { tournamentId: string }) {
  const { t, tInterpolate } = useLanguage()
  const searchParams = useSearchParams()
  const created = searchParams?.get('created') === '1'
  const [tab, setTab] = useState<TabId>('overview')
  const [summary, setSummary] = useState<Summary | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [accessFlags, setAccessFlags] = useState<AccessFlags | null>(null)

  const tabs = useMemo(
    (): { id: TabId; label: string; icon: ReactNode }[] => [
      { id: 'overview', label: t('tournament.commissioner.tab.overview'), icon: <LayoutDashboard className="h-4 w-4" /> },
      { id: 'leagues', label: t('tournament.commissioner.tab.leagues'), icon: <Trophy className="h-4 w-4" /> },
      { id: 'standings', label: t('tournament.commissioner.tab.standings'), icon: <BarChart3 className="h-4 w-4" /> },
      { id: 'drafts', label: t('tournament.commissioner.tab.drafts'), icon: <CalendarClock className="h-4 w-4" /> },
      { id: 'settings', label: t('tournament.commissioner.tab.settings'), icon: <Settings2 className="h-4 w-4" /> },
      { id: 'members', label: t('tournament.commissioner.tab.members'), icon: <Users className="h-4 w-4" /> },
      { id: 'chat', label: t('tournament.commissioner.tab.chat'), icon: <MessageSquare className="h-4 w-4" /> },
      { id: 'ai', label: t('tournament.commissioner.tab.ai'), icon: <Sparkles className="h-4 w-4" /> },
      { id: 'media', label: t('tournament.commissioner.tab.media'), icon: <Share2 className="h-4 w-4" /> },
      { id: 'subscription', label: t('tournament.commissioner.tab.subscription'), icon: <CreditCard className="h-4 w-4" /> },
      { id: 'approvals', label: t('tournament.commissioner.tab.approvals'), icon: <ClipboardList className="h-4 w-4" /> },
      { id: 'history', label: t('tournament.commissioner.tab.history'), icon: <History className="h-4 w-4" /> },
    ],
    [t],
  )

  const loadAccess = useCallback(async () => {
    try {
      const res = await fetch(`/api/tournament/${encodeURIComponent(tournamentId)}/access`, { cache: 'no-store' })
      const j = await res.json().catch(() => ({}))
      if (res.ok && j.authenticated) {
        setAccessFlags({
          isCreator: Boolean(j.isCreator),
          canUseControlConsole: Boolean(j.canUseControlConsole),
          canEditHubSettings: Boolean(j.canEditHubSettings),
        })
      } else {
        setAccessFlags(null)
      }
    } catch {
      setAccessFlags(null)
    }
  }, [tournamentId])

  const loadSummary = useCallback(async () => {
    setLoadError(null)
    try {
      const res = await fetch(`/api/tournament/${encodeURIComponent(tournamentId)}/commissioner-dashboard`, {
        cache: 'no-store',
      })
      if (!res.ok) {
        const j = await res.json().catch(() => ({}))
        setLoadError(typeof j.error === 'string' ? j.error : t('tournament.commissioner.error.loadFailed'))
        setSummary(null)
        return
      }
      setSummary(await res.json())
    } catch {
      setLoadError(t('tournament.commissioner.error.network'))
      setSummary(null)
    }
  }, [t, tournamentId])

  useEffect(() => {
    loadSummary()
    loadAccess()
  }, [loadSummary, loadAccess])

  const phaseRoadmap = useMemo(() => {
    if (!summary?.rounds?.length) return []
    return summary.rounds.map((r) => ({
      label: r.name ?? r.phase,
      phase: r.phase,
      status: r.status,
      weeks: r.startWeek != null && r.endWeek != null ? `W${r.startWeek}–${r.endWeek}` : '—',
    }))
  }, [summary])

  const draftScheduleLines = useMemo(() => {
    const raw = summary?.hub?.draftScheduleV1
    if (!raw || typeof raw !== 'object') return [] as string[]
    const ds = raw as DraftScheduleV1
    const phases = ds.phases ?? {}
    const lines: string[] = []
    for (const key of DRAFT_PHASE_KEYS) {
      const ph = phases[key]
      const at = ph?.uniform?.scheduledAt
      if (typeof at === 'string' && at) {
        try {
          lines.push(`${t(`tournament.draftPhase.${key}`)} · ${new Date(at).toLocaleString()}`)
        } catch {
          /* ignore */
        }
      }
    }
    return lines
  }, [summary?.hub?.draftScheduleV1, t])

  const heroAccent = useMemo((): 'cyan' | 'amber' | 'violet' | 'emerald' => {
    const s = String(summary?.tournament.status ?? '').toLowerCase()
    if (s.includes('final') || s.includes('championship')) return 'amber'
    if (s.includes('cut') || s.includes('elim')) return 'violet'
    if (s.includes('qualif')) return 'emerald'
    return 'cyan'
  }, [summary?.tournament.status])

  return (
    <div className="relative min-h-[80vh] text-white">
      <TournamentWarRoomAmbient />
      <div className="relative z-10">
      <div className="mb-6">
        <WarRoomHeroCard phaseAccent={heroAccent}>
        <div className="border-b border-white/[0.07] px-1 pb-5 sm:px-2">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
            <div className="min-w-0">
              <p className="mb-1 text-[11px] font-bold uppercase tracking-[0.22em] text-cyan-300/90">
                {t('tournament.commissioner.warRoomEyebrow')}
              </p>
              <h1 className="bg-gradient-to-r from-white via-white to-cyan-200/90 bg-clip-text text-2xl font-black tracking-tight text-transparent sm:text-3xl">
                {summary?.tournament.name ?? t('tournament.commissioner.defaultName')}
              </h1>
              <p className="mt-1 text-sm text-white/55">
                {summary ? (
                  <>
                    {tInterpolate('tournament.commissioner.seasonLinePrefix', {
                      sport: summary.tournament.sport,
                      season: String(summary.tournament.season),
                    })}{' '}
                    <span className="font-medium text-cyan-100/90">{summary.tournament.status}</span>
                  </>
                ) : (
                  t('tournament.commissioner.loadingTournament')
                )}
              </p>
            </div>
            <div className="flex w-full max-w-md flex-col gap-2 lg:items-end">
              <KingBuffaloPresentedBy variant="strip" />
              <div className="flex flex-wrap gap-2">
                <Link
                  href={`/tournament/${tournamentId}`}
                  className="inline-flex items-center gap-1.5 rounded-xl border border-white/15 bg-white/[0.06] px-3 py-2 text-xs font-medium text-white/90 shadow-[inset_0_1px_0_rgba(255,255,255,0.08)] backdrop-blur-sm hover:bg-white/10"
                >
                  {t('tournament.commissioner.publicHub')} <ExternalLink className="h-3.5 w-3.5 opacity-70" />
                </Link>
                <button
                  type="button"
                  onClick={() => setSettingsOpen(true)}
                  className="inline-flex items-center gap-1.5 rounded-xl border border-cyan-400/30 bg-cyan-500/15 px-3 py-2 text-xs font-semibold text-cyan-50 shadow-[0_0_20px_-6px_rgba(34,211,238,0.45)] hover:bg-cyan-500/25"
                  data-testid="tournament-open-settings-modal"
                >
                  {t('tournament.commissioner.leagueSettingsBtn')}
                </button>
              </div>
            </div>
          </div>
        </div>

        {created ? (
          <div
            className="flex items-center gap-2 border-b border-emerald-500/25 bg-emerald-500/[0.12] px-4 py-2.5 text-xs text-emerald-100 sm:px-6"
            role="status"
          >
            <ChevronRight className="h-4 w-4 shrink-0 text-emerald-300/90" />
            {t('tournament.commissioner.createdBanner')}
          </div>
        ) : null}

        <div className="flex gap-1.5 overflow-x-auto px-2 py-3 sm:px-3">
          {tabs.map((tb) => (
            <WarRoomTabButton
              key={tb.id}
              active={tab === tb.id}
              onClick={() => setTab(tb.id)}
              icon={tb.icon}
              label={tb.label}
              testId={`tournament-commissioner-tab-${tb.id}`}
            />
          ))}
        </div>
        </WarRoomHeroCard>
      </div>

      {loadError ? (
        <div className="mb-6 rounded-xl border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-100" role="alert">
          {loadError}
        </div>
      ) : null}

      <div className="mt-6 space-y-6">
        {tab === 'overview' && summary && (
          <>
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              <WarRoomStatOrb
                label={t('tournament.commissioner.stat.currentPhase')}
                value={summary.tournament.status}
                hint={t('tournament.commissioner.stat.currentPhaseHint')}
                accent="cyan"
              />
              <WarRoomStatOrb
                label={t('tournament.commissioner.stat.filledCapacity')}
                value={`${summary.counts.totalFilledTeams} / ${summary.counts.totalCapacity}`}
                hint={t('tournament.commissioner.stat.filledCapacityHint')}
                accent="emerald"
              />
              <WarRoomStatOrb
                label={t('tournament.commissioner.stat.subLeagues')}
                value={String(summary.counts.subLeagues)}
                hint={t('tournament.commissioner.stat.subLeaguesHint')}
                accent="violet"
              />
              <WarRoomStatOrb
                label={t('tournament.commissioner.stat.waitlisted')}
                value={String(summary.counts.waitlisted)}
                hint={t('tournament.commissioner.stat.waitlistedHint')}
                accent="amber"
              />
              <WarRoomStatOrb
                label={t('tournament.commissioner.stat.active')}
                value={String(summary.counts.activeParticipants)}
                hint={t('tournament.commissioner.stat.activeHint')}
                accent="cyan"
              />
              <WarRoomStatOrb
                label={t('tournament.commissioner.stat.eliminated')}
                value={String(summary.counts.eliminated)}
                hint={t('tournament.commissioner.stat.eliminatedHint')}
                accent="violet"
              />
              <WarRoomStatOrb
                label={t('tournament.commissioner.stat.qualifierWindow')}
                value={tInterpolate('tournament.commissioner.stat.qualifierWeeks', {
                  weeks: String(summary.scheduleHints.qualificationWeeks),
                })}
                hint={t('tournament.commissioner.stat.qualifierHint')}
                accent="emerald"
              />
              <WarRoomStatOrb
                label={t('tournament.commissioner.stat.redraftBeats')}
                value={summary.scheduleHints.redraftWeeks?.join(', ') || t('tournament.commissioner.stat.emDash')}
                hint={t('tournament.commissioner.stat.redraftHint')}
                accent="amber"
              />
            </div>

            {draftScheduleLines.length > 0 ? (
              <div className="rounded-2xl border border-cyan-500/20 bg-gradient-to-r from-cyan-500/[0.08] via-white/[0.03] to-violet-500/[0.06] p-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.06)] sm:p-5">
                <h2 className="mb-2 flex items-center gap-2 text-xs font-bold uppercase tracking-[0.18em] text-cyan-200/90">
                  <CalendarClock className="h-4 w-4" /> {t('tournament.commissioner.draftPhaseClocks')}
                </h2>
                <ul className="flex flex-col gap-1.5 text-sm text-white/75 sm:flex-row sm:flex-wrap sm:gap-x-6">
                  {draftScheduleLines.map((line) => (
                    <li key={line} className="font-mono text-[13px] text-cyan-50/90">
                      {line}
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}

            <div className="grid gap-4 lg:grid-cols-2">
              <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4 sm:p-5">
                <h2 className="mb-3 flex items-center gap-2 text-sm font-bold uppercase tracking-wide text-white/70">
                  <BarChart3 className="h-4 w-4 text-cyan-400/90" /> {t('tournament.commissioner.phaseRoadmap')}
                </h2>
                <ol className="space-y-2 text-sm">
                  {phaseRoadmap.length === 0 ? (
                    <li className="text-white/50">{t('tournament.commissioner.noRoundRows')}</li>
                  ) : (
                    phaseRoadmap.map((s, i) => (
                      <li
                        key={`${s.phase}-${i}`}
                        className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-white/5 bg-black/20 px-3 py-2"
                      >
                        <span className="font-medium text-white/90">{s.label}</span>
                        <span className="text-xs text-white/45">
                          {s.weeks} · {s.status}
                        </span>
                      </li>
                    ))
                  )}
                </ol>
              </div>
              <div className="rounded-2xl border border-amber-500/15 bg-amber-950/10 p-4 sm:p-5">
                <h2 className="mb-3 flex items-center gap-2 text-sm font-bold uppercase tracking-wide text-amber-200/90">
                  <AlertTriangle className="h-4 w-4" /> {t('tournament.commissioner.actionCenter')}
                </h2>
                <ul className="space-y-2 text-sm text-white/75">
                  <li className="flex justify-between gap-2">
                    <span>{t('tournament.commissioner.chatUniversal')}</span>
                    <Link href={`/tournament/${tournamentId}/forum`} className="text-cyan-400 hover:text-cyan-300">
                      {t('tournament.commissioner.openForum')}
                    </Link>
                  </li>
                  <li className="flex justify-between gap-2">
                    <span>{t('tournament.commissioner.advanceCuts')}</span>
                    <button type="button" onClick={() => setTab('leagues')} className="text-cyan-400 hover:text-cyan-300">
                      {t('tournament.commissioner.goOperations')}
                    </button>
                  </li>
                  <li className="flex justify-between gap-2">
                    <span>{t('tournament.commissioner.standingsExport')}</span>
                    <Link href={`/tournament/${tournamentId}/standings`} className="text-cyan-400 hover:text-cyan-300">
                      {t('tournament.commissioner.viewStandings')}
                    </Link>
                  </li>
                </ul>
              </div>
            </div>

            {summary.feederLeagues && summary.feederLeagues.length > 0 ? (
              <div className="mt-4 rounded-2xl border border-white/10 bg-white/[0.03] p-4 sm:p-5">
                <h2 className="mb-3 text-sm font-bold uppercase tracking-wide text-white/70">
                  {t('tournament.commissioner.subLeagueShell')}
                </h2>
                <p className="mb-4 text-xs text-white/50">{t('tournament.commissioner.subLeagueShellBody')}</p>
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[640px] text-left text-[12px]">
                    <thead>
                      <tr className="border-b border-white/10 text-white/45">
                        <th className="py-2 pr-2">{t('tournament.commissioner.table.league')}</th>
                        <th className="py-2">{t('tournament.commissioner.table.roster')}</th>
                        <th className="py-2">{t('tournament.commissioner.table.shell')}</th>
                        <th className="py-2">{t('tournament.commissioner.table.invite')}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {summary.feederLeagues.map((fl) => (
                        <tr key={fl.tournamentLeagueId} className="border-b border-white/5">
                          <td className="py-2 pr-2">
                            <p className="font-medium text-white/90">{fl.name}</p>
                            <p className="text-[11px] text-white/35">{fl.conferenceName}</p>
                          </td>
                          <td className="py-2 text-white/70">
                            {fl.filledSlots}/{fl.capacity}
                          </td>
                          <td className="py-2 text-emerald-200/80">
                            {fl.shell.homepage && fl.shell.leagueChat && fl.shell.draftBoard
                              ? t('tournament.commissioner.shell.ready')
                              : t('tournament.commissioner.stat.emDash')}
                          </td>
                          <td className="py-2">
                            {fl.joinUrl ? (
                              <span className="text-cyan-300/90" title={fl.joinUrl}>
                                {t('tournament.commissioner.shell.linkSet')}
                              </span>
                            ) : fl.inviteCode ? (
                              <span className="font-mono text-[11px] text-white/50">{fl.inviteCode}</span>
                            ) : (
                              <span className="text-amber-200/80">{t('tournament.commissioner.shell.addInSettings')}</span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            ) : null}
          </>
        )}

        {tab === 'overview' && !summary && !loadError && (
          <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-8 text-center text-white/55">
            {t('tournament.commissioner.loadingOverview')}
          </div>
        )}

        {tab === 'leagues' && (
          <div className="space-y-4">
            <p className="text-sm text-white/55">{t('tournament.commissioner.operationsBlurb')}</p>
            {accessFlags && !accessFlags.canUseControlConsole ? (
              <div className="rounded-2xl border border-amber-500/25 bg-amber-950/15 px-4 py-3 text-sm text-amber-100/95">
                {tInterpolate('tournament.commissioner.roleGate', {
                  manageLeagues: t('tournament.commissioner.perm.manageLeagues'),
                  fullAdmin: t('tournament.commissioner.perm.fullAdmin'),
                })}
              </div>
            ) : (
              <TournamentControlDashboard tournamentId={tournamentId} hideLocalBackLink />
            )}
          </div>
        )}

        {tab === 'standings' && <StandingsTab tournamentId={tournamentId} summary={summary} />}

        {tab === 'drafts' && summary && (
          <Panel
            title={t('tournament.commissioner.draftsPanelTitle')}
            subtitle={t('tournament.commissioner.draftsPanelSubtitle')}
            actions={
              <Link href={`/tournament/${tournamentId}/drafts`} className="text-sm font-medium text-cyan-400 hover:text-cyan-300">
                {t('tournament.commissioner.openDraftsHub')}
              </Link>
            }
          >
            <TournamentDraftSchedulePanel
              tournamentId={tournamentId}
              feeders={(summary.feederLeagues ?? []).map((f) => ({ leagueId: f.leagueId, name: f.name }))}
              draftScheduleV1={summary.hub?.draftScheduleV1 ?? null}
              canEdit={accessFlags?.canEditHubSettings ?? false}
              onSaved={() => loadSummary()}
            />
            <p className="mt-4 text-xs text-white/45">{t('tournament.commissioner.draftsFooter')}</p>
          </Panel>
        )}

        {tab === 'settings' && (
          <div className="space-y-6">
            <TournamentEligibilityControl
              tournamentId={tournamentId}
              mode={summary?.hub?.eligibilityMode ?? 'open'}
              canEdit={accessFlags?.canEditHubSettings ?? false}
              onSaved={() => loadSummary()}
            />
            <Panel title={t('tournament.commissioner.universalVsOverrides')} subtitle={t('tournament.commissioner.universalVsOverridesSubtitle')}>
              <button
                type="button"
                onClick={() => setSettingsOpen(true)}
                className="rounded-xl border border-cyan-500/30 bg-cyan-500/10 px-4 py-3 text-sm font-medium text-cyan-100 hover:bg-cyan-500/15"
              >
                {t('tournament.commissioner.openTournamentSettings')}
              </button>
            </Panel>
          </div>
        )}

        {tab === 'approvals' && (
          <Panel title={t('tournament.commissioner.approvalsTitle')} subtitle={t('tournament.commissioner.approvalsSubtitle')}>
            <TournamentApprovalsCenter tournamentId={tournamentId} />
          </Panel>
        )}

        {tab === 'members' && (
          <MembersTab
            tournamentId={tournamentId}
            isCreator={accessFlags?.isCreator ?? false}
            onRefreshSummary={loadSummary}
          />
        )}

        {tab === 'chat' && (
          <ChatTab
            tournamentId={tournamentId}
            feederLeagues={summary?.feederLeagues}
            isCreator={accessFlags?.isCreator ?? false}
          />
        )}

        {tab === 'ai' && summary && (
          <TournamentAiOperationsCenter
            tournamentId={tournamentId}
            canEdit={accessFlags?.canEditHubSettings ?? false}
            afPlan={summary.monetization?.afPlan ?? null}
            initialAutomation={summary.hub?.aiAutomationV1 ?? defaultAiAutomationV1()}
            onSaved={() => loadSummary()}
          />
        )}
        {tab === 'ai' && !summary && !loadError && (
          <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-8 text-center text-white/55">
            {t('tournament.commissioner.loadingAi')}
          </div>
        )}

        {tab === 'subscription' && (
          <TournamentSubscriptionTokensPanel
            entitlements={{
              plan: summary?.monetization?.afPlan ?? null,
              afTokensRemaining: summary?.monetization?.afTokensRemaining ?? null,
            }}
          />
        )}

        {tab === 'history' && summary && (
          <TournamentHistoryArchivePanel rounds={summary.rounds} tournamentStatus={summary.tournament.status} />
        )}
        {tab === 'history' && !summary && !loadError && (
          <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-8 text-center text-white/55">
            {t('tournament.commissioner.loadingHistory')}
          </div>
        )}

        {tab === 'media' && <MediaTab tournamentId={tournamentId} feederLeagues={summary?.feederLeagues} />}
      </div>
      </div>

      <TournamentLeagueSettingsModalLegacy
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        tournamentId={tournamentId}
        hubSnapshot={summary?.hub}
        canEdit={accessFlags?.canEditHubSettings ?? false}
        onSaved={() => {
          loadSummary()
          setSettingsOpen(false)
        }}
      />
    </div>
  )
}

async function copyText(value: string, successMessage: string, errorMessage: string) {
  try {
    if (typeof navigator !== 'undefined' && navigator.clipboard) {
      await navigator.clipboard.writeText(value)
      toast.success(successMessage)
      return
    }
  } catch {
    // Fall through to the error toast below.
  }
  toast.error(errorMessage)
}

function resolvePublicTournamentUrl(tournamentId: string): string {
  if (typeof window === 'undefined') return `/tournament/${tournamentId}`
  return `${window.location.origin}/tournament/${tournamentId}`
}

function StandingsTab({ tournamentId, summary }: { tournamentId: string; summary: Summary | null }) {
  const { t, tInterpolate } = useLanguage()
  const [snapshot, setSnapshot] = useState<LegacyStandingsSnapshot | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const loadSnapshot = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`/api/tournament/standings?tournamentId=${encodeURIComponent(tournamentId)}`, {
        cache: 'no-store',
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(typeof json.error === 'string' ? json.error : t('tournament.commissioner.error.standings'))
        setSnapshot(null)
        return
      }
      setSnapshot(json as LegacyStandingsSnapshot)
    } catch {
      setError(t('tournament.commissioner.error.standings'))
      setSnapshot(null)
    } finally {
      setLoading(false)
    }
  }, [t, tournamentId])

  useEffect(() => {
    void loadSnapshot()
  }, [loadSnapshot])

  return (
    <Panel
      title={t('tournament.commissioner.standings.title')}
      subtitle={t('tournament.commissioner.standings.subtitle')}
      actions={
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => void loadSnapshot()}
            className="text-sm font-medium text-white/60 hover:text-white/85"
          >
            {t('tournament.commissioner.refresh')}
          </button>
          <Link
            href={`/tournament/${tournamentId}/standings`}
            className="text-sm font-medium text-cyan-400 hover:text-cyan-300"
          >
            {t('tournament.commissioner.openFullStandings')}
          </Link>
        </div>
      }
    >
      {summary ? (
        <div className="mb-4 grid gap-3 sm:grid-cols-3">
          <div className="rounded-xl border border-white/10 bg-black/20 px-3 py-3 text-sm text-white/75">
            <p className="text-[11px] uppercase tracking-wide text-white/40">
              {t('tournament.commissioner.standings.participantPool')}
            </p>
            <p className="mt-1 font-semibold text-white/90">
              {tInterpolate('tournament.commissioner.standings.participantPoolValue', {
                active: String(summary.counts.activeParticipants),
                entered: String(summary.counts.participants),
              })}
            </p>
          </div>
          <div className="rounded-xl border border-white/10 bg-black/20 px-3 py-3 text-sm text-white/75">
            <p className="text-[11px] uppercase tracking-wide text-white/40">
              {t('tournament.commissioner.standings.qualification')}
            </p>
            <p className="mt-1 font-semibold text-white/90">
              {tInterpolate('tournament.commissioner.standings.weeks', {
                n: String(
                  summary.settingsSnapshot?.qualificationWeeks ?? summary.scheduleHints.qualificationWeeks,
                ),
              })}
            </p>
          </div>
          <div className="rounded-xl border border-white/10 bg-black/20 px-3 py-3 text-sm text-white/75">
            <p className="text-[11px] uppercase tracking-wide text-white/40">
              {t('tournament.commissioner.standings.expectedFeeders')}
            </p>
            <p className="mt-1 font-semibold text-white/90">{summary.counts.expectedSubLeagues}</p>
          </div>
        </div>
      ) : null}

      {loading ? <p className="text-sm text-white/50">{t('tournament.commissioner.standings.loading')}</p> : null}
      {!loading && error ? <p className="text-sm text-rose-200">{error}</p> : null}
      {!loading && !error && snapshot?.leagues?.length === 0 ? (
        <p className="text-sm text-white/50">{t('tournament.commissioner.standings.noRows')}</p>
      ) : null}
      {!loading && !error && snapshot ? (
        <div className="space-y-4">
          <div className="rounded-xl border border-cyan-500/15 bg-cyan-500/[0.06] px-3 py-3 text-sm text-cyan-50/90">
            {tInterpolate('tournament.commissioner.standings.roundLine', {
              label: snapshot.round.roundLabel,
              start: String(snapshot.round.weekStart),
              end: String(snapshot.round.weekEnd),
              status: snapshot.round.status,
            })}
          </div>
          <div className="grid gap-4 xl:grid-cols-2">
            {snapshot.leagues.map((league) => (
              <div key={league.id} className="rounded-2xl border border-white/10 bg-black/20 p-4">
                <div className="mb-3 flex items-center justify-between gap-3">
                  <div>
                    <h3 className="text-sm font-semibold text-white/90">{league.name}</h3>
                    <p className="text-xs text-white/45">
                      {tInterpolate('tournament.commissioner.standings.teamsLine', {
                        count: String(league.participants.length),
                        slots: String(league.teamSlots),
                      })}
                      {league.advancersCount > 0
                        ? ` · ${tInterpolate('tournament.commissioner.standings.advance', { n: String(league.advancersCount) })}`
                        : ''}
                    </p>
                  </div>
                  {league.leagueId ? (
                    <Link href={`/league/${league.leagueId}`} className="text-xs font-medium text-cyan-400 hover:text-cyan-300">
                      {t('tournament.commissioner.standings.leagueRoom')}
                    </Link>
                  ) : null}
                </div>
                <div className="space-y-2">
                  {league.participants.slice(0, 6).map((row) => (
                    <div
                      key={row.id}
                      className="flex items-center justify-between gap-3 rounded-lg border border-white/5 bg-white/[0.03] px-3 py-2 text-sm"
                    >
                      <div className="min-w-0">
                        <p className="truncate font-medium text-white/90">
                          #{row.leagueRank} {row.participant.displayName}
                        </p>
                        <p className="text-xs text-white/45">
                          {tInterpolate('tournament.commissioner.standings.recordLine', {
                            w: String(row.wins),
                            l: String(row.losses),
                            t: String(row.ties),
                            pf: row.pointsFor.toFixed(1),
                          })}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </Panel>
  )
}

function ChatTab({
  tournamentId,
  feederLeagues,
  isCreator,
}: {
  tournamentId: string
  feederLeagues: Summary['feederLeagues']
  isCreator: boolean
}) {
  const { t } = useLanguage()
  const [announcements, setAnnouncements] = useState<AnnouncementFeedItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [posting, setPosting] = useState(false)
  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')
  const [pinned, setPinned] = useState(false)

  const loadAnnouncements = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`/api/tournament/${encodeURIComponent(tournamentId)}/announcements`, {
        cache: 'no-store',
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(typeof json.error === 'string' ? json.error : t('tournament.commissioner.error.announcementsLoad'))
        setAnnouncements([])
        return
      }
      setAnnouncements(Array.isArray(json.announcements) ? (json.announcements as AnnouncementFeedItem[]) : [])
    } catch {
      setError(t('tournament.commissioner.error.announcementsLoad'))
      setAnnouncements([])
    } finally {
      setLoading(false)
    }
  }, [t, tournamentId])

  useEffect(() => {
    void loadAnnouncements()
  }, [loadAnnouncements])

  async function postAnnouncement(event: FormEvent) {
    event.preventDefault()
    if (!body.trim()) return
    setPosting(true)
    try {
      const res = await fetch(`/api/tournament/${encodeURIComponent(tournamentId)}/announcements`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: title.trim() || null,
          body: body.trim(),
          pinned,
          type: 'commissioner_update',
        }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) {
        toast.error(typeof json.error === 'string' ? json.error : t('tournament.commissioner.error.announcementsPost'))
        return
      }
      setTitle('')
      setBody('')
      setPinned(false)
      toast.success(t('tournament.commissioner.toast.announcementPosted'))
      await loadAnnouncements()
    } finally {
      setPosting(false)
    }
  }

  return (
    <Panel
      title={t('tournament.commissioner.chat.title')}
      subtitle={t('tournament.commissioner.chat.subtitle')}
      actions={
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => void loadAnnouncements()}
            className="text-sm font-medium text-white/60 hover:text-white/85"
          >
            {t('tournament.commissioner.refresh')}
          </button>
          <Link href={`/tournament/${tournamentId}/forum`} className="text-sm font-medium text-cyan-400 hover:text-cyan-300">
            {t('tournament.commissioner.openForum')}
          </Link>
        </div>
      }
    >
      <div className="grid gap-4 xl:grid-cols-[1.2fr_0.8fr]">
        <div className="space-y-3">
          {loading ? <p className="text-sm text-white/50">{t('tournament.commissioner.chat.loading')}</p> : null}
          {!loading && error ? <p className="text-sm text-rose-200">{error}</p> : null}
          {!loading && !error && announcements.length === 0 ? (
            <p className="text-sm text-white/50">{t('tournament.commissioner.chat.empty')}</p>
          ) : null}
          {!loading && !error
            ? announcements.slice(0, 8).map((item) => (
                <div key={item.id} className="rounded-2xl border border-white/10 bg-black/20 p-4">
                  <div className="mb-2 flex items-center justify-between gap-3">
                    <div className="flex items-center gap-2 text-xs uppercase tracking-wide text-white/45">
                      <Megaphone className="h-4 w-4 text-cyan-300/80" />
                      <span>{item.type.replace(/_/g, ' ')}</span>
                      {item.pinned ? (
                        <span className="rounded-full border border-amber-400/30 px-2 py-0.5 text-amber-200">
                          {t('tournament.commissioner.chat.pinned')}
                        </span>
                      ) : null}
                    </div>
                    <span className="text-xs text-white/35">{new Date(item.createdAt).toLocaleString()}</span>
                  </div>
                  {item.title ? <h3 className="text-sm font-semibold text-white/90">{item.title}</h3> : null}
                  <p className="mt-1 text-sm text-white/70">{item.body}</p>
                </div>
              ))
            : null}
        </div>

        <div className="space-y-4">
          {isCreator ? (
            <form onSubmit={postAnnouncement} className="rounded-2xl border border-cyan-500/20 bg-cyan-500/[0.06] p-4">
              <h3 className="text-sm font-semibold text-cyan-50/95">{t('tournament.commissioner.chat.postFormTitle')}</h3>
              <div className="mt-3 space-y-3">
                <input
                  value={title}
                  onChange={(event) => setTitle(event.target.value)}
                  placeholder={t('tournament.commissioner.chat.titlePlaceholder')}
                  className="w-full rounded-xl border border-white/10 bg-black/20 px-3 py-2 text-sm text-white outline-none placeholder:text-white/30"
                />
                <textarea
                  value={body}
                  onChange={(event) => setBody(event.target.value)}
                  placeholder={t('tournament.commissioner.chat.bodyPlaceholder')}
                  rows={5}
                  className="w-full rounded-xl border border-white/10 bg-black/20 px-3 py-2 text-sm text-white outline-none placeholder:text-white/30"
                />
                <label className="flex items-center gap-2 text-sm text-white/75">
                  <input type="checkbox" checked={pinned} onChange={(event) => setPinned(event.target.checked)} />
                  {t('tournament.commissioner.chat.pinLabel')}
                </label>
                <button
                  type="submit"
                  disabled={posting || !body.trim()}
                  className="rounded-xl border border-cyan-400/30 bg-cyan-500/15 px-4 py-2 text-sm font-semibold text-cyan-50 hover:bg-cyan-500/25 disabled:opacity-50"
                >
                  {posting ? t('tournament.commissioner.chat.posting') : t('tournament.commissioner.chat.postUpdate')}
                </button>
              </div>
            </form>
          ) : null}

          <div className="rounded-2xl border border-white/10 bg-black/20 p-4">
            <h3 className="text-sm font-semibold text-white/90">{t('tournament.commissioner.chat.surfacesTitle')}</h3>
            <div className="mt-3 space-y-2 text-sm text-white/70">
              {(feederLeagues ?? []).slice(0, 8).map((league) => (
                <div key={league.tournamentLeagueId} className="flex items-center justify-between gap-3 rounded-lg border border-white/5 bg-white/[0.03] px-3 py-2">
                  <div>
                    <p className="font-medium text-white/90">{league.name}</p>
                    <p className="text-xs text-white/40">{league.conferenceName}</p>
                  </div>
                  {league.leagueId ? (
                    <Link href={`/league/${league.leagueId}`} className="text-xs font-medium text-cyan-400 hover:text-cyan-300">
                      {t('tournament.commissioner.chat.openLeagueChat')}
                    </Link>
                  ) : null}
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </Panel>
  )
}

function MediaTab({ tournamentId, feederLeagues }: { tournamentId: string; feederLeagues: Summary['feederLeagues'] }) {
  const { t, tInterpolate } = useLanguage()
  const publicUrl = resolvePublicTournamentUrl(tournamentId)

  return (
    <Panel title={t('tournament.commissioner.media.title')} subtitle={t('tournament.commissioner.media.subtitle')}>
      <div className="space-y-4">
        <div className="rounded-2xl border border-white/10 bg-black/20 p-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-sm font-semibold text-white/90">{t('tournament.commissioner.media.publicHubTitle')}</p>
              <p className="text-xs text-white/45">{t('tournament.commissioner.media.publicHubBody')}</p>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() =>
                  void copyText(publicUrl, t('tournament.commissioner.media.hubLinkCopied'), t('tournament.commissioner.error.clipboard'))
                }
                className="inline-flex items-center gap-1.5 rounded-xl border border-white/10 bg-white/[0.04] px-3 py-2 text-xs font-medium text-white/85 hover:bg-white/[0.08]"
              >
                <Copy className="h-3.5 w-3.5" /> {t('tournament.commissioner.media.copyLink')}
              </button>
              <Link href={`/tournament/${tournamentId}`} className="rounded-xl border border-cyan-400/30 bg-cyan-500/10 px-3 py-2 text-xs font-medium text-cyan-50 hover:bg-cyan-500/20">
                {t('tournament.commissioner.media.openHub')}
              </Link>
            </div>
          </div>
          <p className="mt-3 rounded-lg border border-white/5 bg-white/[0.03] px-3 py-2 font-mono text-xs text-cyan-100/80">{publicUrl}</p>
        </div>

        <div className="rounded-2xl border border-white/10 bg-black/20 p-4">
          <h3 className="text-sm font-semibold text-white/90">{t('tournament.commissioner.media.feederInvites')}</h3>
          <div className="mt-3 space-y-2">
            {(feederLeagues ?? []).length === 0 ? (
              <p className="text-sm text-white/50">{t('tournament.commissioner.media.noFeeders')}</p>
            ) : null}
            {(feederLeagues ?? []).map((league) => {
              const inviteValue = league.joinUrl || league.inviteCode
              return (
                <div key={league.tournamentLeagueId} className="rounded-xl border border-white/5 bg-white/[0.03] px-3 py-3">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <p className="text-sm font-medium text-white/90">{league.name}</p>
                      <p className="text-xs text-white/40">
                        {tInterpolate('tournament.commissioner.media.filledLine', {
                          conference: league.conferenceName,
                          filled: String(league.filledSlots),
                          capacity: String(league.capacity),
                        })}
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      {inviteValue ? (
                        <button
                          type="button"
                          onClick={() =>
                            void copyText(
                              inviteValue,
                              tInterpolate('tournament.commissioner.media.inviteCopied', { name: league.name }),
                              t('tournament.commissioner.error.clipboard'),
                            )
                          }
                          className="inline-flex items-center gap-1.5 rounded-lg border border-white/10 bg-white/[0.04] px-3 py-2 text-xs font-medium text-white/85 hover:bg-white/[0.08]"
                        >
                          <Copy className="h-3.5 w-3.5" /> {t('tournament.commissioner.media.copy')}
                        </button>
                      ) : null}
                      {league.joinUrl ? (
                        <a
                          href={league.joinUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="rounded-lg border border-cyan-400/30 bg-cyan-500/10 px-3 py-2 text-xs font-medium text-cyan-50 hover:bg-cyan-500/20"
                        >
                          {t('tournament.commissioner.media.openInvite')}
                        </a>
                      ) : null}
                    </div>
                  </div>
                  <p className="mt-2 break-all rounded-lg border border-white/5 bg-black/20 px-3 py-2 font-mono text-[11px] text-white/65">
                    {league.joinUrl || league.inviteCode || t('tournament.commissioner.media.invitePending')}
                  </p>
                </div>
              )
            })}
          </div>
        </div>
      </div>
    </Panel>
  )
}

function MembersTab({
  tournamentId,
  isCreator,
  onRefreshSummary,
}: {
  tournamentId: string
  isCreator: boolean
  onRefreshSummary: () => void
}) {
  const { t } = useLanguage()
  const [waitlist, setWaitlist] = useState<
    Array<{ order: number; userId: string; displayName: string; createdAt: string }>
  >([])
  const [staff, setStaff] = useState<
    Array<{ userId: string; displayName: string; permissions: Record<string, unknown> }>
  >([])
  const [loading, setLoading] = useState(true)
  const [staffUserId, setStaffUserId] = useState('')
  const [perm, setPerm] = useState({
    dashboard: true,
    manageLeagues: false,
    manageDrafts: false,
    manageChat: false,
    manageSettings: false,
    fullAdmin: false,
  })
  const [staffSaving, setStaffSaving] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const wRes = await fetch(`/api/tournament/${encodeURIComponent(tournamentId)}/waitlist`, { cache: 'no-store' })
      const wJson = await wRes.json().catch(() => ({}))
      if (wRes.ok && Array.isArray(wJson.entries)) setWaitlist(wJson.entries)
      else setWaitlist([])

      if (isCreator) {
        const sRes = await fetch(`/api/tournament/${encodeURIComponent(tournamentId)}/staff`, { cache: 'no-store' })
        const sJson = await sRes.json().catch(() => ({}))
        if (sRes.ok && Array.isArray(sJson.staff)) setStaff(sJson.staff)
        else setStaff([])
      } else {
        setStaff([])
      }
    } catch {
      setWaitlist([])
      setStaff([])
    } finally {
      setLoading(false)
    }
  }, [tournamentId, isCreator])

  useEffect(() => {
    load()
  }, [load])

  async function removeWaitlist(userId: string) {
    const res = await fetch(
      `/api/tournament/${encodeURIComponent(tournamentId)}/waitlist?userId=${encodeURIComponent(userId)}`,
      { method: 'DELETE' },
    )
    if (res.ok) {
      await load()
      onRefreshSummary()
    }
  }

  async function addStaff(e: FormEvent) {
    e.preventDefault()
    const uid = staffUserId.trim()
    if (!uid) return
    setStaffSaving(true)
    try {
      const res = await fetch(`/api/tournament/${encodeURIComponent(tournamentId)}/staff`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          assigneeUserId: uid,
          permissions: {
            dashboard: perm.dashboard || perm.fullAdmin,
            manageLeagues: perm.manageLeagues || perm.fullAdmin,
            manageDrafts: perm.manageDrafts || perm.fullAdmin,
            manageChat: perm.manageChat || perm.fullAdmin,
            manageSettings: perm.manageSettings || perm.fullAdmin,
            fullAdmin: perm.fullAdmin,
          },
        }),
      })
      if (res.ok) {
        setStaffUserId('')
        await load()
      }
    } finally {
      setStaffSaving(false)
    }
  }

  async function removeStaff(userId: string) {
    const res = await fetch(
      `/api/tournament/${encodeURIComponent(tournamentId)}/staff?userId=${encodeURIComponent(userId)}`,
      { method: 'DELETE' },
    )
    if (res.ok) await load()
  }

  return (
    <div className="space-y-6">
      <Panel title={t('tournament.commissioner.members.waitlistTitle')} subtitle={t('tournament.commissioner.members.waitlistSubtitle')}>
        {loading ? (
          <p className="text-sm text-white/50">{t('tournament.commissioner.members.loading')}</p>
        ) : waitlist.length === 0 ? (
          <p className="text-sm text-white/50">{t('tournament.commissioner.members.waitlistEmpty')}</p>
        ) : (
          <ul className="space-y-2">
            {waitlist.map((row) => (
              <li
                key={row.userId}
                className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-white/10 bg-black/20 px-3 py-2 text-sm"
              >
                <span>
                  <span className="text-white/40">#{row.order}</span> {row.displayName}{' '}
                  <span className="font-mono text-[11px] text-white/35">({row.userId.slice(0, 8)}…)</span>
                </span>
                <button
                  type="button"
                  onClick={() => void removeWaitlist(row.userId)}
                  className="text-xs text-rose-300 hover:text-rose-200"
                >
                  {t('tournament.commissioner.members.remove')}
                </button>
              </li>
            ))}
          </ul>
        )}
      </Panel>

      {isCreator ? (
        <Panel title={t('tournament.commissioner.members.staffTitle')} subtitle={t('tournament.commissioner.members.staffSubtitle')}>
          <ul className="mb-4 space-y-2">
            {staff.length === 0 ? (
              <p className="text-sm text-white/50">{t('tournament.commissioner.members.staffEmpty')}</p>
            ) : (
              staff.map((s) => (
                <li
                  key={s.userId}
                  className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-white/10 px-3 py-2 text-sm"
                >
                  <span>{s.displayName}</span>
                  <button
                    type="button"
                    onClick={() => void removeStaff(s.userId)}
                    className="text-xs text-rose-300 hover:text-rose-200"
                  >
                    {t('tournament.commissioner.members.remove')}
                  </button>
                </li>
              ))
            )}
          </ul>
          <form onSubmit={addStaff} className="space-y-3 rounded-xl border border-white/10 bg-white/[0.02] p-4">
            <p className="text-xs font-semibold uppercase tracking-wide text-white/45">
              {t('tournament.commissioner.members.addStaffById')}
            </p>
            <input
              value={staffUserId}
              onChange={(e) => setStaffUserId(e.target.value)}
              placeholder={t('tournament.commissioner.members.userUuidPlaceholder')}
              className="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 font-mono text-sm text-white"
            />
            <div className="grid gap-2 text-xs text-white/75 sm:grid-cols-2">
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={perm.dashboard}
                  onChange={(e) => setPerm((p) => ({ ...p, dashboard: e.target.checked }))}
                />
                {t('tournament.commissioner.members.perm.dashboard')}
              </label>
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={perm.manageLeagues}
                  onChange={(e) => setPerm((p) => ({ ...p, manageLeagues: e.target.checked }))}
                />
                {t('tournament.commissioner.members.perm.manageLeagues')}
              </label>
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={perm.manageSettings}
                  onChange={(e) => setPerm((p) => ({ ...p, manageSettings: e.target.checked }))}
                />
                {t('tournament.commissioner.members.perm.manageSettings')}
              </label>
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={perm.fullAdmin}
                  onChange={(e) => setPerm((p) => ({ ...p, fullAdmin: e.target.checked }))}
                />
                {t('tournament.commissioner.members.perm.fullAdmin')}
              </label>
            </div>
            <button
              type="submit"
              disabled={staffSaving}
              className="rounded-lg border border-cyan-500/30 bg-cyan-500/10 px-4 py-2 text-sm text-cyan-100 hover:bg-cyan-500/20 disabled:opacity-50"
            >
              {staffSaving ? t('tournament.commissioner.members.saving') : t('tournament.commissioner.members.addStaff')}
            </button>
          </form>
        </Panel>
      ) : null}

      <Panel title={t('tournament.commissioner.members.miniTitle')} subtitle={t('tournament.commissioner.members.miniSubtitle')}>
        <p className="text-sm text-white/60">{t('tournament.commissioner.members.miniBody')}</p>
      </Panel>
    </div>
  )
}

function Panel({
  title,
  subtitle,
  children,
  actions,
}: {
  title: string
  subtitle: string
  children: React.ReactNode
  actions?: React.ReactNode
}) {
  return (
    <WarRoomPanel title={title} subtitle={subtitle} actions={actions}>
      {children}
    </WarRoomPanel>
  )
}
