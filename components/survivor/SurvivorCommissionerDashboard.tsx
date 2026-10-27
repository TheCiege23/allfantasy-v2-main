'use client'

import type { ReactNode } from 'react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import {
  LayoutDashboard,
  Users,
  Vote,
  Zap,
  Skull,
  Scale,
  Settings2,
  MessageSquare,
  Sparkles,
  CreditCard,
  History,
  ExternalLink,
  Flame,
  ChevronRight,
  ScanEye,
  Send,
} from 'lucide-react'
import { SurvivorIslandAmbient } from '@/components/survivor/SurvivorIslandAmbient'
import {
  WarRoomHeroCard,
  WarRoomPanel,
  WarRoomStatOrb,
  WarRoomTabButton,
} from '@/components/tournament/TournamentWarRoomPrimitives'
import { TournamentSubscriptionTokensPanel } from '@/components/tournament/TournamentSubscriptionTokensPanel'
import { SurvivorPremiumCommandCenterPanel } from '@/components/survivor/SurvivorPremiumCommandCenterPanel'
import { SurvivorCouncilControl } from '@/components/survivor/SurvivorCouncilControl'
import { SurvivorSeasonFixPanel } from '@/components/survivor/SurvivorSeasonFixPanel'
import { SurvivorCommissionerTodoCard } from '@/components/survivor/SurvivorCommissionerTodoCard'
import type { SurvivorCommissionerTodo } from '@/lib/survivor/survivorCommissionerTodo'
import type { AfPlanId } from '@/lib/tournament/af-premium-plans'
import {
  SURVIVOR_TRIBE_ICON_CHOICES,
  composeTribeName,
  getSurvivorThemeById,
  stripLeadingTribeIcon,
} from '@/lib/survivor/survivorVisuals'

type TabId =
  | 'overview'
  | 'operations'
  | 'tribes'
  | 'tribal'
  | 'minigames'
  | 'exile'
  | 'jury'
  | 'settings'
  | 'chat'
  | 'ai'
  | 'premium'
  | 'subscription'
  | 'history'

const TABS: { id: TabId; label: string; icon: ReactNode }[] = [
  { id: 'overview', label: 'Overview', icon: <LayoutDashboard className="h-4 w-4" /> },
  { id: 'operations', label: 'Operations', icon: <Scale className="h-4 w-4" /> },
  { id: 'tribes', label: 'Tribes', icon: <Users className="h-4 w-4" /> },
  { id: 'tribal', label: 'Elimination Council', icon: <Vote className="h-4 w-4" /> },
  { id: 'minigames', label: 'Mini Games', icon: <Zap className="h-4 w-4" /> },
  { id: 'exile', label: 'Exile Island', icon: <Skull className="h-4 w-4" /> },
  { id: 'jury', label: 'Jury', icon: <Scale className="h-4 w-4" /> },
  { id: 'settings', label: 'Settings', icon: <Settings2 className="h-4 w-4" /> },
  { id: 'chat', label: 'Communications', icon: <MessageSquare className="h-4 w-4" /> },
  { id: 'ai', label: 'AI & Automation', icon: <Sparkles className="h-4 w-4" /> },
  { id: 'premium', label: 'Premium intel', icon: <ScanEye className="h-4 w-4" /> },
  { id: 'subscription', label: 'Access · Tokens', icon: <CreditCard className="h-4 w-4" /> },
  { id: 'history', label: 'History', icon: <History className="h-4 w-4" /> },
]

type DashboardPayload = {
  ok: true
  role?: string
  privacy?: { blindModeActive: boolean; canSeeHiddenIdolAssignments: boolean; canSeePrivateVotes: boolean; commissionerParticipationMode?: string }
  league: { id: string; name: string; sport: string; leagueSize: number | null }
  config?: { visualThemeId?: string | null } | null
  shell: { draftSessionExists: boolean; survivorChatChannels: number; exileLeagueLinked: boolean }
  operations: {
    claimedManagers: number
    draft: { status: string; picksMade: number; totalPicks: number; timerSeconds: number | null } | null
    pendingTrades: number
    completedTrades: number
    exileActive: boolean
    activeChallenges: number
    automationNeedsAttention: boolean
    readinessIssues: string[]
  }
  gameState: {
    phase: string
    currentWeek: number
    activeTribeCount: number
    activePlayerCount: number
    exilePlayerCount: number
    juryPlayerCount: number
    immuneTribeId: string | null
    immunePlayerId: string | null
    tribalDeadline: string | null
  } | null
  week: number
  tribes: { id: string; name: string; emoji?: string | null; members: { rosterId: string; userId?: string | null; displayName?: string | null }[] }[]
  tribeRedraw: { id: string; week: number | null; minTribeSize: number | null; maxTribeSize: number | null; defaultDecision?: string; options?: string[] } | null
  /** Older servers omit it. */
  todo?: SurvivorCommissionerTodo
  council: unknown
  privateBallots: []
  privateIdols: { id: string; ownerName: string; powerLabel: string }[]
  juryCount: number
  merged: boolean
  rosterCount: number
  eliminatedCount: number
  auditTail: { eventType: string; metadata: unknown; createdAt: string }[]
  monetization: { afPlan: AfPlanId | null; afTokensRemaining: number; subscriptionStatus: string }
}

export function SurvivorCommissionerDashboard({ leagueId }: { leagueId: string }) {
  const searchParams = useSearchParams()
  const created = searchParams?.get('created') === '1'
  // A to-do or alert link names the tab to open (?tab=tribes, ?tab=operations, ?tab=tribal).
  const [tab, setTab] = useState<TabId>(() => TABS.find(t => t.id === searchParams?.get('tab'))?.id ?? 'overview')
  const tabParam = searchParams?.get('tab') ?? null
  useEffect(() => {
    // The to-do links stay on this page, so follow the URL when it changes too.
    const next = TABS.find(t => t.id === tabParam)?.id
    if (next) setTab(next)
  }, [tabParam])
  const [data, setData] = useState<DashboardPayload | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [tribeDrafts, setTribeDrafts] = useState<Record<string, { name: string; emoji: string }>>({})
  const [announcement, setAnnouncement] = useState('')
  const [announcementState, setAnnouncementState] = useState<string | null>(null)
  const [sendingAnnouncement, setSendingAnnouncement] = useState(false)
  const [redrawPending, setRedrawPending] = useState(false)
  const [redrawMessage, setRedrawMessage] = useState<string | null>(null)
  const [moveDrafts, setMoveDrafts] = useState<Record<string, { userId: string; toTribeId: string }>>({})
  const [movePending, setMovePending] = useState<string | null>(null)

  const base = `/survivor/${leagueId}`

  const load = useCallback(async () => {
    setError(null)
    try {
      const res = await fetch(`/api/leagues/${encodeURIComponent(leagueId)}/survivor/commissioner-dashboard`, {
        cache: 'no-store',
      })
      const j = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(typeof j.error === 'string' ? j.error : 'Failed to load command center')
        setData(null)
        return
      }
      setData(j as DashboardPayload)
    } catch {
      setError('Network error')
      setData(null)
    }
  }, [leagueId])

  useEffect(() => {
    void load()
  }, [load])

  useEffect(() => {
    if (!data?.tribes?.length) return
    setTribeDrafts((current) => {
      const next = { ...current }
      for (const tribe of data.tribes) {
        next[tribe.id] = next[tribe.id] ?? {
          name: stripLeadingTribeIcon(tribe.name),
          emoji: tribe.emoji ?? '',
        }
      }
      return next
    })
  }, [data?.tribes])

  const heroAccent = useMemo((): 'cyan' | 'amber' | 'violet' | 'emerald' => {
    const p = String(data?.gameState?.phase ?? '')
    if (p.includes('jury') || p.includes('finale')) return 'amber'
    if (p.includes('merge')) return 'violet'
    if (p.includes('exile')) return 'emerald'
    return 'cyan'
  }, [data?.gameState?.phase])

  const gs = data?.gameState
  const theme = getSurvivorThemeById(data?.config?.visualThemeId, leagueId)

  const saveTribe = useCallback(async (tribeId: string) => {
    const draft = tribeDrafts[tribeId]
    if (!draft) return
    const res = await fetch(`/api/leagues/${encodeURIComponent(leagueId)}/survivor/tribes`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tribeId, name: draft.name, emoji: draft.emoji || null }),
    })
    if (!res.ok) {
      const body = await res.json().catch(() => ({}))
      setError(typeof body.error === 'string' ? body.error : 'Failed to save tribe')
      return
    }
    await load()
  }, [leagueId, load, tribeDrafts])

  const decideRedraw = useCallback(async (decision: 'approve' | 'postpone' | 'manual' | 'merge') => {
    if (!data?.tribeRedraw || redrawPending) return
    setRedrawPending(true)
    setRedrawMessage(null)
    const action = { approve: 'approve_redraw', postpone: 'postpone_redraw', manual: 'manual_redraw', merge: 'merge_redraw' }[decision]
    const saved = {
      approve: 'Tribes were randomly redrawn. New private huddles are ready.',
      postpone: 'The redraw was postponed. Current tribes stay in place until the next elimination.',
      manual: 'Reassign by hand: move managers between tribes below. Nothing changes until you do.',
      merge: 'The merge is under way. Every remaining manager now sits in one tribe.',
    }[decision]
    try {
      const response = await fetch(`/api/leagues/${encodeURIComponent(leagueId)}/survivor/tribes`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, recommendationId: data.tribeRedraw.id }),
      })
      const result = await response.json().catch(() => ({}))
      if (!response.ok || !result.ok) setRedrawMessage(result.error ?? 'The redraw decision could not be saved.')
      else { setRedrawMessage(saved); await load() }
    } catch {
      setRedrawMessage('Network error. Reload the dashboard to check whether the decision saved.')
    } finally {
      setRedrawPending(false)
    }
  }, [data?.tribeRedraw, leagueId, load, redrawPending])

  const moveMember = useCallback(async (tribeId: string) => {
    const draft = moveDrafts[tribeId]
    if (!draft?.userId || !draft.toTribeId || movePending) return
    setMovePending(tribeId)
    setRedrawMessage(null)
    try {
      const response = await fetch(`/api/leagues/${encodeURIComponent(leagueId)}/survivor/tribes`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'move_member', userId: draft.userId, toTribeId: draft.toTribeId }),
      })
      const result = await response.json().catch(() => ({}))
      if (!response.ok || !result.ok) setRedrawMessage(result.error ?? 'The manager could not be moved.')
      else { setRedrawMessage('Manager moved. Huddles were updated and Chimmy announced it in league chat.'); setMoveDrafts((current) => ({ ...current, [tribeId]: { userId: '', toTribeId: '' } })); await load() }
    } catch {
      setRedrawMessage('Network error. Reload the dashboard to check whether the move saved.')
    } finally {
      setMovePending(null)
    }
  }, [leagueId, load, moveDrafts, movePending])
  const hostCanReassign = data?.privacy?.commissionerParticipationMode === 'non_participating_host'

  const sendAnnouncement = useCallback(async () => {
    const message = announcement.trim()
    if (!message || sendingAnnouncement) return
    setSendingAnnouncement(true)
    setAnnouncementState(null)
    try {
      const response = await fetch('/api/commissioner/broadcast', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ leagueIds: [leagueId], message }),
      })
      const result = await response.json().catch(() => ({}))
      if (!response.ok || !result.results?.[0]?.sent) {
        setAnnouncementState(result.error ?? result.results?.[0]?.error ?? 'Announcement was not sent.')
        return
      }
      setAnnouncement('')
      setAnnouncementState('Sent to league chat and eligible member notifications.')
    } catch {
      setAnnouncementState('Network error. Announcement was not confirmed.')
    } finally {
      setSendingAnnouncement(false)
    }
  }, [announcement, leagueId, sendingAnnouncement])

  return (
    <div className={`relative min-h-[80vh] overflow-hidden rounded-[28px] ${theme.backgroundClass} p-4 text-white`}>
      <SurvivorIslandAmbient />
      <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(180deg,rgba(255,255,255,0.04),transparent_25%,rgba(0,0,0,0.3)_100%)] opacity-40" />
      <div className="relative z-10">
        <div className="mb-6">
          <WarRoomHeroCard phaseAccent={heroAccent}>
            <div className="border-b border-white/[0.07] px-1 pb-5 sm:px-2">
              <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                <div className="min-w-0">
                  <p className="mb-1 text-[11px] font-bold uppercase tracking-[0.22em] text-emerald-300/90">
                    Survivor command center
                  </p>
                  <h1 className="bg-gradient-to-r from-amber-100 via-white to-emerald-200/90 bg-clip-text text-2xl font-black tracking-tight text-transparent sm:text-3xl">
                    {data?.league.name ?? 'Survivor'}
                  </h1>
                  <p className="mt-1 text-sm text-white/55">
                    {data ? (
                      <>
                        {data.league.sport} · Week {data.week} ·{' '}
                        <span className="font-medium text-amber-100/90">{gs?.phase ?? 'loading'}</span>
                      </>
                    ) : (
                      'Loading island…'
                    )}
                  </p>
                </div>
                <div className="flex w-full max-w-md flex-col gap-2 lg:items-end">
                  <div className="flex flex-wrap gap-2">
                    <Link
                      href={base}
                      className="inline-flex items-center gap-1.5 rounded-xl border border-white/15 bg-white/[0.06] px-3 py-2 text-xs font-medium text-white/90 shadow-[inset_0_1px_0_rgba(255,255,255,0.08)] backdrop-blur-sm hover:bg-white/10"
                    >
                      Island home <ExternalLink className="h-3.5 w-3.5 opacity-70" />
                    </Link>
                    <Link
                      href={`/league/${leagueId}?tab=settings`}
                      className="inline-flex items-center gap-1.5 rounded-xl border border-emerald-400/30 bg-emerald-500/15 px-3 py-2 text-xs font-semibold text-emerald-50 shadow-[0_0_20px_-6px_rgba(52,211,153,0.35)] hover:bg-emerald-500/25"
                    >
                      League settings
                    </Link>
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
                League created. Complete manager invitations and review the draft before starting the season.
              </div>
            ) : null}

            <div className="flex gap-1.5 overflow-x-auto px-2 py-3 sm:px-3">
              {TABS.map((t) => (
                <WarRoomTabButton
                  key={t.id}
                  active={tab === t.id}
                  onClick={() => setTab(t.id)}
                  icon={t.icon}
                  label={t.label}
                  testId={`survivor-commissioner-tab-${t.id}`}
                />
              ))}
            </div>
          </WarRoomHeroCard>
        </div>

        {data?.privacy ? <div className="mb-4 rounded-xl border border-amber-400/25 bg-amber-500/10 px-4 py-3 text-sm text-amber-100" role="status">
          {data.privacy.blindModeActive ? 'Fairness shield on · as a playing commissioner, hidden idols, private ballots, other tribe huddles and unrevealed results stay sealed.' : 'Non-playing host · hidden idols, ballots, tribe huddles and Exile status are available for oversight. Private manager DMs stay private.'}
        </div> : null}

        {error ? (
          <div className="mb-6 rounded-xl border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-100" role="alert">
            {error}
          </div>
        ) : null}

        <div className="mt-6 space-y-6">
          {tab === 'overview' && data && (
            <>
              {data.todo ? <SurvivorCommissionerTodoCard todo={data.todo} /> : null}
              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                <WarRoomStatOrb label="Phase" value={gs?.phase ?? '—'} hint="Game state" accent="emerald" />
                <WarRoomStatOrb
                  label="Players / roster"
                  value={`${Math.max(0, data.rosterCount - data.eliminatedCount)} active`}
                  hint={`${data.eliminatedCount} eliminated`}
                  accent="amber"
                />
                <WarRoomStatOrb label="Tribes" value={String(data.tribes.length)} hint="After draft — random split" accent="violet" />
                <WarRoomStatOrb label="Jury" value={String(data.juryCount)} hint="Post-merge" accent="cyan" />
                <WarRoomStatOrb label="Exile linked" value={data.shell.exileLeagueLinked ? 'Yes' : 'Pending'} hint="Side league" accent="emerald" />
                <WarRoomStatOrb
                  label="Draft shell"
                  value={data.shell.draftSessionExists ? 'Ready' : '—'}
                  hint="Session row"
                  accent="cyan"
                />
                <WarRoomStatOrb
                  label="Island chats"
                  value={String(data.shell.survivorChatChannels)}
                  hint="League / exile / jury channels"
                  accent="violet"
                />
                <WarRoomStatOrb label="Merge" value={data.merged ? 'Merged' : 'Pre-merge'} hint="Conference fusion" accent="amber" />
                <WarRoomStatOrb label="Managers joined" value={`${data.operations.claimedManagers}/${data.league.leagueSize ?? '—'}`} hint="Invitations / league capacity" accent="cyan" />
                <WarRoomStatOrb label="Draft progress" value={data.operations.draft ? `${data.operations.draft.picksMade}/${data.operations.draft.totalPicks}` : 'Missing'} hint={data.operations.draft?.status ?? 'No session'} accent="violet" />
                <WarRoomStatOrb label="Trades to review" value={String(data.operations.pendingTrades)} hint={`${data.operations.completedTrades} completed`} accent="amber" />
                <WarRoomStatOrb label="Automation" value={data.operations.automationNeedsAttention ? 'Attention' : 'Clear'} hint="Season runner" accent={data.operations.automationNeedsAttention ? 'amber' : 'emerald'} />
              </div>

              <div className="grid gap-4 lg:grid-cols-2">
                <WarRoomPanel
                  title="Quick links"
                  subtitle="Tribal councils, challenges, @Chimmy, and exile — all wired to your sport."
                >
                  <ul className="space-y-2 text-sm text-white/75">
                    <li className="flex justify-between gap-2">
                      <span>Elimination Council</span>
                      <Link href={`${base}/tribal`} className="text-emerald-300 hover:text-emerald-200">
                        Open
                      </Link>
                    </li>
                    <li className="flex justify-between gap-2">
                      <span>Mini-games & challenges</span>
                      <Link href={`${base}/challenges`} className="text-emerald-300 hover:text-emerald-200">
                        Open
                      </Link>
                    </li>
                    <li className="flex justify-between gap-2">
                      <span>@Chimmy votes &amp; timing</span>
                      <Link href={`${base}/chimmy`} className="text-emerald-300 hover:text-emerald-200">
                        Open
                      </Link>
                    </li>
                    <li className="flex justify-between gap-2">
                      <span>Exile Island</span>
                      <Link href={`${base}/exile`} className="text-emerald-300 hover:text-emerald-200">
                        Open
                      </Link>
                    </li>
                  </ul>
                </WarRoomPanel>
                <WarRoomPanel
                  title="Immunity & deadlines"
                  subtitle="Engine-driven — updates as councils and challenges lock."
                >
                  <p className="text-sm text-white/60">
                    {gs?.tribalDeadline
                      ? `Next tribal window: ${new Date(gs.tribalDeadline).toLocaleString()}`
                      : 'No active tribal deadline in state.'}
                  </p>
                  <p className="mt-2 text-xs text-white/45">
                    Immunity holders sync from live game state. Use Elimination Council tab for vote tools.
                  </p>
                </WarRoomPanel>
              </div>
            </>
          )}

          {tab === 'operations' && data && (
            <div className="grid gap-4 lg:grid-cols-2">
              <WarRoomPanel title="League health" subtitle="Live readiness signals from the league database.">
                <div className={`mb-4 rounded-xl border p-3 text-sm ${data.operations.readinessIssues.length ? 'border-amber-400/30 bg-amber-500/10 text-amber-100' : 'border-emerald-400/30 bg-emerald-500/10 text-emerald-100'}`} role="status">
                  {data.operations.readinessIssues.length ? <><strong>{data.operations.readinessIssues.length} item{data.operations.readinessIssues.length === 1 ? '' : 's'} need review before draft</strong><ul className="mt-2 list-disc space-y-1 pl-5">{data.operations.readinessIssues.map(issue => <li key={issue}>{issue}</li>)}</ul></> : 'No configuration mismatch detected.'}
                </div>
                <ul className="space-y-3 text-sm text-white/75">
                  <li>Managers joined: <strong>{data.operations.claimedManagers} of {data.league.leagueSize ?? 'unknown'}</strong></li>
                  <li>Draft: <strong>{data.operations.draft?.status ?? 'session missing'}</strong>{data.operations.draft ? ` · ${data.operations.draft.picksMade}/${data.operations.draft.totalPicks} picks · ${data.operations.draft.timerSeconds ?? '—'}s timer` : ''}</li>
                  <li>Island chats: <strong>{data.shell.survivorChatChannels}</strong></li>
                  <li>Exile: <strong>{data.operations.exileActive ? 'active' : data.shell.exileLeagueLinked ? 'linked, awaiting start' : 'not linked'}</strong></li>
                  <li>Open challenges: <strong>{data.operations.activeChallenges}</strong></li>
                  <li>Season automation: <strong>{data.operations.automationNeedsAttention ? 'needs review' : 'no reported error'}</strong></li>
                </ul>
              </WarRoomPanel>
              <WarRoomPanel title="Draft & trades" subtitle="Current status and review workload.">
                <p className="text-sm text-white/70">{data.operations.pendingTrades} trade{data.operations.pendingTrades === 1 ? '' : 's'} awaiting a decision · {data.operations.completedTrades} completed.</p>
                <div className="mt-4 flex flex-wrap gap-2">
                  <Link href={`/league/${leagueId}?tab=draft`} className="rounded-lg border border-emerald-400/30 px-3 py-2 text-sm text-emerald-200">Open draft board</Link>
                  <Link href={`/league/${leagueId}?tab=trades`} className="rounded-lg border border-white/20 px-3 py-2 text-sm text-white">Review trades</Link>
                  <Link href={`${base}/exile`} className="rounded-lg border border-white/20 px-3 py-2 text-sm text-white">Exile status</Link>
                </div>
              </WarRoomPanel>
              <WarRoomPanel title="Fix a problem" subtitle="Score corrections, a manager who quit, or an early merge.">
                <SurvivorSeasonFixPanel
                  leagueId={leagueId}
                  week={data.gameState?.currentWeek ?? data.week}
                  merged={data.merged}
                  managers={[...new Map(data.tribes.flatMap(tribe => tribe.members)
                    .filter(member => member.userId)
                    .map(member => [member.userId as string, { userId: member.userId as string, name: member.displayName || 'Manager' }])).values()]
                    .sort((a, b) => a.name.localeCompare(b.name))}
                />
              </WarRoomPanel>
              {data.privacy?.canSeeHiddenIdolAssignments && !data.privacy.blindModeActive ? (
                <WarRoomPanel title="Private idol oversight" subtitle="Visible only to a non-playing host. Managers see only their own idols.">
                  {data.privateIdols.length ? <ul className="space-y-2 text-sm text-white/75">{data.privateIdols.map(idol => <li key={idol.id}><strong>{idol.ownerName}</strong> · {idol.powerLabel}</li>)}</ul> : <p className="text-sm text-white/60">No active idols have been seeded.</p>}
                </WarRoomPanel>
              ) : null}
            </div>
          )}

          {tab === 'overview' && !data && !error && (
            <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-8 text-center text-white/55">
              Loading overview…
            </div>
          )}

          {tab === 'tribes' && (
            <WarRoomPanel title="Tribes" subtitle="Roster-based tribe assignment runs after the startup draft completes.">
              {data?.tribeRedraw && <div className="mb-5 rounded-xl border border-amber-400/40 bg-amber-500/10 p-4" data-testid="survivor-tribe-redraw-choice">
                <p className="font-semibold text-amber-100">Tribe redraw recommended</p>
                <p className="mt-1 text-sm text-white/70">A tribe has fallen below half the size of the largest tribe. Current sizes range from {data.tribeRedraw.minTribeSize ?? '?'} to {data.tribeRedraw.maxTribeSize ?? '?'} active managers. Choose a random redraw, reassign by hand, or merge now. If nobody chooses, the random redraw runs on its own before the next council. A random redraw archives the old private huddles and opens fresh ones.{hostCanReassign ? '' : ' As a playing commissioner you cannot choose teammates.'}</p>
                <div className="mt-3 flex flex-wrap gap-2">
                  <button type="button" disabled={redrawPending} onClick={() => void decideRedraw('approve')} className="rounded-lg bg-amber-400 px-3 py-2 text-sm font-semibold text-black disabled:opacity-50">{redrawPending ? 'Saving…' : 'Random redraw (default)'}</button>
                  {hostCanReassign && <button type="button" disabled={redrawPending} onClick={() => void decideRedraw('manual')} className="rounded-lg border border-amber-300/50 px-3 py-2 text-sm text-amber-100 disabled:opacity-50">Reassign by hand</button>}
                  <button type="button" disabled={redrawPending} onClick={() => void decideRedraw('merge')} className="rounded-lg border border-amber-300/50 px-3 py-2 text-sm text-amber-100 disabled:opacity-50">Merge now</button>
                  <button type="button" disabled={redrawPending} onClick={() => void decideRedraw('postpone')} className="rounded-lg border border-white/20 px-3 py-2 text-sm text-white disabled:opacity-50">Postpone</button>
                </div>
              </div>}
              {redrawMessage && <p role="status" className="mb-4 text-sm text-amber-200">{redrawMessage}</p>}
              <p className="mb-4 text-sm text-white/60">
                {data?.tribes?.length
                  ? `${data.tribes.length} tribes configured.`
                  : 'Tribes appear after draft bootstrap assigns players.'}
              </p>
              {data?.tribes?.length ? (
                <div className="mb-5 space-y-4">
                  {data.tribes.map((tribe) => {
                    const draft = tribeDrafts[tribe.id] ?? { name: stripLeadingTribeIcon(tribe.name), emoji: tribe.emoji ?? '' }
                    return (
                      <div key={tribe.id} className="rounded-2xl border border-white/10 bg-black/20 p-4">
                        <div className="mb-3 flex items-center justify-between gap-3">
                          <p className="text-sm font-semibold text-white">{tribe.name}</p>
                          <span className="text-xs text-white/45">{Array.isArray(tribe.members) ? tribe.members.length : 0} members</span>
                        </div>
                        <div className="grid gap-3 lg:grid-cols-[120px_minmax(0,1fr)_auto]">
                          <div>
                            <label className="mb-2 block text-[11px] font-bold uppercase tracking-[0.14em] text-white/45">Icon</label>
                            <div className="grid max-h-28 grid-cols-5 gap-1 overflow-y-auto rounded-xl border border-white/10 bg-white/[0.03] p-2">
                              {SURVIVOR_TRIBE_ICON_CHOICES.map((icon) => (
                                <button
                                  key={`${tribe.id}-${icon}`}
                                  type="button"
                                  onClick={() => setTribeDrafts((current) => ({
                                    ...current,
                                    [tribe.id]: { ...draft, emoji: icon },
                                  }))}
                                  className={`rounded-lg px-2 py-1 text-lg ${draft.emoji === icon ? 'bg-emerald-500/25 ring-1 ring-emerald-300/50' : 'bg-white/5 hover:bg-white/10'}`}
                                >
                                  {icon}
                                </button>
                              ))}
                            </div>
                          </div>
                          <div>
                            <label className="mb-2 block text-[11px] font-bold uppercase tracking-[0.14em] text-white/45">Tribe name</label>
                            <input
                              value={draft.name}
                              onChange={(event) => setTribeDrafts((current) => ({
                                ...current,
                                [tribe.id]: { ...draft, name: event.target.value },
                              }))}
                              className="w-full rounded-xl border border-white/10 bg-white/[0.04] px-3 py-2.5 text-sm text-white outline-none ring-0 placeholder:text-white/30 focus:border-emerald-400/40"
                              placeholder="Enter tribe name or include emoji"
                            />
                            <p className="mt-2 text-xs text-white/45">Preview: {composeTribeName(draft.emoji, draft.name)}</p>
                          </div>
                          <div className="flex items-end">
                            <button
                              type="button"
                              onClick={() => void saveTribe(tribe.id)}
                              className="inline-flex rounded-xl border border-emerald-500/35 bg-emerald-500/15 px-4 py-2.5 text-sm font-semibold text-emerald-50 hover:bg-emerald-500/25"
                            >
                              Save tribe
                            </button>
                          </div>
                        </div>
                        {hostCanReassign && tribe.members.some((member) => member.userId) && data.tribes.length > 1 && (
                          <div className="mt-3 flex flex-wrap items-end gap-2 border-t border-white/10 pt-3" data-testid={`survivor-tribe-move-${tribe.id}`}>
                            <label className="flex flex-col gap-1 text-[11px] font-bold uppercase tracking-[0.14em] text-white/45">
                              Move manager
                              <select
                                value={moveDrafts[tribe.id]?.userId ?? ''}
                                onChange={(event) => setMoveDrafts((current) => ({ ...current, [tribe.id]: { userId: event.target.value, toTribeId: current[tribe.id]?.toTribeId ?? '' } }))}
                                className="min-h-10 rounded-lg border border-white/15 bg-black/40 px-2 text-sm font-normal normal-case tracking-normal text-white"
                              >
                                <option value="">Choose a manager</option>
                                {tribe.members.filter((member) => member.userId).map((member) => <option key={member.rosterId} value={member.userId ?? ''}>{member.displayName ?? member.userId}</option>)}
                              </select>
                            </label>
                            <label className="flex flex-col gap-1 text-[11px] font-bold uppercase tracking-[0.14em] text-white/45">
                              To tribe
                              <select
                                value={moveDrafts[tribe.id]?.toTribeId ?? ''}
                                onChange={(event) => setMoveDrafts((current) => ({ ...current, [tribe.id]: { userId: current[tribe.id]?.userId ?? '', toTribeId: event.target.value } }))}
                                className="min-h-10 rounded-lg border border-white/15 bg-black/40 px-2 text-sm font-normal normal-case tracking-normal text-white"
                              >
                                <option value="">Choose a tribe</option>
                                {data.tribes.filter((other) => other.id !== tribe.id).map((other) => <option key={other.id} value={other.id}>{other.name}</option>)}
                              </select>
                            </label>
                            <button
                              type="button"
                              disabled={movePending === tribe.id || !moveDrafts[tribe.id]?.userId || !moveDrafts[tribe.id]?.toTribeId}
                              onClick={() => void moveMember(tribe.id)}
                              className="min-h-10 rounded-lg border border-amber-300/50 px-3 text-sm text-amber-100 disabled:opacity-40"
                            >
                              {movePending === tribe.id ? 'Moving…' : 'Move'}
                            </button>
                          </div>
                        )}
                      </div>
                    )
                  })}
                </div>
              ) : null}
              <Link
                href={`${base}/tribe`}
                className="inline-flex items-center gap-2 rounded-xl border border-emerald-500/35 bg-emerald-500/15 px-4 py-2.5 text-sm font-semibold text-emerald-50 hover:bg-emerald-500/25"
              >
                <Flame className="h-4 w-4" /> Open tribe view
              </Link>
            </WarRoomPanel>
          )}

          {tab === 'tribal' && (
            <div className="space-y-4">
              <SurvivorCouncilControl leagueId={leagueId} />

            </div>
          )}

          {tab === 'minigames' && (
            <WarRoomPanel
              title="Mini games"
              subtitle="Challenges pull real sport schedules for the active week — see Challenges hub."
            >
              <Link href={`${base}/challenges`} className="text-emerald-300 hover:text-emerald-200">
                Go to challenges →
              </Link>
            </WarRoomPanel>
          )}

          {tab === 'exile' && (
            <WarRoomPanel title="Exile Island" subtitle="Hidden side competition — exile league links on create.">
              <Link href={`${base}/exile`} className="text-emerald-300 hover:text-emerald-200">
                Exile dashboard →
              </Link>
            </WarRoomPanel>
          )}

          {tab === 'jury' && (
            <WarRoomPanel title="Jury" subtitle="Jury phase and finale votes — see Jury hub.">
              <Link href={`${base}/jury`} className="text-emerald-300 hover:text-emerald-200">
                Jury chamber →
              </Link>
            </WarRoomPanel>
          )}

          {tab === 'settings' && (
            <WarRoomPanel title="Survivor settings" subtitle="Use league settings — Survivor panels are under the specialty format.">
              <Link
                href={`/league/${leagueId}?tab=settings`}
                className="inline-flex rounded-xl border border-white/15 bg-white/[0.04] px-4 py-3 text-sm text-white/85 hover:bg-white/[0.08]"
              >
                Open full league settings
              </Link>
            </WarRoomPanel>
          )}

          {tab === 'chat' && (
            <WarRoomPanel title="Communications" subtitle="Island chat, tribe threads, jury, and exile channels.">
              <label htmlFor="survivor-announcement" className="mb-2 block text-sm font-semibold text-white">Message the whole league</label>
              <textarea id="survivor-announcement" maxLength={500} rows={4} value={announcement} onChange={event => setAnnouncement(event.target.value)} placeholder="Write a commissioner announcement…" className="mb-2 w-full rounded-xl border border-white/15 bg-black/25 p-3 text-sm text-white placeholder:text-white/40" />
              <div className="mb-4 flex items-center justify-between gap-3">
                <span className="text-xs text-white/50">{announcement.length}/500 · posts to league chat and eligible notifications</span>
                <button type="button" disabled={!announcement.trim() || sendingAnnouncement} onClick={() => void sendAnnouncement()} className="inline-flex items-center gap-2 rounded-xl bg-emerald-500 px-4 py-2 text-sm font-semibold text-black disabled:opacity-40"><Send className="h-4 w-4" />{sendingAnnouncement ? 'Sending…' : 'Send announcement'}</button>
              </div>
              {announcementState && <p role="status" className="mb-4 text-sm text-amber-200">{announcementState}</p>}
              <Link href={`${base}/chat`} className="text-emerald-300 hover:text-emerald-200">
                Survivor chat hub →
              </Link>
            </WarRoomPanel>
          )}

          {tab === 'ai' && (
            <WarRoomPanel title="AI & automation" subtitle="@Chimmy ingests votes, timestamps picks, and posts official results.">
              <Link href={`${base}/chimmy`} className="text-emerald-300 hover:text-emerald-200">
                @Chimmy command center →
              </Link>
              <p className="mt-4 text-xs text-white/45">
                Commissioner automation (anti-collusion, recaps) mirrors subscription tiers — see Access · Tokens.
              </p>
            </WarRoomPanel>
          )}

          {tab === 'premium' && data && (
            <SurvivorPremiumCommandCenterPanel
              leagueId={leagueId}
              plan={data.monetization.afPlan ?? null}
              tokensRemaining={data.monetization.afTokensRemaining ?? null}
            />
          )}

          {tab === 'premium' && !data && !error && (
            <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-8 text-center text-white/55">
              Loading premium intel…
            </div>
          )}

          {tab === 'subscription' && (
            <TournamentSubscriptionTokensPanel
              entitlements={{
                plan: data?.monetization.afPlan ?? null,
                afTokensRemaining: data?.monetization.afTokensRemaining ?? null,
              }}
            />
          )}


          {tab === 'history' && (
            <WarRoomPanel title="History / archive" subtitle="Recent Survivor audit events.">
              {data?.auditTail?.length ? (
                <ul className="space-y-2 text-sm">
                  {data.auditTail.map((row, i) => (
                    <li key={i} className="rounded-lg border border-white/10 bg-black/25 px-3 py-2">
                      <span className="text-white/80">{row.eventType}</span>
                      <span className="ml-2 text-xs text-white/40">{new Date(row.createdAt).toLocaleString()}</span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-sm text-white/45">No audit rows yet.</p>
              )}
            </WarRoomPanel>
          )}
        </div>
      </div>
    </div>
  )
}
