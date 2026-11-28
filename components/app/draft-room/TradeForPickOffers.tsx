'use client'

/**
 * "Trade for this pick" — the card at the top of the pick-trade composer when it was opened from another
 * team's upcoming pick on the board (slow drafts only; `lib/draft-room/tradeForPick.ts`).
 *
 * It shows the pick being asked for, up to three offers from the viewer's own picks ranked by how close to
 * even THE league grade is (`for_their_pick` on the existing suggestions route), and the grade of the offer
 * chosen BEFORE anything is sent. Sending goes through the composer's own Send button — the existing
 * proposal route — so DMs, notifications and AI-manager answers are unchanged.
 */

import { Loader2 } from 'lucide-react'
import { DraftPickTradeGradeLine } from './DraftPickTradeGradeLine'
import type { DraftPickTradeSuggestion } from './DraftPickTradePanel'

export type TradeForPickTarget = { round: number; slot: number; overall: number; ownerName: string | null }

const label = (round: number, slot: number) => `${round}.${String(slot).padStart(2, '0')}`

export function TradeForPickOffers({
  target,
  offers,
  loading,
  emptyReason,
  chosenGiveRound,
  onUse,
}: {
  target: TradeForPickTarget
  offers: DraftPickTradeSuggestion[]
  loading: boolean
  emptyReason: string | null
  /** The give round now in the composer — the offer whose grade is shown. */
  chosenGiveRound: number | null
  onUse: (offer: DraftPickTradeSuggestion) => void
}) {
  const chosen = offers.find((o) => o.giveRound === chosenGiveRound) ?? null
  return (
    <section
      data-testid="trade-for-pick-card"
      className="mb-6 rounded-3xl border border-cyan-400/30 bg-cyan-950/20 p-5 sm:p-6"
      aria-labelledby="trade-for-pick-heading"
    >
      <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-cyan-200/70">Trade for this pick</p>
      <h3 id="trade-for-pick-heading" className="mt-1 text-lg font-bold text-white">
        {target.ownerName ? `${target.ownerName}'s ` : ''}
        <span className="font-mono">{label(target.round, target.slot)}</span>
        <span className="ml-2 text-sm font-medium text-white/50">pick #{target.overall}</span>
      </h3>
      <p className="mt-1 text-[13px] text-white/55">
        Offers from your picks, closest to an even league grade first. Pick one to see its grade, then send it below.
      </p>
      {loading ? (
        <p className="mt-4 flex items-center gap-2 text-sm text-white/60" data-testid="trade-for-pick-loading">
          <Loader2 className="h-4 w-4 animate-spin text-cyan-300" />
          Finding offers…
        </p>
      ) : null}
      {!loading && offers.length === 0 ? (
        <p className="mt-4 rounded-xl border border-white/[0.08] bg-black/25 px-3 py-2 text-[13px] text-white/55" data-testid="trade-for-pick-empty">
          {emptyReason ?? 'No offers from your picks right now. You can still build one below.'}
        </p>
      ) : null}
      {offers.length > 0 ? (
        <ul className="mt-4 space-y-2" data-testid="trade-for-pick-offers">
          {offers.map((o) => {
            const on = o.giveRound === chosenGiveRound
            const g = o.tradeGrade
            return (
              <li key={o.id}>
                <button
                  type="button"
                  onClick={() => onUse(o)}
                  aria-pressed={on}
                  data-testid={`trade-for-pick-offer-${o.giveRound}-${o.giveSlot}`}
                  className={`flex min-h-[48px] w-full items-center justify-between gap-3 rounded-2xl border px-4 py-2 text-left transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400/50 ${
                    on ? 'border-cyan-300/70 bg-cyan-500/20' : 'border-white/[0.1] bg-black/30 hover:bg-white/[0.05]'
                  }`}
                >
                  <span className="text-sm text-white">
                    Your <span className="font-mono font-bold">{label(o.giveRound, o.giveSlot)}</span>
                  </span>
                  <span className="text-[12px] font-semibold text-white/70">
                    {g?.graded ? `You ${g.letter} · Them ${g.partnerLetter}` : 'Not graded'}
                  </span>
                </button>
              </li>
            )
          })}
        </ul>
      ) : null}
      {chosen ? (
        <div className="mt-4" data-testid="trade-for-pick-chosen-grade">
          <DraftPickTradeGradeLine grade={chosen.tradeGrade ?? null} partnerName={target.ownerName} />
        </div>
      ) : null}
    </section>
  )
}
