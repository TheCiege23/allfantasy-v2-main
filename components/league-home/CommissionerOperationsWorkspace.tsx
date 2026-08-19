'use client'

import type { LucideIcon } from 'lucide-react'
import {
  ArrowLeftRight,
  CalendarDays,
  ClipboardList,
  FileText,
  LockKeyhole,
  Megaphone,
  MessageSquare,
  Settings,
  ShieldCheck,
  Trophy,
  UserCog,
  Users,
  WalletCards,
} from 'lucide-react'
import type { UserLeague } from '@/app/dashboard/types'
import { CommissionerPulse } from '@/components/decide/CommissionerPulse'

type WorkspaceAction = {
  id: string
  title: string
  description: string
  icon: LucideIcon
  state?: 'ready' | 'host-managed' | 'unavailable'
  onClick?: () => void
}

type ActionGroup = {
  id: string
  title: string
  description: string
  actions: WorkspaceAction[]
}

export type CommissionerOperationsWorkspaceProps = {
  league: UserLeague
  leagueId: string
  isCommissioner: boolean
  hasActiveRedraftSeason: boolean
  onOpenSettings: (initialPanel?: string | null) => void
  onOpenTab: (tabId: string) => void
}

function ActionCard({ action }: { action: WorkspaceAction }) {
  const Icon = action.icon
  const unavailable = action.state === 'unavailable' || !action.onClick
  const label = action.state === 'host-managed' ? 'Host managed' : unavailable ? 'Not available yet' : 'Open'
  return (
    <button
      type="button"
      disabled={unavailable}
      onClick={action.onClick}
      data-testid={`commissioner-operation-${action.id}`}
      className="flex min-h-[132px] w-full touch-manipulation flex-col rounded-2xl border border-white/[0.08] bg-black/20 p-4 text-left transition enabled:hover:border-[#ff3d81]/30 enabled:hover:bg-white/[0.055] disabled:cursor-not-allowed disabled:opacity-55"
    >
      <div className="flex w-full items-start justify-between gap-3">
        <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#ff3d81]/10 text-[#ffb8d1]">
          <Icon className="h-5 w-5" aria-hidden />
        </span>
        <span className="rounded-full border border-white/10 bg-white/[0.04] px-2 py-1 text-[9px] font-bold uppercase tracking-[0.14em] text-white/50">
          {label}
        </span>
      </div>
      <h3 className="mt-3 text-sm font-black text-white">{action.title}</h3>
      <p className="mt-1 text-xs leading-5 text-white/50">{action.description}</p>
    </button>
  )
}

export function CommissionerOperationsWorkspace({
  league,
  leagueId,
  isCommissioner,
  hasActiveRedraftSeason,
  onOpenSettings,
  onOpenTab,
}: CommissionerOperationsWorkspaceProps) {
  if (!isCommissioner) {
    return (
      <div data-testid="commissioner-operations-denied" role="alert" className="m-4 rounded-2xl border border-amber-400/25 bg-amber-400/10 p-5 text-sm text-amber-100">
        Commissioner controls are only available to the commissioner or a co-commissioner.
      </div>
    )
  }

  const lifecycle = String(league.lifecycleState ?? league.status ?? 'setup').toLowerCase()
  const seasonComplete = ['complete', 'completed', 'archived'].some((value) => lifecycle.includes(value))
  const draftActive = lifecycle.includes('draft') && !lifecycle.includes('post')
  const leagueStateLabel = seasonComplete ? 'Season complete' : draftActive ? 'Draft active' : hasActiveRedraftSeason ? `Week ${league.currentWeek ?? '—'}` : 'Pre-draft'

  const groups: ActionGroup[] = [
    {
      id: 'league-operations',
      title: 'League Operations',
      description: 'Run the season and recover common league-state issues.',
      actions: [
        { id: 'schedule', title: 'Schedule', description: 'Review weekly pairings, byes, completed scores, and playoff timing.', icon: CalendarDays, onClick: () => onOpenTab('schedule') },
        { id: 'standings-playoffs', title: 'Standings & Playoffs', description: 'Review seeds and use the existing generate, advance, and finalize controls.', icon: Trophy, onClick: () => onOpenTab('standings') },
        { id: 'league-controls', title: 'Commissioner Controls', description: 'Open roster locks, score corrections, lineup edits, and host-managed recovery tools.', icon: ShieldCheck, onClick: () => onOpenSettings('commish-controls') },
        { id: 'advance-week', title: 'Advance / Finalize Week', description: 'No standalone audited week-advance control is exposed in the canonical product yet.', icon: LockKeyhole, state: 'unavailable' },
      ],
    },
    {
      id: 'league-settings',
      title: 'League Settings',
      description: 'Edit existing league rules without duplicating settings forms.',
      actions: [
        { id: 'general-settings', title: 'General', description: 'League identity, visibility, timezone, and core configuration.', icon: Settings, onClick: () => onOpenSettings('commish-general') },
        { id: 'scoring-settings', title: 'Scoring', description: 'Review and update this league\'s scoring rules and bonuses.', icon: ClipboardList, onClick: () => onOpenSettings('scoring') },
        { id: 'roster-settings', title: 'Roster', description: 'Position limits, bench, IR, lineup requirements, and compliance.', icon: Users, onClick: () => onOpenSettings('roster') },
        { id: 'draft-settings', title: 'Draft', description: 'Draft date, order, timer, autopick, pause, and automation settings.', icon: ClipboardList, onClick: () => onOpenSettings('draft') },
        { id: 'playoff-settings', title: 'Playoffs', description: 'Teams, start week, reseeding, round length, and consolation rules.', icon: Trophy, onClick: () => onOpenSettings('playoffs') },
      ],
    },
    {
      id: 'transactions',
      title: 'Transactions',
      description: 'Review existing trade and waiver workflows in their canonical surfaces.',
      actions: [
        { id: 'trade-review', title: 'Trade Review', description: 'Review pending trades and use existing approve or reject actions.', icon: ArrowLeftRight, onClick: () => onOpenTab('trades') },
        { id: 'waiver-operations', title: 'Waiver Operations', description: 'Process claims, lock submissions, and review commissioner overrides.', icon: WalletCards, onClick: () => onOpenTab('waivers') },
        { id: 'trade-settings', title: 'Trade Settings', description: 'Review window, deadline, voting, and pick-trading rules.', icon: ArrowLeftRight, onClick: () => onOpenSettings('trade') },
      ],
    },
    {
      id: 'draft',
      title: 'Draft',
      description: 'Use the live draft room as the authority for draft operations.',
      actions: [
        { id: 'draft-room', title: draftActive ? 'Live Draft Controls' : 'Draft Room', description: 'Open pause/resume, timer, force-pick, undo, skip, manager, and audit controls when the draft is active.', icon: ClipboardList, onClick: () => onOpenTab('draft') },
      ],
    },
    {
      id: 'members',
      title: 'Members',
      description: 'Invite managers and manage existing league membership.',
      actions: [
        { id: 'members', title: 'Manage Members', description: 'Review assignments, commissioner roles, removals, and roster ownership.', icon: UserCog, onClick: () => onOpenSettings('members-commish') },
        { id: 'invite', title: 'Invite Managers', description: 'Open the existing invitation and join-link workflow.', icon: Users, onClick: () => onOpenSettings('invite') },
      ],
    },
    {
      id: 'communication',
      title: 'Communication',
      description: 'Keep operational messages in the existing league communication system.',
      actions: [
        { id: 'announcements', title: 'Announcements & Chat', description: 'Post league announcements and messages through League Chat.', icon: Megaphone, onClick: () => onOpenTab('league_chat') },
        { id: 'commissioner-note', title: 'Commissioner Note', description: 'Create or update the commissioner note using the existing settings panel.', icon: FileText, onClick: () => onOpenSettings('commish-note') },
        { id: 'league-messages', title: 'League Messages', description: 'Open the canonical chat destination for manager communication.', icon: MessageSquare, onClick: () => onOpenTab('league_chat') },
      ],
    },
  ]

  return (
    <div className="min-w-0 space-y-5 p-4 pb-8 sm:p-5" data-testid="commissioner-operations-workspace" data-league-id={leagueId}>
      <header className="rounded-3xl border border-[#262c6a] bg-[#12163e]/70 p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-[10px] font-black uppercase italic tracking-[0.18em] text-[#ff8a3d]">Commissioner OS</p>
            <h2 className="mt-1 text-xl font-black italic text-[#f0f2ff]">{league.name}</h2>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-white/55">Run the league from one place — live manager-health signals from the Decision OS above, and every authoritative workflow one tap below.</p>
          </div>
          <span className="rounded-full px-3 py-1.5 text-xs font-extrabold text-white" style={{ background: 'linear-gradient(90deg,#ff3d81,#ff8a3d)' }} data-testid="commissioner-league-state">{leagueStateLabel}</span>
        </div>
        <a
          href={`/league/${leagueId}/intelligence`}
          className="mt-4 inline-flex items-center gap-1.5 rounded-lg border border-[#ff3d81]/40 bg-[#ff3d81]/10 px-3.5 py-2 text-[12px] font-extrabold text-[#ff9ec0] transition hover:bg-[#ff3d81]/20"
          data-testid="commissioner-open-intelligence-hub"
        >
          Open League Intelligence Hub →
        </a>
      </header>

      {/* Decision OS commissioner lens — the same live CommissionerPulse engine
          the Decide tab renders: inactive/at-risk managers from counted signals
          (empty starters, transaction drought, scoring trend, orphan rosters). */}
      <CommissionerPulse leagueId={leagueId} />

      {groups.map((group) => (
        <section key={group.id} aria-labelledby={`commissioner-group-${group.id}`} data-testid={`commissioner-group-${group.id}`}>
          <h2 id={`commissioner-group-${group.id}`} className="text-sm font-black text-white">{group.title}</h2>
          <p className="mt-1 text-xs text-white/45">{group.description}</p>
          <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {group.actions.map((action) => <ActionCard key={action.id} action={action} />)}
          </div>
        </section>
      ))}
    </div>
  )
}
