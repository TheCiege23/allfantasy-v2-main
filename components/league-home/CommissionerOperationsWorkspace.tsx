'use client'

import '@/components/core-app/af-core.css'
import '@/components/league/league-admin.css'

import type { LucideIcon } from 'lucide-react'
import {
  ArrowLeftRight,
  CalendarDays,
  ClipboardList,
  FileText,
  Megaphone,
  Settings,
  ShieldCheck,
  Trophy,
  UserCog,
  Users,
  WalletCards,
} from 'lucide-react'
import type { UserLeague } from '@/app/dashboard/types'
import { CommissionerPulse } from '@/components/decide/CommissionerPulse'
import { RedraftCommishHealth } from '@/components/decide/RedraftCommishHealth'
import { rdDeckAttrs, useRedraftDeck } from '@/components/decide/redraftDeck'
import { CommissionerOsLink } from '@/components/core-app/hubs/CommissionerOsLink'
import { isNativePlatform } from '@/lib/dashboard/platform-label'
import { MAKE_NATIVE_LABEL, NATIVE_SWITCH_ANCHOR } from '@/lib/league/makeNativeLeague'
import { NativeReadinessCard } from '@/components/league-home/NativeReadinessCard'
import { NativeUndoCard } from '@/components/league-home/NativeUndoCard'

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
  actions: WorkspaceAction[]
}

type CommissionerOperationsWorkspaceProps = {
  league: UserLeague
  leagueId: string
  isCommissioner: boolean
  isOwner: boolean
  hasActiveRedraftSeason: boolean
  onOpenSettings: (initialPanel?: string | null) => void
  onOpenTab: (tabId: string) => void
}

function ActionCard({ action }: { action: WorkspaceAction }) {
  const Icon = action.icon
  const unavailable = action.state === 'unavailable' || !action.onClick
  const label = action.state === 'host-managed' ? 'Host managed' : unavailable ? 'Not available yet' : 'Open'
  return (
    // One row per tool (2026-11-24, the simplify pass): icon, name and what it does, then Open. As a 132px tile
    // with the icon on a line of its own, twenty tools were ~3,000px of a phone.
    <button
      type="button"
      disabled={unavailable}
      onClick={action.onClick}
      data-testid={`commissioner-operation-${action.id}`}
      className="af-admin-action flex w-full touch-manipulation items-center gap-3 rounded-2xl border border-white/[0.08] bg-black/20 p-3 text-left transition enabled:hover:bg-white/[0.055] disabled:cursor-not-allowed disabled:opacity-55"
    >
      <span className="af-admin-action-icon flex h-10 w-10 shrink-0 items-center justify-center rounded-xl">
        <Icon className="h-5 w-5" aria-hidden />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-black text-white">{action.title}</span>
        <span className="mt-0.5 block text-xs leading-5 text-white/50">{action.description}</span>
      </span>
      <span className="af-admin-action-state shrink-0 rounded-full border border-white/10 bg-white/[0.04] px-2 py-1 text-[11px] font-bold uppercase tracking-[0.14em] text-white/50">
        {label}
      </span>
    </button>
  )
}

export function CommissionerOperationsWorkspace({
  league,
  leagueId,
  isCommissioner,
  isOwner,
  hasActiveRedraftSeason,
  onOpenSettings,
  onOpenTab,
}: CommissionerOperationsWorkspaceProps) {
  const rd = useRedraftDeck(league)
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
      actions: [
        { id: 'schedule', title: 'Schedule', description: 'Review weekly pairings, byes, completed scores, and playoff timing.', icon: CalendarDays, onClick: () => onOpenTab('schedule') },
        { id: 'standings-playoffs', title: 'Standings & Playoffs', description: 'Seeds, and generating, advancing and finalizing the bracket.', icon: Trophy, onClick: () => onOpenTab('standings') },
        { id: 'league-controls', title: 'Commissioner Controls', description: 'Open roster locks, score corrections, lineup edits, and host-managed recovery tools.', icon: ShieldCheck, onClick: () => onOpenSettings('commish-controls') },
      ],
    },
    {
      id: 'league-settings',
      title: 'League Settings',
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
      actions: [
        { id: 'trade-review', title: 'Trade Review', description: 'Approve or reject pending trades.', icon: ArrowLeftRight, onClick: () => onOpenTab('trades') },
        { id: 'waiver-operations', title: 'Waiver Operations', description: 'Process claims, lock submissions, and review commissioner overrides.', icon: WalletCards, onClick: () => onOpenTab('waivers') },
        { id: 'trade-settings', title: 'Trade Settings', description: 'Review window, deadline, voting, and pick-trading rules.', icon: ArrowLeftRight, onClick: () => onOpenSettings('trade') },
      ],
    },
    {
      id: 'draft',
      title: 'Draft',
      actions: [
        { id: 'draft-room', title: draftActive ? 'Live Draft Controls' : 'Draft Room', description: 'Open pause/resume, timer, force-pick, undo, skip, manager, and audit controls when the draft is active.', icon: ClipboardList, onClick: () => onOpenTab('draft') },
      ],
    },
    {
      id: 'members',
      title: 'Members',
      actions: [
        { id: 'members', title: 'Manage Members', description: 'Review assignments, commissioner roles, removals, and roster ownership.', icon: UserCog, onClick: () => onOpenSettings('members-commish') },
        { id: 'invite', title: 'Invite Managers', description: 'Invite links and join codes.', icon: Users, onClick: () => onOpenSettings('invite') },
      ],
    },
    {
      id: 'communication',
      title: 'Communication',
      actions: [
        { id: 'announcements', title: 'Announcements & Chat', description: 'Post league announcements and messages through League Chat.', icon: Megaphone, onClick: () => onOpenTab('league_chat') },
        { id: 'commissioner-note', title: 'Commissioner Note', description: 'The note every manager sees.', icon: FileText, onClick: () => onOpenSettings('commish-note') },
      ],
    },
  ]

  return (
    <div className="af-core af-league-admin min-w-0 space-y-6 p-4 pb-8 sm:p-5" data-testid="commissioner-operations-workspace" data-league-id={leagueId} {...rdDeckAttrs(rd)}>
      <header className="af-admin-header rounded-3xl border p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="af-admin-eyebrow text-[11px] font-black uppercase italic tracking-[0.18em]">Commissioner OS</p>
            <h2 className="mt-1 text-xl font-black italic">{league.name}</h2>
                </div>
          <span className="rounded-full px-3 py-1.5 text-xs font-extrabold" data-testid="commissioner-league-state">{leagueStateLabel}</span>
        </div>
        <div className="af-admin-shortcuts mt-4 flex flex-wrap gap-2">
          <a
            href={`/league/${leagueId}/intelligence`}
            className="inline-flex items-center gap-1.5 rounded-lg border px-3.5 py-2 text-[12px] font-extrabold transition"
            data-testid="commissioner-open-intelligence-hub"
          >
            Open League Intelligence Hub →
          </a>
          {isOwner ? (
            <CommissionerOsLink
              href="/commissioner-os"
              leagueId={leagueId}
              className="inline-flex items-center gap-1.5 rounded-lg border px-3.5 py-2 text-[12px] font-extrabold transition"
            >
              Open Commissioner OS →
            </CommissionerOsLink>
          ) : null}
          {!isNativePlatform(league.platform) ? (
            <a
              // Same page: jump to the switch card below (the readiness card carries the button).
              href={`#${NATIVE_SWITCH_ANCHOR}`}
              className="inline-flex items-center gap-1.5 rounded-lg border px-3.5 py-2 text-[12px] font-extrabold transition"
              data-testid="commissioner-make-native"
            >
              {MAKE_NATIVE_LABEL} →
            </a>
          ) : null}
        </div>
      </header>

      <div className="af-admin-settings-layout">
      <nav aria-label="Commissioner sections" className="af-admin-shortcuts af-admin-section-nav">
        {groups.map((group) => (
          <a key={group.id} href={`#commissioner-group-${group.id}`}>{group.title}</a>
        ))}
      </nav>

      <div className="af-admin-sections">
      {/* Imported leagues: what the in-place switch to AllFantasy would need. A league that switched in place: undo, while
          it is open (it renders nothing otherwise). Both routes answer the head commissioner alone. */}
      {!isNativePlatform(league.platform) ? <NativeReadinessCard leagueId={leagueId} /> : <NativeUndoCard leagueId={leagueId} />}
      {/* Decision OS commissioner lens — the same live CommissionerPulse engine
          the Decide tab renders: inactive/at-risk managers from counted signals
          (empty starters, transaction drought, scoring trend, orphan rosters). */}
      {rd ? (
        /* Redraft: the league-health panel from the approved Commish mock. CommissionerPulse reads a
           Sleeper feed and renders nothing for a league AllFantasy runs, so it is not mounted here. */
        <RedraftCommishHealth
          leagueId={leagueId}
          currentWeek={league.currentWeek ?? null}
          tradeDeadlineWeek={league.tradeDeadlineWeek ?? null}
          onOpenTab={onOpenTab}
        />
      ) : (
        <div className="bdx af-admin-pulse"><CommissionerPulse leagueId={leagueId} /></div>
      )}

      {groups.map((group) => (
        <section key={group.id} id={`commissioner-group-${group.id}`} aria-labelledby={`commissioner-title-${group.id}`} data-testid={`commissioner-group-${group.id}`}>
          <h2 id={`commissioner-title-${group.id}`} className="af-admin-section-title text-sm font-black text-white">{group.title}</h2>
          <div className="af-admin-action-grid mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {group.actions.map((action) => <ActionCard key={action.id} action={action} />)}
          </div>
        </section>
      ))}
      </div>
      </div>
    </div>
  )
}
