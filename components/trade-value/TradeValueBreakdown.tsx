'use client'

/**
 * Phase 6.2 / 6.3 / 6.4 — the panel that makes the value engine visible.
 *
 * ── WHAT WAS WRONG BEFORE ──────────────────────────────────────────────────────────────────
 * The trade console showed a grade, two side TOTALS, and three chips. Everything the engine
 * actually reasoned about — which input priced each player, what the league's format thinks, why
 * a player came out at zero — was computed, stored, and rendered nowhere. A manager could see
 * that a trade scored 62/100 and had no way to find out why, which makes the number something to
 * either accept or dismiss rather than argue with.
 *
 * ── 🛑 BASE AND FIT ARE TWO NUMBERS, NEVER ONE ─────────────────────────────────────────────
 * The user's decision (plan V5), and the reason is comparability. Base value is market-objective,
 * so two managers in different leagues see the same number for the same player and can disagree
 * about it. Fold a format multiplier in and that stops being true — and, worse, stops being
 * VISIBLE: 6,900 instead of 6,552 with nothing saying which rule moved it.
 *
 * So the fit renders as its own column with its own sentence. `fitAdjustedValue` exists in
 * `formats/applyFormat.ts` for a surface that wants the combination, and this panel deliberately
 * does not call it.
 *
 * ── 🛑 A REFUSAL IS A SENTENCE, NOT A ZERO (6.4) ───────────────────────────────────────────
 * `valuationBasis: 'none'` means no usable input reached the engine. Rendered as a bare `0` next
 * to a real 6,552 that reads as "worthless", which is the opposite of what it means. Every zero
 * in here has to say which of the two it is.
 */

import type { AssetValueSnapshot, TradeValueSnapshot } from '@/lib/trade-value/types'

/** How each basis is described to a manager. Plain language; no internal field names. */
const BASIS_LABEL: Record<string, { short: string; long: string }> = {
  projection: {
    short: 'Projection',
    long: 'Priced from the AllFantasy projection for the rest of this season, scaled for how scarce the position is in your league.',
  },
  idp: {
    short: 'IDP scarcity',
    long: "Priced against your league's own defensive starting slots and scoring — no market ranks defenders, so this is computed rather than quoted.",
  },
  market: {
    short: 'Market',
    long: 'No projection was available, so this falls back to the market price for the player.',
  },
  none: {
    short: 'Not priced',
    long: 'No projection, market price or defensive value reached the engine for this player. This is a gap in our data, NOT a judgement that he is worthless.',
  },
}

function assetLabel(a: AssetValueSnapshot): string {
  if (a.kind === 'draft_pick') {
    return a.pickLabel?.trim() || [a.pickSeason, a.pickRound ? `Round ${a.pickRound}` : null].filter(Boolean).join(' ') || 'Draft pick'
  }
  if (a.kind === 'faab') return `$${a.faabAmount ?? 0} FAAB`
  return a.playerName?.trim() || 'Unnamed player'
}

function AssetRow({ a }: { a: AssetValueSnapshot }) {
  const basis = a.valuationBasis ?? null
  const info = basis ? BASIS_LABEL[basis] : null
  const unpriced = basis === 'none' || (a.kind === 'player' && a.internalValue === 0)
  const fit = a.formatFit?.fit ?? null
  const legality = a.formatFit?.legality ?? null

  return (
    <li className="rounded border border-white/10 bg-black/20 p-2" data-testid="tv-asset-row">
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-[12px] font-medium text-white">
          {assetLabel(a)}
          {a.position ? <span className="ml-1 text-[10px] text-white/40">{a.position}</span> : null}
        </span>
        {/*
          * The base value. Rendered even when zero, because hiding it would leave the side total
          * unexplained — but never alone: the sentence below says which kind of zero it is.
          */}
        <span
          className={`text-[14px] font-bold tabular-nums ${unpriced ? 'text-white/30' : 'text-white'}`}
          data-testid="tv-asset-base"
        >
          {a.internalValue.toLocaleString()}
        </span>
      </div>

      {info ? (
        <p className="mt-0.5 text-[10px] text-white/45" data-testid="tv-asset-basis">
          <span className="text-white/60">{info.short}</span> · {info.long}
        </p>
      ) : a.kind === 'draft_pick' ? (
        <p className="mt-0.5 text-[10px] text-white/45">
          Priced from where the pick actually falls in your league, not from its round number.
        </p>
      ) : a.kind === 'faab' ? (
        <p className="mt-0.5 text-[10px] text-white/45">Priced from the amount itself.</p>
      ) : (
        /*
         * ⚠ ABSENT IS NOT A BASIS. A snapshot written before `valuationBasis` existed carries no
         * label, and inventing one from `sources` here would be the second implementation of the
         * engine's precedence — the thing `valueBasisFor` exists to prevent.
         */
        <p className="mt-0.5 text-[10px] text-white/35">Basis not recorded for this snapshot.</p>
      )}

      {/* ── The format's opinion, as its own number ──────────────────────────────────── */}
      {fit ? (
        <div className="mt-1.5 flex items-baseline justify-between gap-2 rounded border border-sky-400/20 bg-sky-400/5 px-1.5 py-1">
          <p className="text-[10px] text-sky-200/80" data-testid="tv-asset-fit-reason">
            <span className="font-semibold">{a.formatFit?.label ?? 'Format'}</span> · {fit.reason}
          </p>
          <span className="shrink-0 text-[12px] font-bold tabular-nums text-sky-200" data-testid="tv-asset-fit">
            {fit.multiplier === 1
              ? 'no change'
              : `${fit.multiplier > 1 ? '+' : ''}${Math.round((fit.multiplier - 1) * 100)}%`}
          </span>
        </div>
      ) : null}

      {legality && !legality.ok ? (
        <p
          className="mt-1 rounded border border-amber-400/25 bg-amber-400/5 px-1.5 py-1 text-[10px] text-amber-200/85"
          data-testid="tv-asset-legality"
        >
          ⚠ {legality.reason ?? 'This asset cannot be traded right now.'}
        </p>
      ) : null}
    </li>
  )
}

export function TradeValueBreakdown({
  snapshot,
  sideNames,
}: {
  snapshot: TradeValueSnapshot
  /** Display names by roster id. Falls back to the roster id when a name is missing. */
  sideNames?: Record<string, string>
}) {
  const unpricedCount = snapshot.sides
    .flatMap((s) => s.assets)
    .filter((a) => a.kind === 'player' && (a.valuationBasis === 'none' || a.internalValue === 0)).length

  return (
    <div className="space-y-2" data-testid="trade-value-breakdown">
      <div className="grid gap-2 sm:grid-cols-2">
        {snapshot.sides.map((side) => (
          <div key={side.rosterId} className="space-y-1.5">
            <div className="flex items-baseline justify-between gap-2">
              <p className="text-[11px] font-semibold text-white/70">
                {sideNames?.[side.rosterId] ?? side.rosterId} sends
              </p>
              <span className="text-[12px] font-bold tabular-nums text-white/80">
                {side.total.toLocaleString()}
              </span>
            </div>
            {side.assets.length === 0 ? (
              <p className="rounded border border-white/10 bg-black/20 p-2 text-[10px] text-white/40">
                Nothing on this side.
              </p>
            ) : (
              <ul className="space-y-1.5">
                {side.assets.map((a, i) => (
                  <AssetRow key={`${a.playerId ?? a.pickLabel ?? a.kind}-${i}`} a={a} />
                ))}
              </ul>
            )}
          </div>
        ))}
      </div>

      {/*
        * ⚠ THE HONESTY LINE. A side total that silently includes unpriced players looks like a
        * complete valuation and is not. Saying how many are missing is what lets a manager decide
        * whether to trust the comparison — and it is the difference between a number that can be
        * argued with and one that can only be believed.
        */}
      {unpricedCount > 0 ? (
        <p
          className="rounded border border-amber-400/25 bg-amber-400/5 px-2 py-1.5 text-[10px] text-amber-200/85"
          data-testid="tv-unpriced-note"
        >
          ⚠ {unpricedCount} player{unpricedCount === 1 ? '' : 's'} in this trade could not be priced, so the
          totals above are incomplete. That is missing data on our side, not a judgement that{' '}
          {unpricedCount === 1 ? 'he is' : "they are"} worthless.
        </p>
      ) : null}
    </div>
  )
}
