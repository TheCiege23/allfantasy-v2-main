'use client'

import React from 'react'
import { ArrowLeft, ArrowLeftRight, ArrowRight, Gavel, History, Pencil } from 'lucide-react'
import { withAlpha } from '@/lib/draft-room'
import { LazyDraftImage } from './LazyDraftImage'
import { PlayerAvatar } from './PlayerAvatar'
import { isDefRowForAvatar } from '@/lib/draft-room/classify-avatar-source'
import { DEFAULT_SPORT, normalizeToSupportedSport } from '@/lib/sport-scope'
import { buildDraftPlayerDisplayModel } from '@/lib/draft-sports-models/build-display-model'
import { normalizePlayer } from '@/lib/players/normalizePlayer'
import { getPlayerImage } from '@/lib/players/getPlayerImage'

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
}

function TinyHeadshot({
  name,
  src,
  position,
  teamLogoUrl,
  teamAbbr,
}: {
  name: string | null
  src: string | null
  /** F.1 — DEF picks render the team logo as the primary avatar. */
  position?: string | null
  /** F.1 — passed only for DEF picks; non-DEF cells keep the existing
   * separate `TinyTeamLogo` badge so the layout doesn't change for normal players. */
  teamLogoUrl?: string | null
  teamAbbr?: string | null
}) {
  /** E.1: delegate to the shared PlayerAvatar so the URL classifier (which rejects data URIs and
   * team logos) is applied uniformly. The board cell stays at 22px and skips the team-logo badge
   * because TinyTeamLogo is rendered separately in this layout. */
  return (
    <PlayerAvatar
      headshotUrl={src}
      displayName={name ?? ''}
      teamLogoUrl={teamLogoUrl}
      teamAbbr={teamAbbr}
      position={position}
      size={22}
      testIdBase="draft-board-cell-headshot"
    />
  )
}

function TinyTeamLogo({
  team,
  src,
}: {
  team: string | null
  src: string | null
}) {
  const [imgError, setImgError] = React.useState(false)
  if (src && !imgError) {
    return (
      <LazyDraftImage
        src={src}
        alt=""
        width={14}
        height={14}
        className="rounded object-contain"
        lazy
        onError={() => setImgError(true)}
      />
    )
  }
  return (
    <span className="inline-flex h-[14px] min-w-[14px] items-center justify-center rounded border border-cyan-300/50 bg-[#1a2844] px-0.5 text-[7px] font-bold text-cyan-100">
      {team ? team.slice(0, 3).toUpperCase() : '—'}
    </span>
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

function highlightClass(tone: PickHighlightTone | undefined): string {
  if (tone === 'user')
    return 'ring-1 ring-amber-400/60 border-amber-400/50 shadow-[0_4px_24px_rgba(251,191,36,0.24)]'
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
    <span className={`inline-flex items-center rounded px-1 py-0.5 text-[8px] font-semibold uppercase tracking-[0.12em] ${className}`}>
      {label}
    </span>
  )
}

function PositionBadge({ pos }: { pos: string | null }) {
  const p = (pos ?? '—').trim().slice(0, 4).toUpperCase()
  return (
    <span
      className="inline-flex min-w-[1.5rem] shrink-0 items-center justify-center rounded-md border border-cyan-300/60 bg-gradient-to-r from-cyan-500/40 to-cyan-400/30 px-1 py-0.5 text-[8px] font-bold text-cyan-100 shadow-lg shadow-cyan-500/20"
      title={pos ?? undefined}
    >
      {p}
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

  const tint =
    tradedPickColorMode && pick.tradedPickMeta?.tintColor
      ? {
          borderColor: withAlpha(pick.tradedPickMeta.tintColor, 0.54),
          backgroundColor: withAlpha(pick.tradedPickMeta.tintColor, 0.16),
        }
      : undefined
  const managerTint =
    !tint && pick.managerTintColor
      ? {
          borderColor: withAlpha(pick.managerTintColor, 0.32),
          backgroundColor: withAlpha(pick.managerTintColor, 0.08),
        }
      : undefined

  const ownerLabel = pick.tradedPickMeta?.newOwnerName ?? pick.displayName ?? null
  const showTradeChip = Boolean(isEmpty && ownerLabel && pick.tradedPickMeta?.newOwnerName)
  const compactLabel = compactPickLabel(pick.pickLabel)

  const ariaLabel = isEmpty
    ? `Draft pick ${compactLabel}, empty slot`
    : `${pick.playerName ?? 'Player'}, ${pick.position ?? ''}, ${pick.team ?? ''}, pick ${compactLabel}`

  const hoverLift = rs && !isEmpty ? 'hover:z-[1] hover:-translate-y-1 hover:scale-[1.015]' : 'hover:z-[1] hover:-translate-y-1 hover:scale-[1.02]'

  return (
    <div
      className={`group relative flex h-[52px] min-h-[52px] flex-col overflow-hidden rounded-md border px-1.5 pb-1 pt-1 text-[10px] backdrop-blur-sm transition-[border-color,box-shadow,transform,background-color] duration-200 ${hoverLift} hover:border-cyan-300/55 hover:shadow-xl sm:h-[56px] sm:min-h-[56px] sm:px-2 sm:pb-1 sm:pt-1 ${
        onTradeFromCell ? 'pr-7 sm:pr-8' : ''
      } ${
        isCurrentPick
          ? rs
            ? 'animate-pulse border-cyan-300/90 bg-[radial-gradient(ellipse_at_50%_0%,rgba(34,211,238,0.35),transparent),linear-gradient(155deg,rgba(34,211,238,0.22),rgba(15,23,42,0.96))] shadow-[0_0_56px_rgba(34,211,238,0.55)] ring-2 ring-cyan-200/70'
            : 'animate-pulse border-cyan-400/95 bg-gradient-to-br from-cyan-500/35 via-[#2a3d5a] to-[#1f2d47] shadow-[0_0_50px_rgba(34,211,238,0.6)] ring-2 ring-cyan-300/80'
          : isRecentPick
            ? rs
              ? 'border-emerald-400/70 bg-gradient-to-br from-emerald-500/28 to-[#142032] ring-1 ring-emerald-400/50 shadow-[0_0_36px_rgba(52,211,153,0.28)]'
              : 'border-emerald-400/80 bg-gradient-to-br from-emerald-500/25 to-[#2a3d5a] ring-1 ring-emerald-400/60 shadow-[0_0_32px_rgba(52,211,153,0.35)]'
            : isEmpty
              ? 'border-transparent bg-[linear-gradient(145deg,rgba(15,23,42,0.45),rgba(8,15,28,0.78))]'
              : `border-cyan-400/35 bg-gradient-to-b from-[#2a3d5a] to-[#1a2844] ${rs ? 'shadow-lg' : 'shadow-xl'} ${highlightClass(pickHighlight)}`
      }`}
      style={tint ?? managerTint}
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
          /* Slice 7 — hover/focus-only on desktop to match Sleeper's clean tile.
             Mobile (no hover) keeps a touch-friendly always-visible tap target via
             `md:opacity-0`: visible by default on small screens, hidden on md+ until
             hover/focus reveals it. */
          className="absolute left-0.5 top-0.5 z-[2] inline-flex h-6 w-6 items-center justify-center rounded-md border border-amber-400/40 bg-amber-500/15 text-amber-100 opacity-90 shadow-sm backdrop-blur-sm transition duration-150 hover:border-amber-300/60 hover:bg-amber-500/30 hover:opacity-100 focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-300/50 active:scale-90 md:opacity-0 md:group-hover:opacity-100 md:group-focus-within:opacity-100"
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
          className="absolute right-0.5 top-0.5 z-[1] inline-flex h-6 w-6 items-center justify-center rounded-md border border-white/14 bg-[#0a1228]/95 text-white/60 opacity-90 shadow-sm backdrop-blur-sm transition duration-150 hover:border-cyan-400/40 hover:text-cyan-100 hover:opacity-100 focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400/50 active:scale-90 md:opacity-0 md:group-hover:opacity-100 md:group-focus-within:opacity-100"
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
          className={`absolute ${onTradeFromCell ? 'right-0.5 top-7' : 'right-0.5 top-0.5'} z-[1] inline-flex h-6 w-6 items-center justify-center rounded-md border border-amber-400/30 bg-amber-500/12 text-amber-200/85 opacity-90 shadow-sm backdrop-blur-sm transition duration-150 hover:border-amber-300/50 hover:text-amber-100 hover:opacity-100 focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-300/50 active:scale-90 md:opacity-0 md:group-hover:opacity-100 md:group-focus-within:opacity-100`}
        >
          <History className="h-3 w-3" />
        </button>
      ) : null}
      <div
        className="pointer-events-none absolute inset-x-0 top-0 h-px"
        style={{ backgroundColor: withAlpha(pick.managerTintColor ?? '#94a3b8', isCurrentPick ? 0.78 : 0.38) }}
        aria-hidden
      />

      <div className="flex items-start justify-between gap-1">
        <div className="flex min-w-0 flex-wrap items-center gap-0.5">
          {pick.isKeeper ? <StatusBadge label="K" className="bg-emerald-500/25 text-emerald-200" /> : null}
          {pick.isDevyPick ? <StatusBadge label="D" className="bg-violet-500/25 text-violet-200" /> : null}
          {pick.isCollegePick ? <StatusBadge label="C" className="bg-violet-500/25 text-violet-200" /> : null}
          {pick.isProPick ? <StatusBadge label="P" className="bg-cyan-500/25 text-cyan-200" /> : null}
          {pick.isPromotedFromDevy ? <StatusBadge label="Promoted" className="bg-amber-500/25 text-amber-200" /> : null}
          {showTradeChip ? (
            <span
              className={`max-w-[70px] truncate rounded px-1 py-0.5 text-[8px] font-semibold ${
                showNewOwnerInRed ? 'bg-red-500/20 text-red-200' : 'bg-white/20 text-white/95'
              }`}
              title={ownerLabel ?? undefined}
            >
              {ownerLabel}
            </span>
          ) : null}
        </div>

        <span className="tabular-nums text-[11px] font-bold text-white/65" aria-hidden>
          {compactLabel}
        </span>
      </div>

      {isEmpty ? (
        <div className="mt-auto flex min-h-0 flex-1 items-end justify-between gap-1">
          <div className="flex min-w-0 items-center gap-1 text-white/55">
            {emptyCellDirection === 'reverse' ? (
              <ArrowLeft className="h-3 w-3 shrink-0" aria-hidden />
            ) : (
              <ArrowRight className="h-3 w-3 shrink-0" aria-hidden />
            )}
            <span className="truncate text-[9px] font-medium" title={ownerLabel ?? 'Awaiting pick'}>
              {ownerLabel ?? 'Awaiting pick'}
            </span>
            {isCollegeRound ? (
              <StatusBadge label="College" className="shrink-0 bg-violet-500/25 text-violet-200" />
            ) : isDevyRound ? (
              <StatusBadge label="Devy" className="shrink-0 bg-violet-500/25 text-violet-200" />
            ) : null}
          </div>
          {pick.tradedPickMeta?.previousOwnerName ? (
            <span
              className="max-w-[56px] shrink-0 truncate text-[8px] text-white/30"
              title={`Originally ${pick.tradedPickMeta.previousOwnerName}`}
            >
              from {pick.tradedPickMeta.previousOwnerName}
            </span>
          ) : null}
        </div>
      ) : (
        <div className="mt-0.5 flex min-h-0 flex-1 flex-col justify-between gap-1 overflow-hidden">
          <div className="flex min-w-0 items-start gap-1.5">
            <div className="relative shrink-0">
              <TinyHeadshot
                name={pick.playerName}
                src={headshotSrc}
                position={pick.position}
                teamLogoUrl={teamLogoSrc}
                teamAbbr={pick.team}
              />
              {/* F.1 — DEF picks already use the team logo as the primary avatar
                  (see PlayerAvatar's DEF branch). Skip the duplicate corner overlay. */}
              {isDefRowForAvatar(pick.position) ? null : (
                <div className="absolute -bottom-0.5 -right-0.5 rounded border border-white/12 bg-[#232c40] p-px">
                  <TinyTeamLogo team={pick.team} src={teamLogoSrc} />
                </div>
              )}
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-1">
                <span className="truncate font-bold leading-tight text-white/98 text-[11px]" title={pick.playerName ?? undefined}>
                  {pick.playerName}
                </span>
                <PositionBadge pos={pick.position} />
                {pick.experienceBadge ? (
                  <span className="shrink-0 rounded border border-cyan-400/30 bg-cyan-500/12 px-1 py-0.5 text-[7px] font-bold uppercase tracking-wide text-cyan-100/95">
                    {pick.experienceBadge}
                  </span>
                ) : null}
              </div>
              <p className="truncate text-[9px] text-white/60">
                {(pick.team ?? '—').toString()}
                {pick.byeWeek != null && pick.byeWeek > 0 ? ` · Bye ${pick.byeWeek}` : ''}
              </p>
            </div>
          </div>

          {pick.amount != null && pick.amount > 0 ? (
            <span className="inline-flex w-fit items-center gap-1 rounded bg-amber-500/16 px-1.5 py-0.5 text-[8px] font-semibold text-amber-100">
              <Gavel className="h-2.5 w-2.5" aria-hidden />
              ${pick.amount}
            </span>
          ) : null}

          {pick.injuryStatus ? (
            <span className="truncate text-[8px] text-amber-300/90" title={pick.injuryStatus}>
              {pick.injuryStatus}
            </span>
          ) : null}
        </div>
      )}
    </div>
  )
}

export const DraftBoardCell = React.memo(DraftBoardCellInner)
