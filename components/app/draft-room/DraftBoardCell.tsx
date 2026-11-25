'use client'

import React from 'react'
import { ArrowLeft, ArrowLeftRight, ArrowRight, Gavel, History, Lock, Pencil } from 'lucide-react'
import { withAlpha } from '@/lib/draft-room'
import { PlayerAvatar } from './PlayerAvatar'
import { DEFAULT_SPORT, normalizeToSupportedSport } from '@/lib/sport-scope'
import { buildDraftPlayerDisplayModel } from '@/lib/draft-sports-models/build-display-model'
import { normalizePlayer } from '@/lib/players/normalizePlayer'
import { classifyAvatarSource } from '@/lib/draft-room/classify-avatar-source'
import { getPlayerImage } from '@/lib/players/getPlayerImage'
import { positionTintHex } from '@/lib/draft-room/positionTint'
import { useOptionalLanguage } from '@/components/i18n/LanguageProviderClient'
import { useMessages } from '@/components/i18n/useMessages'
import { draftRoomHeaderMessages } from '@/lib/core-app/messages/draftRoomHeader'

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
  /** A kept player pre-assigned to this slot before the draft — not a pick anyone made. */
  isKeeper?: boolean
  /** The kept player belongs to the viewer's roster. */
  isViewerKeeper?: boolean
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
  /** League signature (room v2): the player's age, or a college pick's class year. */
  signatureChip?: { kind: 'age' | 'class'; text: string; title: string } | null
  /** Snake salary-cap signature: the contract this slot is signed to (`loadRookieContractTerms`). */
  slotSalary?: { salary: number; years: number } | null
  /** Keeper league: this kept player's year as a keeper (2+), from the league's keeper history. */
  keeperYear?: number | null
}

function TinyHeadshot({
  name,
  src,
  position,
  teamLogoUrl,
  teamAbbr,
  size = 26,
  badgeSize,
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
  badgeSize?: number
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
      badgeSize={badgeSize}
      testIdBase="draft-board-cell-headshot"
    />
  )
}

export type PickHighlightTone = 'none' | 'user' | 'ai'

type DraftBoardCellProps = {
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
  /** Filled cells: tap the tile to open the player card. The corner buttons stop propagation. */
  onOpenPlayer?: () => void
  /**
   * Survivor signature: the column's tribe colour, drawn as a thin edge along the tile's top. The
   * column header names the tribe, so the colour is never the only cue.
   */
  tribeColor?: string | null
}

/**
 * Room v2 (2026-11): the on-the-clock tile is a dark tile with a cyan border, glow and an "On the
 * clock" label, not a solid fill; your picks keep a thin cyan ring. Before v2:
 *
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
  // Gold = your picks, matching the legend. It was a cyan ring beside a cyan on-the-clock ring
  // and a sky ring on Chimmy-run teams: three near-identical blues for three meanings.
  // A white ring set off by a dark gap: tiles are coloured by POSITION (WR yellow, RB green...),
  // so any coloured ring vanishes on one of them. Measured: gold on a WR tile could not be seen.
  if (tone === 'user') return 'ring-2 ring-white ring-offset-2 ring-offset-[#0b1428]'
  // Chimmy-run teams are marked AUTO in their column header; a fourth ring colour only added noise.
  if (tone === 'ai') return ''
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
  onOpenPlayer,
  tribeColor,
  presentationVariant = 'default',
}: DraftBoardCellProps) {
  const openPlayer = !isEmpty && pick.playerName?.trim() && onOpenPlayer ? onOpenPlayer : undefined
  const { tInterpolate, t } = useOptionalLanguage()
  const headerCopy = useMessages(draftRoomHeaderMessages)
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
  const positionHex = !isEmpty ? positionTintHex(pick.position, sportNorm) : null
  const fillHex = !isEmpty ? positionHex : tradeHex
  /**
   * A kept player was assigned before the draft — nobody picked them. A solid position tile made
   * them indistinguishable from a real pick (the old cue was an 11px "K"), so a keeper is drawn
   * LOCKED instead: dark striped tile, position-coloured edge, light text. The viewer's own keeper
   * adds the accent ring the board already uses for "yours".
   */
  const isKept = Boolean(pick.isKeeper) && !isEmpty
  const keptHex = positionHex ?? '#8b949e'
  const tileStyle: React.CSSProperties | undefined = isKept
    ? {
        backgroundColor: '#101a2e',
        backgroundImage: `repeating-linear-gradient(135deg, ${withAlpha(keptHex, 0.24)} 0 7px, transparent 7px 14px)`,
        boxShadow: pick.isViewerKeeper
          ? `inset 0 0 0 2px ${keptHex}, 0 0 0 2px #22d3ee`
          : `inset 0 0 0 2px ${keptHex}`,
      }
    : fillHex
      ? isEmpty
        ? { backgroundColor: withAlpha(fillHex, 0.22), boxShadow: `inset 0 0 0 1px ${withAlpha(fillHex, 0.55)}` }
        : { backgroundColor: fillHex }
      : undefined
  // Filled tiles carry dark text on the bright position colour. Kept tiles are dark.
  const onFill = !isEmpty && Boolean(positionHex) && !isKept

  const ownerLabel = pick.tradedPickMeta?.newOwnerName ?? pick.displayName ?? null
  const showTradeChip = Boolean(isEmpty && ownerLabel && pick.tradedPickMeta?.newOwnerName)
  /**
   * Provenance survives the pick: a made pick on a traded slot keeps a small "via X" marker (X = the
   * slot's original owner). It sits on the first-name line so the tile keeps its height and its
   * position colour; the trade tint only ever colours EMPTY cells.
   */
  const viaOwner = !isEmpty ? pick.tradedPickMeta?.previousOwnerName?.trim() || null : null
  const compactLabel = compactPickLabel(pick.pickLabel)

  const ariaLabel = isEmpty
    ? `Draft pick ${compactLabel}, empty slot`
    : isKept
      ? `${pick.isViewerKeeper ? 'Your kept player' : 'Kept player'} ${pick.playerName ?? ''}, ${pick.position ?? ''}, ${pick.team ?? ''}, uses pick ${compactLabel}`
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

  /*
   * Tile buttons. Empty tiles keep trade / history bottom-right. A filled tile's text runs to the
   * bottom edge, and below md these buttons are always visible (no hover on touch), so there they
   * move to the top-left corner, which a filled tile leaves free (the pick number is top-right).
   */
  const topLeftStart = onCommissionerEditPick ? 'left-6' : 'left-0.5'
  const tradeSpot = isEmpty ? 'bottom-0.5 right-0.5' : `top-0.5 ${topLeftStart}`
  const historySpot = isEmpty
    ? onTradeFromCell ? 'bottom-0.5 right-6' : 'bottom-0.5 right-0.5'
    : `top-0.5 ${onTradeFromCell ? (onCommissionerEditPick ? 'left-[46px]' : 'left-6') : topLeftStart}`

  const nameParts = (pick.playerName ?? '').trim().split(/\s+/)
  const firstName = nameParts.length > 1 ? nameParts[0] : ''
  const lastName = nameParts.length > 1 ? nameParts.slice(1).join(' ') : nameParts[0] ?? ''

  return (
    <div
      className={`group relative flex h-[68px] w-full flex-col overflow-hidden rounded-lg px-1.5 py-1 text-[11px] [container-type:inline-size] transition-[box-shadow,filter,background-color] duration-150 hover:z-[1] hover:brightness-110 ${
        isCurrentPick ? 'draft-live-current-pick' : isRecentPick ? 'draft-live-recent-pick' : ''
      } ${
        isCurrentPick
          ? 'bg-[radial-gradient(120%_140%_at_0%_0%,color-mix(in_srgb,var(--af-league-accent,#22d3ee)_28%,transparent),#0d1020_62%)] ring-2 ring-[color:var(--af-league-accent,#67e8f9)]'
          : isEmpty
            ? 'bg-[#2a2f45]'
            : `${positionHex ? '' : 'bg-[#3a4160]'} ${isRecentPick ? 'ring-2 ring-emerald-300 ring-offset-2 ring-offset-[#0b1428]' : ''} ${highlightClass(pickHighlight)}`
      }`}
      style={openPlayer ? { ...tileStyle, cursor: 'pointer' } : tileStyle}
      data-overall={pick.overall}
      data-round={pick.round}
      data-slot={pick.slot}
      data-owner-roster={pick.ownerRosterId ?? ''}
      data-testid={`draft-board-cell-${pick.overall}`}
      data-recent={isRecentPick ? 'true' : 'false'}
      data-current={isCurrentPick ? 'true' : 'false'}
      role="group"
      aria-label={ariaLabel}
      data-tribe-color={tribeColor ?? undefined}
      {...(openPlayer
        ? {
            onClick: openPlayer,
            onKeyDown: (event: React.KeyboardEvent<HTMLDivElement>) => {
              if (event.target === event.currentTarget && (event.key === 'Enter' || event.key === ' ')) {
                event.preventDefault()
                openPlayer()
              }
            },
            tabIndex: 0,
            title: `View ${pick.playerName} player card`,
          }
        : {})}
    >
      {tribeColor ? (
        <span
          className="pointer-events-none absolute inset-x-0 top-0 z-[1] h-1 shadow-[0_1px_0_rgba(0,0,0,0.35)]"
          style={{ backgroundColor: tribeColor }}
          aria-hidden
          data-testid={`draft-board-cell-tribe-edge-${pick.overall}`}
        />
      ) : null}
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
          title={t('draftRoom.board.offerPickTrade')}
          aria-label={t('draftRoom.board.offerPickTradeAria')}
          className={`absolute ${tradeSpot} z-[1] inline-flex h-5 w-5 items-center justify-center rounded bg-black/45 text-white/80 opacity-80 transition duration-150 hover:bg-black/65 hover:text-white hover:opacity-100 focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400/50 active:scale-90 md:opacity-0 md:group-hover:opacity-100 md:group-focus-within:opacity-100`}
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
          className={`absolute ${historySpot} z-[1] inline-flex h-5 w-5 items-center justify-center rounded bg-black/45 text-amber-200 opacity-80 transition duration-150 hover:bg-black/65 hover:opacity-100 focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-300/50 active:scale-90 md:opacity-0 md:group-hover:opacity-100 md:group-focus-within:opacity-100`}
        >
          <History className="h-3 w-3" />
        </button>
      ) : null}

      {/* Pick number in the corner, as Sleeper does, so it never costs the name a line.
          /85 on a fill, not /70: at 11px, /70 measured 3.49:1 on the lightest position tints (AA is 4.5:1). */}
      <span
        className={`pointer-events-none absolute right-1.5 top-1 tabular-nums text-[11px] font-bold leading-none ${onFill ? 'text-[#14172a]/85' : 'text-white/65'}`}
        aria-hidden
      >
        {compactLabel}
      </span>

      {hasStatusBadges ? (
        <div className="flex min-w-0 items-center gap-0.5 overflow-hidden pr-8">
          {isKept ? (
            <span
              className="inline-flex shrink-0 items-center gap-0.5 rounded-full px-1.5 py-px font-mono text-[11px] font-extrabold uppercase leading-[13px] tracking-[0.04em] text-[#14172a]"
              style={{ backgroundColor: keptHex }}
              data-testid={`draft-board-cell-keeper-${pick.overall}`}
            >
              <Lock className="h-2.5 w-2.5" strokeWidth={3} aria-hidden />
              {pick.isViewerKeeper ? 'Yours' : 'Kept'}
            </span>
          ) : null}
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

      {isEmpty && isCurrentPick ? (
        <span
          className="pointer-events-none mt-auto self-center text-[11px] font-black uppercase tracking-[0.04em] text-[color:var(--af-league-accent,#67e8f9)]"
          data-testid={`draft-board-cell-on-clock-${pick.overall}`}
        >
          {headerCopy.onTheClock}
        </span>
      ) : null}
      {isEmpty && pick.slotSalary ? (
        <span
          className={`pointer-events-none self-center text-[12px] font-bold leading-none tabular-nums text-white/60 ${isCurrentPick ? 'mt-0.5' : 'mt-auto'}`}
          title={headerCopy.slotSalary(pick.slotSalary.salary, pick.slotSalary.years)}
          aria-label={headerCopy.slotSalary(pick.slotSalary.salary, pick.slotSalary.years)}
          data-testid={`draft-board-cell-slot-salary-${pick.overall}`}
        >
          ${pick.slotSalary.salary}
        </span>
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
              title={tInterpolate('draftRoom.board.originally', { owner: pick.tradedPickMeta.previousOwnerName })}
            >
              {tInterpolate('draftRoom.board.fromOwner', { owner: pick.tradedPickMeta.previousOwnerName })}
            </span>
          ) : null}
        </div>
      ) : (
        /*
         * Room v2 (2026-11): on a phone the photo sits centred at the top of the tile, the name under
         * it as "A. Runner", then position · team. On a desktop board (a tile 150px or wider —
         * `af-tile-*` in globals.css; 2026-11-24, owner's call) the photo and team logo sit on the
         * LEFT and the text on the right. A crowded 12-team board's narrow tiles keep the stack.
         * The logo is the avatar's corner badge, drawn larger than before and no longer clipped by a
         * round frame (it had shrunk to a sliver).
         */
        <div
          className={`af-tile-body flex min-h-0 min-w-0 flex-1 flex-col items-center justify-center gap-px text-center ${onFill ? 'text-[#14172a]' : 'text-white'}`}
          data-testid={`draft-board-cell-body-${pick.overall}`}
        >
          {/* Only a real photo: with none, an initials circle read as a dark blob over the name. A tile
              already carrying a badge row (keeper, devy, trade) gives the photo's height to the text.
              `leading-[0]`: the avatar is an inline-block, so a line box made each wrapper 36px tall for a
              32px photo. Measured 2026-11-25: that left the photo 1.4px from the tile's top edge. */}
          {hasRealHeadshot && !hasStatusBadges ? (
            <div className="shrink-0" data-testid={`draft-board-cell-headshot-wrap-${pick.overall}`}>
              <span className={`af-tile-photo-sm block rounded-full leading-[0] ${onFill ? 'bg-black/15 ring-2 ring-white/40' : 'ring-1 ring-white/20'}`}>
                <TinyHeadshot name={pick.playerName} src={headshotSrc} position={pick.position}
                  teamLogoUrl={teamLogoSrc} teamAbbr={pick.team} size={32} badgeSize={16} />
              </span>
              <span className={`af-tile-photo-lg hidden rounded-full leading-[0] ${onFill ? 'bg-black/15 ring-2 ring-white/40' : 'ring-1 ring-white/20'}`}>
                <TinyHeadshot name={pick.playerName} src={headshotSrc} position={pick.position}
                  teamLogoUrl={teamLogoSrc} teamAbbr={pick.team} size={46} badgeSize={22} />
              </span>
            </div>
          ) : null}
          <div className="af-tile-text flex min-w-0 max-w-full flex-col items-center gap-px">
          {viaOwner ? (
            <span
              className={`max-w-full truncate rounded-[3px] px-0.5 text-[11px] font-semibold leading-[12px] ${onFill ? 'bg-black/20 text-[#14172a]' : 'bg-white/15 text-white'}`}
              title={tInterpolate('draftRoom.board.originally', { owner: viaOwner })}
              data-testid={`draft-board-cell-via-${pick.overall}`}
            >
              {tInterpolate('draftRoom.board.viaOwner', { owner: viaOwner })}
            </span>
          ) : null}
          <span className="af-tile-name block max-w-full truncate text-[12px] leading-[14px] tracking-tight" title={pick.playerName ?? undefined}>
            {/* "A. Runner" for the eye; the full name for screen readers and text search. */}
            <span aria-hidden>
              {firstName ? <span className="font-medium opacity-90">{firstName.slice(0, 1)}. </span> : null}
              <span className="font-extrabold">{lastName}</span>
            </span>
            <span className="sr-only">{pick.playerName}</span>
          </span>
          {/*
            With a league signature chip the line stays ONE row: wrapping it pushed the player's name
            off an 84px tile (measured on phone and portrait tablet). The team truncates first — the
            headshot already carries the team logo.

            ONE row on every tile, chip or not (2026-11-25). A 68px tile holds the photo and two lines
            of text. Without a chip this line used to wrap, and a third line overflowed a stacked tile
            by 13px: the photo rode up over the tile's top edge (seen on a 16-team board, 117px tiles).

            NO ADP GAP HERE ("19 early" / "4 late"; owner's call, 2026-11-25). It was that third line,
            it is the least useful thing on a tile this small, and the recap already names the best
            steal and the biggest reach. `pick.adpDelta` is still passed in; nothing on the tile shows it.
          */}
          <span
            className="flex max-w-full min-w-0 flex-nowrap items-center justify-center gap-x-1 text-[11px] font-semibold leading-[13px] opacity-90 af-tile-info"
            data-testid={`draft-board-cell-info-${pick.overall}`}
          >
            <span className="min-w-0 truncate">
              {(pick.position ?? '—').toString()} · {(pick.team ?? '—').toString()}
            </span>
            {pick.injuryStatus ? (
              <span className="shrink-0 font-bold text-red-700" title={pick.injuryStatus}>
                {pick.injuryStatus.slice(0, 1).toUpperCase()}
              </span>
            ) : null}
            {pick.slotSalary ? (
              <span
                className="shrink-0 rounded bg-black/20 px-0.5 font-bold tabular-nums"
                title={headerCopy.slotSalary(pick.slotSalary.salary, pick.slotSalary.years)}
                aria-label={headerCopy.slotSalary(pick.slotSalary.salary, pick.slotSalary.years)}
                data-testid={`draft-board-cell-salary-${pick.overall}`}
              >
                ${pick.slotSalary.salary}
              </span>
            ) : null}
            {pick.signatureChip ? (
              <span
                className="shrink-0 rounded bg-black/20 px-0.5 font-bold tabular-nums"
                title={pick.signatureChip.title}
                aria-label={pick.signatureChip.title}
                data-testid={`draft-board-cell-signature-${pick.overall}`}
                data-kind={pick.signatureChip.kind}
              >
                {pick.signatureChip.text}
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
          </span>
          {isKept ? (
            <span
              className="block max-w-full truncate text-[11px] font-bold leading-[13px]"
              style={{ color: keptHex }}
              data-testid={`draft-board-cell-keeper-cost-${pick.overall}`}
            >
              {pick.keeperYear ? (
                <>
                  {/* Below 120px "Costs " gives way so the round and the year both fit (globals.css). */}
                  <span className="af-tile-squeezable">{pick.isViewerKeeper ? 'Costs your ' : 'Costs '}</span>
                  {`Rd ${pick.round}`}
                  <span
                    title={headerCopy.keeperYearTitle(pick.keeperYear)}
                    aria-label={headerCopy.keeperYearTitle(pick.keeperYear)}
                    data-testid={`draft-board-cell-keeper-year-${pick.overall}`}
                  >
                    {` · ${headerCopy.keeperYear(pick.keeperYear)}`}
                  </span>
                </>
              ) : pick.isViewerKeeper ? `Costs your Rd ${pick.round}` : `Costs Rd ${pick.round}`}
            </span>
          ) : null}
          </div>
        </div>
      )}
    </div>
  )
}

export const DraftBoardCell = React.memo(DraftBoardCellInner)
