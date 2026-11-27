'use client'

import '@/components/core-app/af-core.css'
import './af-draft-room.css'
import { useState, useEffect, useMemo } from 'react'
import { Pencil } from 'lucide-react'
import type { AuctionSessionSnapshot, AuctionState, DraftPickSnapshot } from '@/lib/live-draft-engine/types'
import { getAuctionMaxBid } from '@/lib/mock-draft/draft-engine'
import { useMessages } from '@/components/i18n/useMessages'
import { draftRoomRedesignMessages } from '@/lib/core-app/messages/draftRoomRedesign'
import { auctionBidLadderMessages } from '@/lib/core-app/messages/auctionBidLadder'
import { auctionBidPlayerKey, ladderFor } from '@/lib/draft-room/auctionBidLadder'
import { AuctionBidLadder, useAuctionBidHistory } from './AuctionBidLadder'
import { PlayerAvatar } from './PlayerAvatar'
import { DraftPlayerFace } from './DraftPlayerFace'

export type AuctionQueuePick = { playerName: string; position: string; team?: string | null; playerId?: string | null; byeWeek?: number | null }

export type AuctionSpotlightPanelProps = {
  auction: AuctionSessionSnapshot
  currentUserRosterId: string | null
  isCommissioner: boolean
  onNominate: (player: AuctionQueuePick) => void
  onBid: (amount: number) => void
  onResolve: () => void
  timerRemainingSeconds: number | null
  timerStatus: 'running' | 'paused' | 'expired' | 'none'
  nominateLoading?: boolean
  bidLoading?: boolean
  resolveLoading?: boolean
  /** When true (incomplete roster schema), hide bid controls even if a nomination is live. */
  rosterGateBlocksAuctionActions?: boolean
  /** Roster size (the session's round count). With `picks`, gives each team's open spots and max bid. */
  rosterSize?: number | null
  /** Picks so far: open spots per team, and the "Recently won" list (picks carrying a winning bid). */
  picks?: DraftPickSnapshot[] | null
  /** The league's minimum bid; the server reserves this much per open spot. */
  minimumBid?: number
  /**
   * The league whose bid history to show. Without it no history is read and no ladder is drawn
   * (the history route is per league).
   */
  leagueId?: string | null
  /** The viewer's queue, best first — offered as one-tap nominations when it is their turn. */
  queue?: AuctionQueuePick[] | null
  /**
   * Length of a full bid clock, when known. A short clock (the mock's) scales "going once / twice"
   * to its own length instead of calling them for the whole lot.
   */
  bidClockSeconds?: number | null
  /**
   * The nominated player's photo and club crest, looked up from the player pool by the parent (the
   * nomination itself carries only name, position and team). Missing either, the shared avatar falls
   * back to initials and the team abbreviation.
   */
  nominationMedia?: { headshotUrl: string | null; teamLogoUrl: string | null } | null
  /** The draft's sport, for the crest beside each recent win (registry crest, else the abbreviation). */
  sport?: string | null
}

export type AuctionTeamLine = {
  rosterId: string
  displayName: string
  left: number
  /** Null when the roster size is unknown, so no max is drawn rather than a wrong one. */
  max: number | null
  spots: number | null
  /** Share of the starting budget still unspent, 0–100. */
  leftPct: number
}

/**
 * Budget, max bid and open spots per team, in nomination order. Max bid is the server's own rule
 * (`getAuctionMaxBid`): keep the minimum bid in reserve for every open spot after this one.
 */
export function buildAuctionTeamLines(input: {
  auction: Pick<AuctionSessionSnapshot, 'nominationOrder' | 'budgets' | 'budgetPerTeam'>
  rosterSize?: number | null
  picks?: Pick<DraftPickSnapshot, 'rosterId' | 'playerName'>[] | null
  minimumBid?: number
}): AuctionTeamLine[] {
  const filled = new Map<string, number>()
  for (const pick of input.picks ?? []) {
    if (!pick.playerName?.trim()) continue
    filled.set(pick.rosterId, (filled.get(pick.rosterId) ?? 0) + 1)
  }
  const total = input.auction.budgetPerTeam > 0 ? input.auction.budgetPerTeam : 1
  return input.auction.nominationOrder.map((entry) => {
    const left = input.auction.budgets[entry.rosterId] ?? input.auction.budgetPerTeam
    const spots = input.rosterSize != null && input.rosterSize > 0 ? Math.max(0, input.rosterSize - (filled.get(entry.rosterId) ?? 0)) : null
    const max = spots == null ? null : getAuctionMaxBid({ budget: left, rosterSlotsRemaining: spots, minimumBid: input.minimumBid ?? 1 })
    return {
      rosterId: entry.rosterId,
      displayName: entry.displayName ?? '—',
      left,
      max,
      spots,
      leftPct: Math.max(0, Math.min(100, Math.round((left / total) * 100))),
    }
  })
}

/**
 * Nomination turns until the viewer nominates: 0 means it is their turn now. While a player is on
 * the block the current index is the team that nominated it, so the viewer's own live nomination
 * counts as a full lap away. Null for a spectator.
 */
export function nominationTurnsUntil(input: {
  order: { rosterId: string }[]
  currentIndex: number
  viewerRosterId: string | null
  nominationLive: boolean
}): number | null {
  const n = input.order.length
  if (!input.viewerRosterId || n === 0) return null
  const mine = input.order.findIndex((e) => e.rosterId === input.viewerRosterId)
  if (mine < 0) return null
  const current = ((input.currentIndex % n) + n) % n
  const turns = (mine - current + n) % n
  return turns === 0 && input.nominationLive ? n : turns
}

/** The next `count` nominators after the current one, in order (wrapping). */
export function upcomingNominators<T extends { rosterId: string }>(order: T[], currentIndex: number, count: number): T[] {
  const n = order.length
  if (n === 0) return []
  const out: T[] = []
  for (let i = 1; i <= Math.min(count, n - 1); i += 1) out.push(order[(((currentIndex + i) % n) + n) % n]!)
  return out
}

/** Auction-clock urgency words for the last ten seconds; null otherwise. */
export function goingCall(remaining: number | null, status: AuctionSpotlightPanelProps['timerStatus'], clockSeconds?: number | null): 'once' | 'twice' | null {
  if (status !== 'running' || remaining == null || remaining <= 0) return null
  const once = clockSeconds != null && clockSeconds > 0 ? Math.min(10, Math.floor(clockSeconds / 2)) : 10
  const twice = clockSeconds != null && clockSeconds > 0 ? Math.min(5, Math.floor(clockSeconds / 4)) : 5
  if (remaining <= twice) return 'twice'
  if (remaining <= once) return 'once'
  return null
}

/** Shared bid maths for the stage and the phone dock. */
export function useAuctionBidding(props: Pick<AuctionSpotlightPanelProps, 'auction' | 'currentUserRosterId' | 'rosterGateBlocksAuctionActions' | 'rosterSize' | 'picks' | 'minimumBid'>) {
  const { auction, currentUserRosterId, rosterGateBlocksAuctionActions = false, rosterSize = null, picks = null, minimumBid = 1 } = props
  const state: AuctionState = auction.auctionState
  const nomination = state.currentNomination
  const minNextBid = state.minNextBid ?? 1
  const myBudget = currentUserRosterId != null ? (auction.budgets[currentUserRosterId] ?? 0) : 0
  const teamLines = useMemo(() => buildAuctionTeamLines({ auction, rosterSize, picks, minimumBid }), [auction, rosterSize, picks, minimumBid])
  const mine = teamLines.find((line) => line.rosterId === currentUserRosterId) ?? null
  const myMax = mine?.max ?? null
  const leading = nomination != null && currentUserRosterId != null && state.currentBidderRosterId === currentUserRosterId
  const canBid = !rosterGateBlocksAuctionActions && nomination != null && currentUserRosterId != null && myBudget >= minNextBid
  const nextOne = Math.max(minNextBid, state.currentBid + 1)
  const nextFive = Math.max(minNextBid, state.currentBid + 5)
  const withinMax = (amount: number) => myMax == null || amount <= myMax
  return { state, nomination, minNextBid, myBudget, teamLines, mine, myMax, leading, canBid, nextOne, nextFive, withinMax }
}

/**
 * The live auction stage (2026-11-15 redesign): one compact block that always answers "what do I do
 * right now?" — bid, you're winning, your nomination, or who just won. Budgets and recent wins live
 * in `AuctionTeamsPanel` (the Teams tab on desktop, a fold on phone) so the player pool stays in
 * view. The pick clock is the top bar's; this block adds only "going once / twice" near the end.
 */
export function AuctionSpotlightPanel(props: AuctionSpotlightPanelProps) {
  const {
    auction,
    currentUserRosterId,
    isCommissioner,
    onNominate,
    onBid,
    onResolve,
    timerRemainingSeconds,
    timerStatus,
    nominateLoading = false,
    bidLoading = false,
    resolveLoading = false,
    picks = null,
    leagueId = null,
    queue = null,
  } = props
  const m = useMessages(draftRoomRedesignMessages)
  const bidding = useAuctionBidding(props)
  const { state, nomination, minNextBid, myBudget, mine, myMax, leading, canBid, nextOne, nextFive, withinMax } = bidding
  const [bidAmount, setBidAmount] = useState(() => String(minNextBid))
  const currentNominator = auction.nominationOrder[state.nominationOrderIndex]
  const isMyTurnToNominate = currentUserRosterId != null && currentNominator?.rosterId === currentUserRosterId
  const turns = nominationTurnsUntil({
    order: auction.nominationOrder,
    currentIndex: state.nominationOrderIndex,
    viewerRosterId: currentUserRosterId,
    nominationLive: nomination != null,
  })
  const nameOf = (rosterId: string | null | undefined) => auction.nominationOrder.find((e) => e.rosterId === rosterId)?.displayName ?? '—'
  const lastSale = useMemo(
    () => (picks ?? []).filter((p) => p.amount != null && p.playerName.trim()).sort((a, b) => b.overall - a.overall)[0] ?? null,
    [picks],
  )

  useEffect(() => {
    setBidAmount(String(minNextBid))
  }, [minNextBid])

  const blockKey = nomination ? auctionBidPlayerKey(nomination) : ''
  const bidHistory = useAuctionBidHistory(leagueId, `${blockKey}|${state.currentBid}|${state.currentBidderRosterId ?? ''}|${picks?.length ?? 0}`)
  const blockLadder = useMemo(() => (blockKey ? ladderFor(bidHistory, blockKey).slice(0, 8) : []), [bidHistory, blockKey])

  const placeBid = (amount: number) => {
    if (!Number.isNaN(amount) && amount >= minNextBid) onBid(amount)
  }
  const handleBid = () => {
    const amt = parseInt(bidAmount, 10)
    if (!Number.isNaN(amt) && amt >= minNextBid) {
      onBid(amt)
      setBidAmount(String(amt + 1))
    }
  }

  const timerExpired = timerStatus === 'expired' || (timerRemainingSeconds != null && timerRemainingSeconds <= 0)
  const showResolve = (timerExpired || isCommissioner) && nomination != null
  const call = goingCall(timerRemainingSeconds, timerStatus, props.bidClockSeconds)
  const upcoming = upcomingNominators(auction.nominationOrder, state.nominationOrderIndex, 5)
  const queuePicks = (queue ?? []).slice(0, 3)
  const stageState = nomination ? (leading ? 'leading' : 'bidding') : isMyTurnToNominate ? 'nominate' : 'waiting'

  return (
    <section className="af-core af-dr flex flex-col gap-2.5 px-3 pb-2.5 pt-2.5 text-white md:px-4" aria-label={m.auctionAria} data-auction-spotlight data-stage={stageState}>
      {currentUserRosterId != null ? (
        <p className="m-0 flex flex-wrap items-center gap-x-2 gap-y-0.5 px-1 text-[13px] text-white/75" data-testid="auction-viewer-stats">
          <b className="text-white">{m.youLabel}:</b>
          <span>
            <b className="text-emerald-300">{m.viewerLeft(myBudget, auction.budgetPerTeam)}</b>
          </span>
          {myMax != null ? (
            <span>
              · <span data-testid="auction-viewer-max-bid">{m.viewerMax(myMax)}</span>
            </span>
          ) : null}
          {mine?.spots != null ? <span>· {m.viewerSpots(mine.spots)}</span> : null}
          {turns != null ? (
            <span className={turns === 0 ? 'font-bold text-cyan-300' : ''}>
              · <span data-testid="auction-viewer-nominate-in">{m.viewerNominate(turns)}</span>
            </span>
          ) : null}
        </p>
      ) : null}

      {/* ── The stage ─────────────────────────────────────────────────────── */}
      <div
        className={`rounded-2xl border px-4 py-3 md:px-5 md:py-4 ${
          stageState === 'leading'
            ? 'border-emerald-400/60 bg-[linear-gradient(90deg,rgba(16,185,129,0.10),transparent_60%),#0b1426]'
            : stageState === 'nominate'
              ? 'border-cyan-400 bg-[#0b1426]'
              : 'border-white/10 bg-[#0b1426]'
        }`}
        data-testid="auction-stage"
        data-state={stageState}
      >
        {nomination ? (
          <div className="grid items-center gap-3 md:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)_auto] md:gap-5">
            <div className="flex min-w-0 items-center gap-3">
              <PlayerAvatar
                headshotUrl={props.nominationMedia?.headshotUrl ?? null}
                displayName={nomination.playerName}
                teamLogoUrl={props.nominationMedia?.teamLogoUrl ?? null}
                teamAbbr={nomination.team}
                position={nomination.position}
                size={48}
                testIdBase="auction-nomination-avatar"
              />
              <span className="flex min-w-0 flex-col">
                <span className="text-[11px] font-extrabold uppercase tracking-[0.12em] text-white/50">
                  {currentNominator?.displayName ? m.nominatedBy(currentNominator.displayName) : m.onTheBlock}
                </span>
                <span className="truncate text-xl font-extrabold">{nomination.playerName}</span>
                <span className="text-xs text-white/65">{[nomination.position, nomination.team].filter(Boolean).join(' · ')}</span>
              </span>
            </div>

            <div className="flex items-baseline gap-3 md:flex-col md:items-start md:gap-0.5">
              <span className="text-[34px] font-extrabold leading-none text-emerald-300" data-testid="auction-current-bid">
                {state.currentBid > 0 ? `$${state.currentBid}` : '—'}
              </span>
              <span className={`text-[13px] ${leading ? 'font-bold text-emerald-300' : 'text-white/75'}`} data-testid="auction-highest-bidder">
                {leading ? m.youLead : state.currentBidderRosterId ? m.highBidder(nameOf(state.currentBidderRosterId)) : m.noBidsYet}
              </span>
              {timerStatus === 'paused' ? <span className="text-xs font-bold text-white/60">{m.paused}</span> : null}
            </div>

            <div className="flex flex-col items-stretch gap-2 md:items-end">
              {leading ? (
                <div className="flex flex-col md:items-end" data-testid="auction-leading">
                  {/* Phone: the bid dock carries "going once" — say it once. */}
                  {call ? (
                    <span className="hidden text-xs font-extrabold uppercase tracking-[0.06em] text-amber-300 md:inline" aria-live="polite">
                      {call === 'twice' ? m.goingTwice : m.goingOnce}
                    </span>
                  ) : null}
                  <span className="text-[13px] text-white/70">
                    {m.afterWin(myBudget - state.currentBid, mine?.spots != null ? Math.max(0, mine.spots - 1) : null)}
                  </span>
                </div>
              ) : canBid ? (
                /* On phone the same controls live in the pinned bid dock (AuctionBidDock). */
                <div className="hidden items-center gap-2 md:flex">
                  {call ? (
                    <span className="mr-1 text-xs font-extrabold uppercase tracking-[0.06em] text-amber-300" aria-live="polite">
                      {call === 'twice' ? m.goingTwice : m.goingOnce}
                    </span>
                  ) : null}
                  <button
                    type="button"
                    onClick={() => placeBid(nextFive)}
                    disabled={bidLoading || !withinMax(nextFive)}
                    className="flex min-h-[52px] flex-col items-center justify-center rounded-xl border border-[#2c3a57] bg-[#111c31] px-4 text-[15px] font-extrabold disabled:opacity-40"
                    data-testid="auction-quick-bid-5"
                  >
                    {m.plusFive}
                    <small className="text-[11px] font-semibold text-white/55">${nextFive}</small>
                  </button>
                  <label className="flex flex-col rounded-xl border border-[#2c3a57] bg-[#070c18] px-3 py-1.5">
                    <span className="text-[11px] text-white/55">{m.customBid}</span>
                    <input
                      type="number"
                      min={minNextBid}
                      max={myMax ?? undefined}
                      value={bidAmount}
                      onChange={(e) => setBidAmount(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') handleBid()
                      }}
                      aria-label={m.bidAmountAria}
                      className="w-16 border-0 bg-transparent text-base font-extrabold text-white outline-none"
                      data-testid="auction-bid-input"
                    />
                  </label>
                  <button
                    type="button"
                    onClick={handleBid}
                    disabled={bidLoading}
                    className="min-h-[52px] rounded-xl border border-[#2c3a57] bg-[#111c31] px-3 text-sm font-bold disabled:opacity-40"
                    data-testid="auction-bid-button"
                  >
                    {bidLoading ? m.bidding : m.customBidSend}
                  </button>
                  <button
                    type="button"
                    onClick={() => placeBid(nextOne)}
                    disabled={bidLoading || !withinMax(nextOne)}
                    className="min-h-[56px] rounded-2xl bg-cyan-400 px-6 text-[17px] font-extrabold text-[#04121a] hover:bg-cyan-300 disabled:opacity-40"
                    data-testid="auction-quick-bid-1"
                  >
                    {m.bidCta(nextOne)}
                  </button>
                </div>
              ) : null}
              {showResolve ? (
                <div className="flex items-center gap-1.5 md:justify-end">
                  {isCommissioner ? <span className="text-[11px] text-white/50">{m.commissionerOnly}</span> : null}
                  <button
                    type="button"
                    onClick={onResolve}
                    disabled={resolveLoading}
                    className="min-h-[36px] rounded-lg border border-amber-600 px-3 text-xs font-bold text-amber-200 disabled:opacity-50"
                    data-testid="auction-resolve-button"
                  >
                    {resolveLoading ? m.bidding : !isCommissioner ? m.resolve : state.currentBidderRosterId ? m.sellNow : m.passNow}
                  </button>
                </div>
              ) : null}
            </div>
          </div>
        ) : (
          <div className="flex flex-col gap-2.5">
            {lastSale ? (
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1" data-testid="auction-last-sale">
                <span className="font-mono text-lg font-extrabold tracking-[0.12em] text-amber-300">{m.soldTag}</span>
                <span className="text-base font-extrabold">{m.soldLine(lastSale.playerName, lastSale.displayName ?? nameOf(lastSale.rosterId))}</span>
                <span className="text-[13px] text-white/65">{m.soldFor(lastSale.amount ?? 0)}</span>
              </div>
            ) : null}
            {isMyTurnToNominate ? (
              <div className="flex flex-col gap-2" data-testid="auction-nominate-step">
                <div className="flex items-baseline gap-3">
                  <span className="text-xl font-extrabold">{m.yourTurnTitle}</span>
                  {timerStatus === 'running' && timerRemainingSeconds != null ? (
                    <span className="text-[15px] font-extrabold text-cyan-300" data-testid="auction-nomination-timer">
                      {m.nominationWindow(timerRemainingSeconds)}
                    </span>
                  ) : null}
                </div>
                {queuePicks.length > 0 ? (
                  <>
                    <span className="text-[11px] font-extrabold uppercase tracking-[0.12em] text-white/50">{m.fromYourQueue}</span>
                    <div className="flex flex-wrap gap-2">
                      {queuePicks.map((p, i) => (
                        <button
                          key={`${p.playerName}-${i}`}
                          type="button"
                          onClick={() => onNominate(p)}
                          disabled={nominateLoading}
                          className="flex min-h-[48px] flex-col items-start justify-center rounded-xl border border-[#2c3a57] bg-[#111c31] px-3 text-left text-sm font-bold hover:border-cyan-400 disabled:opacity-50"
                          data-testid={`auction-nominate-queue-${i}`}
                        >
                          {m.nominatePlayer(p.playerName)}
                          <small className="text-[11px] font-semibold text-white/55">{[p.position, p.team].filter(Boolean).join(' · ')}</small>
                        </button>
                      ))}
                    </div>
                  </>
                ) : null}
                <span className="text-[13px] text-white/60">{queuePicks.length > 0 ? m.orUsePool : m.yourTurnNominate}</span>
              </div>
            ) : (
              <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                <span className="text-sm text-white/75">
                  {lastSale && currentNominator?.displayName
                    ? m.nextNominates(currentNominator.displayName)
                    : currentNominator?.displayName
                      ? m.waitingFor(currentNominator.displayName)
                      : m.waitingForUnknown}
                </span>
                {timerStatus === 'running' && timerRemainingSeconds != null ? (
                  <span className="text-[13px] text-white/55" data-testid="auction-nomination-timer">
                    {m.nominationWindow(timerRemainingSeconds)}
                  </span>
                ) : null}
              </div>
            )}
          </div>
        )}
      </div>

      {nomination && blockLadder.length > 0 ? (
        <AuctionBidLadder bids={blockLadder} playerName={nomination.playerName} nameOf={nameOf} testId="auction-block-ladder" />
      ) : null}

      <div className="flex flex-wrap items-center gap-1.5 px-1" role="list" aria-label={m.nominationOrderAria}>
        <span className="mr-1 text-[11px] font-extrabold uppercase tracking-[0.12em] text-white/50" data-testid="auction-current-nominator">
          {m.nominatorLabel}: {currentNominator?.displayName ?? '—'}
        </span>
        {upcoming.length > 0 ? <span className="text-[11px] text-white/40">· {m.nominatingNext}</span> : null}
        {upcoming.map((entry) => {
          const me = entry.rosterId === currentUserRosterId
          return (
            <span
              key={entry.rosterId}
              role="listitem"
              className={`whitespace-nowrap rounded-full border px-2.5 py-0.5 text-xs ${me ? 'border-cyan-400 font-bold text-cyan-200' : 'border-[#22304a] text-white/75'}`}
              title={entry.displayName ?? undefined}
            >
              {me ? m.youLabel : entry.displayName ?? '—'}
            </span>
          )
        })}
      </div>

      {/* Phone: budgets fold here (desktop has the Teams tab). */}
      <details className="rounded-xl border border-white/10 bg-[#0b1426] px-3 py-2 md:hidden" data-testid="auction-teams-fold">
        <summary className="min-h-[36px] cursor-pointer text-sm font-bold text-white/85">{m.teamsFold}</summary>
        <AuctionTeamsPanel {...props} />
      </details>
    </section>
  )
}

/**
 * Every team's budget, max bid and open spots, and the recent winning bids with their ladders.
 * Moved out of the stage (2026-11-15) so the player pool stays in view: the Teams tab on desktop,
 * a fold on phone.
 */
export function AuctionTeamsPanel(props: AuctionSpotlightPanelProps) {
  const { auction, currentUserRosterId, picks = null, leagueId = null } = props
  const m = useMessages(draftRoomRedesignMessages)
  const lm = useMessages(auctionBidLadderMessages)
  const { teamLines } = useAuctionBidding(props)
  const nameOf = (rosterId: string | null | undefined) => auction.nominationOrder.find((e) => e.rosterId === rosterId)?.displayName ?? '—'
  const recentWins = useMemo(
    () =>
      (picks ?? [])
        .filter((p) => p.amount != null && p.playerName.trim())
        .sort((a, b) => b.overall - a.overall)
        .slice(0, 6),
    [picks],
  )
  const bidHistory = useAuctionBidHistory(leagueId, `${picks?.length ?? 0}`)

  return (
    <div className="af-core af-dr flex flex-col gap-3 py-2 text-white">
      <div className="af-dr-card" data-testid="auction-budgets">
        <div className="af-dr-card-head">
          <h3 className="af-dr-card-title">{m.budgets}</h3>
          <span className="af-dr-label">{m.budgetCols}</span>
        </div>
        {teamLines.map((line) => (
          <div key={line.rosterId} className="af-dr-budget" data-me={line.rosterId === currentUserRosterId ? 'true' : undefined}>
            <div className="af-dr-row">
              <span className="af-dr-row-name">{line.rosterId === currentUserRosterId ? `${line.displayName} · ${m.you}` : line.displayName}</span>
              <span className="af-dr-budget-nums">
                <strong>${line.left}</strong>
                {line.max != null ? <span>${line.max}</span> : null}
                {line.spots != null ? <span>{m.spotsLeft(line.spots)}</span> : null}
              </span>
            </div>
            <div className="af-dr-track" aria-hidden>
              <span style={{ width: `${line.leftPct}%` }} />
            </div>
          </div>
        ))}
      </div>
      {recentWins.length > 0 ? (
        <div className="af-dr-card" data-testid="auction-recently-won">
          <div className="af-dr-card-head">
            <h3 className="af-dr-card-title">{m.recentlyWon}</h3>
          </div>
          {recentWins.map((pick) => {
            const ladder = ladderFor(bidHistory, auctionBidPlayerKey(pick))
            return (
              <div key={pick.id} className="af-dr-won">
                <div className="af-dr-row">
                  <DraftPlayerFace name={pick.playerName} headshotUrl={pick.playerImageUrl} team={pick.team} position={pick.position} sport={props.sport} size={28} testIdBase="auction-win-face" />
                  <span style={{ minWidth: 0, flex: '1 1 auto' }}>
                    <span className="af-dr-row-name" style={{ display: 'block' }}>
                      {pick.playerName}
                    </span>
                    <span className="af-dr-row-sub">{[pick.position, pick.team, pick.displayName ?? nameOf(pick.rosterId)].filter(Boolean).join(' · ')}</span>
                  </span>
                  <span className="af-dr-num" style={{ fontWeight: 800, color: 'var(--text)' }}>
                    ${pick.amount}
                  </span>
                </div>
                {ladder.length > 0 ? (
                  <details className="af-dr-ladder-fold" data-testid="auction-won-ladder">
                    <summary className="af-dr-ladder-summary">
                      {lm.title} · {lm.show(ladder.length)}
                    </summary>
                    <AuctionBidLadder bids={ladder} playerName={pick.playerName} nameOf={nameOf} testId="auction-won-ladder-list" />
                  </details>
                ) : null}
              </div>
            )
          })}
        </div>
      ) : null}
    </div>
  )
}

/**
 * Phone bid controls pinned above the tray, so Bid is never off-screen or under a floating button.
 * Renders nothing unless the viewer can bid on a live nomination; while they lead it shows that
 * instead of buttons (no bidding against yourself).
 */
export function AuctionBidDock(props: AuctionSpotlightPanelProps) {
  const { onBid, bidLoading = false, timerRemainingSeconds, timerStatus } = props
  const m = useMessages(draftRoomRedesignMessages)
  const { nomination, minNextBid, myMax, leading, canBid, nextOne, nextFive, withinMax, state } = useAuctionBidding(props)
  const [custom, setCustom] = useState<string | null>(null)
  if (!nomination || (!canBid && !leading)) return null
  const call = goingCall(timerRemainingSeconds, timerStatus, props.bidClockSeconds)
  if (leading) {
    return (
      <div className="flex min-h-[56px] items-center justify-between gap-3 rounded-2xl border border-emerald-400/60 bg-[#0b1f1a] px-4" role="status" data-testid="auction-dock-leading">
        <span className="text-[15px] font-extrabold text-emerald-300">
          {m.youLead} · ${state.currentBid}
        </span>
        {call ? <span className="text-xs font-extrabold uppercase text-amber-300">{call === 'twice' ? m.goingTwice : m.goingOnce}</span> : null}
      </div>
    )
  }
  const submitCustom = () => {
    const amt = parseInt(custom ?? '', 10)
    if (!Number.isNaN(amt) && amt >= minNextBid) onBid(amt)
    setCustom(null)
  }
  return (
    <div className="flex items-stretch gap-2 rounded-2xl border border-white/10 bg-[#0d1628] p-2 shadow-[0_-8px_24px_rgba(0,0,0,0.35)]" role="group" aria-label={m.bid} data-testid="auction-bid-dock">
      {custom != null ? (
        <>
          <input
            type="number"
            inputMode="numeric"
            autoFocus
            min={minNextBid}
            max={myMax ?? undefined}
            value={custom}
            onChange={(e) => setCustom(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') submitCustom()
            }}
            aria-label={m.customBidAria}
            className="min-h-[52px] min-w-0 flex-1 rounded-xl border border-[#2c3a57] bg-[#070c18] px-3 text-lg font-extrabold text-white outline-none"
            data-testid="auction-dock-custom-input"
          />
          <button type="button" onClick={submitCustom} disabled={bidLoading} className="min-h-[52px] rounded-xl bg-cyan-400 px-5 text-base font-extrabold text-[#04121a]" data-testid="auction-dock-custom-send">
            {m.customBidSend}
          </button>
        </>
      ) : (
        <>
          <button
            type="button"
            onClick={() => onBid(nextFive)}
            disabled={bidLoading || !withinMax(nextFive)}
            className="flex min-h-[52px] flex-col items-center justify-center rounded-xl border border-[#2c3a57] bg-[#111c31] px-3.5 text-[15px] font-extrabold text-white disabled:opacity-40"
            data-testid="auction-dock-plus5"
          >
            {m.plusFive}
            <small className="text-[11px] font-semibold text-white/55">${nextFive}</small>
          </button>
          <button
            type="button"
            onClick={() => onBid(nextOne)}
            disabled={bidLoading || !withinMax(nextOne)}
            className="min-h-[52px] flex-1 rounded-xl bg-cyan-400 text-lg font-extrabold text-[#04121a] disabled:opacity-40"
            data-testid="auction-dock-bid"
          >
            {call ? `${call === 'twice' ? m.goingTwice : m.goingOnce} ` : ''}
            {m.bidCta(nextOne)}
          </button>
          <button
            type="button"
            onClick={() => setCustom(String(nextOne))}
            aria-label={m.customBidAria}
            className="flex min-h-[52px] w-[52px] items-center justify-center rounded-xl border border-[#2c3a57] bg-[#111c31] text-white"
            data-testid="auction-dock-custom"
          >
            <Pencil className="h-4 w-4" aria-hidden />
          </button>
        </>
      )}
    </div>
  )
}

export default AuctionSpotlightPanel
