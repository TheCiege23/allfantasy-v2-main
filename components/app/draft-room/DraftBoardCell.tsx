'use client'

import React from 'react'
import { ArrowLeft, ArrowLeftRight, ArrowRight, Gavel, History, Pencil } from 'lucide-react'
import { withAlpha } from '@/lib/draft-room'
import { PlayerAvatar } from './PlayerAvatar'
import { DEFAULT_SPORT, normalizeToSupportedSport } from '@/lib/sport-scope'
import { buildDraftPlayerDisplayModel } from '@/lib/draft-sports-models/build-display-model'
import { normalizePlayer } from '@/lib/players/normalizePlayer'
import { classifyAvatarSource } from '@/lib/draft-room/classify-avatar-source'
import { getPlayerImage } from '@/lib/players/getPlayerImage'
import { positionTintHex } from '@/lib/draft-room/positionTint'

export type DraftBoardCellPick = {
  overall: number
  round: number
  slot: number
  pickLabel: string
  playerName: string | null
  position: string | null
  team: string | null
  playerId?: string | null
  /** Persisted at pick commit — avoids missing headshots when playerId is synthetic or unresolved offline. */
  playerImageUrl?: string | null
  sport?: string | null
  injuryStatus?: string | null
  byeWeek: number | null
  displayName: string | null
  amount?: number | null
  isKeeper?: boolean
  isDevyPick?: boolean
  isCollegePick?: boolean
  isProPick?: boolean
  isPromotedFromDevy?: boolean
  source?: string | null
  tradedPickMeta?: {
    originalRosterId?: string
    newOwnerName?: string
    previousOwnerName?: string
    showNewOwnerInRed?: boolean
    tintColor?: string
  } | null
  managerTintColor?: string | null
  /** Current owner of this pick slot (for trade targeting). */
  ownerRosterId?: string | null
  /** From live pool merge — Rookie / N YOE */
  experienceBadge?: string | null
  /** overall − market ADP, rounded; set only when large enough to badge (+ steal, − reach). */
  adpDelta?: number | null
}

function TinyHeadshot({
  name,
  src,
  position,
  teamLogoUrl,
  teamAbbr,
  size = 26,
}: {
  name: string | null
  src: string | null
  /** F.1 — DEF picks render the team logo as the primary avatar. */
  position?: string | null
  /** F.1 — passed only for DEF picks; non-DEF cells keep the existing
   * team on the line under the name. */
  teamLogoUrl?: string | null
  teamAbbr?: string | null
  size?: number
}) {
  /** E.1: delegate to the shared PlayerAvatar so the URL classifier (which rejects data URIs and
   * team logos) is applied uniformly. The board cell stays at 22px and skips the team-logo badge
   * because the tile prints the team under the name. 40px on the square tiles. */
  return (
    <PlayerAvatar
      headshotUrl={src}
      displayName={name ?? ''}
      teamLogoUrl={teamLogoUrl}
      teamAbbr={teamAbbr}
      position={position}
      size={size}
      testIdBase="draft-board-cell-headshot"
    />
  )
}

export type PickHighlightTone = 'none' | 'user' | 'ai'

export type DraftBoardCellProps = {
  pick: DraftBoardCellPick
  isEmpty: boolean
  isCurrentPick?: boolean
  /** Latest completed pick — subtle highlight */
  isRecentPick?: boolean
  /** Resolved league sport for assets */
  sport?: string | null
  tradedPickColorMode?: boolean
  showNewOwnerInRed?: boolean
  isDevyRound?: boolean
  isCollegeRound?: boolean
  pickHighlight?: PickHighlightTone
  /** When set, show a trade affordance (opens pick-trade flow from parent). */
  onTradeFromCell?: () => void
  /**
   * When set on a cell whose pick has `tradedPickMeta`, shows a secondary
   * "history" chip. Parent routes this to PickTradeHistoryModal with
   * focusRound / focusOriginalRosterId so the relevant row highlights.
   */
  onViewTradeHistory?: () => void
  /** Snake: reversed rounds show a left arrow on empty cells; forward rounds show right. */
  emptyCellDirection?: 'forward' | 'reverse'
  presentationVariant?: 'default' | 'redraft_snake'
  /** Commissioner-only: opens the Pick Editor panel prefilled with this overall. Caller gates by viewer + draft state. */
  onCommissionerEditPick?: () => void
}

/**
 * ⚠ GOLD BELONGS TO "ON THE CLOCK" AND NOTHING ELSE ON THIS BOARD.
 *
 * The user tone used to be amber — the same family as the `#f6c445` on-the-clock cell. On a
 * twelve-team board that meant your own completed picks glowed like the one state that demands you
 * act right now, which is the fastest way to make an urgency colour stop meaning urgency. Your
 * picks are accent (the product's cyan); the clock keeps gold to itself.
 *
 * `ai` stays sky — distinct from both, and mutually exclusive with `user` on a given cell anyway.
 */
function highlightClass(tone: PickHighlightTone | undefined): string {
  if (tone === 'user')
    return 'ring-1 ring-cyan-400/60 border-cyan-400/50 shadow-[0_4px_24px_rgba(34,211,238,0.24)]'
  if (tone === 'ai') return 'ring-1 ring-sky-400/55 border-sky-400/45 shadow-[0_4px_26px_rgba(56,189,248,0.26)]'
  return ''
}

function compactPickLabel(value: string): string {
  return value.replace(/\.0(?=\d$)/, '.')
}

function StatusBadge({
  label,
  className,
}: {
  label: string
  className: string
}) {
  return (
    <span className={`inline-flex items-center rounded px-1 py-0.5 text-[11px] font-semibold uppercase tracking-[0.12em] ${className}`}>
      {label}
    </span>
  )
}

function DraftBoardCellInner({
  pick,
  isEmpty,
  isCurrentPick = false,
  isRecentPick = false,
  sport = null,
  tradedPickColorMode = false,
  showNewOwnerInRed = false,
  isDevyRound = false,
  isCollegeRound = false,
  pickHighlight = 'none',
  emptyCellDirection = 'forward',
  onTradeFromCell,
  onViewTradeHistory,
  onCommissionerEditPick,
  presentationVariant = 'default',
}: DraftBoardCellProps) {
  const rs = presentationVariant === 'redraft_snake'
  const sportNorm = normalizeToSupportedSport(pick.sport ?? sport ?? DEFAULT_SPORT)

  const normalized = React.useMemo(() => {
    if (isEmpty || !pick.playerName?.trim()) return null
    const built = buildDraftPlayerDisplayModel({
      playerName: pick.playerName ?? '',
      position: pick.position ?? '-',
      team: pick.team ?? null,
      playerId: pick.playerId ?? null,
      byeWeek: pick.byeWeek ?? null,
      injuryStatus: pick.injuryStatus ?? null,
      sport: sportNorm,
    })
    return normalizePlayer({ display: built, sport: sportNorm })
  }, [
    isEmpty,
    pick.playerName,
    pick.position,
    pick.team,
    pick.playerId,
    pick.byeWeek,
    pick.injuryStatus,
    sportNorm,
  ])

  const headshotSrc =
    pick.playerImageUrl?.trim() ||
    (normalized ? getPlayerImage(normalized, sportNorm) : null)
  const teamLogoSrc = normalized?.teamLogoUrl ?? null

  // Sleeper-style: a flat slate tile when empty, a solid position-coloured tile once filled.
  // Trade colouring still wins when the commissioner turned it on.
  const tradeHex = tradedPickColorMode ? pick.tradedPickMeta?.tintColor ?? null : null
  const positionHex = !isEmpty ? positionTintHex(pick.position) : null
  const fillHex = !isEmpty ? positionHex : tradeHex
  const tileStyle: React.CSSProperties | undefined = fillHex
    ? isEmpty
      ? { backgroundColor: withAlpha(fillHex, 0.22), boxShadow: `inset 0 0 0 1px ${withAlpha(fillHex, 0.55)}` }
      : { backgroundColor: fillHex }
    : undefined
  // Filled tiles carry dark text on the bright position colour, as Sleeper does.
  const onFill = !isEmpty && Boolean(positionHex)

  const ownerLabel = pick.tradedPickMeta?.newOwnerName ?? pick.displayName ?? null
  const showTradeChip = Boolean(isEmpty && ownerLabel && pick.tradedPickMeta?.newOwnerName)
  const compactLabel = compactPickLabel(pick.pickLabel)

  const ariaLabel = isEmpty
    ? `Draft pick ${compactLabel}, empty slot`
    : `${pick.playerName ?? 'Player'}, ${pick.position ?? ''}, ${pick.team ?? ''}, pick ${compactLabel}`

  const hasRealHeadshot = Boolean(headshotSrc && classifyAvatarSource(headshotSrc) === 'headshot')
  const hasStatusBadges = Boolean(
    pick.isKeeper ||
      pick.isDevyPick ||
      pick.isCollegePick ||
      pick.isProPick ||
      pick.isPromotedFromDevy ||
      showTradeChip ||
      (isEmpty && (isCollegeRound || isDevyRound)),
  )

  const nameParts = (pick.playerName ?? '').trim().split(/\s+/)
  const firstName = nameParts.length > 1 ? nameParts[0] : ''
  const lastName = nameParts.length > 1 ? nameParts.slice(1).join(' ') : nameParts[0] ?? ''

  return (
    <div
      className={`group relative flex h-[50px] w-full flex-col overflow-hidden rounded-[4px] px-1.5 py-1 text-[11px] transition-[box-shadow,filter,background-color] duration-150 hover:z-[1] hover:brightness-110 ${
        isCurrentPick ? 'draft-live-current-pick' : isRecentPick ? 'draft-live-recent-pick' : ''
      } ${
        isCurrentPick
          ? 'bg-[#4a5378] ring-2 ring-[#f6c445] shadow-[0_0_40px_rgba(246,196,69,0.35)]'
          : isEmpty
            ? 'bg-[#2a2f45]'
            : `${positionHex ? '' : 'bg-[#3a4160]'} ${isRecentPick ? 'ring-2 ring-emerald-300' : ''} ${highlightClass(pickHighlight)}`
      }`}
      style={tileStyle}
      data-overall={pick.overall}
      data-round={pick.round}
      data-slot={pick.slot}
      data-owner-roster={pick.ownerRosterId ?? ''}
      data-testid={`draft-board-cell-${pick.overall}`}
      data-recent={isRecentPick ? 'true' : 'false'}
      data-current={isCurrentPick ? 'true' : 'false'}
      role="group"
      aria-label={ariaLabel}
    >
      {onCommissionerEditPick ? (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation()
            onCommissionerEditPick()
          }}
          data-testid={`draft-board-cell-commish-edit-${pick.overall}`}
          title={`Edit pick ${pick.overall}`}
          aria-label={`Edit pick ${pick.overall}`}
          /* Hover/focus-only on desktop to keep the tile clean; always visible on touch screens. */
          className="absolute left-0.5 top-0.5 z-[2] inline-flex h-5 w-5 items-center justify-center rounded bg-black/45 text-amber-100 opacity-60 transition duration-150 hover:bg-black/65 hover:opacity-100 focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-300/50 active:scale-90 md:opacity-0 md:group-hover:opacity-100 md:group-focus-within:opacity-100"
        >
          <Pencil className="h-3 w-3" />
        </button>
      ) : null}
      {onTradeFromCell ? (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation()
            onTradeFromCell()
          }}
          data-testid={`draft-board-cell-trade-${pick.overall}`}
          title="Offer pick trade"
          aria-label="Offer pick trade for this slot"
          className="absolute bottom-0.5 right-0.5 z-[1] inline-flex h-5 w-5 items-center justify-center rounded bg-black/45 text-white/80 opacity-80 transition duration-150 hover:bg-black/65 hover:text-white hover:opacity-100 focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400/50 active:scale-90 md:opacity-0 md:group-hover:opacity-100 md:group-focus-within:opacity-100"
        >
          <ArrowLeftRight className="h-3 w-3" />
        </button>
      ) : null}
      {onViewTradeHistory && pick.tradedPickMeta ? (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation()
            onViewTradeHistory()
          }}
          data-testid={`draft-board-cell-history-${pick.overall}`}
          title="View trade history for this pick"
          aria-label="View trade history for this pick"
          className={`absolute ${onTradeFromCell ? 'bottom-0.5 right-6' : 'bottom-0.5 right-0.5'} z-[1] inline-flex h-5 w-5 items-center justify-center rounded bg-black/45 text-amber-200 opacity-80 transition duration-150 hover:bg-black/65 hover:opacity-100 focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-300/50 active:scale-90 md:opacity-0 md:group-hover:opacity-100 md:group-focus-within:opacity-100`}
        >
          <History className="h-3 w-3" />
        </button>
      ) : null}

      {/* Pick number in the corner, as Sleeper does, so it never costs the name a line. */}
      <span
        className={`pointer-events-none absolute right-1.5 top-1 tabular-nums text-[11px] font-bold leading-none ${onFill ? 'text-[#14172a]/70' : 'text-white/65'}`}
        aria-hidden
      >
        {compactLabel}
      </span>

      {hasStatusBadges ? (
        <div className="flex min-w-0 items-center gap-0.5 overflow-hidden pr-8">
          {pick.isKeeper ? <StatusBadge label="K" className="bg-emerald-500/30 text-emerald-100" /> : null}
          {pick.isDevyPick ? <StatusBadge label="D" className="bg-violet-500/30 text-violet-100" /> : null}
          {pick.isCollegePick ? <StatusBadge label="C" className="bg-violet-500/30 text-violet-100" /> : null}
          {pick.isProPick ? <StatusBadge label="P" className="bg-cyan-500/30 text-cyan-100" /> : null}
          {pick.isPromotedFromDevy ? <StatusBadge label="Promoted" className="bg-amber-500/30 text-amber-100" /> : null}
          {showTradeChip ? (
            <span
              className={`max-w-[80px] truncate rounded px-1 text-[11px] font-semibold ${
                showNewOwnerInRed ? 'bg-red-500/25 text-red-100' : 'bg-white/20 text-white'
              }`}
              title={ownerLabel ?? undefined}
            >
              {ownerLabel}
            </span>
          ) : null}
          {isEmpty && isCollegeRound ? (
            <StatusBadge label="College" className="bg-violet-500/30 text-violet-100" />
          ) : isEmpty && isDevyRound ? (
            <StatusBadge label="Devy" className="bg-violet-500/30 text-violet-100" />
          ) : null}
        </div>
      ) : null}

      {isEmpty ? (
        <div className="mt-auto flex min-w-0 items-center justify-between gap-1 text-white/45">
          {emptyCellDirection === 'reverse' ? (
            <ArrowLeft className="h-3 w-3 shrink-0" aria-hidden />
          ) : (
            <ArrowRight className="h-3 w-3 shrink-0" aria-hidden />
          )}
          {pick.tradedPickMeta?.previousOwnerName ? (
            <span
              className="max-w-[70px] shrink-0 truncate text-[11px] text-white/45"
              title={`Originally ${pick.tradedPickMeta.previousOwnerName}`}
            >
              from {pick.tradedPickMeta.previousOwnerName}
            </span>
          ) : null}
        </div>
      ) : (
        <div className={`mt-auto flex min-w-0 items-end gap-1 ${onFill ? 'text-[#14172a]' : 'text-white'}`}>
          <div className="min-w-0 flex-1 leading-none">
            {firstName ? (
              <span className="block truncate pr-7 text-[11px] font-medium leading-[12px] opacity-80" title={pick.playerName ?? undefined}>
                {firstName}
              </span>
            ) : null}
            <span className="block truncate text-[12px] font-extrabold leading-[14px] tracking-tight" title={pick.playerName ?? undefined}>
              {lastName}
            </span>
            <span className="flex min-w-0 items-center gap-1 text-[11px] font-semibold leading-[13px] opacity-75">
              <span className="truncate">
                {(pick.position ?? '—').toString()} - {(pick.team ?? '—').toString()}
                {pick.byeWeek != null && pick.byeWeek > 0 ? ` (${pick.byeWeek})` : ''}
              </span>
              {pick.injuryStatus ? (
                <span className="shrink-0 font-bold text-red-700" title={pick.injuryStatus}>
                  {pick.injuryStatus.slice(0, 1).toUpperCase()}
                </span>
              ) : null}
              {pick.experienceBadge ? (
                <span className="shrink-0 rounded bg-black/20 px-0.5 text-[11px] font-bold uppercase">
                  {pick.experienceBadge}
                </span>
              ) : null}
              {pick.amount != null && pick.amount > 0 ? (
                <span className="inline-flex shrink-0 items-center gap-0.5 rounded bg-black/20 px-0.5 font-bold tabular-nums">
                  <Gavel className="h-2.5 w-2.5" aria-hidden />${pick.amount}
                </span>
              ) : null}
              {pick.adpDelta != null && pick.adpDelta !== 0 ? (
                <span
                  className="shrink-0 rounded bg-black/25 px-0.5 font-bold tabular-nums"
                  title={
                    pick.adpDelta > 0
                      ? `Taken ${pick.adpDelta} picks after ADP`
                      : `Taken ${Math.abs(pick.adpDelta)} picks before ADP`
                  }
                  data-testid="draft-board-cell-adp-delta"
                >
                  {pick.adpDelta > 0 ? `+${pick.adpDelta}` : `−${Math.abs(pick.adpDelta)}`}
                </span>
              ) : null}
            </span>
          </div>
          {/* Only a real photo: with none, an initials circle read as a dark blob over the name. */}
          {hasRealHeadshot ? (
            <div className="shrink-0 overflow-hidden rounded-full">
              <TinyHeadshot
                name={pick.playerName}
                src={headshotSrc}
                position={pick.position}
                teamLogoUrl={teamLogoSrc}
                teamAbbr={pick.team}
                size={26}
              />
            </div>
          ) : null}
        </div>
      )}
    </div>
  )
}

export const DraftBoardCell = React.memo(DraftBoardCellInner)
