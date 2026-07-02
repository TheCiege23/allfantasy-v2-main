'use client'

import Link from 'next/link'
import {
  Activity,
  Bell,
  CalendarClock,
  CheckCircle2,
  ClipboardList,
  Gauge,
  HeartPulse,
  Lock,
  MessageSquare,
  ShieldCheck,
  Sparkles,
  Users,
  type LucideIcon,
} from 'lucide-react'
import type { UserLeague, UserLeagueTeam } from '@/app/dashboard/types'
import { useEntitlements } from '@/hooks/useEntitlements'

type NflRedraftLeagueHomeDashboardProps = {
  league: UserLeague
  leagueId: string
  teamSlots: UserLeagueTeam[]
  userTeamName?: string | null
  isCommissioner: boolean
  draftDateIso: string | null
  onOpenSettings: (initialPanel?: string | null) => void
  onOpenTab: (tabId: string) => void
}

type Tile = {
  title: string
  body: string
  meta?: string
  locked?: boolean
  cta?: string
  onClick?: () => void
  href?: string
}

function formatDraftDate(draftDateIso: string | null): string {
  if (!draftDateIso) return 'Set when the commissioner is ready'
  const parsed = new Date(draftDateIso)
  if (Number.isNaN(parsed.getTime())) return 'Set when the commissioner is ready'
  return parsed.toLocaleString(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })
}

function Card({
  tile,
  testId,
}: {
  tile: Tile
  testId: string
}) {
  const content = (
    <div className="flex h-full flex-col rounded-2xl border border-white/[0.08] bg-white/[0.035] p-4 text-left transition hover:border-violet-400/30 hover:bg-white/[0.055]">
      <div className="flex items-start justify-between gap-3">
        <h3 className="text-sm font-black text-white">{tile.title}</h3>
        {tile.locked ? <Lock className="h-4 w-4 shrink-0 text-amber-300" aria-hidden /> : null}
      </div>
      <p className="mt-2 flex-1 text-xs leading-5 text-white/55">{tile.body}</p>
      {tile.meta ? <p className="mt-3 text-[11px] font-bold uppercase tracking-[0.14em] text-violet-200/80">{tile.meta}</p> : null}
      {tile.cta ? <p className="mt-3 text-xs font-bold text-cyan-200">{tile.cta}</p> : null}
    </div>
  )

  if (tile.href) {
    return (
      <Link href={tile.href} data-testid={testId} className="block h-full">
        {content}
      </Link>
    )
  }

  if (tile.onClick) {
    return (
      <button type="button" onClick={tile.onClick} data-testid={testId} className="block h-full">
        {content}
      </button>
    )
  }

  return (
    <div data-testid={testId} className="h-full">
      {content}
    </div>
  )
}

function Metric({
  icon: Icon,
  label,
  value,
}: {
  icon: LucideIcon
  label: string
  value: string
}) {
  return (
    <div className="rounded-2xl border border-white/[0.08] bg-black/20 p-3">
      <div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.16em] text-white/45">
        <Icon className="h-3.5 w-3.5 text-violet-300" aria-hidden />
        {label}
      </div>
      <p className="mt-2 text-sm font-black text-white">{value}</p>
    </div>
  )
}

export function NflRedraftLeagueHomeDashboard({
  league,
  leagueId,
  teamSlots,
  userTeamName,
  isCommissioner,
  draftDateIso,
  onOpenSettings,
  onOpenTab,
}: NflRedraftLeagueHomeDashboardProps) {
  const entitlements = useEntitlements()
  const hasManagerIntelligence = entitlements.hasPro || entitlements.hasSupreme
  const hasCommissionerIntelligence = entitlements.hasCommissioner || entitlements.hasSupreme
  const joinedTeams = teamSlots.filter((team) => Boolean(team.id)).length
  const teamCount = league.teamCount ?? teamSlots.length
  const draftDate = formatDraftDate(draftDateIso)
  const teamLabel = userTeamName || 'Roster opens after draft'
  const replayIntro = () => {
    window.dispatchEvent(new CustomEvent('af:replay-league-intro', { detail: { leagueId } }))
  }

  const baseTiles: Tile[] = isCommissioner
    ? [
        {
          title: 'Draft setup',
          body: 'Set draft date, order, timer, auto-pick, and mock draft access before managers arrive.',
          meta: draftDate,
          cta: 'Open draft settings',
          onClick: () => onOpenSettings('draft'),
        },
        {
          title: 'Invite managers',
          body: 'Fill the league, review member readiness, and keep setup moving from one place.',
          meta: `${joinedTeams}/${teamCount} teams joined`,
          cta: 'Open members',
          onClick: () => onOpenSettings('members-commish'),
        },
        {
          title: 'League rules summary',
          body: 'Review roster, scoring, waiver, trade, and playoff rules before the season starts.',
          cta: 'Open settings',
          onClick: () => onOpenSettings(null),
        },
        {
          title: 'Announcements',
          body: 'Keep league chat visible while you post draft reminders, setup notes, and rule clarifications.',
          cta: 'Open League Chat',
          onClick: () => onOpenTab('league_chat'),
        },
      ]
    : [
        {
          title: 'Draft HQ',
          body: 'Open the draft room, check the countdown, and get ready for your board.',
          meta: draftDate,
          cta: 'Open Draft',
          onClick: () => onOpenTab('draft'),
        },
        {
          title: 'Roster prep',
          body: 'Your roster view is ready for draft results and lineup prep once players are assigned.',
          meta: teamLabel,
          cta: 'Open Roster',
          onClick: () => onOpenTab('roster'),
        },
        {
          title: 'League rules summary',
          body: 'View scoring, waivers, trade review, roster limits, playoffs, and permissions.',
          cta: 'View rules',
          onClick: () => onOpenSettings(null),
        },
        {
          title: 'League Chat',
          body: 'Chat stays available by default so managers can coordinate draft night.',
          cta: 'Open League Chat',
          onClick: () => onOpenTab('league_chat'),
        },
      ]

  const managerTiles: Tile[] = [
    {
      title: 'Manager Intelligence',
      body: hasManagerIntelligence
        ? 'Draft prep insights, roster guidance, waiver watchlist, trade outlook, and matchup prep are available for your team.'
        : 'AF Pro unlocks Manager Intelligence, personal Decision OS views, and smarter prep workflows.',
      meta: hasManagerIntelligence ? 'Unlocked' : 'AF Pro preview',
      locked: !hasManagerIntelligence,
    },
    {
      title: 'Personal Decision OS panel',
      body: hasManagerIntelligence
        ? 'Your personal recommendations stay tied to league settings and your roster context.'
        : 'Preview the shape of smart recommendations without changing the normal league experience.',
      locked: !hasManagerIntelligence,
    },
    {
      title: 'Ask Chimmy',
      body: 'Use Chimmy as a league guide or draft guide when you need rule help or quick context.',
      meta: 'League helper',
    },
  ]

  const commissionerTiles: Tile[] = [
    {
      title: 'League Intelligence',
      body: hasCommissionerIntelligence
        ? 'Monitor league health, trade health, waiver activity, draft readiness, and manager engagement.'
        : 'AF Commissioner unlocks League Intelligence, smart recommendations, and workload shortcuts.',
      meta: hasCommissionerIntelligence ? 'Unlocked' : 'AF Commissioner preview',
      locked: !hasCommissionerIntelligence,
    },
    {
      title: 'Fair Play Monitoring',
      body: 'Review inactive manager detection, anti-tanking, anti-collusion, and advanced trade review controls.',
      locked: !hasCommissionerIntelligence,
      cta: hasCommissionerIntelligence ? 'Open Decision OS settings' : undefined,
      onClick: hasCommissionerIntelligence ? () => onOpenSettings('ai-chimmy-setup') : undefined,
    },
    {
      title: 'Weekly League Report',
      body: 'Prepare summaries, manager engagement prompts, rivalry/storyline prompts, and commissioner shortcuts.',
      locked: !hasCommissionerIntelligence,
    },
  ]

  const headline = isCommissioner
    ? hasCommissionerIntelligence
      ? 'Commissioner Command Center'
      : 'Commissioner HQ'
    : hasManagerIntelligence
      ? 'Manager Intelligence'
      : 'Draft HQ'

  const subtitle = isCommissioner
    ? 'Run draft setup, member readiness, league rules, chat, and settings from a focused command surface.'
    : 'Get ready for draft night, keep league chat nearby, and track the next steps before kickoff.'

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto px-4 py-5 lg:px-6" data-testid="g32-nfl-redraft-home">
      <section className="relative overflow-hidden rounded-3xl border border-violet-500/20 bg-gradient-to-br from-violet-500/[0.12] via-[#050814] to-cyan-500/[0.06] p-5 shadow-[0_18px_70px_rgba(0,0,0,0.32)]">
        <div className="relative flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
          <div className="max-w-3xl">
            <p className="text-[11px] font-black uppercase tracking-[0.2em] text-violet-200/75">
              NFL Redraft League Home
            </p>
            <h2 className="mt-2 text-3xl font-black tracking-tight text-white sm:text-4xl">{headline}</h2>
            <p className="mt-2 text-sm leading-6 text-white/58">{subtitle}</p>
            <button
              type="button"
              onClick={replayIntro}
              className="mt-4 inline-flex min-h-9 items-center rounded-xl border border-white/12 bg-white/[0.06] px-3 text-xs font-bold text-white/80 hover:border-cyan-300/40 hover:bg-white/[0.09]"
              data-testid="g32-replay-intro"
            >
              Replay intro
            </button>
          </div>
          <div className="grid min-w-[min(100%,420px)] grid-cols-2 gap-2">
            <Metric icon={Users} label="Managers" value={`${joinedTeams}/${teamCount}`} />
            <Metric icon={CalendarClock} label="Draft" value={draftDate} />
          </div>
        </div>
      </section>

      <section className="mt-5 grid gap-3 md:grid-cols-2 xl:grid-cols-4" aria-label="League home actions">
        {baseTiles.map((tile) => (
          <Card key={tile.title} tile={tile} testId={`g32-home-card-${tile.title.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`} />
        ))}
      </section>

      <section className="mt-5 grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(300px,380px)]">
        <div className="rounded-3xl border border-white/[0.08] bg-white/[0.035] p-4">
          <div className="flex items-center gap-2">
            {isCommissioner ? <ShieldCheck className="h-5 w-5 text-violet-200" aria-hidden /> : <ClipboardList className="h-5 w-5 text-violet-200" aria-hidden />}
            <h3 className="text-base font-black text-white">{isCommissioner ? 'Basic issue checklist' : 'Upcoming events'}</h3>
          </div>
          <div className="mt-4 grid gap-2 sm:grid-cols-2">
            {[
              isCommissioner ? 'Draft setup reviewed' : 'Draft date checked',
              isCommissioner ? 'Managers invited' : 'Roster tab ready',
              isCommissioner ? 'League rules reviewed' : 'League rules reviewed',
              isCommissioner ? 'League chat announcement posted' : 'League chat open',
            ].map((item) => (
              <div key={item} className="flex items-center gap-2 rounded-2xl border border-white/[0.07] bg-black/20 px-3 py-2 text-xs text-white/65">
                <CheckCircle2 className="h-4 w-4 text-cyan-300" aria-hidden />
                {item}
              </div>
            ))}
          </div>
        </div>

        <div className="rounded-3xl border border-white/[0.08] bg-white/[0.035] p-4" data-testid="g32-chat-visibility-card">
          <div className="flex items-center gap-2">
            <MessageSquare className="h-5 w-5 text-cyan-200" aria-hidden />
            <h3 className="text-base font-black text-white">League chat</h3>
          </div>
          <p className="mt-2 text-sm leading-6 text-white/55">
            Chat is visible by default on desktop and opens from the mobile chat button. Use it for draft coordination,
            announcements, and league guide questions.
          </p>
          <button
            type="button"
            onClick={() => onOpenTab('league_chat')}
            className="mt-4 inline-flex min-h-10 items-center rounded-xl border border-cyan-400/30 bg-cyan-400/10 px-3 text-xs font-bold text-cyan-100 hover:bg-cyan-400/15"
          >
            Open League Chat
          </button>
        </div>
      </section>

      {isCommissioner ? (
        <section className="mt-5" data-testid="g32-commissioner-intelligence-section">
          <div className="mb-3 flex items-center gap-2">
            <HeartPulse className="h-5 w-5 text-violet-200" aria-hidden />
            <h3 className="text-base font-black text-white">
              {hasCommissionerIntelligence ? 'League Intelligence' : 'Locked Commissioner Intelligence preview'}
            </h3>
          </div>
          <div className="grid gap-3 md:grid-cols-3">
            {commissionerTiles.map((tile) => (
              <Card key={tile.title} tile={tile} testId={`g32-commissioner-card-${tile.title.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`} />
            ))}
          </div>
        </section>
      ) : (
        <section className="mt-5" data-testid="g32-manager-intelligence-section">
          <div className="mb-3 flex items-center gap-2">
            <Activity className="h-5 w-5 text-violet-200" aria-hidden />
            <h3 className="text-base font-black text-white">
              {hasManagerIntelligence ? 'Manager Intelligence' : 'Locked Manager Intelligence preview'}
            </h3>
          </div>
          <div className="grid gap-3 md:grid-cols-3">
            {managerTiles.map((tile) => (
              <Card key={tile.title} tile={tile} testId={`g32-manager-card-${tile.title.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`} />
            ))}
          </div>
        </section>
      )}

      <section className="mt-5 rounded-3xl border border-white/[0.08] bg-black/20 p-4" data-testid="g32-league-activity">
        <div className="flex items-center gap-2">
          <Bell className="h-5 w-5 text-violet-200" aria-hidden />
          <h3 className="text-base font-black text-white">League activity</h3>
        </div>
        <p className="mt-2 text-sm leading-6 text-white/55">
          Activity will populate from draft actions, roster moves, waivers, trades, matchup results, and commissioner
          announcements. No live activity is shown until the league creates it.
        </p>
      </section>
    </div>
  )
}
