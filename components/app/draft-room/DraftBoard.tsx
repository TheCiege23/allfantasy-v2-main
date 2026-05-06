'use client'

import React, { useEffect, useMemo, useRef, useState } from 'react'
import { ArrowLeft, ArrowLeftRight, ArrowRight, ChevronLeft, ChevronRight, Gavel } from 'lucide-react'
import { DraftBoardCell, type DraftBoardCellPick, type PickHighlightTone } from './DraftBoardCell'
import type { DraftPickSnapshot, SlotOrderEntry, TradedPickRecord } from '@/lib/live-draft-engine/types'
import type { KeeperSessionSnapshot } from '@/lib/live-draft-engine/types'
import { getSlotInRoundForOverall } from '@/lib/live-draft-engine/DraftOrderService'
import { isDraftPickRowEmptyFromSnapshot } from '@/lib/live-draft-engine/draftPickEmpty'
import { resolvePickOwner } from '@/lib/live-draft-engine/PickOwnershipResolver'
import { getRoundNavigationState } from '@/lib/draft-room/DraftBoardRenderer'
import { getManagerColorBySlot, withAlpha } from '@/lib/draft-room'
import type { DraftRoomDisplayPlayerLike } from '@/lib/player-data/adapters/draftRoomDisplayFields'
import { mergePoolPlayerIntoBoardPickDisplay } from '@/lib/player-data/adapters/draftRoomDisplayFields'

export type DraftBoardProps = {
  picks: DraftPickSnapshot[]
  slotOrder: SlotOrderEntry[]
  tradedPicks?: TradedPickRecord[]
  teamCount: number
  rounds: number
  draftType: 'snake' | 'linear' | 'auction'
  thirdRoundReversal: boolean
  tradedPickColorMode?: boolean
  showNewOwnerInRed?: boolean
  keeperLocks?: KeeperSessionSnapshot['locks']
  devyRounds?: number[]
  c2cCollegeRounds?: number[]
  currentOverallPick?: number | null
  sport?: string
  currentUserRosterId?: string | null
  aiManagedRosterIds?: string[]
  orderSourceLabel?: string | null
  /** Open pick-trade modal from a cell with rounds / receiver prefilled (logged-in user must have a roster). */
  onCellTrade?: (ctx: {
    round: number
    ownerSlot: number
    ownerRosterId: string
    overall: number
  }) => void
  /** Open the read-only pick-trade history modal. */
  onOpenTradeHistory?: () => void
  /** Premium chrome for live redraft snake route. */
  presentationVariant?: 'default' | 'redraft_snake'
  /**
   * Open the trade-history modal with a specific row pre-focused. Parent
   * routes to PickTradeHistoryModal's `focusRound` / `focusOriginalRosterId`
   * props so the matching traded-pick row highlights and scrolls into view.
   */
  onViewCellTradeHistory?: (ctx: { round: number; originalRosterId: string }) => void
  /** When true, board cells render a commissioner-only edit affordance. Caller still gates by paused/non-auction state. */
  canCommissionerEditPicks?: boolean
  /** Click handler for the commissioner edit affordance on a cell. */
  onCommissionerEditPick?: (overall: number) => void
  /** Live draft pool rows by player id — enriches tiles only; does not change stored picks */
  poolPlayerById?: Record<string, DraftRoomDisplayPlayerLike>
}

type SequentialBoardEntry = {
  round: number
  overall: number
  pick: DraftBoardCellPick
}

type AuctionBoardColumn = {
  rosterId: string
  slot: number
  displayName: string
  tintHex: string
  picks: DraftBoardCellPick[]
}

function isSnakeRoundReversed(round: number, draftType: 'snake' | 'linear' | 'auction', thirdRoundReversal: boolean): boolean {
  if (draftType !== 'snake') return false
  if (!thirdRoundReversal) return round % 2 === 0
  return round === 2 || round === 3 || (round >= 4 && round % 2 === 1)
}

function describeBoardMode(
  draftType: 'snake' | 'linear' | 'auction',
  thirdRoundReversal: boolean,
  orderSourceLabel?: string | null,
): string {
  if (draftType === 'auction') return 'Auction purchase board'
  if (thirdRoundReversal) {
    return orderSourceLabel ? `3RR snake | ${orderSourceLabel}` : '3RR snake'
  }
  if (draftType === 'linear') {
    return orderSourceLabel ? `Linear | ${orderSourceLabel}` : 'Linear'
  }
  return orderSourceLabel ? `Snake | ${orderSourceLabel}` : 'Snake'
}

function managerInitials(value: string): string {
  const parts = String(value ?? '')
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
  if (parts.length === 0) return 'AF'
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase()
  return `${parts[0]![0] ?? ''}${parts[1]![0] ?? ''}`.toUpperCase()
}

function buildAuctionCellPick(
  pick: DraftPickSnapshot,
  tintHex: string,
  sport: string | undefined,
  ownerRosterId: string,
): DraftBoardCellPick {
  return {
    overall: pick.overall,
    round: pick.round,
    slot: pick.slot,
    pickLabel: `N${pick.overall}`,
    playerName: pick.playerName,
    position: pick.position,
    team: pick.team ?? null,
    playerId: pick.playerId ?? null,
    playerImageUrl: pick.playerImageUrl ?? null,
    sport: sport ?? null,
    injuryStatus: null,
    byeWeek: pick.byeWeek ?? null,
    displayName: pick.displayName ?? null,
    tradedPickMeta: pick.tradedPickMeta ?? null,
    managerTintColor: tintHex,
    amount: pick.amount ?? null,
    source: pick.source,
    ownerRosterId,
  }
}

function DraftBoardInner({
  picks,
  slotOrder,
  tradedPicks = [],
  teamCount,
  rounds,
  draftType,
  thirdRoundReversal,
  tradedPickColorMode = false,
  showNewOwnerInRed = false,
  keeperLocks = [],
  devyRounds = [],
  c2cCollegeRounds = [],
  currentOverallPick = null,
  sport,
  currentUserRosterId = null,
  aiManagedRosterIds = [],
  orderSourceLabel,
  onCellTrade,
  onOpenTradeHistory,
  onViewCellTradeHistory,
  canCommissionerEditPicks = false,
  onCommissionerEditPick,
  presentationVariant = 'default',
  poolPlayerById,
}: DraftBoardProps) {
  const rs = presentationVariant === 'redraft_snake'
  const [viewMode, setViewMode] = useState<'all' | 'single'>('all')
  const [selectedRound, setSelectedRound] = useState(1)
  const lastFollowedOverallRef = useRef<number | null>(null)

  useEffect(() => {
    setSelectedRound((prev) => Math.min(Math.max(1, prev), Math.max(1, rounds)))
  }, [rounds])

  /** After each new pick, focus the board on the current round (single-round view) unless the user chose “All rounds”. */
  useEffect(() => {
    if (draftType === 'auction' || currentOverallPick == null) return
    const prev = lastFollowedOverallRef.current
    lastFollowedOverallRef.current = currentOverallPick
    if (prev === null) return
    if (currentOverallPick <= prev) return
    const round = Math.ceil(currentOverallPick / teamCount)
    setSelectedRound((r) => Math.min(rounds, Math.max(1, round)))
    setViewMode((mode) => (mode === 'all' ? 'all' : 'single'))
  }, [currentOverallPick, teamCount, rounds, draftType])

  const slotOrderBySlot = useMemo(() => new Map(slotOrder.map((entry) => [entry.slot, entry])), [slotOrder])
  const slotOrderByRosterId = useMemo(() => new Map(slotOrder.map((entry) => [entry.rosterId, entry])), [slotOrder])

  const pickHighlight = (existing: DraftPickSnapshot | undefined): PickHighlightTone => {
    const rid = existing?.rosterId
    if (!rid) return 'none'
    if (currentUserRosterId && rid === currentUserRosterId) return 'user'
    if (aiManagedRosterIds.length && aiManagedRosterIds.includes(rid)) return 'ai'
    return 'none'
  }

  const lastFilledPickOverall = useMemo(() => {
    const filled = picks.filter(
      (p) =>
        !isDraftPickRowEmptyFromSnapshot({
          playerName: p.playerName,
          position: p.position,
          pickMetadata: (p as { pickMetadata?: unknown }).pickMetadata,
          pickEditorEmpty: p.pickEditorEmpty,
        }),
    )
    if (filled.length === 0) return null
    return filled[filled.length - 1].overall
  }, [picks])

  const pickByKey = useMemo(() => {
    const map: Record<string, DraftPickSnapshot> = {}
    for (const pick of picks) {
      map[`${pick.round}-${pick.slot}`] = pick
    }
    return map
  }, [picks])

  const keeperByKey = useMemo(() => {
    const map: Record<string, (typeof keeperLocks)[number]> = {}
    for (const lock of keeperLocks) {
      map[`${lock.round}-${lock.slot}`] = lock
    }
    return map
  }, [keeperLocks])

  /** Per-round map of draft slot (column) → cell data. Columns match `orderedSlots` (slot 1…N left to right). */
  const boardRowsByRoundAndSlot = useMemo(() => {
    const totalPicks = rounds * teamCount
    const byRoundSlot: Record<number, Map<number, SequentialBoardEntry>> = {}

    for (let overall = 1; overall <= totalPicks; overall += 1) {
      const round = Math.ceil(overall / teamCount)
      const pickInRound = ((overall - 1) % teamCount) + 1
      const ownerSlot = getSlotInRoundForOverall({
        overall,
        teamCount,
        draftType,
        thirdRoundReversal,
      })
      const key = `${round}-${ownerSlot}`
      const existing = pickByKey[key]
      const lock = keeperByKey[key]
      const resolved = resolvePickOwner(round, ownerSlot, slotOrder, tradedPicks)
      const defaultOwner = slotOrderBySlot.get(ownerSlot) ?? null
      const ownerRosterId = resolved?.rosterId ?? defaultOwner?.rosterId ?? null
      const currentOwner = resolved?.rosterId ? (slotOrderByRosterId.get(resolved.rosterId) ?? null) : null
      const tintSlot = currentOwner?.slot ?? defaultOwner?.slot ?? ownerSlot
      const ownerColor = getManagerColorBySlot(tintSlot)
      const resolvedTradedMeta = (existing?.tradedPickMeta ?? resolved?.tradedPickMeta)
        ? {
            ...(existing?.tradedPickMeta ?? resolved?.tradedPickMeta),
            tintColor: (existing?.tradedPickMeta ?? resolved?.tradedPickMeta)?.tintColor ?? ownerColor.tintHex,
          }
        : null
      const source = String((existing as { source?: string | null } | undefined)?.source ?? '').toLowerCase()
      const isDevyRound = devyRounds.includes(round)
      const isCollegeRound = c2cCollegeRounds.includes(round)
      const c2cEnabled = c2cCollegeRounds.length > 0
      const isCollegePick = c2cEnabled && !!existing && (source === 'college' || isCollegeRound)
      const isProPick = c2cEnabled && !!existing && !isCollegePick
      const isDevyPick =
        !c2cEnabled &&
        (source === 'devy' ||
          source === 'college' ||
          (!!existing && isDevyRound && source !== 'promoted_devy'))
      const isPromotedFromDevy = source === 'promoted_devy'
      const useLock = !existing && lock

      if (!byRoundSlot[round]) byRoundSlot[round] = new Map()
      const basePick = {
        overall,
        round,
        slot: ownerSlot,
        pickLabel: `${round}.${pickInRound}`,
        playerName: existing?.playerName ?? lock?.playerName ?? null,
        position: existing?.position ?? lock?.position ?? null,
        team: existing?.team ?? lock?.team ?? null,
        playerId: existing?.playerId ?? lock?.playerId ?? null,
        playerImageUrl: existing?.playerImageUrl ?? null,
        sport: sport ?? null,
        injuryStatus: (existing as { injuryStatus?: string | null } | undefined)?.injuryStatus ?? null,
        byeWeek: existing?.byeWeek ?? null,
        displayName: existing?.displayName ?? lock?.displayName ?? resolved?.displayName ?? null,
        tradedPickMeta: resolvedTradedMeta,
        managerTintColor: ownerColor.tintHex,
        amount: existing?.amount ?? null,
        isKeeper: useLock ?? undefined,
        isDevyPick: isDevyPick || undefined,
        isCollegePick: isCollegePick || undefined,
        isProPick: isProPick || undefined,
        isPromotedFromDevy: isPromotedFromDevy || undefined,
        source: source || undefined,
        ownerRosterId,
      }
      const pid = existing?.playerId ? String(existing.playerId).trim() : ''
      const poolEntry = pid && poolPlayerById ? poolPlayerById[pid] : undefined
      const mergedPick =
        poolEntry && existing?.playerId
          ? mergePoolPlayerIntoBoardPickDisplay(basePick, poolEntry)
          : basePick
      byRoundSlot[round]!.set(ownerSlot, {
        round,
        overall,
        pick: mergedPick,
      })
    }

    return byRoundSlot
  }, [
    rounds,
    teamCount,
    draftType,
    thirdRoundReversal,
    pickByKey,
    keeperByKey,
    slotOrder,
    tradedPicks,
    slotOrderBySlot,
    slotOrderByRosterId,
    devyRounds,
    c2cCollegeRounds,
    sport,
    poolPlayerById,
  ])

  const auctionColumns = useMemo(() => {
    if (draftType !== 'auction') return [] as AuctionBoardColumn[]

    return slotOrder
      .slice()
      .sort((a, b) => a.slot - b.slot)
      .map((entry) => {
        const tintHex = getManagerColorBySlot(entry.slot).tintHex
        const ownedPicks = picks
          .filter((pick) => pick.rosterId === entry.rosterId)
          .sort((a, b) => a.overall - b.overall)
          .map((pick) => {
            const base = buildAuctionCellPick(pick, tintHex, sport, entry.rosterId)
            const pid = pick.playerId ? String(pick.playerId).trim() : ''
            return pid && poolPlayerById?.[pid]
              ? mergePoolPlayerIntoBoardPickDisplay(base, poolPlayerById[pid])
              : base
          })

        return {
          rosterId: entry.rosterId,
          slot: entry.slot,
          displayName: entry.displayName,
          tintHex,
          picks: ownedPicks,
        }
      })
  }, [draftType, picks, slotOrder, sport, poolPlayerById])

  const navigation = getRoundNavigationState(selectedRound, rounds)
  const orderedSlots = useMemo(
    () => slotOrder.slice().sort((a, b) => a.slot - b.slot),
    [slotOrder],
  )
  const visibleRounds =
    viewMode === 'single'
      ? [navigation.round]
      : Array.from({ length: rounds }, (_, index) => index + 1)

  const auctionMaxRows = useMemo(
    () => Math.max(1, ...auctionColumns.map((column) => column.picks.length)),
    [auctionColumns],
  )

  const boardModeLabel = describeBoardMode(draftType, thirdRoundReversal, orderSourceLabel)
  const currentRoundDirection =
    draftType === 'auction'
      ? 'Budgets and sold players update live during bidding.'
      : isSnakeRoundReversed(navigation.round, draftType, thirdRoundReversal)
        ? 'Owner flow reverses on this round.'
        : 'Owner flow runs in the original order on this round.'
  const currentOwnerSlot = useMemo(() => {
    if (draftType === 'auction' || currentOverallPick == null) return null
    return getSlotInRoundForOverall({
      overall: currentOverallPick,
      teamCount,
      draftType,
      thirdRoundReversal,
    })
  }, [draftType, currentOverallPick, teamCount, thirdRoundReversal])

  return (
    <section
      className={
        rs
          ? 'relative flex flex-col overflow-hidden rounded-2xl border border-cyan-400/20 bg-[linear-gradient(165deg,rgba(15,23,42,0.92)_0%,rgba(6,13,26,0.98)_45%,rgba(4,9,17,1)_100%)] shadow-[0_24px_72px_rgba(0,0,0,0.55),0_0_0_1px_rgba(34,211,238,0.06),inset_0_1px_0_rgba(255,255,255,0.06)]'
          : 'relative flex flex-col overflow-hidden rounded-2xl border border-white/[0.09] bg-gradient-to-b from-[#070f22] via-[#060d1e] to-[#050a14] shadow-[0_20px_60px_rgba(0,0,0,0.45),inset_0_1px_0_rgba(255,255,255,0.04)]'
      }
      data-testid="draft-board"
    >
      <div
        className={`pointer-events-none absolute inset-x-3 top-0 h-px bg-gradient-to-r ${rs ? 'via-cyan-300/35' : 'via-cyan-400/20'} from-transparent to-transparent`}
        aria-hidden
      />
      <div
        className={`border-b px-3 py-1.5 text-xs text-white/70 backdrop-blur-sm sm:px-4 ${rs ? 'border-cyan-500/15 bg-[linear-gradient(180deg,rgba(7,15,29,0.96),rgba(6,13,30,0.9))]' : 'border-white/[0.08] bg-[linear-gradient(180deg,rgba(6,13,30,0.95),rgba(5,10,22,0.88))]'}`}
      >
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap items-center gap-2">
            <span className={`text-sm font-bold tracking-tight drop-shadow-sm ${rs ? 'bg-gradient-to-r from-white to-cyan-100/90 bg-clip-text text-transparent' : 'text-white'}`}>
              Draft board
            </span>
            <span
              className={`rounded-full border px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.16em] shadow-sm ${rs ? 'border-white/18 bg-white/[0.08] text-cyan-100/85' : 'border-white/12 bg-white/[0.06] text-white/60'}`}
            >
              {boardModeLabel}
            </span>
            {tradedPicks.length > 0 ? (
              onOpenTradeHistory ? (
                <button
                  type="button"
                  onClick={onOpenTradeHistory}
                  data-testid="draft-board-open-trade-history"
                  className="inline-flex items-center gap-1 rounded-full border border-amber-400/35 bg-amber-500/12 px-2.5 py-1 text-[10px] font-medium text-amber-100/95 shadow-[0_0_16px_rgba(251,191,36,0.12)] transition duration-150 hover:bg-amber-500/22"
                  title="View pick trade history"
                >
                  <ArrowLeftRight className="h-3 w-3" />
                  {tradedPicks.length} traded {tradedPicks.length === 1 ? 'pick' : 'picks'}
                </button>
              ) : (
                <span className="inline-flex items-center gap-1 rounded-full border border-amber-400/25 bg-amber-500/10 px-2 py-1 text-[10px] text-amber-100/88">
                  <ArrowLeftRight className="h-3 w-3" />
                  {tradedPicks.length} traded {tradedPicks.length === 1 ? 'pick' : 'picks'}
                </span>
              )
            ) : null}
            {draftType === 'auction' ? (
              <span className="inline-flex items-center gap-1 rounded-full border border-cyan-400/30 bg-cyan-500/12 px-2 py-1 text-[10px] font-medium text-cyan-100/90 shadow-[0_0_14px_rgba(34,211,238,0.12)]">
                <Gavel className="h-3 w-3" />
                {picks.length} sold
              </span>
            ) : null}
          </div>

          {draftType !== 'auction' ? (
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                data-testid="draft-board-prev-round"
                onClick={() => setSelectedRound((prev) => Math.max(1, prev - 1))}
                disabled={!navigation.canGoPrev}
                className="rounded-lg border border-white/20 bg-black/35 px-2 py-1 text-[10px] text-white/80 shadow-sm transition duration-150 hover:border-cyan-300/35 hover:bg-white/12 active:scale-95 disabled:opacity-40"
              >
                <ChevronLeft className="h-3.5 w-3.5" />
              </button>
              <select
                value={navigation.round}
                data-testid="draft-board-round-selector"
                onChange={(event) => setSelectedRound(Math.max(1, Number(event.target.value) || 1))}
                className="rounded-lg border border-white/20 bg-black/40 px-2 py-1 text-[10px] text-white shadow-inner"
                aria-label="Draft board round selector"
              >
                {Array.from({ length: rounds }, (_, index) => index + 1).map((round) => (
                  <option key={round} value={round}>
                    Round {round}
                  </option>
                ))}
              </select>
              <button
                type="button"
                data-testid="draft-board-next-round"
                onClick={() => setSelectedRound((prev) => Math.min(rounds, prev + 1))}
                disabled={!navigation.canGoNext}
                className="rounded-lg border border-white/20 bg-black/35 px-2 py-1 text-[10px] text-white/80 shadow-sm transition duration-150 hover:border-cyan-300/35 hover:bg-white/12 active:scale-95 disabled:opacity-40"
              >
                <ChevronRight className="h-3.5 w-3.5" />
              </button>
              <button
                type="button"
                data-testid="draft-board-toggle-view-mode"
                onClick={() => setViewMode((prev) => (prev === 'all' ? 'single' : 'all'))}
                className="rounded-lg border border-cyan-400/40 bg-cyan-500/12 px-2.5 py-1 text-[10px] font-medium text-cyan-100 shadow-[0_0_14px_rgba(34,211,238,0.1)] transition duration-150 hover:bg-cyan-500/22 active:scale-95"
              >
                {viewMode === 'all' ? 'Focus round' : 'All rounds'}
              </button>
              {currentOverallPick != null ? (
                <button
                  type="button"
                  data-testid="draft-board-jump-current"
                  onClick={() => {
                    const round = Math.ceil(currentOverallPick / teamCount)
                    setSelectedRound(Math.min(rounds, Math.max(1, round)))
                    setViewMode('single')
                  }}
                  className="rounded-lg border border-emerald-400/40 bg-emerald-500/12 px-2 py-1 text-[10px] font-medium text-emerald-100 shadow-[0_0_14px_rgba(16,185,129,0.12)] transition duration-150 hover:bg-emerald-500/22"
                >
                  Current
                </button>
              ) : null}
            </div>
          ) : null}
        </div>
      </div>

      <div
        className={`border-b px-3 py-1 text-[10px] sm:px-4 ${rs ? 'border-cyan-500/10 bg-cyan-500/[0.07] text-cyan-100/72' : 'border-white/[0.08] bg-white/[0.03] text-white/60'}`}
        data-testid="draft-board-round-label"
      >
        {draftType === 'auction'
          ? 'Purchases are grouped by manager and update as the bidding room resolves each nomination.'
          : viewMode === 'all'
            ? `All rounds (${rounds}) • ${currentRoundDirection}`
            : `${navigation.label} • ${currentRoundDirection}`}
      </div>

      {draftType === 'auction' ? (
        <div className="snap-x snap-mandatory overflow-x-auto overflow-y-visible px-2 py-3 pb-4 [-webkit-overflow-scrolling:touch]">
          <div
            className="grid min-w-min gap-3"
            data-testid="draft-board-grid"
            style={{ gridTemplateColumns: `repeat(${Math.max(1, auctionColumns.length)}, minmax(136px, 1fr))` }}
          >
            {auctionColumns.map((column) => (
              <section
                key={column.rosterId}
                className="snap-start overflow-hidden rounded-xl border bg-[#0a1227] shadow-[0_8px_30px_rgba(0,0,0,0.35)] transition duration-150 hover:shadow-[0_12px_40px_rgba(0,0,0,0.45)]"
                style={{
                  borderColor: withAlpha(column.tintHex, 0.22),
                  backgroundColor: withAlpha(column.tintHex, 0.05),
                }}
              >
                <div
                  className="border-b px-2 py-2"
                  style={{ borderColor: withAlpha(column.tintHex, 0.18) }}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-[10px] font-medium uppercase tracking-[0.14em] text-white/38">
                      Slot {column.slot}
                    </span>
                    <span
                      className="h-2.5 w-2.5 rounded-full"
                      style={{ backgroundColor: withAlpha(column.tintHex, 0.95) }}
                      aria-hidden
                    />
                  </div>
                  <p className="mt-1 truncate text-sm font-semibold text-white">{column.displayName}</p>
                </div>

                <div className="space-y-1.5 p-1.5">
                  {Array.from({ length: auctionMaxRows }, (_, index) => {
                    const pick = column.picks[index]
                    if (!pick) {
                      return (
                        <div
                          key={`${column.rosterId}-open-${index + 1}`}
                          className="flex min-h-[60px] items-end rounded-lg border border-dashed border-white/[0.08] bg-[#0d1424]/90 px-2 py-1.5 text-[10px] text-white/30"
                        >
                          Open slot {index + 1}
                        </div>
                      )
                    }

                    const existing = picks.find((entry) => entry.overall === pick.overall)
                    return (
                      <DraftBoardCell
                        key={pick.overall}
                        pick={pick}
                        isEmpty={false}
                        presentationVariant={presentationVariant}
                        sport={sport}
                        isRecentPick={Boolean(pick.playerName?.trim() && pick.overall === lastFilledPickOverall)}
                        tradedPickColorMode={tradedPickColorMode}
                        showNewOwnerInRed={showNewOwnerInRed}
                        pickHighlight={pickHighlight(existing)}
                        onTradeFromCell={
                          currentUserRosterId && onCellTrade && pick.ownerRosterId && typeof pick.slot === 'number'
                            ? () =>
                                onCellTrade({
                                  round: pick.round,
                                  ownerSlot: pick.slot,
                                  ownerRosterId: pick.ownerRosterId ?? '',
                                  overall: pick.overall,
                                })
                            : undefined
                        }
                        onViewTradeHistory={
                          onViewCellTradeHistory && pick.tradedPickMeta?.originalRosterId
                            ? () =>
                                onViewCellTradeHistory({
                                  round: pick.round,
                                  originalRosterId: pick.tradedPickMeta!.originalRosterId!,
                                })
                            : undefined
                        }
                        onCommissionerEditPick={
                          canCommissionerEditPicks && onCommissionerEditPick
                            ? () => onCommissionerEditPick(pick.overall)
                            : undefined
                        }
                      />
                    )
                  })}
                </div>
              </section>
            ))}
          </div>
        </div>
      ) : (
        <div className="snap-x snap-mandatory overflow-x-auto overflow-y-visible px-2 py-3 pb-4 [-webkit-overflow-scrolling:touch]">
          <div className="min-w-max" data-testid="draft-board-grid">
            <div
              className={`sticky top-0 z-10 grid gap-1 border-b pb-2 backdrop-blur-md sm:gap-1.5 ${
                rs
                  ? 'border-cyan-500/15 bg-[rgba(7,13,28,0.92)] shadow-[0_16px_40px_rgba(0,0,0,0.45)]'
                  : 'border-white/[0.06] bg-[#070b18]/95 shadow-[0_12px_32px_rgba(0,0,0,0.35)]'
              }`}
              style={{ gridTemplateColumns: `40px repeat(${teamCount}, minmax(96px, 1fr))` }}
              data-testid="draft-board-team-header"
            >
              <div
                className={`flex h-14 items-center justify-center text-[9px] font-bold uppercase tracking-[0.16em] ${
                  rs ? 'text-cyan-100/55' : 'text-white/45'
                }`}
              >
                Rd
              </div>
              {orderedSlots.map((entry) => (
                <div
                  key={entry.rosterId}
                  className={`group relative flex h-14 min-w-0 flex-col items-center justify-center gap-1 px-1 transition duration-150 ${
                    currentOwnerSlot === entry.slot ? 'text-cyan-100' : 'text-white/85'
                  }`}
                >
                  <span
                    className={`inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full border text-[10px] font-bold uppercase tracking-[0.04em] shadow-sm ${
                      currentOwnerSlot === entry.slot
                        ? 'border-cyan-300/70 bg-cyan-500/15 text-cyan-50 shadow-[0_0_14px_rgba(34,211,238,0.35)]'
                        : 'border-white/15 bg-white/[0.04] text-white/85'
                    }`}
                  >
                    {managerInitials(entry.displayName)}
                  </span>
                  <span
                    className="w-full truncate text-center text-[10px] font-medium leading-none"
                    title={entry.displayName}
                  >
                    {entry.displayName}
                  </span>
                  {currentOwnerSlot === entry.slot ? (
                    <span className="absolute -top-0.5 right-1 inline-flex h-1.5 w-1.5 rounded-full bg-cyan-300 shadow-[0_0_8px_rgba(34,211,238,0.8)]" aria-hidden />
                  ) : null}
                </div>
              ))}
            </div>

            <div className="space-y-1 pt-1">
              {visibleRounds.map((round) => (
                <section key={round} data-testid={`draft-board-round-${round}`}>
                    <div
                      className="grid gap-1 sm:gap-1.5"
                      style={{ gridTemplateColumns: `40px repeat(${teamCount}, minmax(96px, 1fr))` }}
                    >
                    {(() => {
                      const reversed = isSnakeRoundReversed(round, draftType, thirdRoundReversal)
                      const isSnake = draftType === 'snake'
                      return (
                        <div
                          className={`flex min-h-[52px] flex-col items-center justify-center gap-0.5 rounded-xl border text-[10px] shadow-[inset_0_1px_0_rgba(255,255,255,0.04)] sm:min-h-[56px] ${
                            round === 1
                              ? 'border-amber-300/35 bg-gradient-to-br from-amber-500/18 via-[#1d2236] to-[#0a1228] text-amber-100/95'
                              : 'border-white/[0.1] bg-gradient-to-br from-[#0d1629] to-[#0a1228] text-white/75'
                          }`}
                          title={
                            isSnake
                              ? reversed
                                ? 'Snake direction: reversed (right → left)'
                                : 'Snake direction: forward (left → right)'
                              : 'Linear order (left → right)'
                          }
                          data-testid={`draft-board-round-${round}-direction`}
                          data-direction={reversed ? 'reverse' : 'forward'}
                        >
                          <span className="font-semibold uppercase tracking-[0.14em]">R{round}</span>
                          {reversed ? (
                            <ArrowLeft className="h-3 w-3 text-amber-300/80" aria-label="reverse" />
                          ) : (
                            <ArrowRight className="h-3 w-3 text-cyan-300/80" aria-label="forward" />
                          )}
                        </div>
                      )
                    })()}

                    {orderedSlots.map((slotEntry) => {
                      const cell = boardRowsByRoundAndSlot[round]?.get(slotEntry.slot)
                      if (!cell) {
                        return (
                          <div
                            key={`${round}-${slotEntry.slot}-missing`}
                            className="min-h-[52px] rounded-xl border border-dashed border-red-400/30 bg-red-500/8 sm:min-h-[56px]"
                            title="Missing cell data for this slot"
                          />
                        )
                      }
                      const { pick, overall } = cell
                      const existing = picks.find((entry) => entry.overall === overall)
                      const isPickDisplayEmpty =
                        pick.isKeeper
                          ? false
                          : existing
                            ? isDraftPickRowEmptyFromSnapshot({
                                playerName: existing.playerName,
                                position: existing.position,
                                pickMetadata: (existing as { pickMetadata?: unknown }).pickMetadata,
                                pickEditorEmpty: existing.pickEditorEmpty,
                              })
                            : !String(pick.playerName ?? '').trim()
                      const isCurrentPick = currentOverallPick != null && overall === currentOverallPick
                      const emptyCellDirection =
                        draftType === 'snake' && isSnakeRoundReversed(round, draftType, thirdRoundReversal)
                          ? 'reverse'
                          : 'forward'

                      return (
                        <DraftBoardCell
                          key={`${round}-${slotEntry.slot}`}
                          pick={pick}
                          isEmpty={isPickDisplayEmpty}
                          isCurrentPick={isCurrentPick}
                          presentationVariant={presentationVariant}
                          sport={sport}
                          isRecentPick={Boolean(!isPickDisplayEmpty && overall === lastFilledPickOverall)}
                          tradedPickColorMode={tradedPickColorMode}
                          showNewOwnerInRed={showNewOwnerInRed}
                          isDevyRound={devyRounds.includes(round) && isPickDisplayEmpty}
                          isCollegeRound={c2cCollegeRounds.includes(round) && isPickDisplayEmpty}
                          pickHighlight={isCurrentPick ? 'none' : pickHighlight(existing)}
                          emptyCellDirection={emptyCellDirection}
                          onTradeFromCell={
                            currentUserRosterId && onCellTrade && pick.ownerRosterId && typeof pick.slot === 'number'
                              ? () =>
                                  onCellTrade({
                                    round: pick.round,
                                    ownerSlot: pick.slot,
                                    ownerRosterId: pick.ownerRosterId ?? '',
                                    overall: pick.overall,
                                  })
                              : undefined
                          }
                          onViewTradeHistory={
                            onViewCellTradeHistory && pick.tradedPickMeta?.originalRosterId
                              ? () =>
                                  onViewCellTradeHistory({
                                    round: pick.round,
                                    originalRosterId: pick.tradedPickMeta!.originalRosterId!,
                                  })
                              : undefined
                          }
                          onCommissionerEditPick={
                            canCommissionerEditPicks && onCommissionerEditPick
                              ? () => onCommissionerEditPick(pick.overall)
                              : undefined
                          }
                        />
                      )
                    })}
                  </div>
                </section>
              ))}
            </div>
          </div>
        </div>
      )}
    </section>
  )
}

export const DraftBoard = React.memo(DraftBoardInner)
