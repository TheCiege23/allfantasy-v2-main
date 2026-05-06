'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { LayoutGrid, Settings } from 'lucide-react'
import { toast } from 'sonner'
import type { UserLeague, UserLeagueTeam } from '@/app/dashboard/types'
import { LeagueManagersStandingsSection } from '@/app/league/[leagueId]/components/LeagueManagersStandingsSection'
import { LeagueRecentActivity } from '@/app/league/[leagueId]/components/LeagueRecentActivity'
import type { LeagueSeasonSnapshot } from '@/lib/league/sort-teams-standings'
import type { StandingsPresentation } from '@/app/league/[leagueId]/league-dashboard-types'
import { getDraftIdFromSettings, getSleeperLikeBundle } from '@/app/league/[leagueId]/components/league-settings-modal-utils'
import { IDPDraftFilters } from '@/app/idp/components/IDPDraftFilters'
import { isNflRedraftCoreDashboardFromUserLeague } from '@/lib/league/is-nfl-redraft-core-dashboard'
import { openDraftFromEmbeddedLeague } from '@/lib/dashboard/dashboard-draft-overlay-bridge'

export type DraftTabProps = {
  league: UserLeague
  teams: UserLeagueTeam[]
  isOwner: boolean
  /** Head or co-commissioner — can list the league on League finder */
  isCommissioner?: boolean
  inviteToken?: string
  idpLeagueUi?: boolean
  /** Post-season ordering + champion — from `LeagueSeason` when present */
  seasonSnapshot?: LeagueSeasonSnapshot | null
  standingsPresentation?: StandingsPresentation
  /**
   * `draft` — full draft hub including draftboard and draft-position labels on teams.
   * `league` — same invite + team list + activity as draft, but no draftboard and no draft-position subtext (League tab).
   */
  mode?: 'draft' | 'league'
  /** Opens full league settings modal (replaces `?view=settings` tab on NFL redraft). */
  onOpenLeagueSettings?: (initialPanel?: string | null) => void
  /** Dashboard iframe hub — ask parent window to open full-screen draft overlay instead of navigating inside iframe. */
  dashboardEmbed?: boolean
}

function isPreDraftLeagueStatus(league: UserLeague): boolean {
  const s = String(league.status ?? '').toLowerCase()
  if (!s) return true
  if (s.includes('in_season') || s === 'in season' || s === 'complete' || s === 'postseason') {
    return false
  }
  return s.includes('draft') || s.includes('pre') || s === 'scheduled'
}

function isLiveDraftLeagueStatus(league: UserLeague): boolean {
  const s = String(league.status ?? '').toLowerCase()
  return s === 'in_progress' || s === 'in progress' || s === 'active' || s === 'live' || s === 'paused'
}

function formatDraftTypeLabel(type: unknown): string {
  const normalized = String(type ?? '').trim().toLowerCase()
  if (normalized === 'snake') return 'Snake Draft'
  if (normalized === 'linear') return 'Linear Draft'
  if (normalized === 'auction') return 'Auction Draft'
  if (normalized === '3rd_reversal' || normalized === 'third_round_reversal') return '3rd Round Reversal'
  return normalized ? normalized.replace(/_/g, ' ').replace(/\b\w/g, (char) => char.toUpperCase()) : 'Snake Draft'
}

function formatPickTimerLabel(preset: unknown, customValue: unknown): string {
  const normalizedPreset = String(preset ?? '').trim().toLowerCase()
  const customSeconds = typeof customValue === 'number' && Number.isFinite(customValue) ? customValue : null

  const formatSeconds = (seconds: number): string => {
    if (seconds >= 3600) {
      const hours = seconds / 3600
      return `${hours % 1 === 0 ? String(hours) : hours.toFixed(1)} Hours`
    }
    if (seconds >= 60) return `${Math.round(seconds / 60)} Mins`
    return `${seconds} Secs`
  }

  if (normalizedPreset === 'custom' && customSeconds != null && customSeconds > 0) {
    return formatSeconds(customSeconds)
  }

  const presetMatch = normalizedPreset.match(/^(\d+)s$/)
  if (presetMatch) return formatSeconds(Number(presetMatch[1]))
  if (normalizedPreset === 'none' || normalizedPreset === 'untimed') return 'Untimed'
  return '120 Secs'
}

function formatDraftDateLabel(draftDateIso: string | null): string {
  if (!draftDateIso) return 'Not scheduled yet'
  const parsed = new Date(draftDateIso)
  if (Number.isNaN(parsed.getTime())) return 'Not scheduled yet'
  return parsed.toLocaleString(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })
}

function NflRedraftDraftOrderBlock({
  teams,
  isCommissioner,
  onOpenDraftSettings,
  onGenerateDraftOrder,
}: {
  teams: UserLeagueTeam[]
  isCommissioner: boolean
  onOpenDraftSettings: () => void
  onGenerateDraftOrder: () => void
}) {
  const ordered = useMemo(() => {
    const withPos = teams.filter((t) => t.draftPosition != null && Number.isFinite(t.draftPosition))
    return [...withPos].sort((a, b) => (a.draftPosition ?? 0) - (b.draftPosition ?? 0))
  }, [teams])
  const hasOrder = ordered.length > 0

  return (
    <section
      className="rounded-2xl border border-white/[0.08] bg-[#0c0c1e] p-4"
      aria-label="Draft order"
      data-testid="nfl-redraft-draft-order"
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <h2 className="text-sm font-semibold text-white">Draft order</h2>
        {isCommissioner ? (
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={onGenerateDraftOrder}
              className="rounded-lg border border-cyan-500/35 bg-cyan-500/10 px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide text-cyan-200 hover:bg-cyan-500/20"
              data-testid="nfl-redraft-generate-draft-order"
            >
              {hasOrder ? 'Regenerate draft order' : 'Generate draft order'}
            </button>
            <button
              type="button"
              onClick={onOpenDraftSettings}
              className="rounded-lg border border-white/[0.12] bg-white/[0.06] px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide text-white/85 hover:bg-white/[0.1]"
              data-testid="nfl-redraft-edit-draft-settings"
            >
              Edit draft settings
            </button>
          </div>
        ) : null}
      </div>
      {!hasOrder ? (
        <p className="mt-3 text-[12px] text-white/45">Draft order has not been generated yet.</p>
      ) : (
        <ol className="mt-3 space-y-2">
          {ordered.map((t, i) => (
            <li
              key={t.id}
              className="flex items-center justify-between gap-2 rounded-lg border border-white/[0.06] bg-black/20 px-3 py-2 text-[12px]"
            >
              <span className="font-bold tabular-nums text-cyan-300">{i + 1}.</span>
              <span className="min-w-0 flex-1 truncate font-semibold text-white">{t.teamName}</span>
              <span className="shrink-0 text-[10px] text-white/40">Slot #{t.draftPosition}</span>
            </li>
          ))}
        </ol>
      )}
    </section>
  )
}

type TimerParts = { days: number; hours: number; mins: number; secs: number }

function remainingParts(targetMs: number): TimerParts | 'dash' {
  if (!Number.isFinite(targetMs)) return 'dash'
  const diff = Math.max(0, targetMs - Date.now())
  const secs = Math.floor(diff / 1000)
  const days = Math.floor(secs / 86400)
  const hours = Math.floor((secs % 86400) / 3600)
  const mins = Math.floor((secs % 3600) / 60)
  const s = secs % 60
  return { days, hours, mins, secs: s }
}

function useDraftCountdown(draftDateIso: string | null | undefined): TimerParts | 'dash' {
  const targetMs = useMemo(() => {
    if (!draftDateIso) return NaN
    const t = new Date(draftDateIso).getTime()
    return Number.isFinite(t) ? t : NaN
  }, [draftDateIso])

  const [parts, setParts] = useState<TimerParts | 'dash'>(() =>
    Number.isFinite(targetMs) ? remainingParts(targetMs) : 'dash',
  )

  useEffect(() => {
    if (!Number.isFinite(targetMs)) {
      setParts('dash')
      return
    }

    const tick = () => {
      setParts(remainingParts(targetMs))
    }

    tick()
    const id = window.setInterval(tick, 1000)
    return () => window.clearInterval(id)
  }, [targetMs])

  return parts
}

export function DraftTab({
  league,
  teams,
  isOwner,
  isCommissioner = false,
  inviteToken,
  idpLeagueUi = false,
  seasonSnapshot = null,
  standingsPresentation = { mode: 'standard' },
  mode = 'draft',
  onOpenLeagueSettings,
  dashboardEmbed = false,
}: DraftTabProps) {
  const isLeagueHome = mode === 'league'
  const router = useRouter()
  const searchParams = useSearchParams()
  const [displayTeams, setDisplayTeams] = useState<UserLeagueTeam[]>(teams)

  useEffect(() => {
    setDisplayTeams(teams)
  }, [teams])

  const filled = displayTeams.length
  const cap = league.teamCount
  const isFull = filled >= cap
  const justCreated = searchParams?.get('created') === '1'
  const showInviteHighlight = searchParams?.get('showInvite') === '1'
  const settings = league.settings as Record<string, unknown> | undefined
  const allowInviteLink =
    typeof settings?.league_allow_invite_link === 'boolean'
      ? settings.league_allow_invite_link
      : typeof settings?.allow_invite_link === 'boolean'
        ? settings.allow_invite_link
        : true
  const inviteCode =
    (typeof settings?.inviteCode === 'string' && settings.inviteCode.trim()) ||
    (typeof inviteToken === 'string' && inviteToken.trim()) ||
    ''
  const inviteDisplayPath =
    inviteCode.length > 0
      ? `allfantasy.ai/join?code=${encodeURIComponent(inviteCode)}&leagueId=${encodeURIComponent(league.id)}`
      : ''
  const inviteCopyUrl = inviteDisplayPath ? `https://${inviteDisplayPath}` : ''
  const canManageInvite = isOwner || isCommissioner
  const showInvite =
    canManageInvite &&
    inviteCode.length > 0 &&
    allowInviteLink &&
    (!isFull || (justCreated && showInviteHighlight))

  const [finderListed, setFinderListed] = useState(false)
  const [finderLoading, setFinderLoading] = useState(false)
  const [finderChecked, setFinderChecked] = useState(false)

  useEffect(() => {
    if (!isCommissioner || !league.id) return
    let cancelled = false
    fetch(`/api/commissioner/leagues/${encodeURIComponent(league.id)}/league-finder`, { credentials: 'include' })
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { listed?: boolean } | null) => {
        if (cancelled || !d) return
        setFinderListed(Boolean(d.listed))
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setFinderChecked(true)
      })
    return () => {
      cancelled = true
    }
  }, [isCommissioner, league.id])

  const handleCopyInvite = useCallback(async () => {
    if (!inviteCopyUrl) return
    try {
      await navigator.clipboard.writeText(inviteCopyUrl)
    } catch {
      // ignore
    }
  }, [inviteCopyUrl])

  const handleLeagueFinder = useCallback(async () => {
    if (!isCommissioner || finderLoading) return
    setFinderLoading(true)
    try {
      if (finderListed) {
        const res = await fetch(`/api/commissioner/leagues/${encodeURIComponent(league.id)}/league-finder`, {
          method: 'DELETE',
          credentials: 'include',
        })
        if (res.ok) {
          setFinderListed(false)
          toast.success('Removed from League finder')
        } else {
          toast.error('Could not remove listing')
        }
      } else {
        const res = await fetch(`/api/commissioner/leagues/${encodeURIComponent(league.id)}/league-finder`, {
          method: 'POST',
          credentials: 'include',
        })
        const data = (await res.json().catch(() => ({}))) as { error?: string; tierBand?: { low: number; high: number } }
        if (res.ok) {
          setFinderListed(true)
          const band =
            data.tierBand && typeof data.tierBand.low === 'number'
              ? `Tiers ${data.tierBand.low}–${data.tierBand.high}`
              : 'Rank-matched'
          toast.success(`Added to League finder (${band})`)
        } else {
          toast.error(typeof data.error === 'string' ? data.error : 'Could not add to League finder')
        }
      }
    } catch {
      toast.error('Network error')
    } finally {
      setFinderLoading(false)
    }
  }, [isCommissioner, finderLoading, finderListed, league.id])

  const draftDateIso = league.draftDate ?? null
  const hasDraftTime = Boolean(draftDateIso && Number.isFinite(new Date(draftDateIso).getTime()))
  const timer = useDraftCountdown(hasDraftTime ? draftDateIso : null)
  const canSetDraftTime = isOwner || isCommissioner
  const settingsBundle = useMemo(() => getSleeperLikeBundle(league.settings as unknown), [league.settings])
  const sleeperDraftId = useMemo(
    () => getDraftIdFromSettings(league.settings as unknown),
    [league.settings],
  )
  const draftTypeLabel = useMemo(
    () => formatDraftTypeLabel(settingsBundle.draftType ?? settingsBundle.draft_type),
    [settingsBundle],
  )
  const pickTimerLabel = useMemo(
    () => formatPickTimerLabel(settingsBundle.pickTimerPreset ?? settingsBundle.pick_timer_preset, settingsBundle.pickTimerCustomValue ?? settingsBundle.pick_timer_custom_value),
    [settingsBundle],
  )
  const draftDateLabel = useMemo(() => formatDraftDateLabel(draftDateIso), [draftDateIso])
  const leagueIdentityLabel = useMemo(() => {
    const scoring = typeof league.scoring === 'string' && league.scoring.trim() ? league.scoring.replace(/_/g, ' ').toUpperCase() : 'REDRAFT'
    return `${String(league.sport ?? 'NFL').toUpperCase()} • ${scoring}`
  }, [league.scoring, league.sport])
  const enterDraftRoomHref = `/league/${league.id}/draft`

  const handleSetTime = useCallback(() => {
    console.log('DraftTab: Set Time (stub)', { leagueId: league.id })
  }, [league.id])

  const handleMockDrafts = useCallback(async () => {
    try {
      const res = await fetch('/api/draft/create-mock', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ leagueId: league.id, sport: league.sport }),
      })
      if (!res.ok) return
      const data = (await res.json()) as { draftId?: string; roomId?: string }
      const id = data.draftId ?? data.roomId
      if (id) {
        router.push(`/draft/mock/${id}`)
      }
    } catch {
      // ignore
    }
  }, [league.id, league.sport, router])

  const nflRedraftShell = isNflRedraftCoreDashboardFromUserLeague(league)
  const preDraft = isPreDraftLeagueStatus(league)
  const liveDraft = isLiveDraftLeagueStatus(league)

  const openSettingsDraft = useCallback(() => {
    if (onOpenLeagueSettings) onOpenLeagueSettings('draft')
    else router.push(`/league/${league.id}?view=settings`)
  }, [onOpenLeagueSettings, router, league.id])

  const canEnterDraftRoom = (preDraft || liveDraft) && Boolean(league.id)

  /**
   * Always navigate to the draft route — `/league/[id]/draft` handles its own
   * state (pre-draft hub, live room, post-draft summary). The previous silent
   * no-op when canEnterDraftRoom was false left users with a dead-feeling button.
   * If the league truly has no draft session yet (no league.id), surface a toast
   * instead of swallowing the click.
   */
  const handleDraftRoom = useCallback(async () => {
    if (!league.id) {
      toast.error('Draft is not available for this league yet.')
      return
    }
    if (dashboardEmbed) {
      await openDraftFromEmbeddedLeague({
        leagueId: league.id,
        dashboardEmbed: true,
        source: 'DraftTab',
      })
      return
    }
    router.push(enterDraftRoomHref)
  }, [dashboardEmbed, enterDraftRoomHref, league.id, router])

  const handleGenerateDraftOrder = useCallback(async () => {
    if (!(isCommissioner || isOwner)) return
    try {
      const res = await fetch('/api/league/settings/randomize-order', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ leagueId: league.id, count: Math.max(1, cap) }),
      })
      const data = (await res.json().catch(() => ({}))) as {
        error?: string
        slots?: Array<{ slot: number; ownerId: string }>
      }
      if (!res.ok) {
        toast.error(typeof data.error === 'string' ? data.error : 'Could not generate draft order')
        return
      }

      const slotByOwnerId = new Map<string, number>()
      for (const slot of data.slots ?? []) {
        if (typeof slot.ownerId === 'string' && Number.isFinite(slot.slot)) {
          slotByOwnerId.set(slot.ownerId, slot.slot)
        }
      }

      const getSlotByOwnerId = (ownerId: string | null | undefined) =>
        ownerId ? slotByOwnerId.get(ownerId) : undefined

      setDisplayTeams((currentTeams) =>
        currentTeams.map((team) => ({
          ...team,
          draftPosition:
            getSlotByOwnerId(team.id) ??
            getSlotByOwnerId(team.claimedByUserId) ??
            getSlotByOwnerId(team.platformUserId) ??
            getSlotByOwnerId(team.externalId) ??
            team.draftPosition ??
            null,
        })),
      )
      toast.success(slotByOwnerId.size > 0 ? 'Draft order updated' : 'Draft order saved')
    } catch {
      toast.error('Could not generate draft order')
    }
  }, [cap, isCommissioner, isOwner, league.id])

  return (
    <div className={isLeagueHome ? 'space-y-4' : 'space-y-4 p-5'}>
      {idpLeagueUi ? <IDPDraftFilters /> : null}
      {showInvite ? (
        <section
          className="rounded-2xl border border-white/[0.08] bg-[#0c0c1e] p-4"
          aria-label="Invite friends"
        >
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 className="text-sm font-semibold text-white">Invite friends to play</h2>
              <p className="mt-0.5 text-[11px] text-white/45">Copy the link and share with your friends</p>
            </div>
            <div className="shrink-0 text-[13px] font-bold tabular-nums">
              <span className="text-cyan-400">{filled}</span>
              <span className="text-white/80">/{cap}</span>
            </div>
          </div>
          {justCreated && showInviteHighlight ? (
            <p className="mt-2 text-[11px] text-cyan-200/80">League ID: {league.id}</p>
          ) : null}

          <div className="mt-3 flex flex-wrap items-center gap-2">
            <div className="relative min-w-0 flex-1">
              <code className="block truncate rounded-lg border border-white/[0.07] bg-black/25 py-2 pl-3 pr-10 text-[11px] text-cyan-200/90">
                {inviteCopyUrl || inviteDisplayPath}
              </code>
            </div>
            <button
              type="button"
              onClick={() => void handleCopyInvite()}
              className="shrink-0 rounded-xl bg-cyan-500 px-4 py-2 text-[11px] font-black uppercase tracking-wide text-black transition hover:bg-cyan-400"
              data-testid="league-invite-copy"
            >
              COPY
            </button>
            {isCommissioner ? (
              <button
                type="button"
                onClick={() => void handleLeagueFinder()}
                disabled={finderLoading || !finderChecked}
                className={`shrink-0 rounded-xl border px-3 py-2 text-[11px] font-bold uppercase tracking-wide transition ${
                  finderListed
                    ? 'border-white/20 bg-white/[0.08] text-white/80 hover:bg-white/[0.12]'
                    : 'border-cyan-500/40 bg-cyan-500/10 text-cyan-200 hover:bg-cyan-500/20'
                } disabled:opacity-50`}
                data-testid="league-finder-toggle"
              >
                {finderLoading ? '…' : finderListed ? 'Remove from league finder' : 'Add to league finder'}
              </button>
            ) : null}
          </div>
          {isCommissioner ? (
            <p className="mt-2 text-[10px] leading-relaxed text-white/35">
              <Link href="/app/discover" className="text-cyan-400/90 underline decoration-cyan-500/30 underline-offset-2 hover:text-cyan-300">
                League finder
              </Link>{' '}
              matches your league to managers within one rank tier of yours (same, one above, or one below).
            </p>
          ) : null}
        </section>
      ) : null}

      {!isLeagueHome ? (
      <section
        className="relative overflow-hidden rounded-[22px] text-white shadow-lg shadow-black/30"
        style={{
          background: 'linear-gradient(135deg, #5b46c8 0%, #4836b8 42%, #3d2da3 100%)',
        }}
        aria-label="Draftboard"
        data-testid="league-draftboard-card"
      >
        {/* Right-side depth + faint grid blocks */}
        <div
          className="pointer-events-none absolute inset-y-0 right-0 w-[min(52%,280px)] bg-gradient-to-l from-[#1a0f4a]/85 via-[#2a1d70]/40 to-transparent"
          aria-hidden
        />
        <div
          className="pointer-events-none absolute -right-6 top-4 h-24 w-24 rotate-12 rounded-2xl border border-white/[0.07] bg-white/[0.04]"
          aria-hidden
        />
        <div
          className="pointer-events-none absolute right-16 top-10 h-16 w-16 rotate-6 rounded-xl border border-white/[0.05] bg-white/[0.03]"
          aria-hidden
        />
        <div
          className="pointer-events-none absolute right-8 bottom-16 h-20 w-20 -rotate-3 rounded-2xl border border-white/[0.06] bg-white/[0.025]"
          aria-hidden
        />

        <div className="relative z-10 p-5 sm:p-6">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="min-w-0 pr-2">
              <h2 className="text-base font-bold tracking-tight text-white sm:text-[17px]">Draftboard</h2>
              <p className="mt-1 text-[12px] font-normal leading-snug text-white/80 sm:text-[13px]">
                {draftDateLabel}
              </p>
              <p className="mt-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-cyan-200/70">{leagueIdentityLabel}</p>
            </div>
            <div className="flex shrink-0 gap-2">
              <button
                type="button"
                onClick={() => void handleDraftRoom()}
                className="flex h-10 w-10 items-center justify-center rounded-full border border-white/20 bg-[#0f1f52]/60 text-white shadow-inner backdrop-blur-sm transition hover:bg-[#0f1f52]/90"
                aria-label="Open draft room"
                data-testid="league-draftboard-draft-room"
              >
                <LayoutGrid className="h-[18px] w-[18px]" strokeWidth={2} aria-hidden />
              </button>
              <button
                type="button"
                onClick={() => openSettingsDraft()}
                className="flex h-10 w-10 items-center justify-center rounded-full border border-white/20 bg-[#0f1f52]/60 text-white shadow-inner backdrop-blur-sm transition hover:bg-[#0f1f52]/90"
                aria-label="League and draft settings"
                data-testid="league-draftboard-settings"
              >
                <Settings className="h-[18px] w-[18px]" strokeWidth={2} aria-hidden />
              </button>
            </div>
          </div>

          <div className="mt-5 flex justify-center">
            <div className="flex w-full max-w-lg items-stretch justify-center rounded-full border border-white/[0.08] bg-[#040915]/85 px-3 py-3 shadow-[inset_0_1px_0_rgba(255,255,255,0.06)] sm:px-5">
              <div className="flex flex-1 flex-wrap items-center justify-center gap-x-1 gap-y-2 sm:gap-x-2">
                {(['DAYS', 'HRS', 'MINS', 'SECS'] as const).map((label, i) => {
                  const value =
                    timer === 'dash'
                      ? '--'
                      : label === 'DAYS'
                        ? String(timer.days)
                        : label === 'HRS'
                          ? String(timer.hours).padStart(2, '0')
                          : label === 'MINS'
                            ? String(timer.mins).padStart(2, '0')
                            : String(timer.secs).padStart(2, '0')
                  return (
                    <div key={label} className="flex items-center">
                      {i > 0 ? (
                        <span className="mx-0.5 font-mono text-lg font-bold text-white/35 sm:mx-1" aria-hidden>
                          :
                        </span>
                      ) : null}
                      <div className="flex min-w-[3rem] flex-col items-center gap-1 sm:min-w-[3.5rem]">
                        <span className="font-mono text-[17px] font-bold tabular-nums text-white sm:text-[19px]">
                          {value}
                        </span>
                        <span className="text-[8px] font-semibold uppercase tracking-[0.14em] text-white/40">
                          {label}
                        </span>
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          </div>

          <div className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4" data-testid="nfl-redraft-predraft-summary">
            <div className="rounded-2xl border border-white/[0.08] bg-black/20 p-3">
              <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-white/45">League fill</p>
              <p className="mt-1 text-sm font-semibold text-white">{filled}/{cap} teams joined</p>
              <p className="mt-1 text-[11px] text-white/55">{isFull ? 'League is full and ready for draft setup.' : `${Math.max(cap - filled, 0)} spot${cap - filled === 1 ? '' : 's'} still open.`}</p>
            </div>
            <div className="rounded-2xl border border-white/[0.08] bg-black/20 p-3">
              <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-white/45">Draft type</p>
              <p className="mt-1 text-sm font-semibold text-white">{draftTypeLabel}</p>
              <p className="mt-1 text-[11px] text-white/55">League setup card stays on Home until someone intentionally enters the draft room.</p>
            </div>
            <div className="rounded-2xl border border-white/[0.08] bg-black/20 p-3">
              <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-white/45">Draft date</p>
              <p className="mt-1 text-sm font-semibold text-white">{draftDateLabel}</p>
              <p className="mt-1 text-[11px] text-white/55">Commissioners can edit this from draft settings.</p>
            </div>
            <div className="rounded-2xl border border-white/[0.08] bg-black/20 p-3">
              <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-white/45">Pick timer</p>
              <p className="mt-1 text-sm font-semibold text-white">{pickTimerLabel}</p>
              <p className="mt-1 text-[11px] text-white/55">Applies once the live draft room opens.</p>
            </div>
          </div>

          {sleeperDraftId ? (
            <p className="mt-3 text-center text-[10px] text-white/35">
              Sleeper draft id: <span className="font-mono text-white/50">{sleeperDraftId}</span>
            </p>
          ) : null}

          <div className="mt-5 flex flex-col gap-3 sm:flex-row sm:items-stretch">
            <button
              type="button"
              onClick={() => void handleMockDrafts()}
              className="flex flex-1 flex-col items-center justify-center rounded-full border-2 border-white/90 bg-transparent px-5 py-3 text-center transition hover:bg-white/10"
              data-testid="league-draftboard-mock"
            >
              <span className="text-[12px] font-bold uppercase tracking-wide text-white">Mock drafts</span>
              <span className="mt-0.5 text-[11px] font-normal text-white/85">Practice drafting</span>
            </button>
            {canSetDraftTime ? (
              <button
                type="button"
                onClick={handleSetTime}
                className="flex flex-1 items-center justify-center rounded-full bg-cyan-400 px-5 py-3 text-[12px] font-black uppercase tracking-wide text-[#0a0f18] shadow-md shadow-cyan-900/30 transition hover:bg-cyan-300"
                data-testid="league-draftboard-set-time"
              >
                Set time
              </button>
            ) : (
              <button
                type="button"
                onClick={() => void handleDraftRoom()}
                disabled={!canEnterDraftRoom}
                className="flex flex-1 items-center justify-center rounded-full bg-cyan-400 px-5 py-3 text-[12px] font-black uppercase tracking-wide text-[#0a0f18] shadow-md shadow-cyan-900/30 transition hover:bg-cyan-300 disabled:cursor-not-allowed disabled:opacity-50"
                data-testid="league-draftboard-enter-room"
              >
                Draftroom
              </button>
            )}
          </div>

          <p className="mt-3 text-center text-[11px] text-white/55" data-testid="league-draftboard-enter-room-help">
            {canEnterDraftRoom
              ? 'The live draft room only opens when you click Enter Draft Room.'
              : 'Draft room entry is unavailable outside draft setup or live drafting.'}
          </p>
        </div>
      </section>
      ) : null}

      <LeagueManagersStandingsSection
        league={league}
        leagueId={league.id}
        teams={displayTeams}
        seasonSnapshot={seasonSnapshot}
        draftTabExtras={{ filled, cap, isFull, isOwner }}
        standingsPresentation={standingsPresentation}
        showDraftPositions={!isLeagueHome}
      />

      {nflRedraftShell && !isLeagueHome && preDraft ? (
        <NflRedraftDraftOrderBlock
          teams={displayTeams}
          isCommissioner={Boolean(isCommissioner || isOwner)}
          onOpenDraftSettings={() => openSettingsDraft()}
          onGenerateDraftOrder={() => void handleGenerateDraftOrder()}
        />
      ) : null}

      <LeagueRecentActivity leagueId={league.id} />
    </div>
  )
}
