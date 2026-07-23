'use client'

import Link from 'next/link'
import Image from 'next/image'
import { useRouter } from 'next/navigation'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ArrowLeftRight, ClipboardList, Settings, X, ExternalLink, Activity } from 'lucide-react'
import { toast } from 'sonner'
import { SubscriptionGateBadge } from '@/components/subscription/SubscriptionGateBadge'
import { SubscriptionGateModal } from '@/components/subscription/SubscriptionGateModal'
import { useEntitlement } from '@/hooks/useEntitlement'
import { useSubscriptionGateOptional } from '@/hooks/useSubscriptionGate'
import { isBestBallLeague } from '@/lib/autocoach/bestBallShared'
import type { LeagueTeam } from '@prisma/client'
import { PlayerHeadshot } from '@/components/league/PlayerHeadshot'
import { TeamLogo } from '@/app/components/TeamLogo'
import { getRosterPlayerIds } from '@/lib/waiver-wire/roster-utils'
import type { UserLeague } from '@/app/dashboard/types'
import { type PlayerMap, useSleeperPlayers } from '@/lib/hooks/useSleeperPlayers'
import { getStarterSlotLabels } from '@/lib/league/rosterSlots'
import { IDPTeamDashboard } from '@/app/idp/components/IDPTeamDashboard'
import { isWeatherSensitiveSport } from '@/lib/weather/outdoorSportMetadata'
import { ProjectionDisplay } from '@/components/weather/ProjectionDisplay'
import { ProjectionValue } from '@/components/league/ProjectionValue'
import { resolveProjectionAvailability } from '@/lib/league/dataHonesty'
import type { ExpandedStarterSlot } from '@/lib/league/lineup-expand-template'
import { evaluateLineupLock } from '@/lib/league/lineup-lock'
import { isNflRedraftCoreDashboardFromUserLeague } from '@/lib/league/is-nfl-redraft-core-dashboard'
import { openChimmyWithPrompt } from '@/lib/dashboard/open-chimmy-with-prompt'
import { invalidateIntelligence } from '@/lib/dashboard/intelligence-events'
import { TeamLineupSwapModal } from '@/components/league/TeamLineupSwapModal'
import type { SwapCandidate } from '@/components/league/TeamLineupSwapModal'
import { StartVsComparisonLauncher } from '@/components/app/player-comparison/StartVsComparisonLauncher'
import {
  applyLineupPick,
  buildPlayerRow,
  buildReserveSwapCandidates,
  buildSwapCandidates,
  initOrSyncLineupLists,
  swapPlayersInLists,
  type RosterLineupLists,
} from '@/app/league/[leagueId]/tabs/team-tab-roster-helpers'
import type { RosterLegalityFullResult } from '@/lib/roster-legality/types'
import dynamic from 'next/dynamic'
import type { UnifiedPlayerWireDto } from '@/lib/player-data/serializeUnifiedPlayerForApi'
import {
  buildDisplayPlayerMap,
  resolveDisplayPlayer,
  type DisplayPlayerMap,
  type DisplayPlayerRecord,
} from '@/lib/player-data/adapters/redraftDisplayPlayers'
import { teamDefenseDisplayNameFromId } from '@/lib/redraft/teamDefenseIdentity'
import { useLeagueRealtimeRefresh } from '@/hooks/useLeagueRealtimeRefresh'

const TeamTabMatchupBanner = dynamic(
  () =>
    import('@/app/league/[leagueId]/tabs/team-tab-matchup-banner').then(
      (m) => m.TeamTabMatchupBanner
    ),
  { ssr: false }
)

function dispatchRosterLegalityEvent(leagueId: string, result: RosterLegalityFullResult | null) {
  if (typeof window === 'undefined') return
  if (!result || result.isLegal) {
    window.dispatchEvent(new CustomEvent('af-roster-legality', { detail: { leagueId, count: 0 } }))
  } else {
    const count = Math.max(
      result.requiredMovesCount,
      result.blockingReasons?.length ?? 0,
      result.highlightedPlayerIds?.length ?? 0,
      1,
    )
    window.dispatchEvent(new CustomEvent('af-roster-legality', { detail: { leagueId, count } }))
  }
  window.dispatchEvent(new CustomEvent('af-roster-legality-summary-invalidate'))
}

type DbLineupSwapCtx =
  | { kind: 'starter'; index: number; slot: ExpandedStarterSlot }
  | { kind: 'reserve'; section: 'bench' | 'ir' | 'taxi' | 'devy'; playerId: string }

type LineupReplacementCtx =
  | {
      kind: 'starter'
      sourcePlayerId: string
      slotIndex: number
      slotLabel: string
      candidates: SwapCandidate[]
    }
  | {
      kind: 'reserve'
      sourcePlayerId: string
      section: 'bench' | 'ir' | 'taxi' | 'devy'
      slotLabel: string
      candidates: SwapCandidate[]
    }

const RESERVE_SWAP_TITLE: Record<'bench' | 'ir' | 'taxi' | 'devy', string> = {
  bench: 'Bench',
  ir: 'IR',
  taxi: 'Taxi',
  devy: 'Devy',
}

export type TeamTabProps = {
  league: UserLeague
  userTeam: LeagueTeam | null
  onPlayerClick: (playerId: string) => void
  inviteToken?: string | null
  /** When set, overrides `league.sport` for Sleeper hooks / position labels */
  sport?: string
  /** IDP split roster dashboard when league has `IdpLeagueConfig`. */
  idpLeagueUi?: boolean
  idpViewMode?: 'offense' | 'defense' | 'full'
  idpPositionMode?: string
  /** Opens user account settings (defaults to `/settings`). */
  onUserSettingsClick?: () => void
}

type DbRosterPayload = {
  source?: 'db'
  roster: unknown
  unifiedRoster?: UnifiedPlayerWireDto[]
  rosterId?: string
  faabRemaining?: number
  slotLimits?: { starters: number; bench: number; ir: number; taxi: number; devy: number } | null
  leagueWeek?: number
  maxWeek?: number
  starterSlots?: ExpandedStarterSlot[]
  canEditLineup?: boolean
  lineupLockHelp?: string | null
}

type SleeperRosterBody = {
  roster_id: number
  starters: string[]
  players: string[]
  reserve: string[]
  taxi: string[]
  picks: unknown[]
  settings: {
    wins: number
    losses: number
    ties: number
    fpts: number
    fpts_decimal: number
    waiver_budget_used: number
    waiver_position: number
  }
}

type SleeperUsersMap = Record<
  string,
  { display_name: string; avatar: string | null; team_name: string | null }
>

type SleeperApiPayload = {
  source: 'sleeper'
  roster: SleeperRosterBody | null
  ownerId?: string | null
  users: SleeperUsersMap
  rosterPositions?: string[]
}

function toRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null
}

function getStringIds(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.map((x) => String(x)).filter(Boolean)
}

function getStarterIds(playerData: unknown): string[] {
  const rec = toRecord(playerData)
  if (!rec) return []
  return getStringIds(rec.starters)
}

function getIrIds(playerData: unknown): string[] {
  const rec = toRecord(playerData)
  if (!rec) return []
  return getStringIds(rec.reserve ?? rec.ir)
}

function getTaxiIds(playerData: unknown): string[] {
  const rec = toRecord(playerData)
  if (!rec) return []
  return getStringIds(rec.taxi)
}

function partitionRoster(
  playerData: unknown,
  slotLimits: DbRosterPayload['slotLimits'],
): { starters: string[]; bench: string[]; ir: string[]; taxi: string[] } {
  const all = getRosterPlayerIds(playerData)
  const starterIds = getStarterIds(playerData)
  const irIds = getIrIds(playerData)
  const taxiIds = getTaxiIds(playerData)

  let starters: string[]
  if (starterIds.length > 0) {
    starters = starterIds.filter((id) => all.includes(id))
  } else {
    const n = Math.max(0, slotLimits?.starters ?? 9)
    starters = all.slice(0, Math.min(n, all.length))
  }

  const starterSet = new Set(starters)
  const irSet = new Set(irIds)
  const taxiSet = new Set(taxiIds)

  const reserved = new Set([...starterSet, ...irSet, ...taxiSet])
  const bench = all.filter((id) => !reserved.has(id))

  const ir = irIds.filter((id) => all.includes(id))
  const taxi = taxiIds.filter((id) => all.includes(id))

  return { starters, bench, ir, taxi }
}

function partitionSleeperRoster(r: SleeperRosterBody): {
  starters: string[]
  bench: string[]
  ir: string[]
  taxi: string[]
} {
  const starters = r.starters.map(String)
  const reserve = new Set((r.reserve ?? []).map(String))
  const taxiSet = new Set((r.taxi ?? []).map(String))
  const starterSet = new Set(starters)
  const players = (r.players ?? []).map(String)
  const bench = players.filter(
    (id) => !starterSet.has(id) && !reserve.has(id) && !taxiSet.has(id),
  )
  return {
    starters,
    bench,
    ir: (r.reserve ?? []).map(String),
    taxi: (r.taxi ?? []).map(String),
  }
}

function formatDraftPick(p: unknown): string {
  if (!p || typeof p !== 'object') return 'Draft pick'
  const o = p as Record<string, unknown>
  const season = o.season ?? o.year
  const round = o.round
  const order = o.order ?? o.pick_no
  if (season == null && round == null) return 'Draft pick'
  const line = `${season} Round ${round} Pick`
  return order != null ? `${line} #${order}` : line
}

function positionBadgeClass(pos: string): string {
  const p = pos.toUpperCase()
  if (p === 'QB') return 'border-red-500/35 bg-red-500/25 text-red-400'
  if (p === 'RB') return 'border-emerald-500/35 bg-emerald-500/25 text-emerald-400'
  if (p === 'WR') return 'border-blue-500/35 bg-blue-500/25 text-blue-400'
  if (p === 'TE') return 'border-orange-500/35 bg-orange-500/25 text-orange-400'
  if (p === 'K') return 'border-gray-500/35 bg-gray-500/25 text-gray-400'
  if (p === 'DEF' || p === 'DST') return 'border-purple-500/35 bg-purple-500/25 text-purple-400'
  return 'border-subtle bg-surface-muted text-secondary'
}

function managerInitials(name: string): string {
  const t = name.trim()
  if (!t) return '?'
  const parts = t.split(/\s+/).filter(Boolean)
  if (parts.length >= 2) {
    return (parts[0]![0]! + parts[1]![0]!).toUpperCase()
  }
  return t.slice(0, 2).toUpperCase()
}

function slotBadgeClass(slot: string): string {
  const u = slot.toUpperCase()
  if (u === 'BN' || u === 'BENCH') return 'border-subtle bg-surface-muted text-secondary'
  if (u === 'IR') return 'border-subtle bg-surface-muted text-primary'
  if (u === 'TX' || u === 'TAXI') return 'border-subtle bg-surface-muted text-primary'
  if (u === 'DV' || u === 'DEVY') return 'border-subtle bg-surface-muted text-primary'
  if (u.includes('DL') || u === 'DE' || u === 'DT') return 'border-rose-400/35 bg-rose-500/20 text-rose-200'
  if (u.includes('LB')) return 'border-indigo-400/35 bg-indigo-500/20 text-indigo-200'
  if (u.includes('DB') || u === 'CB' || u === 'S') return 'border-fuchsia-400/35 bg-fuchsia-500/20 text-fuchsia-200'
  if (u.includes('QB')) return 'border-red-500/35 bg-red-500/25 text-red-400'
  if (u.includes('RB')) return 'border-emerald-500/35 bg-emerald-500/25 text-emerald-400'
  if (u.includes('WR')) return 'border-blue-500/35 bg-blue-500/25 text-blue-400'
  if (u.includes('TE')) return 'border-orange-500/35 bg-orange-500/25 text-orange-400'
  if (u.includes('FLEX') || u.includes('SF') || u.includes('SUPER') || u.includes('WRT')) return 'border-cyan-500/35 bg-cyan-500/25 text-cyan-400'
  if (u.includes('K')) return 'border-gray-500/35 bg-gray-500/25 text-gray-400'
  if (u.includes('DEF') || u.includes('DST')) return 'border-purple-500/35 bg-purple-500/25 text-purple-400'
  return 'border-subtle bg-surface-muted text-secondary'
}

function displayPlayerStatusText(player: DisplayPlayerRecord): string {
  const injury = player.injuryStatus?.trim()
  if (injury) return injury
  const active = player.activeStatus?.trim()
  return active || 'Active'
}

function displayPlayerStatusTextClass(status: string): string {
  const normalized = status.toLowerCase()
  if (/\bout\b|\bir\b|inactive|suspend|pup|injured reserve/.test(normalized)) return 'text-rose-300'
  if (/questionable|doubtful|limited|injur|probable/.test(normalized)) return 'text-amber-300'
  return 'text-emerald-300'
}

function displayPlayerStatusDotClass(status: string): string {
  const normalized = status.toLowerCase()
  if (/\bout\b|\bir\b|inactive|suspend|pup|injured reserve/.test(normalized)) return 'bg-rose-400'
  if (/questionable|doubtful|limited|injur|probable/.test(normalized)) return 'bg-amber-300'
  return 'bg-emerald-400'
}

function buildNflRedraftRosterChimmyPrompt(args: {
  playerName: string
  teamAbbr: string
  position: string
  rosterSlot: string
  leagueName: string
  userQuestion: string
}): string {
  const q = args.userQuestion.trim()
  const questionLine = q.length > 0 ? q : '(none)'
  return [
    'Analyze this NFL redraft roster player:',
    `Player: ${args.playerName}`,
    `Team: ${args.teamAbbr}`,
    `Position: ${args.position}`,
    `Roster slot: ${args.rosterSlot}`,
    `League: ${args.leagueName}`,
    `Question: ${questionLine}`,
    '',
    'Should I start, bench, trade, hold, or drop this player?',
  ].join('\n')
}

// Player Detail Bottom Sheet

function PlayerDetailSheet({
  playerId,
  slotLabel,
  sport,
  players,
  week,
  season,
  onClose,
  onViewFullStats,
  canReplaceInLineup,
  onOpenReplace,
}: {
  playerId: string
  slotLabel?: string
  sport: string
  players: DisplayPlayerMap
  week: number
  season: number
  onClose: () => void
  /** Calls the existing PlayerStatCard opener from LeagueShell. */
  onViewFullStats: (id: string) => void
  canReplaceInLineup?: boolean
  onOpenReplace?: () => void
}) {
  const resolved = resolveDisplayPlayer(playerId, players)
  const pos = resolved.position || '-'
  // Honest projection: no fabricated baseline — missing renders as missing (Honesty Pack 1A).
  const projection = resolved.projectedPoints ?? null
  const statusText = displayPlayerStatusText(resolved)
  const statusTextClass = displayPlayerStatusTextClass(statusText)
  const statusDotClass = displayPlayerStatusDotClass(statusText)
  const showCrest = isWeatherSensitiveSport(sport)

  // Close on Escape key
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const statusDot =
    (pos === 'DEF' || pos === 'DST' || pos === 'K') && !resolved.injuryStatus && !resolved.activeStatus
      ? null
      : (
        <span
          className={`h-2 w-2 rounded-full ${statusDotClass}`}
          title={`Status: ${statusText}`}
          aria-label={statusText}
        />
      )

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 z-40 bg-black/60 backdrop-blur-[2px]"
        onClick={onClose}
        aria-hidden
      />
      {/* Sheet */}
      <div
        role="dialog"
        aria-modal="true"
        aria-label={`${resolved.name} player details`}
        className="fixed bottom-0 left-0 right-0 z-50 mx-auto max-w-lg rounded-t-2xl border-t border-subtle bg-surface pb-[max(1.25rem,env(safe-area-inset-bottom))] shadow-popover"
        data-testid="player-detail-sheet"
      >
        {/* Drag handle */}
        <div className="flex justify-center pt-3 pb-1">
          <div className="h-1 w-10 rounded-full bg-surface-hover" />
        </div>

        {/* Header */}
        <div className="flex items-start gap-3 px-5 pb-3 pt-2">
          <div className="relative shrink-0">
            <PlayerHeadshot
              playerId={playerId}
              sport={sport}
              useResolver={String(sport ?? '').trim().toUpperCase() === 'NFL'}
              playerName={resolved.name}
              headshotUrl={resolved.headshotUrl ?? resolved.imageUrl ?? null}
              position={resolved.position}
              espnId={players[playerId]?.espn_id}
              nbaId={players[playerId]?.nba_id}
              team={resolved.team}
              size={52}
              variant="round"
            />
          </div>
          <div className="min-w-0 flex-1">
            <h2 className="truncate text-base font-bold text-primary">{resolved.name || `Player ${playerId.slice(-4)}`}</h2>
            <div className="mt-1 flex flex-wrap items-center gap-2 text-[12px] text-secondary">
              <span className={`rounded-md border px-1.5 py-0.5 text-[10px] font-bold ${positionBadgeClass(pos)}`}>{pos}</span>
              {resolved.team && resolved.team !== 'FA' ? (
                <span className="flex items-center gap-1">
                  <TeamLogo
                    teamAbbr={resolved.team}
                    sport={sport}
                    logoUrl={resolved.teamLogoUrl ?? null}
                    size={14}
                  />
                  {resolved.team}
                </span>
              ) : <span className="text-muted">Free Agent</span>}
              {slotLabel ? (
                <span className={`rounded-md border px-1.5 py-0.5 text-[10px] font-bold ${slotBadgeClass(slotLabel)}`}>{slotLabel}</span>
              ) : null}
              {statusDot}
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close player detail"
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-subtle bg-surface-muted text-muted hover:bg-surface-hover hover:text-primary"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Stats row */}
        <div className="mx-5 mb-4 grid grid-cols-3 gap-px overflow-hidden rounded-xl border border-subtle bg-surface-muted">
          <div className="flex flex-col items-center gap-0.5 bg-surface px-3 py-3">
            <span className="text-[10px] font-bold uppercase tracking-wide text-muted">Proj</span>
            <span className="text-[18px] font-bold text-primary">
              {projection != null ? projection.toFixed(1) : '—'}
            </span>
            {showCrest ? (
              <span className="text-[9px] text-muted">via AF</span>
            ) : null}
          </div>
          <div className="flex flex-col items-center gap-0.5 bg-surface px-3 py-3">
            <span className="text-[10px] font-bold uppercase tracking-wide text-muted">Pts</span>
            <span className="text-[18px] font-bold text-muted">-</span>
            <span className="text-[9px] text-muted">live feed</span>
          </div>
          <div className="flex flex-col items-center gap-0.5 bg-surface px-3 py-3">
            <span className="text-[10px] font-bold uppercase tracking-wide text-muted">Status</span>
            <span className={`flex items-center gap-1 text-[12px] font-semibold ${statusTextClass}`}>
              <Activity className="h-3 w-3" />
              {statusText}
            </span>
            <span className="text-[9px] text-muted">provider status</span>
          </div>
        </div>

        {/* Actions */}
        <div className="flex gap-2 px-5">
          {canReplaceInLineup ? (
            <button
              type="button"
              onClick={() => onOpenReplace?.()}
              className="flex flex-1 items-center justify-center gap-2 rounded-xl border border-subtle bg-surface-muted py-3 text-[13px] font-bold text-primary transition hover:bg-surface-hover active:scale-95"
            >
              <ArrowLeftRight className="h-4 w-4" aria-hidden />
              Replace in lineup
            </button>
          ) : null}
          <button
            type="button"
            onClick={() => {
              onClose()
              onViewFullStats(playerId)
            }}
            className="flex flex-1 items-center justify-center gap-2 rounded-xl border border-cyan-400/30 bg-cyan-400/10 py-3 text-[13px] font-bold text-cyan-200 transition hover:bg-cyan-400/20 active:scale-95"
          >
            <ExternalLink className="h-4 w-4" aria-hidden />
            Full Stats
          </button>
        </div>
      </div>
    </>
  )
}

function LineupReplacementPickerSheet({
  open,
  sourcePlayerId,
  sourceSlotLabel,
  sport,
  players,
  candidates,
  saving,
  locked,
  lockMessage,
  autosaveWired,
  helperError,
  onClose,
  onConfirmReplacement,
}: {
  open: boolean
  sourcePlayerId: string | null
  sourceSlotLabel?: string
  sport: string
  players: DisplayPlayerMap
  candidates: SwapCandidate[]
  saving: boolean
  locked: boolean
  lockMessage?: string | null
  autosaveWired: boolean
  helperError?: string | null
  onClose: () => void
  onConfirmReplacement: (incomingId: string) => Promise<void>
}) {
  const [query, setQuery] = useState('')
  const [selectedId, setSelectedId] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    setQuery('')
    setSelectedId(null)
  }, [open, sourcePlayerId])

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return candidates
    return candidates.filter((c) => {
      const hay = `${c.name} ${c.position}`.toLowerCase()
      return hay.includes(q)
    })
  }, [candidates, query])

  if (!open || !sourcePlayerId) return null

  const source = resolveDisplayPlayer(sourcePlayerId, players)
  const confirmDisabled =
    !selectedId ||
    saving ||
    locked ||
    !autosaveWired ||
    !candidates.some((c) => c.id === selectedId && c.eligible)

  return (
    <>
      <div className="fixed inset-0 z-[70] bg-black/70 backdrop-blur-[2px]" onClick={onClose} aria-hidden />
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Replace player in lineup"
        className="fixed bottom-0 left-0 right-0 z-[80] mx-auto max-h-[84dvh] w-full max-w-xl rounded-t-2xl border-t border-subtle bg-surface pb-[max(1rem,env(safe-area-inset-bottom))] shadow-popover"
      >
        <div className="flex justify-center pt-3 pb-1">
          <div className="h-1 w-10 rounded-full bg-surface-hover" />
        </div>
        <div className="flex items-start justify-between gap-3 px-4 pb-3 pt-2">
          <div className="min-w-0">
            <p className="text-sm font-bold text-primary">Replace in lineup</p>
            <p className="truncate text-[11px] text-muted">
              {source.name} · {source.position || '-'}
              {sourceSlotLabel ? ` · ${sourceSlotLabel}` : ''}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1.5 text-muted hover:bg-surface-hover hover:text-primary"
            aria-label="Close replacement picker"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="px-4 pb-3">
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search by player or position"
            className="w-full rounded-xl border border-subtle bg-surface-muted px-3 py-2 text-xs text-primary placeholder:text-muted focus:border-brand-primary/40 focus:outline-none focus:ring-1 focus:ring-focus/30"
          />
        </div>

        {locked ? (
          <p className="px-4 pb-2 text-xs text-amber-200/90">{lockMessage ?? 'Lineup is locked.'}</p>
        ) : null}
        {!autosaveWired ? (
          <p className="px-4 pb-2 text-xs text-secondary">Lineup autosave route is not wired yet.</p>
        ) : null}
        {helperError ? <p className="px-4 pb-2 text-xs text-rose-300/90">{helperError}</p> : null}

        <div className="max-h-[46dvh] overflow-y-auto px-2">
          {filtered.length === 0 ? (
            <p className="px-3 py-4 text-xs text-muted">No eligible players match your filter.</p>
          ) : (
            <ul className="space-y-1 pb-2">
              {filtered.map((c) => {
                const selected = selectedId === c.id
                const p = players[c.id]
                const candidateProjection = resolveProjectionAvailability({
                  providerProjection: (players[c.id] as { projectedPoints?: number | null } | undefined)?.projectedPoints ?? null,
                })
                const injuryRaw =
                  (p as Record<string, unknown> | undefined)?.injury_status ??
                  (p as Record<string, unknown> | undefined)?.status ??
                  null
                const status =
                  typeof injuryRaw === 'string' && injuryRaw.trim().length > 0
                    ? injuryRaw.trim().toUpperCase()
                    : 'ACTIVE'
                return (
                  <li key={c.id}>
                    <button
                      type="button"
                      disabled={!c.eligible || locked}
                      onClick={() => setSelectedId(c.id)}
                      className={[
                        'w-full rounded-xl border px-3 py-2 text-left transition',
                        selected
                          ? 'border-cyan-400/50 bg-cyan-500/10'
                          : 'border-subtle bg-surface-muted hover:bg-surface-hover',
                        !c.eligible || locked ? 'opacity-40' : '',
                      ].join(' ')}
                      data-testid={`lineup-replace-candidate-${c.id}`}
                    >
                      <div className="flex items-center gap-2">
                        <span className="inline-flex min-w-[2.25rem] shrink-0 justify-center rounded-md border border-subtle bg-surface px-1.5 py-0.5 text-[10px] font-bold text-secondary">
                          {c.badge ?? '-'}
                        </span>
                        <PlayerHeadshot
                          playerId={c.id}
                          sport={sport}
                          useResolver={String(sport ?? '').trim().toUpperCase() === 'NFL'}
                          playerName={c.name}
                          headshotUrl={p?.headshotUrl ?? p?.imageUrl ?? null}
                          position={c.position}
                          espnId={players[c.id]?.espn_id}
                          nbaId={players[c.id]?.nba_id}
                          team={c.team}
                          size={28}
                          variant="round"
                        />
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-xs font-semibold text-primary">{c.name}</p>
                          <p className="flex items-center gap-1 text-[10px] text-muted">
                            <span>{c.position || '-'}</span>
                            <span className="text-muted">·</span>
                            {c.team && c.team !== 'FA' ? (
                              <>
                                <TeamLogo
                                  teamAbbr={c.team}
                                  sport={sport}
                                  logoUrl={p?.teamLogoUrl ?? null}
                                  size={14}
                                />
                                <span>{c.team}</span>
                              </>
                            ) : (
                              <span>FA</span>
                            )}
                          </p>
                        </div>
                        {!c.eligible ? (
                          <span className="rounded-md border border-amber-400/35 bg-amber-500/15 px-1.5 py-0.5 text-[10px] font-bold text-amber-200">
                            Ineligible
                          </span>
                        ) : null}
                      </div>
                      <div className="mt-1.5 grid grid-cols-3 gap-2 text-[10px] text-secondary">
                        <span>Proj: <ProjectionValue projection={candidateProjection} className="" /></span>
                        <span>Pts: -</span>
                        <span>Status: {status}</span>
                      </div>
                    </button>
                  </li>
                )
              })}
            </ul>
          )}
        </div>

        <div className="border-t border-subtle px-4 pt-3">
          <button
            type="button"
            disabled={confirmDisabled}
            onClick={() => {
              if (!selectedId || confirmDisabled) return
              void onConfirmReplacement(selectedId)
            }}
            className={[
              'w-full rounded-xl border py-2.5 text-sm font-bold transition',
              confirmDisabled
                ? 'cursor-not-allowed border-subtle bg-surface-muted text-muted'
                : 'border-cyan-400/35 bg-cyan-500/15 text-cyan-100 hover:bg-cyan-500/25',
            ].join(' ')}
          >
            {saving ? 'Saving replacement...' : 'Confirm replacement'}
          </button>
        </div>
      </div>
    </>
  )
}

function RosterRow({
  playerId,
  sport,
  players,
  playersLoading,
  onPlayerClick,
  slotLabel,
  week,
  season,
  onSlotClick,
  emptyLabel,
  issueHighlight,
  chimmyNote,
  onChimmyNoteChange,
  onAskChimmy,
  liveScore,
}: {
  playerId: string
  sport: string
  players: DisplayPlayerMap
  playersLoading: boolean
  onPlayerClick: (id: string, slotLabel?: string) => void
  slotLabel?: string
  week: number
  season: number
  /** Position badge opens lineup swap (Team tab). */
  onSlotClick?: () => void
  emptyLabel?: string
  /** Roster legality / IR / taxi / slot lock highlight */
  issueHighlight?: boolean
  /** NFL redraft core: local Chimmy note + open prompt (client-only v1). */
  chimmyNote?: string
  onChimmyNoteChange?: (value: string) => void
  onAskChimmy?: () => void
  /** Live fantasy points for this player (current week, from SSE-refreshed roster). */
  liveScore?: number | null
}) {
  // Flash animation when liveScore changes - hooks must run before any early return.
  const [ptFlash, setPtFlash] = useState(false)
  const prevLiveScore = useRef<number | null>(null)
  useEffect(() => {
    if (liveScore != null && prevLiveScore.current != null && liveScore !== prevLiveScore.current) {
      setPtFlash(true)
      const t = setTimeout(() => setPtFlash(false), 800)
      return () => clearTimeout(t)
    }
    prevLiveScore.current = liveScore ?? null
  }, [liveScore])

  const leftBadgeEarly = slotLabel ?? '-'
  const badgeClassEarly = slotLabel ? slotBadgeClass(slotLabel) : positionBadgeClass('-')
  if (!playerId || playerId.trim() === '') {
    return (
      <div className="flex w-full items-center gap-2 rounded-lg border border-dashed border-white/[0.08] px-2 py-2 text-left">
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation()
            onSlotClick?.()
          }}
          className={`inline-flex min-w-[2.25rem] shrink-0 justify-center rounded-md border px-1.5 py-0.5 text-[10px] font-bold ${badgeClassEarly}`}
        >
          {leftBadgeEarly}
        </button>
        <span className="text-xs text-muted">{emptyLabel ?? 'Empty'}</span>
      </div>
    )
  }

  const resolved = resolveDisplayPlayer(playerId, players)
  // A synthetic team-defense id (`nfl:def:KC`) is self-describing - its name is
  // final and never "loading", so it must not be masked by the loading
  // placeholder. Other ids keep the placeholder until the player map resolves.
  const teamDefLabel = teamDefenseDisplayNameFromId(playerId)
  const label = teamDefLabel ?? (playersLoading ? `Player ${playerId.slice(-4)}` : resolved.name)
  const pos = resolved.position || '-'
  const showTeam = resolved.team && resolved.team !== 'FA'
  const leftBadge = slotLabel ?? pos
  const badgeClass = slotLabel ? slotBadgeClass(slotLabel) : positionBadgeClass(pos)
  // Honest projection: no fabricated baseline — missing renders as missing (Honesty Pack 1A).
  const baseline = resolved.projectedPoints ?? null
  const statusText = displayPlayerStatusText(resolved)
  const statusDotClass = displayPlayerStatusDotClass(statusText)
  const crestSport = sport
  const showCrest = isWeatherSensitiveSport(crestSport)

  const rowBorderClass = issueHighlight
    ? 'border-amber-500/45 bg-amber-500/10 ring-1 ring-amber-400/25'
    : 'border-transparent'

  const rowInner = (
    <>
      <span
        role={onSlotClick ? 'button' : undefined}
        onClick={
          onSlotClick
            ? (e) => {
                e.preventDefault()
                e.stopPropagation()
                onSlotClick()
              }
            : undefined
        }
        className={`inline-flex min-w-[2.25rem] shrink-0 justify-center rounded-md border px-1.5 py-0.5 text-[10px] font-bold ${badgeClass} ${
          onSlotClick ? 'cursor-pointer hover:brightness-110' : ''
        }`}
      >
        {leftBadge}
      </span>
      <div className="relative shrink-0">
        <PlayerHeadshot
          playerId={playerId}
          sport={sport}
          useResolver={String(sport ?? '').trim().toUpperCase() === 'NFL'}
          playerName={label}
          headshotUrl={resolved.headshotUrl ?? resolved.imageUrl ?? null}
          position={resolved.position}
          espnId={players[playerId]?.espn_id}
          nbaId={players[playerId]?.nba_id}
          team={resolved.team}
          size={28}
          variant="round"
        />
        <span
          className={`absolute bottom-0 right-0 h-2 w-2 rounded-full border border-[#0a1228] ${statusDotClass}`}
          title={`Status: ${statusText}`}
          aria-hidden
        />
      </div>
      <div className="min-w-0 flex-1">
        <p className="truncate text-xs font-semibold text-white">{label}</p>
        <p className="flex flex-wrap items-center gap-1 text-[10px] text-white/40">
          {playersLoading ? (
            '- · -'
          ) : (
            <>
              <span>{resolved.position || '-'}</span>
              <span className="text-white/25">·</span>
              {showTeam ? (
                <>
                  <TeamLogo
                    teamAbbr={resolved.team}
                    sport={sport}
                    logoUrl={resolved.teamLogoUrl ?? null}
                    size={16}
                  />
                  <span className="text-white/45">{resolved.team}</span>
                </>
              ) : (
                <span>-</span>
              )}
            </>
          )}
        </p>
      </div>
      <div className="flex shrink-0 items-center gap-2 text-right text-xs text-muted">
        <span className="flex w-[4.5rem] items-center justify-end gap-0.5">
          {baseline == null ? (
            <ProjectionValue
              projection={{ state: 'unavailable', value: null, source: null, reason: 'provider_missing' }}
              className="text-xs text-white/35"
            />
          ) : null}
          <ProjectionDisplay
            projection={baseline}
            suffix=""
            showAFCrest={showCrest}
            pointsClassName="text-xs text-muted"
            afCrestProps={
              showCrest
                ? {
                    playerId,
                    playerName: label,
                    sport: crestSport,
                    position: pos,
                    week,
                    season,
                    size: 'sm',
                  }
                : undefined
            }
          />
        </span>
        <span
          className={ptFlash ? 'w-10 tabular-nums font-semibold text-cyan-300 transition-colors duration-700' : 'w-10 tabular-nums text-white/55 transition-colors duration-700'}
          data-testid="roster-player-pts"
        >
          {liveScore != null ? liveScore.toFixed(2) : '-'}
        </span>
      </div>
    </>
  )

  const chimmyEnabled = typeof onAskChimmy === 'function'

  if (chimmyEnabled && onChimmyNoteChange) {
    return (
      <div
        className={[
          'flex flex-col rounded-lg border transition hover:border-white/[0.08]',
          rowBorderClass,
        ].join(' ')}
        data-testid={`roster-row-${playerId}`}
      >
        <button
          type="button"
          onClick={() => onPlayerClick(playerId, slotLabel)}
          className="flex w-full items-center gap-2 rounded-t-lg border-0 bg-transparent px-2 py-2 text-left hover:bg-white/[0.04]"
        >
          {rowInner}
        </button>
        <div
          className="border-t border-white/[0.06] bg-[#040915]/90 px-2 pb-2 pt-1.5"
          onMouseDown={(e) => e.stopPropagation()}
          onClick={(e) => e.stopPropagation()}
        >
          <label className="mb-1 block text-[9px] font-bold uppercase tracking-wide text-white/35" htmlFor={`chimmy-note-${playerId}`}>
            Chimmy note
          </label>
          <textarea
            id={`chimmy-note-${playerId}`}
            value={chimmyNote ?? ''}
            onChange={(e) => onChimmyNoteChange(e.target.value)}
            placeholder="Optional context for Chimmy..."
            rows={2}
            data-testid={`roster-row-chimmy-note-${playerId}`}
            className="mb-2 w-full resize-y rounded-md border border-white/[0.08] bg-[#0a1228] px-2 py-1.5 text-[11px] text-white/85 placeholder:text-white/25 focus:border-cyan-500/40 focus:outline-none focus:ring-1 focus:ring-cyan-500/30"
          />
          <button
            type="button"
            onClick={() => onAskChimmy?.()}
            data-testid={`roster-row-chimmy-ask-${playerId}`}
            className="rounded-lg border border-cyan-500/35 bg-cyan-500/10 px-3 py-1.5 text-[10px] font-bold uppercase tracking-wide text-cyan-100 hover:bg-cyan-500/20"
          >
            Ask Chimmy
          </button>
        </div>
      </div>
    )
  }

  return (
    <button
      type="button"
      onClick={() => onPlayerClick(playerId, slotLabel)}
      className={[
        'flex w-full items-center gap-2 rounded-lg border px-2 py-2 text-left transition hover:border-white/[0.08] hover:bg-white/[0.04]',
        rowBorderClass,
      ].join(' ')}
      data-testid={`roster-row-${playerId}`}
    >
      {rowInner}
    </button>
  )
}

function SkeletonRows() {
  return (
    <div className="space-y-2">
      {Array.from({ length: 8 }).map((_, i) => (
        <div
          key={`sk-${i}`}
          className="flex animate-pulse items-center gap-2 rounded-lg px-2 py-2"
        >
          <div className="h-6 w-10 rounded-md bg-white/10" />
          <div className="h-8 w-8 rounded-full bg-white/10" />
          <div className="flex-1 space-y-1">
            <div className="h-3 w-32 rounded bg-white/10" />
            <div className="h-2 w-24 rounded bg-white/10" />
          </div>
        </div>
      ))}
    </div>
  )
}

export function TeamTab({
  league,
  userTeam,
  onPlayerClick: onOpenPlayerStats,
  inviteToken,
  sport,
  idpLeagueUi = false,
  idpViewMode = 'full',
  idpPositionMode = 'standard',
  onUserSettingsClick,
}: TeamTabProps) {
  const router = useRouter()
  const resolvedSport = sport ?? league.sport
  const { players: sleeperPlayers, loading: sleeperPlayersLoading } = useSleeperPlayers(resolvedSport)
  const isSleeper = league.platform === 'sleeper'
  const [week, setWeek] = useState(1)
  const [weekMenuOpen, setWeekMenuOpen] = useState(false)
  const [dbRosterMeta, setDbRosterMeta] = useState<{
    rosterId: string
    leagueWeek: number
    maxWeek: number
    starterSlots: ExpandedStarterSlot[]
    canEditLineup: boolean
    lineupLockHelp?: string | null
  } | null>(null)
  const [lineupLists, setLineupLists] = useState<RosterLineupLists | null>(null)
  const [savingLineup, setSavingLineup] = useState(false)
  const [swapOpen, setSwapOpen] = useState(false)
  const [swapCtx, setSwapCtx] = useState<DbLineupSwapCtx | null>(null)
  const seasonYear = new Date().getFullYear()
  const [loading, setLoading] = useState(() => isSleeper || Boolean(userTeam))
  const [error, setError] = useState<string | null>(null)
  const [payload, setPayload] = useState<DbRosterPayload | SleeperApiPayload | null>(null)
  // Live per-player fantasy points refreshed by SSE events (non-Sleeper only).
  const [liveScores, setLiveScores] = useState<Map<string, number>>(() => new Map())
  const [autoCoachRow, setAutoCoachRow] = useState<{
    enabled: boolean
    leagueAutoCoachEnabled: boolean
    blockedByCommissioner: boolean
  } | null>(null)
  const [autoCoachLoading, setAutoCoachLoading] = useState(false)
  const [localAutoCoachGate, setLocalAutoCoachGate] = useState(false)
  const [legalitySnapshot, setLegalitySnapshot] = useState<RosterLegalityFullResult | null>(null)
  const [legalityBump, setLegalityBump] = useState(0)
  const highlightSet = useMemo(
    () => new Set(legalitySnapshot?.highlightedPlayerIds ?? []),
    [legalitySnapshot],
  )
  const [draftPickRows, setDraftPickRows] = useState<
    Array<{
      id: string
      label: string
      tradeHint?: 'received' | 'traded_away' | 'owned' | null
      status: string
    }>
  >([])
  const [draftPickFallback, setDraftPickFallback] = useState<unknown[]>([])
  const [draftPickDetailOpen, setDraftPickDetailOpen] = useState(false)
  const [draftPickDetailLoading, setDraftPickDetailLoading] = useState(false)
  // Local player detail sheet state
  const [detailPlayerId, setDetailPlayerId] = useState<string | null>(null)
  const [detailSlotLabel, setDetailSlotLabel] = useState<string | undefined>(undefined)
  const handleRowClick = useCallback((playerId: string, slotLabel?: string) => {
    if (!playerId?.trim()) return
    setDetailPlayerId(playerId)
    setDetailSlotLabel(slotLabel)
  }, [])
  const [replacementPickerPlayerId, setReplacementPickerPlayerId] = useState<string | null>(null)
  const [replacementPickerError, setReplacementPickerError] = useState<string | null>(null)
  const onPlayerClick = useCallback((playerId: string, slotLabel?: string) => {
    handleRowClick(playerId, slotLabel)
  }, [handleRowClick])
  const [draftPickDetail, setDraftPickDetail] = useState<{
    pick: { id: string; label: string; status: string } | null
    tradeChain: Array<{ tradeId: string; status: string; createdAt: string; summary: string }>
  } | null>(null)
  const [chimmyNotesByPlayer, setChimmyNotesByPlayer] = useState<Record<string, string>>({})
  const proEnt = useEntitlement('pro_autocoach')
  const gateOptional = useSubscriptionGateOptional()
  const hasProAutoCoach = proEnt.hasAccess('pro_autocoach')
  const isBestBall = isBestBallLeague(league.leagueVariant ?? null, league.bestBallMode ?? null)

  const nflRedraftCoreRoster = useMemo(
    () => isNflRedraftCoreDashboardFromUserLeague(league),
    [league],
  )

  const players = useMemo(
    () =>
      buildDisplayPlayerMap(
        sleeperPlayers,
        payload && payload.source !== 'sleeper' ? payload.unifiedRoster ?? [] : [],
      ),
    [sleeperPlayers, payload],
  )

  const playersLoading =
    payload && payload.source !== 'sleeper' && (payload.unifiedRoster?.length ?? 0) > 0
      ? false
      : sleeperPlayersLoading

  const buildChimmyProps = useCallback(
    (playerId: string, rosterSlotLabel: string) => {
      if (!nflRedraftCoreRoster || !playerId?.trim()) return {}
      const resolved = resolveDisplayPlayer(playerId, players)
      return {
        chimmyNote: chimmyNotesByPlayer[playerId] ?? '',
        onChimmyNoteChange: (v: string) =>
          setChimmyNotesByPlayer((prev) => ({ ...prev, [playerId]: v })),
        onAskChimmy: () => {
          openChimmyWithPrompt({
            leagueId: league.id,
            source: 'roster',
            prompt: buildNflRedraftRosterChimmyPrompt({
              playerName: resolved.name,
              teamAbbr: resolved.team && resolved.team !== 'FA' ? resolved.team : '-',
              position: resolved.position || '-',
              rosterSlot: rosterSlotLabel,
              leagueName: String(league.name ?? 'League'),
              userQuestion: chimmyNotesByPlayer[playerId] ?? '',
            }),
          })
        },
      }
    },
    [nflRedraftCoreRoster, chimmyNotesByPlayer, league.id, league.name, players],
  )

  useEffect(() => {
    let cancelled = false
    void (async () => {
      const res = await fetch('/api/user/autocoach', { cache: 'no-store' })
      if (!res.ok || cancelled) return
      const j = (await res.json()) as {
        settings?: Array<{
          leagueId: string
          enabled: boolean
          blockedByCommissioner: boolean
          league?: { autoCoachEnabled?: boolean | null }
        }>
      }
      const row = j.settings?.find((s) => s.leagueId === league.id)
      if (row && !cancelled) {
        setAutoCoachRow({
          enabled: row.enabled,
          leagueAutoCoachEnabled: row.league?.autoCoachEnabled !== false,
          blockedByCommissioner: row.blockedByCommissioner,
        })
      }
    })()
    return () => {
      cancelled = true
    }
  }, [league.id])

  const handleAutoCoachToggle = async () => {
    if (!hasProAutoCoach || isBestBall) return
    const next = !autoCoachRow?.enabled
    setAutoCoachLoading(true)
    try {
      const res = await fetch('/api/user/autocoach', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ leagueId: league.id, enabled: next }),
      })
      if (!res.ok) {
        const j = (await res.json().catch(() => ({}))) as { error?: string }
        toast.error(typeof j.error === 'string' ? j.error : 'Could not update AutoCoach')
        return
      }
      setAutoCoachRow((prev) =>
        prev
          ? { ...prev, enabled: next }
          : {
              enabled: next,
              leagueAutoCoachEnabled: true,
              blockedByCommissioner: false,
            }
      )
      toast.success(next ? 'AI Auto Start/Sit Protection on' : 'AI Auto Start/Sit Protection off')
    } finally {
      setAutoCoachLoading(false)
    }
  }

  const load = useCallback(async () => {
    if (!isSleeper && !userTeam) {
      setLoading(false)
      return
    }
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`/api/league/roster?leagueId=${encodeURIComponent(league.id)}`, {
        cache: 'no-store',
      })
      const data = (await res.json()) as Record<string, unknown>

      if (!res.ok) {
        const errText =
          res.status === 404 ? 'No roster synced yet for your account.' : 'Could not load roster.'
        setError(errText)
        setPayload(null)
        return
      }

      if (data.source === 'sleeper') {
        setDbRosterMeta(null)
        setLineupLists(null)
        setPayload(data as unknown as SleeperApiPayload)
        return
      }

      const d = data as unknown as DbRosterPayload
      setPayload(d)
      const slots = d.starterSlots ?? []
      const rid = typeof d.rosterId === 'string' ? d.rosterId : ''
      if (rid && slots.length > 0) {
        setDbRosterMeta({
          rosterId: rid,
          leagueWeek: d.leagueWeek ?? 1,
          maxWeek: d.maxWeek ?? 18,
          starterSlots: slots,
          canEditLineup: d.canEditLineup !== false,
          lineupLockHelp: d.lineupLockHelp ?? null,
        })
        setWeek(d.leagueWeek ?? 1)
        setLineupLists(initOrSyncLineupLists(d.roster, slots))
      } else {
        setDbRosterMeta(null)
        setLineupLists(null)
      }
    } catch {
      setError('Could not load roster.')
      setPayload(null)
    } finally {
      setLoading(false)
    }
  }, [isSleeper, league.id, userTeam])

  useEffect(() => {
    void load()
  }, [load])

  const loadLiveScores = useCallback(async () => {
    if (isSleeper) return
    try {
      const res = await fetch(
        `/api/redraft/roster?leagueId=${encodeURIComponent(league.id)}&week=${week}`,
        { cache: 'no-store' },
      )
      if (!res.ok) return
      const data = (await res.json()) as {
        roster?: { players?: Array<{ playerId?: string; weeklyScore?: { fantasyPts?: number } | null }> }
      }
      const scored = data.roster?.players ?? []
      const next = new Map<string, number>()
      for (const p of scored) {
        if (p.playerId && p.weeklyScore?.fantasyPts != null) {
          next.set(p.playerId, p.weeklyScore.fantasyPts)
        }
      }
      setLiveScores(next)
    } catch {
      // non-fatal - live scores are best-effort
    }
  }, [isSleeper, league.id, week])

  useEffect(() => {
    void loadLiveScores()
  }, [loadLiveScores])

  useLeagueRealtimeRefresh(league.id, (env) => {
    const t = String(env.eventType ?? '')
    if (t === 'player_changed' || t === 'league_changed' || t.includes('score')) {
      void loadLiveScores()
    }
  })

  useEffect(() => {
    if (isSleeper || !userTeam) {
      setLegalitySnapshot(null)
      dispatchRosterLegalityEvent(league.id, null)
      return
    }
    let cancelled = false
    void (async () => {
      try {
        const res = await fetch(`/api/leagues/${encodeURIComponent(league.id)}/roster/legality`, {
          cache: 'no-store',
        })
        if (!res.ok) {
          if (!cancelled) {
            setLegalitySnapshot(null)
            dispatchRosterLegalityEvent(league.id, null)
          }
          return
        }
        const j = (await res.json()) as { result?: RosterLegalityFullResult }
        const result = j.result
        if (cancelled || !result) return
        setLegalitySnapshot(result)
        dispatchRosterLegalityEvent(league.id, result)
      } catch {
        if (!cancelled) {
          setLegalitySnapshot(null)
          dispatchRosterLegalityEvent(league.id, null)
        }
      }
    })()
    return () => {
      cancelled = true
    }
  }, [isSleeper, league.id, userTeam, legalityBump])

  useEffect(() => {
    if (isSleeper || !userTeam) {
      setDraftPickRows([])
      setDraftPickFallback([])
      return
    }
    let cancelled = false
    void (async () => {
      try {
        const res = await fetch(`/api/leagues/${encodeURIComponent(league.id)}/roster/draft-picks`, {
          cache: 'no-store',
        })
        if (!res.ok || cancelled) return
        const j = (await res.json()) as {
          picks?: Array<{ id: string; label: string; tradeHint?: 'received' | 'traded_away' | 'owned' | null; status: string }>
          fallbackPicks?: unknown[]
        }
        if (cancelled) return
        setDraftPickRows(Array.isArray(j.picks) ? j.picks : [])
        setDraftPickFallback(Array.isArray(j.fallbackPicks) ? j.fallbackPicks : [])
      } catch {
        if (!cancelled) {
          setDraftPickRows([])
          setDraftPickFallback([])
        }
      }
    })()
    return () => {
      cancelled = true
    }
  }, [isSleeper, league.id, userTeam])

  const sleeperParts = useMemo(() => {
    if (!payload || payload.source !== 'sleeper' || !payload.roster) return null
    return partitionSleeperRoster(payload.roster)
  }, [payload])

  const sleeperStarterLabels = useMemo(() => {
    if (!payload || payload.source !== 'sleeper' || !payload.roster) return []
    const rp = payload.rosterPositions?.length
      ? payload.rosterPositions
      : ((league.settings as Record<string, unknown> | undefined)?.roster_positions as string[] | undefined) ??
        []
    return rp.length > 0 ? getStarterSlotLabels(rp) : payload.roster.starters.map((_, i) => `S${i + 1}`)
  }, [payload, league.settings])

  const dbParts = useMemo(() => {
    if (!payload || payload.source === 'sleeper') return null
    if (!payload.roster) return null
    return partitionRoster(payload.roster, payload.slotLimits ?? null)
  }, [payload])

  const missingNormalizedRosterData =
    payload &&
    payload.source !== 'sleeper' &&
    getRosterPlayerIds(payload.roster).length > 0 &&
    (payload.unifiedRoster?.length ?? 0) === 0

  const showIrSectionSleeper = (sleeperParts?.ir.length ?? 0) > 0
  const showTaxiSectionSleeper = (sleeperParts?.taxi.length ?? 0) > 0
  const showIrSectionDb = (dbParts?.ir.length ?? 0) > 0 || ((payload as DbRosterPayload)?.slotLimits?.ir ?? 0) > 0
  const showTaxiSectionDb =
    league.isDynasty === true &&
    ((dbParts?.taxi.length ?? 0) > 0 || ((payload as DbRosterPayload)?.slotLimits?.taxi ?? 0) > 0)
  const showDevySectionDb = ((payload as DbRosterPayload)?.slotLimits?.devy ?? 0) > 0
  const dbBenchSlotCount =
    payload && payload.source !== 'sleeper' && lineupLists
      ? Math.max(payload.slotLimits?.bench ?? 0, lineupLists.bench.length)
      : 0
  const dbIrSlotCount =
    payload && payload.source !== 'sleeper' && lineupLists
      ? Math.max(payload.slotLimits?.ir ?? 0, lineupLists.ir.length)
      : 0
  const dbBenchRows = lineupLists
    ? Array.from({ length: dbBenchSlotCount }, (_, i) => lineupLists.bench[i] ?? '')
    : []
  const dbIrRows = lineupLists
    ? Array.from({ length: dbIrSlotCount }, (_, i) => lineupLists.ir[i] ?? '')
    : []
const maxWeekMenu = useMemo(() => {
    if (dbRosterMeta?.maxWeek && dbRosterMeta.maxWeek > 0) return dbRosterMeta.maxWeek
    if (payload && typeof payload === 'object' && 'maxWeek' in payload) {
      const m = (payload as { maxWeek?: number }).maxWeek
      if (typeof m === 'number' && m > 0) return m
    }
    return 18
  }, [dbRosterMeta, payload])

  const weekLock = useMemo(() => {
    if (!dbRosterMeta) return null
    return evaluateLineupLock({
      sport: resolvedSport,
      now: new Date(),
      leagueWeek: dbRosterMeta.leagueWeek,
      editingWeek: week,
    })
  }, [dbRosterMeta, resolvedSport, week])

  const lineupEditable =
    !isSleeper &&
    Boolean(dbRosterMeta) &&
    dbRosterMeta?.canEditLineup !== false &&
    Boolean(weekLock) &&
    !weekLock!.locked

  const saveLineup = useCallback(
    async (next: RosterLineupLists): Promise<boolean> => {
      if (!dbRosterMeta?.rosterId || !lineupEditable) return false
      setSavingLineup(true)
      try {
        const roster = {
          starters: next.starters
            .map((id) => (id ? buildPlayerRow(id, players) : null))
            .filter((x): x is Record<string, unknown> => x != null),
          bench: next.bench.map((id) => buildPlayerRow(id, players)),
          ir: next.ir.map((id) => buildPlayerRow(id, players)),
          taxi: next.taxi.map((id) => buildPlayerRow(id, players)),
          devy: next.devy.map((id) => buildPlayerRow(id, players)),
        }
        const res = await fetch('/api/leagues/roster/save', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            leagueId: league.id,
            rosterId: dbRosterMeta.rosterId,
            week,
            roster,
          }),
        })
        await res.json().catch(() => ({}))
        if (!res.ok) {
          toast.error('Lineup was not saved. Your previous lineup is still active.')
          return false
        }
        toast.success('Lineup saved')
        setLineupLists(next)
        await load()
        setLegalityBump((n) => n + 1)
        // Phase 3B.4: notify intelligence rail of lineup change (fire-and-forget).
        invalidateIntelligence({ leagueId: league.id, reason: 'lineup_saved' })
        return true
      } catch {
        toast.error('Lineup was not saved. Your previous lineup is still active.')
        return false
      } finally {
        setSavingLineup(false)
      }
    },
    [dbRosterMeta, lineupEditable, players, league.id, week, load],
  )

  const replacementContextsByPlayer = useMemo(() => {
    const map = new Map<string, LineupReplacementCtx>()
    if (!lineupLists || !dbRosterMeta) return map

    dbRosterMeta.starterSlots.forEach((slot, i) => {
      const sourcePlayerId = lineupLists.starters[i] ?? ''
      if (!sourcePlayerId) return
      const candidates = buildSwapCandidates({
        lists: lineupLists,
        slot,
        slotIndex: i,
        players,
      })
      if (candidates.length === 0) return
      map.set(sourcePlayerId, {
        kind: 'starter',
        sourcePlayerId,
        slotIndex: i,
        slotLabel: slot.label,
        candidates,
      })
    })

    const reserveDefs: Array<{ section: 'bench' | 'ir' | 'taxi' | 'devy'; ids: string[] }> = [
      { section: 'bench', ids: lineupLists.bench },
      { section: 'ir', ids: lineupLists.ir },
      { section: 'taxi', ids: lineupLists.taxi },
      { section: 'devy', ids: lineupLists.devy },
    ]

    for (const def of reserveDefs) {
      for (const sourcePlayerId of def.ids) {
        const candidates = buildReserveSwapCandidates({
          lists: lineupLists,
          sourcePlayerId,
          players,
        })
        if (candidates.length === 0) continue
        map.set(sourcePlayerId, {
          kind: 'reserve',
          sourcePlayerId,
          section: def.section,
          slotLabel: RESERVE_SWAP_TITLE[def.section],
          candidates,
        })
      }
    }

    return map
  }, [lineupLists, dbRosterMeta, players])

  const detailReplacementContext = useMemo(() => {
    if (!detailPlayerId) return null
    return replacementContextsByPlayer.get(detailPlayerId) ?? null
  }, [detailPlayerId, replacementContextsByPlayer])

  const replacementPickerContext = useMemo(() => {
    if (!replacementPickerPlayerId) return null
    return replacementContextsByPlayer.get(replacementPickerPlayerId) ?? null
  }, [replacementPickerPlayerId, replacementContextsByPlayer])

  const lineupAutosaveWired = Boolean(dbRosterMeta?.rosterId)
  const canReplaceFromDetail = Boolean(detailReplacementContext) && lineupEditable

  const handleOpenReplacementPickerFromDetail = useCallback(() => {
    if (!detailPlayerId || !detailReplacementContext || !lineupEditable) return
    setReplacementPickerError(null)
    setReplacementPickerPlayerId(detailPlayerId)
    setDetailPlayerId(null)
    setDetailSlotLabel(undefined)
  }, [detailPlayerId, detailReplacementContext, lineupEditable])

  const handleConfirmReplacement = useCallback(
    async (incomingId: string) => {
      if (!replacementPickerPlayerId || !lineupLists) return
      const ctx = replacementContextsByPlayer.get(replacementPickerPlayerId)
      if (!ctx) return

      if (!lineupAutosaveWired) {
        setReplacementPickerError('Lineup autosave route is not wired yet.')
        return
      }

      const next =
        ctx.kind === 'starter'
          ? applyLineupPick({
              lists: lineupLists,
              slotIndex: ctx.slotIndex,
              incomingId,
            })
          : swapPlayersInLists(lineupLists, ctx.sourcePlayerId, incomingId)

      const ok = await saveLineup(next)
      if (ok) {
        setReplacementPickerError(null)
        setReplacementPickerPlayerId(null)
        return
      }
      setReplacementPickerError('Could not save lineup. Please try again.')
    },
    [replacementPickerPlayerId, lineupLists, replacementContextsByPlayer, lineupAutosaveWired, saveLineup],
  )

  if (!isSleeper && !userTeam) {
    const href = inviteToken ? `/join/${inviteToken}` : '/dashboard'
    return (
      <div className="flex min-h-[240px] flex-col items-center justify-center gap-4 p-6 text-center">
        <p className="text-sm font-semibold text-secondary">You haven&apos;t claimed a team in this league</p>
        <Link
          href={href}
          className="rounded-xl bg-brand-primary px-5 py-2.5 text-sm font-bold text-content-inverse transition hover:bg-brand-strong"
        >
          Claim a team
        </Link>
      </div>
    )
  }

  if (isSleeper && !loading && !error && payload?.source === 'sleeper' && payload.roster === null) {
    const href = inviteToken ? `/join/${inviteToken}` : '/dashboard'
    return (
      <div className="flex min-h-[240px] flex-col items-center justify-center gap-4 p-6 text-center">
        <p className="text-sm font-semibold text-secondary">
          No Sleeper roster linked to your account in this league
        </p>
        <p className="max-w-sm text-xs text-muted">
          Link your Sleeper profile in settings or claim a team so we can match your owner ID.
        </p>
        <Link
          href={href}
          className="rounded-xl border border-subtle bg-surface-muted px-5 py-2.5 text-sm font-semibold text-secondary transition hover:bg-surface-hover"
        >
          Back to dashboard
        </Link>
      </div>
    )
  }

  const headerTeamName =
    payload?.source === 'sleeper' && payload.ownerId && payload.users[payload.ownerId]
      ? payload.users[payload.ownerId].team_name ||
        payload.users[payload.ownerId].display_name ||
        userTeam?.teamName
      : userTeam?.teamName ?? 'Your team'

  const sleeperOwner =
    payload?.source === 'sleeper' && payload.ownerId ? payload.users[payload.ownerId] : null
  const ownerAvatarSrc = (() => {
    if (!sleeperOwner?.avatar?.trim()) return null
    const raw = sleeperOwner.avatar.trim()
    if (raw.startsWith('http://') || raw.startsWith('https://')) return raw
    return `https://sleepercdn.com/avatars/${raw}`
  })()

  const waiverLine =
    payload?.source === 'sleeper' && payload.roster
      ? `$FAAB: ${payload.roster.settings.waiver_budget_used}/1000 · Waiver position: #${payload.roster.settings.waiver_position}`
      : payload && payload.source !== 'sleeper' && (payload as DbRosterPayload).faabRemaining != null
        ? `FAAB: $${(payload as DbRosterPayload).faabRemaining} · Trade hub (Coming Soon)`
        : 'FAAB: - · Trade hub (Coming Soon)'

  const showIdpDashboard =
    idpLeagueUi &&
    !loading &&
    !error &&
    ((payload?.source === 'sleeper' && sleeperParts) ||
      (payload && payload.source !== 'sleeper' && dbParts && !lineupLists))

  return (
    <div className="space-y-4 p-5">
      {league.status === 'in_season' ? (
        <TeamTabMatchupBanner leagueId={league.id} />
      ) : null}
      {legalitySnapshot && !legalitySnapshot.isLegal ? (
        <div
          className="rounded-xl border border-amber-400/35 bg-amber-500/10 px-4 py-3 text-sm text-amber-100"
          data-testid="team-tab-roster-legality-banner"
          role="status"
        >
          <p className="font-semibold text-amber-50">Roster needs attention</p>
          <p className="mt-1 text-xs text-amber-100/85">
            {legalitySnapshot.blockingReasons[0]?.message ??
              'Resolve lineup or roster rule issues before your lineup locks.'}
          </p>
          {legalitySnapshot.blockingReasons.length > 1 ? (
            <p className="mt-1 text-[11px] text-amber-200/70">
              +{legalitySnapshot.blockingReasons.length - 1} more{' '}
              {legalitySnapshot.blockingReasons.length === 2 ? 'issue' : 'issues'}
            </p>
          ) : null}
        </div>
      ) : null}
      {missingNormalizedRosterData ? (
        <div
          className="rounded-xl border border-amber-400/35 bg-amber-500/10 px-4 py-3 text-xs text-amber-100"
          data-testid="team-tab-normalized-warning"
          role="status"
        >
          Normalized roster player data is still syncing. Lineup slots are available, but names,
          images, and projections may be partial until the player foundation refresh finishes.
        </div>
      ) : null}

      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            {sleeperOwner ? (
              ownerAvatarSrc ? (
                <Image
                  src={ownerAvatarSrc}
                  alt=""
                  width={36}
                  height={36}
                  unoptimized
                  className="h-9 w-9 shrink-0 rounded-full border border-subtle object-cover"
                />
              ) : (
                <div
                  className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-indigo-500/80 to-cyan-600/80 text-[11px] font-bold text-white"
                  aria-hidden
                >
                  {managerInitials(sleeperOwner.display_name ?? headerTeamName ?? 'Manager')}
                </div>
              )
            ) : null}
            <h2 className="text-base font-bold text-primary">{headerTeamName}</h2>
            <button
              type="button"
              className="rounded-lg p-1 text-muted hover:bg-surface-hover hover:text-secondary"
              aria-label="User settings"
              data-testid="team-tab-user-settings"
              onClick={() => (onUserSettingsClick ? onUserSettingsClick() : router.push('/settings'))}
            >
              <Settings className="h-4 w-4" />
            </button>
          </div>
          <p className="mt-1 text-[11px] text-muted">{waiverLine}</p>
        </div>
        <div className="flex flex-wrap items-center justify-end gap-2">
          <div className="flex items-center gap-1">
            <Link
              href={`/waiver-ai?leagueId=${encodeURIComponent(league.id)}`}
              className="inline-flex h-10 flex-col items-center justify-center rounded-xl border border-subtle bg-surface-muted px-2.5 text-[9px] font-bold uppercase tracking-wide text-secondary transition hover:border-brand-primary/30 hover:text-brand-primary"
              data-testid="team-tab-waiver"
            >
              <ClipboardList className="mb-0.5 h-4 w-4 text-cyan-300/90" strokeWidth={2} />
              Waiver
            </Link>
            <Link
              href={`/league/${encodeURIComponent(league.id)}?view=trades`}
              className="inline-flex h-10 flex-col items-center justify-center rounded-xl border border-subtle bg-surface-muted px-2.5 text-[9px] font-bold uppercase tracking-wide text-secondary transition hover:border-brand-primary/30 hover:text-brand-primary"
              data-testid="team-tab-trade"
            >
              <ArrowLeftRight className="mb-0.5 h-4 w-4 text-cyan-300/90" strokeWidth={2} />
              Trade
            </Link>
          </div>
          <div className="relative flex items-center gap-2 rounded-xl border border-subtle bg-surface-muted px-2 py-1">
            <button
              type="button"
              className="px-2 text-muted hover:text-primary"
              onClick={() => setWeek((w) => Math.max(1, w - 1))}
              aria-label="Previous week"
            >
              &lt;-
            </button>
            <button
              type="button"
              className="min-w-[4rem] text-center text-xs font-semibold text-secondary"
              aria-haspopup="listbox"
              aria-expanded={weekMenuOpen}
              onClick={() => setWeekMenuOpen((o) => !o)}
              data-testid="team-tab-week-trigger"
            >
              Wk {week}
            </button>
            <button
              type="button"
              className="px-2 text-muted hover:text-primary"
              onClick={() => setWeek((w) => Math.min(maxWeekMenu, w + 1))}
              aria-label="Next week"
            >
              -&gt;
            </button>
            {weekMenuOpen ? (
              <div
                className="absolute right-0 top-[calc(100%+6px)] z-50 w-52 rounded-xl border border-subtle bg-surface p-2 shadow-popover"
                role="listbox"
                data-testid="team-tab-week-menu"
              >
                <div className="grid grid-cols-3 gap-1">
                  {Array.from({ length: maxWeekMenu }, (_, i) => i + 1).map((w) => (
                    <button
                      key={w}
                      type="button"
                      className={`rounded-lg px-2 py-1.5 text-center text-[11px] font-bold ${
                        w === week ? 'bg-surface-hover text-primary' : 'text-secondary hover:bg-surface-hover'
                      }`}
                      onClick={() => {
                        setWeek(w)
                        setWeekMenuOpen(false)
                      }}
                    >
                      Week {w}
                    </button>
                  ))}
                </div>
              </div>
            ) : null}
          </div>
        </div>
      </div>

      {payload?.source === 'sleeper' && 'lineupLockHelp' in (payload as object) ? (
        <p className="rounded-lg border border-amber-500/25 bg-amber-500/10 px-3 py-2 text-[11px] text-amber-100/90">
          {(payload as { lineupLockHelp?: string }).lineupLockHelp}
        </p>
      ) : null}

      {!isSleeper && weekLock?.locked ? (
        <p className="rounded-lg border border-amber-500/25 bg-amber-500/10 px-3 py-2 text-[11px] text-amber-100/90">
          {weekLock.reason ?? 'Lineup is locked for this week.'}
        </p>
      ) : null}

      {savingLineup ? (
        <p className="text-[11px] text-cyan-200/80">Saving lineup...</p>
      ) : null}

      <div className="rounded-xl border border-subtle bg-surface-muted p-4">
        <div className="flex items-center justify-between gap-4">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <p className="text-sm font-bold text-primary">Lightning AI Auto Start/Sit Protection</p>
              {!hasProAutoCoach ? <SubscriptionGateBadge featureId="pro_autocoach" /> : null}
            </div>
            <p className="mt-0.5 text-xs text-muted">
              Pre-lock automation only: swaps clearly unavailable starters (OUT, inactive, IR, etc.) using live
              status and the same projection engine as Start/Sit. Each player locks at their own game time - not the
              first game of the slate. Not Best Ball; no in-game fixes.
            </p>
            {autoCoachRow && autoCoachRow.leagueAutoCoachEnabled === false ? (
              <p className="mt-1 text-[11px] text-amber-400/70">Disabled by league commissioner.</p>
            ) : null}
            {isBestBall ? (
              <p className="mt-1 text-[11px] text-muted">Not available in Best Ball leagues.</p>
            ) : null}
          </div>
          {hasProAutoCoach && autoCoachRow?.leagueAutoCoachEnabled !== false && !isBestBall ? (
            <button
              type="button"
              role="switch"
              aria-checked={Boolean(autoCoachRow?.enabled)}
              disabled={autoCoachLoading}
              onClick={() => void handleAutoCoachToggle()}
              className={[
                'relative h-6 w-11 shrink-0 rounded-full border transition-colors',
                autoCoachRow?.enabled ? 'border-cyan-400 bg-cyan-500' : 'border-subtle bg-surface-muted',
              ].join(' ')}
            >
              <span
                className={[
                  'absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform',
                  autoCoachRow?.enabled ? 'translate-x-5' : 'translate-x-0.5',
                ].join(' ')}
              />
            </button>
          ) : (
            <button
              type="button"
              disabled={isBestBall || autoCoachRow?.leagueAutoCoachEnabled === false}
              onClick={() => {
                if (isBestBall || autoCoachRow?.leagueAutoCoachEnabled === false) return
                if (gateOptional) gateOptional.gate('pro_autocoach')
                else setLocalAutoCoachGate(true)
              }}
              className="relative h-6 w-11 shrink-0 rounded-full border border-subtle bg-surface-muted opacity-50"
              title={
                isBestBall
                  ? 'Not available in Best Ball'
                  : autoCoachRow?.leagueAutoCoachEnabled === false
                    ? 'Disabled by commissioner'
                    : 'Requires AF Pro'
              }
            />
          )}
        </div>
      </div>

      <div className="rounded-xl border border-brand-primary/15 bg-surface-muted p-4 backdrop-blur-sm">
        <p className="mb-1 text-[10px] font-bold uppercase tracking-wide text-muted">Start A vs B</p>
        <p className="mb-3 text-xs text-muted">
          Compare two players with deterministic projections first; AI explains the math (Pro). Supports all league sports.
        </p>
        <StartVsComparisonLauncher
          leagueId={league.id}
          teamId={dbRosterMeta?.rosterId ?? userTeam?.id ?? null}
          sport={resolvedSport}
          weekOrPeriod={`Week ${week}`}
          showNameInputs
        />
      </div>

      {localAutoCoachGate && !gateOptional ? (
        <SubscriptionGateModal isOpen onClose={() => setLocalAutoCoachGate(false)} featureId="pro_autocoach" />
      ) : null}

      {loading ? <SkeletonRows /> : null}

      {!loading && error ? (
        <p className="rounded-xl border border-white/[0.07] bg-[#0c0c1e] px-4 py-3 text-sm text-muted">{error}</p>
      ) : null}

      {!loading && !error && showIdpDashboard && payload?.source === 'sleeper' && sleeperParts ? (
        <IDPTeamDashboard
          leagueId={league.id}
          week={week}
          sport={resolvedSport}
          players={players}
          playersLoading={playersLoading}
          idpViewMode={idpViewMode}
          positionMode={idpPositionMode}
          starterIds={sleeperParts.starters}
          benchIds={[...sleeperParts.bench, ...sleeperParts.taxi, ...sleeperParts.ir]}
          slotLabels={sleeperStarterLabels}
          onOffensePlayerClick={onPlayerClick}
        />
      ) : null}

      {!loading && !error && showIdpDashboard && payload && payload.source !== 'sleeper' && dbParts ? (
        <IDPTeamDashboard
          leagueId={league.id}
          week={week}
          sport={resolvedSport}
          players={players}
          playersLoading={playersLoading}
          idpViewMode={idpViewMode}
          positionMode={idpPositionMode}
          starterIds={dbParts.starters}
          benchIds={[...dbParts.bench, ...dbParts.taxi, ...dbParts.ir]}
          onOffensePlayerClick={onPlayerClick}
        />
      ) : null}

      {!loading && !error && !showIdpDashboard && payload?.source === 'sleeper' && payload.roster && sleeperParts ? (
        <>
          <section>
            <div className="mb-2 flex flex-wrap items-end justify-between gap-2">
              <div>
                <p className="text-[10px] font-bold uppercase tracking-wide text-muted">Starters</p>
                <p className="text-[11px] text-muted">Click a row to open the player card (stub).</p>
              </div>
              <div className="flex gap-4 text-[10px] font-semibold uppercase tracking-wide text-white/35">
                <span className="w-10 text-right">OWN%</span>
                <span className="w-10 text-right">START%</span>
              </div>
            </div>
            <div className="space-y-1">
              {sleeperParts.starters.map((id, i) => (
                <RosterRow
                  key={`${id}-${i}`}
                  playerId={id}
                  issueHighlight={highlightSet.has(id)}
                  sport={resolvedSport}
                  players={players}
                  playersLoading={playersLoading}
                  onPlayerClick={onPlayerClick}
                  slotLabel={sleeperStarterLabels[i]}
                  week={week}
                  season={seasonYear}
                  {...buildChimmyProps(id, sleeperStarterLabels[i] ?? 'Starter')}
                  liveScore={liveScores.get(id) ?? null}
                />
              ))}
            </div>
          </section>

          <section>
            <div className="mb-2 flex items-center gap-2">
              <p className="text-[10px] font-bold uppercase tracking-wide text-secondary">Bench</p>
              <div className="h-px flex-1 bg-subtle" />
            </div>
            <div className="space-y-1">
              {sleeperParts.bench.map((id) => (
                <RosterRow
                  key={id}
                  playerId={id}
                  issueHighlight={highlightSet.has(id)}
                  sport={resolvedSport}
                  players={players}
                  playersLoading={playersLoading}
                  onPlayerClick={onPlayerClick}
                  week={week}
                  season={seasonYear}
                  {...buildChimmyProps(id, 'Bench')}
                  liveScore={liveScores.get(id) ?? null}
                />
              ))}
            </div>
          </section>

          {showTaxiSectionSleeper ? (
            <section>
              <div className="mb-2 flex items-center gap-2">
                <p className="text-[10px] font-bold uppercase tracking-wide text-secondary">Taxi</p>
                <div className="h-px flex-1 bg-subtle" />
              </div>
              <div className="space-y-1">
                {sleeperParts.taxi.map((id) => (
                  <RosterRow
                    key={id}
                    playerId={id}
                    issueHighlight={highlightSet.has(id)}
                    sport={resolvedSport}
                    players={players}
                    playersLoading={playersLoading}
                    onPlayerClick={onPlayerClick}
                    week={week}
                    season={seasonYear}
                    {...buildChimmyProps(id, 'Taxi')}
                    liveScore={liveScores.get(id) ?? null}
                  />
                ))}
              </div>
            </section>
          ) : null}

          {showIrSectionSleeper ? (
            <section>
              <div className="mb-2 flex items-center gap-2">
                <p className="text-[10px] font-bold uppercase tracking-wide text-secondary">Reserve / IR</p>
                <div className="h-px flex-1 bg-subtle" />
              </div>
              <div className="space-y-1">
                {sleeperParts.ir.map((id) => (
                  <RosterRow
                    key={id}
                    playerId={id}
                    issueHighlight={highlightSet.has(id)}
                    sport={resolvedSport}
                    players={players}
                    playersLoading={playersLoading}
                    onPlayerClick={onPlayerClick}
                    week={week}
                    season={seasonYear}
                    {...buildChimmyProps(id, 'IR')}
                    liveScore={liveScores.get(id) ?? null}
                  />
                ))}
              </div>
            </section>
          ) : null}

          {payload.roster.picks.length > 0 ? (
            <section>
              <div className="mb-2 flex items-center gap-2">
                <p className="text-[10px] font-bold uppercase tracking-wide text-secondary">Draft picks</p>
                <div className="h-px flex-1 bg-subtle" />
              </div>
              <ul className="space-y-1 text-xs text-secondary">
                {payload.roster.picks.map((p, i) => (
                  <li
                    key={`pick-${i}`}
                    className="rounded-lg border border-subtle bg-surface-muted px-3 py-2"
                  >
                    {formatDraftPick(p)}
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
        </>
      ) : null}

      {!loading && !error && !showIdpDashboard && payload && payload.source !== 'sleeper' && dbRosterMeta && lineupLists ? (
        <>
          <section>
            <div className="mb-2 flex flex-wrap items-end justify-between gap-2">
              <div>
                <div className="flex items-center gap-2">
                  <p className="text-[10px] font-bold uppercase tracking-wide text-secondary">Starters</p>
                  <div className="h-px flex-1 bg-subtle" />
                </div>
                <p className="mt-0.5 text-[11px] text-muted">
                  {lineupEditable
                    ? 'Tap a position badge (starters, bench, IR, taxi, devy) to swap. Lineup saves automatically.'
                    : 'Lineup changes are locked for this view or scoring period.'}
                </p>
              </div>
              <div className="flex gap-4 text-[10px] font-semibold uppercase tracking-wide text-white/40">
                <span className="w-10 text-right">PROJ</span>
                <span className="w-10 text-right">PTS</span>
              </div>
            </div>
            <div className="space-y-1">
              {dbRosterMeta.starterSlots.map((slot, i) => (
                <RosterRow
                  key={`slot-${slot.index}-${i}`}
                  playerId={lineupLists.starters[i] ?? ''}
                  issueHighlight={highlightSet.has(lineupLists.starters[i] ?? '')}
                  sport={resolvedSport}
                  players={players}
                  playersLoading={playersLoading}
                  onPlayerClick={onPlayerClick}
                  slotLabel={slot.label}
                  week={week}
                  season={seasonYear}
                  onSlotClick={
                    lineupEditable
                      ? () => {
                          const sourcePlayerId = lineupLists.starters[i] ?? ''
                          if (sourcePlayerId) {
                            handleRowClick(sourcePlayerId, slot.label)
                            return
                          }
                          setSwapCtx({ kind: 'starter', index: i, slot })
                          setSwapOpen(true)
                        }
                      : undefined
                  }
                  {...buildChimmyProps(lineupLists.starters[i] ?? '', slot.label)}
                  liveScore={liveScores.get(lineupLists.starters[i] ?? '') ?? null}
                />
              ))}
            </div>
          </section>

          <section>
            <div className="mb-2 flex items-center gap-2">
              <p className="text-[10px] font-bold uppercase tracking-wide text-secondary">Bench</p>
              <div className="h-px flex-1 bg-subtle" />
            </div>
            <div className="space-y-1">
              {dbBenchRows.map((id, i) => (
                <RosterRow
                  key={id ? `bench-${id}` : `bench-empty-${i}`}
                  playerId={id}
                  issueHighlight={id ? highlightSet.has(id) : false}
                  sport={resolvedSport}
                  players={players}
                  playersLoading={playersLoading}
                  onPlayerClick={onPlayerClick}
                  slotLabel="BN"
                  emptyLabel="Empty bench slot"
                  week={week}
                  season={seasonYear}
                  onSlotClick={
                    lineupEditable && id
                      ? () => {
                          handleRowClick(id, 'BN')
                        }
                      : undefined
                  }
                  {...buildChimmyProps(id, 'BN')}
                  liveScore={liveScores.get(id) ?? null}
                />
              ))}
            </div>
          </section>

          {showIrSectionDb ? (
            <section>
              <div className="mb-2 flex items-center gap-2">
                <p className="text-[10px] font-bold uppercase tracking-wide text-secondary">Injured reserve</p>
                <div className="h-px flex-1 bg-subtle" />
              </div>
              <div className="space-y-1">
                {dbIrRows.map((id, i) => (
                  <RosterRow
                    key={id ? `ir-${id}` : `ir-empty-${i}`}
                    playerId={id}
                    issueHighlight={id ? highlightSet.has(id) : false}
                    sport={resolvedSport}
                    players={players}
                    playersLoading={playersLoading}
                    onPlayerClick={onPlayerClick}
                    slotLabel="IR"
                    emptyLabel="Empty IR slot"
                    week={week}
                    season={seasonYear}
                    onSlotClick={
                      lineupEditable && id
                        ? () => {
                            handleRowClick(id, 'IR')
                          }
                        : undefined
                    }
                    {...buildChimmyProps(id, 'IR')}
                    liveScore={liveScores.get(id) ?? null}
                  />
                ))}
              </div>
            </section>
          ) : null}

          {showTaxiSectionDb ? (
            <section>
              <div className="mb-2 flex items-center gap-2">
                <p className="text-[10px] font-bold uppercase tracking-wide text-secondary">Taxi</p>
                <div className="h-px flex-1 bg-subtle" />
              </div>
              <div className="space-y-1">
                {lineupLists.taxi.length > 0 ? (
                  lineupLists.taxi.map((id) => (
                    <RosterRow
                      key={id}
                      playerId={id}
                      issueHighlight={highlightSet.has(id)}
                      sport={resolvedSport}
                      players={players}
                      playersLoading={playersLoading}
                      onPlayerClick={onPlayerClick}
                      slotLabel="TX"
                      week={week}
                      season={seasonYear}
                      onSlotClick={
                        lineupEditable
                          ? () => {
                              handleRowClick(id, 'TX')
                            }
                          : undefined
                      }
                      {...buildChimmyProps(id, 'TX')}
                      liveScore={liveScores.get(id) ?? null}
                    />
                  ))
                ) : (
                  <p className="text-xs text-muted">No taxi squad players</p>
                )}
              </div>
            </section>
          ) : null}

          {showDevySectionDb ? (
            <section>
              <div className="mb-2 flex items-center gap-2">
                <p className="text-[10px] font-bold uppercase tracking-wide text-secondary">Devy</p>
                <div className="h-px flex-1 bg-subtle" />
              </div>
              <div className="space-y-1">
                {lineupLists.devy.length > 0 ? (
                  lineupLists.devy.map((id) => (
                    <RosterRow
                      key={id}
                      playerId={id}
                      issueHighlight={highlightSet.has(id)}
                      sport={resolvedSport}
                      players={players}
                      playersLoading={playersLoading}
                      onPlayerClick={onPlayerClick}
                      slotLabel="DV"
                      week={week}
                      season={seasonYear}
                      onSlotClick={
                        lineupEditable
                          ? () => {
                              handleRowClick(id, 'DV')
                            }
                          : undefined
                      }
                      {...buildChimmyProps(id, 'DV')}
                      liveScore={liveScores.get(id) ?? null}
                    />
                  ))
                ) : (
                  <p className="text-xs text-muted">No devy players</p>
                )}
              </div>
            </section>
          ) : null}

          <TeamLineupSwapModal
            open={swapOpen && swapCtx != null && lineupLists != null}
            onClose={() => {
              setSwapOpen(false)
              setSwapCtx(null)
            }}
            slotLabel={
              swapCtx?.kind === 'starter'
                ? swapCtx.slot.label
                : swapCtx?.kind === 'reserve'
                  ? RESERVE_SWAP_TITLE[swapCtx.section]
                  : ''
            }
            candidates={
              swapCtx && lineupLists
                ? swapCtx.kind === 'starter'
                  ? buildSwapCandidates({
                      lists: lineupLists,
                      slot: swapCtx.slot,
                      slotIndex: swapCtx.index,
                      players,
                    })
                  : buildReserveSwapCandidates({
                      lists: lineupLists,
                      sourcePlayerId: swapCtx.playerId,
                      players,
                    })
                : []
            }
            sport={resolvedSport}
            locked={!lineupEditable || savingLineup}
            lockMessage={weekLock?.reason ?? dbRosterMeta.lineupLockHelp ?? null}
            onPick={(incomingId) => {
              if (!swapCtx || !lineupLists) return
              if (swapCtx.kind === 'starter') {
                const next = applyLineupPick({
                  lists: lineupLists,
                  slotIndex: swapCtx.index,
                  incomingId,
                })
                void saveLineup(next)
                return
              }
              const next = swapPlayersInLists(lineupLists, swapCtx.playerId, incomingId)
              void saveLineup(next)
            }}
          />
        </>
      ) : null}

      {!loading && !error && !showIdpDashboard && payload && payload.source !== 'sleeper' && dbParts && !lineupLists ? (
        <>
          <section>
            <div className="mb-2 flex flex-wrap items-end justify-between gap-2">
              <div>
                <p className="text-[10px] font-bold uppercase tracking-wide text-muted">Starters</p>
                <p className="text-[11px] text-muted">Click a row to open the player card (stub).</p>
              </div>
              <div className="flex gap-4 text-[10px] font-semibold uppercase tracking-wide text-white/35">
                <span className="w-10 text-right">OWN%</span>
                <span className="w-10 text-right">START%</span>
              </div>
            </div>
            <div className="space-y-1">
              {dbParts.starters.map((id, i) => (
                <RosterRow
                  key={id}
                  playerId={id}
                  issueHighlight={highlightSet.has(id)}
                  sport={resolvedSport}
                  players={players}
                  playersLoading={playersLoading}
                  onPlayerClick={onPlayerClick}
                  week={week}
                  season={seasonYear}
                  {...buildChimmyProps(id, `S${i + 1}`)}
                  liveScore={liveScores.get(id) ?? null}
                />
              ))}
            </div>
          </section>

          <section>
            <div className="mb-2 flex items-center gap-2">
              <p className="text-[10px] font-bold uppercase tracking-wide text-secondary">Bench</p>
              <div className="h-px flex-1 bg-subtle" />
            </div>
            <div className="space-y-1">
              {dbParts.bench.map((id) => (
                <RosterRow
                  key={id}
                  playerId={id}
                  issueHighlight={highlightSet.has(id)}
                  sport={resolvedSport}
                  players={players}
                  playersLoading={playersLoading}
                  onPlayerClick={onPlayerClick}
                  week={week}
                  season={seasonYear}
                  {...buildChimmyProps(id, 'Bench')}
                  liveScore={liveScores.get(id) ?? null}
                />
              ))}
            </div>
          </section>

          {showIrSectionDb ? (
            <section>
              <div className="mb-2 flex items-center gap-2">
                <p className="text-[10px] font-bold uppercase tracking-wide text-secondary">IR</p>
                <div className="h-px flex-1 bg-subtle" />
              </div>
              <div className="space-y-1">
                {dbParts.ir.length > 0 ? (
                  dbParts.ir.map((id) => (
                    <RosterRow
                      key={id}
                      playerId={id}
                      issueHighlight={highlightSet.has(id)}
                      sport={resolvedSport}
                      players={players}
                      playersLoading={playersLoading}
                      onPlayerClick={onPlayerClick}
                      week={week}
                      season={seasonYear}
                      {...buildChimmyProps(id, 'IR')}
                      liveScore={liveScores.get(id) ?? null}
                    />
                  ))
                ) : (
                  <p className="text-xs text-muted">No players on IR</p>
                )}
              </div>
            </section>
          ) : null}

          {showTaxiSectionDb ? (
            <section>
              <div className="mb-2 flex items-center gap-2">
                <p className="text-[10px] font-bold uppercase tracking-wide text-secondary">Taxi</p>
                <div className="h-px flex-1 bg-subtle" />
              </div>
              <div className="space-y-1">
                {dbParts.taxi.length > 0 ? (
                  dbParts.taxi.map((id) => (
                    <RosterRow
                      key={id}
                      playerId={id}
                      issueHighlight={highlightSet.has(id)}
                      sport={resolvedSport}
                      players={players}
                      playersLoading={playersLoading}
                      onPlayerClick={onPlayerClick}
                      week={week}
                      season={seasonYear}
                      {...buildChimmyProps(id, 'Taxi')}
                      liveScore={liveScores.get(id) ?? null}
                    />
                  ))
                ) : (
                  <p className="text-xs text-muted">No taxi squad players</p>
                )}
              </div>
            </section>
          ) : null}
        </>
      ) : null}

      {!loading && !error && !isSleeper && userTeam && (draftPickRows.length > 0 || draftPickFallback.length > 0) ? (
        <section
          className="rounded-xl border border-subtle bg-surface-muted p-4"
          data-testid="team-tab-draft-picks-section"
        >
          <div className="mb-3 flex items-center gap-2">
            <p className="text-[10px] font-bold uppercase tracking-wide text-secondary">Draft picks</p>
            <div className="h-px flex-1 bg-subtle" />
          </div>
          <ul className="space-y-1.5">
            {draftPickRows.map((p) => (
              <li key={p.id}>
                <button
                  type="button"
                  data-testid={`team-tab-draft-pick-${p.id}`}
                  onClick={() => {
                    setDraftPickDetailOpen(true)
                    setDraftPickDetail(null)
                    setDraftPickDetailLoading(true)
                    void (async () => {
                      try {
                        const res = await fetch(
                          `/api/leagues/${encodeURIComponent(league.id)}/roster/draft-picks?pickId=${encodeURIComponent(p.id)}`,
                          { cache: 'no-store' },
                        )
                        const j = (await res.json()) as {
                          pick?: { id: string; label: string; status: string } | null
                          tradeChain?: Array<{
                            tradeId: string
                            status: string
                            createdAt: string
                            summary: string
                          }>
                        }
                        setDraftPickDetail({
                          pick: j.pick ?? { id: p.id, label: p.label, status: p.status },
                          tradeChain: Array.isArray(j.tradeChain) ? j.tradeChain : [],
                        })
                      } finally {
                        setDraftPickDetailLoading(false)
                      }
                    })()
                  }}
                  className={[
                    'w-full rounded-lg border px-3 py-2 text-left text-xs text-white/85 transition hover:brightness-110',
                    p.tradeHint === 'traded_away'
                      ? 'border-rose-500/35 bg-rose-500/10'
                      : p.tradeHint === 'received'
                        ? 'border-emerald-500/35 bg-emerald-500/10'
                        : 'border-subtle bg-surface-muted',
                  ].join(' ')}
                >
                  {p.label}
                  {p.status && p.status !== 'pending' && p.status !== 'scheduled' ? (
                    <span className="ml-2 text-[10px] text-white/35">({p.status})</span>
                  ) : null}
                  <span className="mt-1 block text-[10px] text-cyan-400/80">Tap for trade history</span>
                </button>
              </li>
            ))}
            {draftPickFallback.map((p, i) => (
              <li
                key={`fb-${i}`}
                className="rounded-lg border border-subtle bg-surface-muted px-3 py-2 text-xs text-white/70"
              >
                {formatDraftPick(p)}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {!loading && !error && payload?.source === 'sleeper' && payload.roster && !sleeperParts ? (
        <p className="text-sm text-muted">No roster data.</p>
      ) : null}

      {!loading && !error && payload && payload.source !== 'sleeper' && !dbParts ? (
        <p className="text-sm text-muted">No roster data.</p>
      ) : null}

      {draftPickDetailOpen ? (
        <div
          className="fixed inset-0 z-[80] flex items-end justify-center bg-black/60 p-4 sm:items-center"
          role="dialog"
          aria-modal
          aria-labelledby="draft-pick-detail-title"
        >
          <button
            type="button"
            className="absolute inset-0 cursor-default"
            aria-label="Close"
            onClick={() => setDraftPickDetailOpen(false)}
          />
          <div className="relative z-[81] w-full max-w-md rounded-2xl border border-subtle bg-surface p-5 shadow-popover">
            <h3 id="draft-pick-detail-title" className="text-sm font-bold text-primary">
              Draft pick
            </h3>
            {draftPickDetailLoading ? (
              <p className="mt-3 text-xs text-muted">Loading...</p>
            ) : draftPickDetail?.pick ? (
              <>
                <p className="mt-2 text-sm text-primary">{draftPickDetail.pick.label}</p>
                <p className="mt-1 text-[11px] text-muted">Status: {draftPickDetail.pick.status}</p>
                <div className="mt-4 border-t border-subtle pt-3">
                  <p className="text-[10px] font-bold uppercase tracking-wide text-muted">Trade chain (AF)</p>
                  {draftPickDetail.tradeChain.length === 0 ? (
                    <p className="mt-2 text-xs text-muted">No linked trades found for this pick id.</p>
                  ) : (
                    <ul className="mt-2 max-h-48 space-y-2 overflow-y-auto text-xs text-secondary">
                      {draftPickDetail.tradeChain.map((t) => (
                        <li key={t.tradeId} className="rounded-lg border border-subtle bg-surface-muted px-2 py-1.5">
                          <span className="text-muted">{new Date(t.createdAt).toLocaleString()}</span>
                          <span className="mx-1 text-muted">·</span>
                          <span className="text-amber-200/90">{t.status}</span>
                          <p className="mt-0.5 text-[11px] text-secondary">{t.summary}</p>
                        </li>
                      ))}
                    </ul>
                  )}
                  <Link
                    href={`/league/${encodeURIComponent(league.id)}?view=trades`}
                    className="mt-2 inline-block text-[10px] font-semibold text-cyan-400/90 hover:text-cyan-300"
                  >
                    Open trades tab -&gt;
                  </Link>
                </div>
              </>
            ) : (
              <p className="mt-3 text-xs text-muted">Could not load pick details.</p>
            )}
            <button
              type="button"
              className="mt-4 w-full rounded-xl border border-subtle bg-surface-muted py-2 text-sm font-semibold text-secondary hover:bg-surface-hover"
              onClick={() => setDraftPickDetailOpen(false)}
            >
              Close
            </button>
          </div>
        </div>
      ) : null}

      {/* Local player detail bottom-sheet */}
      <LineupReplacementPickerSheet
        open={replacementPickerPlayerId != null && replacementPickerContext != null}
        sourcePlayerId={replacementPickerPlayerId}
        sourceSlotLabel={replacementPickerContext?.slotLabel}
        sport={resolvedSport}
        players={players}
        candidates={replacementPickerContext?.candidates ?? []}
        saving={savingLineup}
        locked={!lineupEditable}
        lockMessage={weekLock?.reason ?? dbRosterMeta?.lineupLockHelp ?? null}
        autosaveWired={lineupAutosaveWired}
        helperError={replacementPickerError}
        onClose={() => {
          if (savingLineup) return
          setReplacementPickerError(null)
          setReplacementPickerPlayerId(null)
        }}
        onConfirmReplacement={handleConfirmReplacement}
      />

      {detailPlayerId ? (
        <PlayerDetailSheet
          playerId={detailPlayerId}
          slotLabel={detailSlotLabel}
          sport={resolvedSport}
          players={players}
          week={week}
          season={seasonYear}
          canReplaceInLineup={canReplaceFromDetail}
          onOpenReplace={handleOpenReplacementPickerFromDetail}
          onClose={() => {
            setDetailPlayerId(null)
            setDetailSlotLabel(undefined)
          }}
          onViewFullStats={(id) => {
            setDetailPlayerId(null)
            setDetailSlotLabel(undefined)
            onOpenPlayerStats(id)
          }}
        />
      ) : null}
    </div>
  )
}
