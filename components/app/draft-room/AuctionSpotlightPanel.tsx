'use client'

import { useState, useEffect } from 'react'
import { DraftPlayerCard } from './DraftPlayerCard'
import type { AuctionSessionSnapshot, AuctionState } from '@/lib/live-draft-engine/types'
import { buildDraftPlayerDisplayModel } from '@/lib/draft-sports-models/build-display-model'

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
}

const PRESET_BIDS = [1, 2, 3, 5, 10, 15, 20, 25, 30, 50]

export function AuctionSpotlightPanel({
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
  rosterGateBlocksAuctionActions = false,
}: AuctionSpotlightPanelProps) {
  const [bidAmount, setBidAmount] = useState('')
  const state: AuctionState = auction.auctionState
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

  useEffect(() => {
    setBidAmount(String(minNextBid))
  }, [minNextBid])

  const handleBid = () => {
    const amt = parseInt(bidAmount, 10)
    if (!Number.isNaN(amt) && amt >= minNextBid) {
      onBid(amt)
      setBidAmount(String(amt + 1))
    }
  }

  const timerExpired = timerStatus === 'expired' || (timerRemainingSeconds != null && timerRemainingSeconds <= 0)
  const showResolve = (timerExpired || isCommissioner) && nomination != null

  return (
    <section
      className="flex flex-col gap-3 border-b border-white/10 bg-black/30 p-3"
      aria-label="Auction spotlight"
      data-auction-spotlight
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-semibold text-white">Auction</h2>
        <span className="text-[11px] text-white/60" data-testid="auction-current-nominator">
          Nominator: {currentNominator?.displayName ?? '—'}
        </span>
        <div className="flex items-center gap-2 text-xs text-white/70">
          {auction.nominationOrder.map((entry) => (
            <span
              key={entry.rosterId}
              className={`rounded px-1.5 py-0.5 ${
                entry.rosterId === currentNominator?.rosterId
                  ? 'bg-cyan-500/30 text-cyan-200'
                  : 'bg-white/10 text-white/60'
              }`}
              title={entry.displayName}
            >
              {entry.displayName?.slice(0, 8) ?? '—'}
            </span>
          ))}
        </div>
      </div>

      {/* Nominated player card */}
      <div className="min-h-[80px] rounded-xl border border-white/12 bg-black/40 p-3">
        {nomination ? (
          <div className="flex flex-wrap items-center gap-3">
            <DraftPlayerCard
              display={buildDraftPlayerDisplayModel({
                playerName: nomination.playerName,
                position: nomination.position,
                team: nomination.team ?? null,
                playerId: nomination.playerId ?? null,
                byeWeek: nomination.byeWeek ?? null,
              })}
              name={nomination.playerName}
              position={nomination.position}
              team={nomination.team}
              byeWeek={nomination.byeWeek ?? null}
              variant="card"
              isDrafted={false}
            />
            <div className="flex flex-1 flex-col gap-1">
              <p className="text-xs text-white/60">
                High bid: <strong className="text-white">${state.currentBid || '—'}</strong>
                {state.currentBidderRosterId && (
                  <span className="ml-1">
                    ({auction.nominationOrder.find((e) => e.rosterId === state.currentBidderRosterId)?.displayName ?? '—'})
                  </span>
                )}
              </p>
              <p className="text-[11px] text-white/55" data-testid="auction-highest-bidder">
                Highest bidder: {state.currentBidderRosterId
                  ? (auction.nominationOrder.find((e) => e.rosterId === state.currentBidderRosterId)?.displayName ?? '—')
                  : 'No bids yet'}
              </p>
              <p className="text-[11px] text-white/50">
                Min next bid: ${minNextBid}
              </p>
              <div className="flex flex-wrap items-center gap-2 mt-1">
                {timerStatus === 'running' && timerRemainingSeconds != null && (
                  <span className="rounded bg-amber-500/20 px-2 py-0.5 text-xs text-amber-200" aria-live="polite">
                    {timerRemainingSeconds}s
                  </span>
                )}
                {timerStatus === 'paused' && (
                  <span className="rounded bg-white/10 px-2 py-0.5 text-xs text-white/70">Paused</span>
                )}
                {canBid && (
                  <>
                    <input
                      type="number"
                      min={minNextBid}
                      value={bidAmount}
                      onChange={(e) => setBidAmount(e.target.value)}
                      className="w-20 rounded border border-white/20 bg-black/40 px-2 py-1 text-sm text-white"
                      aria-label="Bid amount"
                        data-testid="auction-bid-input"
                    />
                    <button
                      type="button"
                      onClick={handleBid}
                      disabled={bidLoading}
                        data-testid="auction-bid-button"
                      className="rounded bg-cyan-500/30 px-3 py-1 text-sm text-cyan-200 hover:bg-cyan-500/40 disabled:opacity-50"
                    >
                      {bidLoading ? '…' : 'Bid'}
                    </button>
                  </>
                )}
                {showResolve && (
                  <button
                    type="button"
                    onClick={onResolve}
                    disabled={resolveLoading}
                    data-testid="auction-resolve-button"
                    className="rounded bg-emerald-500/30 px-3 py-1 text-sm text-emerald-200 hover:bg-emerald-500/40 disabled:opacity-50"
                  >
                    {resolveLoading ? '…' : isCommissioner ? 'Sell / Pass' : 'Resolve'}
                  </button>
                )}
              </div>
            </div>
          </div>
        ) : (
          <div className="flex flex-col items-center justify-center py-4 text-center">
            <p className="text-sm text-white/70">
              {isMyTurnToNominate
                ? 'Your turn to nominate. Select a player from the list and click Nominate.'
                : `Waiting for ${currentNominator?.displayName ?? 'nominator'} to nominate.`}
            </p>
            {timerStatus === 'running' && timerRemainingSeconds != null && (
              <p className="mt-1 text-[11px] text-white/50" data-testid="auction-nomination-timer">
                Nomination window: {timerRemainingSeconds}s
              </p>
            )}
          </div>
        )}
      </div>

      {/* Remaining budgets */}
      <div className="flex flex-wrap gap-2">
        {auction.nominationOrder.map((entry) => (
          <div
            key={entry.rosterId}
            className={`rounded-lg border px-2 py-1 text-[11px] ${
              entry.rosterId === currentUserRosterId
                ? 'border-cyan-500/40 bg-cyan-500/10 text-cyan-200'
                : 'border-white/10 bg-white/5 text-white/70'
            }`}
          >
            <span className="font-medium">{entry.displayName?.slice(0, 10) ?? '—'}</span>
            <span className="ml-1">${auction.budgets[entry.rosterId] ?? auction.budgetPerTeam}</span>
          </div>
        ))}
      </div>
    </section>
  )
}

export default AuctionSpotlightPanel
