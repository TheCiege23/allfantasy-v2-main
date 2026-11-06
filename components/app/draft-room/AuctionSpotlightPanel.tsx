'use client'

import '@/components/core-app/af-core.css'
import './af-draft-room.css'
import { useState, useEffect, useMemo } from 'react'
import type { AuctionSessionSnapshot, AuctionState, DraftPickSnapshot } from '@/lib/live-draft-engine/types'
import { getAuctionMaxBid } from '@/lib/mock-draft/draft-engine'
import { positionTintHex } from '@/lib/draft-room/positionTint'
import { SKIN_ON_FILL } from '@/lib/draft-room/sleeperSkin'
import { useMessages } from '@/components/i18n/useMessages'
import { draftRoomRedesignMessages } from '@/lib/core-app/messages/draftRoomRedesign'
import { auctionBidLadderMessages } from '@/lib/core-app/messages/auctionBidLadder'
import { auctionBidPlayerKey, ladderFor } from '@/lib/draft-room/auctionBidLadder'
import { AuctionBidLadder, useAuctionBidHistory } from './AuctionBidLadder'

export type AuctionSpotlightPanelProps = {
  auction: AuctionSessionSnapshot
  currentUserRosterId: string | null
  isCommissioner: boolean
  onNominate: (player: { playerName: string; position: string; team?: string | null; playerId?: string | null; byeWeek?: number | null }) => void
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

function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return '—'
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase()
  return `${parts[0]![0]}${parts[parts.length - 1]![0]}`.toUpperCase()
}

export function AuctionSpotlightPanel({
  auction,
  currentUserRosterId,
  isCommissioner,
  onBid,
  onResolve,
  timerRemainingSeconds,
  timerStatus,
  bidLoading = false,
  resolveLoading = false,
  rosterGateBlocksAuctionActions = false,
  rosterSize = null,
  picks = null,
  minimumBid = 1,
  leagueId = null,
}: AuctionSpotlightPanelProps) {
  const m = useMessages(draftRoomRedesignMessages)
  const lm = useMessages(auctionBidLadderMessages)
  const state: AuctionState = auction.auctionState
  const [bidAmount, setBidAmount] = useState(() => String(state.minNextBid ?? 1))
  const nomination = state.currentNomination
  const currentNominator = auction.nominationOrder[state.nominationOrderIndex]
  const isMyTurnToNominate = currentUserRosterId != null && currentNominator?.rosterId === currentUserRosterId
  const minNextBid = state.minNextBid ?? 1
  const myBudget = currentUserRosterId != null ? (auction.budgets[currentUserRosterId] ?? 0) : 0
  const canBid =
    !rosterGateBlocksAuctionActions &&
    state.currentNomination != null &&
    currentUserRosterId != null &&
    myBudget >= minNextBid

  const teamLines = useMemo(
    () => buildAuctionTeamLines({ auction, rosterSize, picks, minimumBid }),
    [auction, rosterSize, picks, minimumBid],
  )
  const mine = teamLines.find((line) => line.rosterId === currentUserRosterId) ?? null
  const myMax = mine?.max ?? null
  const turns = nominationTurnsUntil({
    order: auction.nominationOrder,
    currentIndex: state.nominationOrderIndex,
    viewerRosterId: currentUserRosterId,
    nominationLive: nomination != null,
  })
  const nameOf = (rosterId: string | null | undefined) =>
    auction.nominationOrder.find((e) => e.rosterId === rosterId)?.displayName ?? '—'
  const recentWins = useMemo(
    () =>
      (picks ?? [])
        .filter((p) => p.amount != null && p.playerName.trim())
        .sort((a, b) => b.overall - a.overall)
        .slice(0, 6),
    [picks],
  )

  useEffect(() => {
    setBidAmount(String(minNextBid))
  }, [minNextBid])

  // Refetch the history whenever the auction moves: a new bid, a new player on the block, a sale.
  const blockKey = nomination ? auctionBidPlayerKey(nomination) : ''
  const bidHistory = useAuctionBidHistory(
    leagueId,
    `${blockKey}|${state.currentBid}|${state.currentBidderRosterId ?? ''}|${picks?.length ?? 0}`,
  )
  const blockLadder = useMemo(() => (blockKey ? ladderFor(bidHistory, blockKey).slice(0, 8) : []), [bidHistory, blockKey])

  const withinMax = (amount: number) => myMax == null || amount <= myMax
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
  const nextOne = Math.max(minNextBid, state.currentBid + 1)
  const nextFive = Math.max(minNextBid, state.currentBid + 5)

  const timerExpired = timerStatus === 'expired' || (timerRemainingSeconds != null && timerRemainingSeconds <= 0)
  const showResolve = (timerExpired || isCommissioner) && nomination != null
  const tint = nomination ? positionTintHex(nomination.position) : null

  return (
    <section className="af-core af-dr af-dr-auction" aria-label={m.auctionAria} data-auction-spotlight>
      {currentUserRosterId != null ? (
        <div className="af-dr-stats" data-testid="auction-viewer-stats">
          <div className="af-dr-stat">
            <span className="af-dr-label">{m.statBudget}</span>
            <span className="af-dr-stat-value">{m.statBudgetValue(myBudget, auction.budgetPerTeam)}</span>
          </div>
          <div className="af-dr-stat">
            <span className="af-dr-label">{m.statMaxBid}</span>
            <span className="af-dr-stat-value" data-testid="auction-viewer-max-bid">
              {myMax != null ? `$${myMax}` : '—'}
            </span>
          </div>
          <div className="af-dr-stat" data-tone={turns === 0 ? 'now' : undefined}>
            <span className="af-dr-label">{m.statNominate}</span>
            <span className="af-dr-stat-value" data-testid="auction-viewer-nominate-in">
              {turns == null ? m.nominateNever : turns === 0 ? m.nominateNow : m.nominateIn(turns)}
            </span>
          </div>
        </div>
      ) : null}

      <div className="af-dr-order" role="list" aria-label={m.nominationOrderAria}>
        <span className="af-dr-label" data-testid="auction-current-nominator">
          {m.nominatorLabel}: {currentNominator?.displayName ?? '—'}
        </span>
        {auction.nominationOrder.map((entry) => (
          <span
            key={entry.rosterId}
            role="listitem"
            className="af-dr-order-chip"
            data-current={entry.rosterId === currentNominator?.rosterId ? 'true' : undefined}
            data-me={entry.rosterId === currentUserRosterId ? 'true' : undefined}
            title={entry.displayName ?? undefined}
          >
            {entry.displayName?.slice(0, 10) ?? '—'}
          </span>
        ))}
      </div>

      <div className="af-dr-block">
        <div className="af-dr-block-head">
          <span className="af-dr-label">{m.onTheBlock}</span>
          {timerStatus === 'running' && timerRemainingSeconds != null ? (
            <span className="af-dr-block-clock" aria-live="polite">
              {m.secondsLeft(timerRemainingSeconds)}
            </span>
          ) : timerStatus === 'paused' ? (
            <span className="af-dr-block-clock" data-paused="true">
              {m.paused}
            </span>
          ) : null}
        </div>

        {nomination ? (
          <>
            <div className="af-dr-block-main">
              <div className="af-dr-player">
                <span
                  className="af-dr-avatar"
                  style={tint ? { backgroundColor: tint, color: SKIN_ON_FILL } : { background: 'var(--surface2)', color: 'var(--text)' }}
                  aria-hidden
                >
                  {initialsOf(nomination.playerName)}
                </span>
                <span style={{ minWidth: 0 }}>
                  <span className="af-dr-player-name">{nomination.playerName}</span>
                  <span className="af-dr-player-meta">
                    {[nomination.position, nomination.team].filter(Boolean).join(' · ')}
                  </span>
                </span>
              </div>
              <div className="af-dr-bidbox">
                <span className="af-dr-label">{m.currentBid}</span>
                <span className="af-dr-bid" data-testid="auction-current-bid">
                  {state.currentBid > 0 ? `$${state.currentBid}` : '—'}
                </span>
                <span className="af-dr-bid-leader" data-testid="auction-highest-bidder">
                  {state.currentBidderRosterId ? m.highBidder(nameOf(state.currentBidderRosterId)) : m.noBidsYet}
                </span>
              </div>
            </div>

            {canBid || showResolve ? (
              <div className="af-dr-bids">
                {canBid ? (
                  <>
                    <button
                      type="button"
                      className="af-dr-quick"
                      onClick={() => placeBid(nextOne)}
                      disabled={bidLoading || !withinMax(nextOne)}
                      data-testid="auction-quick-bid-1"
                    >
                      +$1 <small>{m.bidCaps} ${nextOne}</small>
                    </button>
                    <button
                      type="button"
                      className="af-dr-quick"
                      onClick={() => placeBid(nextFive)}
                      disabled={bidLoading || !withinMax(nextFive)}
                      data-testid="auction-quick-bid-5"
                    >
                      +$5 <small>{m.bidCaps} ${nextFive}</small>
                    </button>
                    <div className="af-dr-custom">
                      <label>
                        <span className="af-dr-label">{m.customBid}</span>
                        <input
                          type="number"
                          min={minNextBid}
                          max={myMax ?? undefined}
                          value={bidAmount}
                          onChange={(e) => setBidAmount(e.target.value)}
                          aria-label={m.bidAmountAria}
                          data-testid="auction-bid-input"
                        />
                      </label>
                      <button
                        type="button"
                        className="af-dr-btn"
                        onClick={handleBid}
                        disabled={bidLoading}
                        data-testid="auction-bid-button"
                      >
                        {bidLoading ? m.bidding : m.bid}
                      </button>
                    </div>
                  </>
                ) : null}
                {showResolve ? (
                  <button
                    type="button"
                    className="af-dr-btn"
                    data-variant="resolve"
                    onClick={onResolve}
                    disabled={resolveLoading}
                    data-testid="auction-resolve-button"
                  >
                    {resolveLoading ? m.bidding : isCommissioner ? m.sellOrPass : m.resolve}
                  </button>
                ) : null}
              </div>
            ) : null}

            <p className="af-dr-note">
              {m.minNextBid(minNextBid)}
              {canBid && myMax != null && mine?.spots != null && mine.spots > 0 ? ` · ${m.maxBidNote(myMax, mine.spots, minimumBid)}` : ''}
            </p>

            <AuctionBidLadder bids={blockLadder} playerName={nomination.playerName} nameOf={nameOf} testId="auction-block-ladder" />
          </>
        ) : (
          <div>
            <p className="af-dr-waiting">
              {isMyTurnToNominate
                ? m.yourTurnNominate
                : currentNominator?.displayName
                  ? m.waitingFor(currentNominator.displayName)
                  : m.waitingForUnknown}
            </p>
            {timerStatus === 'running' && timerRemainingSeconds != null ? (
              <p className="af-dr-note" style={{ textAlign: 'center' }} data-testid="auction-nomination-timer">
                {m.nominationWindow(timerRemainingSeconds)}
              </p>
            ) : null}
          </div>
        )}
      </div>

      <div className="af-dr-lower">
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
                    <span style={{ minWidth: 0 }}>
                      <span className="af-dr-row-name" style={{ display: 'block' }}>
                        {pick.playerName}
                      </span>
                      <span className="af-dr-row-sub">
                        {[pick.position, pick.team, pick.displayName ?? nameOf(pick.rosterId)].filter(Boolean).join(' · ')}
                      </span>
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

        <div className="af-dr-card" data-testid="auction-budgets" style={recentWins.length > 0 ? undefined : { gridColumn: '1 / -1' }}>
          <div className="af-dr-card-head">
            <h3 className="af-dr-card-title">{m.budgets}</h3>
            <span className="af-dr-label">{m.budgetCols}</span>
          </div>
          {teamLines.map((line) => (
            <div key={line.rosterId} className="af-dr-budget" data-me={line.rosterId === currentUserRosterId ? 'true' : undefined}>
              <div className="af-dr-row">
                <span className="af-dr-row-name">
                  {line.rosterId === currentUserRosterId ? `${line.displayName} · ${m.you}` : line.displayName}
                </span>
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
      </div>
    </section>
  )
}

export default AuctionSpotlightPanel
