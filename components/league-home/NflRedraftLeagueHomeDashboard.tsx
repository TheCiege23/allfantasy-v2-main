'use client'

import '@/components/core-app/af-core.css'
import '@/components/league/league-overview.css'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { BarChart3, Bell, ChevronDown, ChevronRight, ClipboardList, HeartPulse, Lock, MessageSquare, Settings2, Sparkles, UserPlus, type LucideIcon } from 'lucide-react'
import type { UserLeague, UserLeagueTeam } from '@/app/dashboard/types'
import { useEntitlements } from '@/hooks/useEntitlements'
import { RedraftCommunicationPanel } from '@/components/redraft/RedraftCommunicationPanel'
import { ManagerReplayInsightsCard } from '@/components/dashboard/ManagerReplayInsightsCard'
import { resolveRedraftIdentity } from '@/lib/league-media/redraftIdentity'
import { buildScoreBug, draftCountdown, type ScoreBug } from '@/lib/league-media/redraftLeagueHome'
import { loadYourWeekWithMatchup } from '@/components/league/native/LeagueYourWeekStrip'
import { RedraftScoreBug } from '@/components/league/native/redraft/RedraftScoreBug'
import '@/components/league/native/redraft-home.css'

/**
 * This week's score bug on the football Home — the same `matchup-center` load League home's strip
 * uses. Renders nothing until a head-to-head matchup loads.
 */
function RedraftHomeScoreBug({ leagueId, week, sport, onOpen }: { leagueId: string; week: number | null; sport: string; onOpen: () => void }) {
  const [bug, setBug] = useState<ScoreBug | null>(null)
  useEffect(() => {
    let cancelled = false
    loadYourWeekWithMatchup(leagueId, week).then((r) => {
      if (!cancelled) setBug(buildScoreBug(r.matchup))
    })
    return () => {
      cancelled = true
    }
  }, [leagueId, week])
  return bug ? <RedraftScoreBug bug={bug} sport={sport} onOpen={onOpen} /> : null
}

type NflRedraftLeagueHomeDashboardProps = {
  league: UserLeague
  leagueId: string
  teamSlots: UserLeagueTeam[]
  userTeamName?: string | null
  isCommissioner: boolean
  draftDateIso: string | null
  /**
   * True once a `RedraftSeason` row exists for this league (created by
   * `syncCompletedDraftToRedraftSeason` after the draft finalizes) — the
   * source of truth for "has this league actually completed its draft",
   * independent of `league.lifecycleState`/`status`. Genuinely pre-draft
   * leagues have no `RedraftSeason` yet, so this stays false for them.
   */
  hasActiveRedraftSeason: boolean
  onOpenSettings: (initialPanel?: string | null) => void
  onOpenTab: (tabId: string) => void
}

function formatDraftDate(draftDateIso: string | null): string | null {
  if (!draftDateIso) return null
  const parsed = new Date(draftDateIso)
  if (Number.isNaN(parsed.getTime())) return null
  return parsed.toLocaleString(undefined, { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
}

type Row = {
  id: string
  icon: LucideIcon
  label: string
  /** Short right-hand value, e.g. "1/12" or a lock badge. */
  value?: string
  locked?: boolean
  onClick?: () => void
  href?: string
}

const card = 'rounded-2xl border border-white/[0.08] bg-white/[0.03]'

function RowItem({ row }: { row: Row }) {
  const Icon = row.icon
  const inner = (
    <>
      <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-white/[0.07] text-white/80">
        <Icon className="h-4 w-4" aria-hidden />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[15px] font-semibold text-white">{row.label}</span>
        {row.locked && row.value ? <span className="block truncate text-xs text-white/50">Included with {row.value}</span> : null}
      </span>
      {row.locked ? (
        <Lock className="h-4 w-4 shrink-0 text-white/45" aria-label="Locked" />
      ) : row.value ? (
        <span className="max-w-[45%] shrink-0 truncate text-sm font-semibold tabular-nums text-white/55">{row.value}</span>
      ) : null}
      <ChevronRight className="h-4 w-4 shrink-0 text-white/35" aria-hidden />
    </>
  )
  const cls = 'flex min-h-14 w-full touch-manipulation items-center gap-3 px-4 text-left transition hover:bg-white/[0.03] active:bg-white/[0.05]'
  const testId = `g32-home-row-${row.id}`
  if (row.href) {
    return (
      <Link href={row.href} className={cls} data-testid={testId}>
        {inner}
      </Link>
    )
  }
  return (
    <button type="button" onClick={row.onClick} className={cls} data-testid={testId}>
      {inner}
    </button>
  )
}

/**
 * Football redraft League home (owner, 2026-11-28: "simple like Sleeper… I don't like busy and the
 * customers don't like busy"). It used to stack a hero header, four action tiles, a "Suggested
 * checklist", a card explaining where chat is, three Intelligence tiles and an always-open
 * communication panel. Now, top to bottom:
 *   1. one status line (pre-draft or this week) and a small Replay intro link
 *   2. this week's score bug, in season
 *   3. ONE "next up" card: the draft before it, the matchup after
 *   4. a short list of rows, each one tap to where the job is done
 *   5. Announcements, folded behind one row
 * Keep it that way: a tile grid or checklist coming back is the busy screen coming back.
 */
export function NflRedraftLeagueHomeDashboard({
  league,
  leagueId,
  teamSlots,
  userTeamName,
  isCommissioner,
  draftDateIso,
  hasActiveRedraftSeason,
  onOpenSettings,
  onOpenTab,
}: NflRedraftLeagueHomeDashboardProps) {
  const entitlements = useEntitlements()
  const hasManagerIntelligence = entitlements.hasPro || entitlements.hasSupreme
  const hasCommissionerIntelligence = entitlements.hasCommissioner || entitlements.hasSupreme
  // `claimedByUserId` is set only when a real manager has claimed the slot; placeholder teams
  // created with the league must not count as joined.
  const joinedTeams = teamSlots.filter((team) => Boolean(team.claimedByUserId)).length
  const teamCount = league.teamCount ?? teamSlots.length
  const draftDate = formatDraftDate(draftDateIso)
  const currentWeek = league.currentWeek ?? null
  const redraft = resolveRedraftIdentity(league)
  const countdown = !hasActiveRedraftSeason ? draftCountdown(draftDateIso, Date.now()) : null
  const [announcementsOpen, setAnnouncementsOpen] = useState(false)

  const replayIntro = () => {
    window.dispatchEvent(new CustomEvent('af:replay-league-intro', { detail: { leagueId } }))
  }

  const sportLabel = redraft?.sportLabel ?? String(league.sport ?? 'NFL')
  const status = hasActiveRedraftSeason
    ? `${sportLabel} redraft · ${currentWeek != null ? `Week ${currentWeek}` : 'In season'}`
    : `${sportLabel} redraft · Pre-draft`

  const rows: Row[] = []
  if (!hasActiveRedraftSeason && isCommissioner && joinedTeams < teamCount) {
    // The invite lives at the top of the Draft tab.
    rows.push({ id: 'invite', icon: UserPlus, label: 'Invite managers', value: `${joinedTeams}/${teamCount}`, onClick: () => onOpenTab('draft') })
  }
  rows.push({ id: 'roster', icon: ClipboardList, label: 'My roster', value: userTeamName ?? undefined, onClick: () => onOpenTab('roster') })
  if (hasActiveRedraftSeason) rows.push({ id: 'standings', icon: BarChart3, label: 'Standings', onClick: () => onOpenTab('standings') })
  rows.push({ id: 'chat', icon: MessageSquare, label: 'League chat', onClick: () => onOpenTab('league_chat') })
  rows.push({ id: 'settings', icon: Settings2, label: isCommissioner ? 'League settings' : 'League rules', onClick: () => onOpenSettings(null) })
  // One Intelligence row instead of three upsell tiles. Locked rows go to the plans page, never nowhere.
  if (isCommissioner) {
    rows.push(
      hasCommissionerIntelligence
        ? { id: 'intelligence', icon: HeartPulse, label: 'League Intelligence', href: `/league/${leagueId}/intelligence` }
        : { id: 'intelligence', icon: HeartPulse, label: 'League Intelligence', value: 'AF Commissioner', locked: true, href: '/pricing' },
    )
  } else {
    rows.push(
      hasManagerIntelligence
        ? { id: 'intelligence', icon: Sparkles, label: 'Manager Intelligence', onClick: () => onOpenTab('decide') }
        : { id: 'intelligence', icon: Sparkles, label: 'Manager Intelligence', value: 'AF Pro', locked: true, href: '/pricing' },
    )
  }

  return (
    <div className={`af-core af-league-overview flex min-h-0 flex-1 flex-col overflow-y-auto px-4 py-5 lg:px-6${redraft ? ' rdh-football-home' : ''}`} data-testid="g32-nfl-redraft-home">
      <div className="mx-auto w-full max-w-2xl space-y-5 pb-8">
        <div className="flex items-center justify-between gap-3">
          <p className="text-[12px] font-bold uppercase tracking-[0.14em] text-white/50" data-testid="g32-home-status">{status}</p>
          <button type="button" onClick={replayIntro} className="min-h-11 shrink-0 px-1 text-xs font-semibold text-white/50 hover:text-white" data-testid="g32-replay-intro">
            Replay intro
          </button>
        </div>

        {hasActiveRedraftSeason ? (
          <RedraftHomeScoreBug leagueId={leagueId} week={typeof currentWeek === 'number' ? currentWeek : null} sport={String(league.sport)} onOpen={() => onOpenTab('matchups')} />
        ) : null}

        <section className={`${card} p-4`} data-testid="g32-home-next">
          {hasActiveRedraftSeason ? (
            <>
              <h2 className="text-[17px] font-bold text-white">This week&apos;s matchup</h2>
              <p className="mt-0.5 text-sm text-white/55">{currentWeek != null ? `Week ${currentWeek}` : 'In season'} · set your lineup before kickoff</p>
              <button
                type="button"
                onClick={() => onOpenTab('matchups')}
                className="mt-4 flex min-h-12 w-full touch-manipulation items-center justify-center rounded-xl bg-[#ff3d81] text-sm font-black uppercase tracking-[0.1em] text-[#ffffff]"
                data-testid="g32-home-next-action"
              >
                Open matchup
              </button>
            </>
          ) : (
            <>
              <h2 className="text-[17px] font-bold text-white">Draft</h2>
              <p className="mt-0.5 text-sm text-white/55">
                {draftDate ? (countdown ? `${draftDate} · in ${countdown.label}` : draftDate) : 'Draft time has not been set'}
              </p>
              <button
                type="button"
                onClick={() => onOpenTab('draft')}
                className="mt-4 flex min-h-12 w-full touch-manipulation items-center justify-center rounded-xl bg-[#ff3d81] text-sm font-black uppercase tracking-[0.1em] text-[#ffffff]"
                data-testid="g32-home-next-action"
              >
                Go to draft
              </button>
            </>
          )}
        </section>

        <nav aria-label="League home" className={`${card} divide-y divide-white/[0.06] overflow-hidden`} data-testid="g32-home-rows">
          {rows.map((row) => (
            <RowItem key={row.id} row={row} />
          ))}
        </nav>

        {/* Announcements and notifications: kept, but folded — it was an always-open panel with two inputs. */}
        <section className={`${card} overflow-hidden`}>
          <button
            type="button"
            onClick={() => setAnnouncementsOpen((v) => !v)}
            aria-expanded={announcementsOpen}
            className="flex min-h-14 w-full touch-manipulation items-center gap-3 px-4 text-left"
            data-testid="g32-home-announcements-toggle"
          >
            <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-white/[0.07] text-white/80">
              <Bell className="h-4 w-4" aria-hidden />
            </span>
            <span className="min-w-0 flex-1 text-[15px] font-semibold text-white">{isCommissioner ? 'Announcements' : 'League updates'}</span>
            <ChevronDown className={`h-4 w-4 shrink-0 text-white/35 transition ${announcementsOpen ? 'rotate-180' : ''}`} aria-hidden />
          </button>
          {announcementsOpen ? (
            <div className="border-t border-white/[0.06] px-2 pb-2">
              <RedraftCommunicationPanel leagueId={leagueId} isCommissioner={isCommissioner} onOpenChat={() => onOpenTab('league_chat')} />
            </div>
          ) : null}
        </section>

        {/* Renders nothing unless MANAGER_REPLAY_INSIGHTS_DASHBOARD_ENABLED=true. */}
        <ManagerReplayInsightsCard leagueId={leagueId} />
      </div>
    </div>
  )
}
