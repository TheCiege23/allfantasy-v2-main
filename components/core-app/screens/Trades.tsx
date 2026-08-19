'use client'

import '@/components/core-app/af-trades.css'
import type { TradesData, TradeRecord } from '@/lib/core-app/trades'

/**
 * Screen 6 — Trades.
 *
 * "Offer, grade, counter — all scored against this league's own rules."
 *
 * The handoff centres a letter grade (B+) with a fairness score and a rationale.
 * That grade is NOT rendered here, and the empty slot says why rather than
 * standing empty: trades are stored as asset counts, not the players involved,
 * so there is nothing to value. A grade from that data lands every trade in the
 * C band and reads "dead even" when it actually means no data — the exact trap
 * lib/trade-intel's own hasNoSignal() was written to catch.
 *
 * What IS shown is real: completed trades, when they happened, who with, and how
 * many players and picks moved.
 */

export type TradesProps = {
  data: TradesData
}

function Unavailable({ reason }: { reason: string }) {
  return <p className="af-tr-unavailable">{reason}</p>
}

function TradeCard({ trade }: { trade: TradeRecord }) {
  const assets = trade.playersIn + trade.playersOut + trade.picks

  return (
    <li className="af-card af-tr-card">
      <header className="af-tr-card-head">
        <span className="af-tr-when af-num">
          {trade.season ?? '—'}
          {trade.week != null ? ` · wk ${trade.week}` : ''}
        </span>
        <span className="af-tr-partner">
          {trade.partnerTeamName ? `with ${trade.partnerTeamName}` : 'partner not identified'}
        </span>
      </header>

      <div className="af-tr-sides">
        <div className="af-tr-side">
          <div className="af-label">In</div>
          <div className="af-tr-count af-num">{trade.playersIn}</div>
          <div className="af-tr-count-label">
            {trade.playersIn === 1 ? 'player' : 'players'}
          </div>
        </div>

        <div className="af-tr-swap" aria-hidden>
          ⇄
        </div>

        <div className="af-tr-side">
          <div className="af-label">Out</div>
          <div className="af-tr-count af-num">{trade.playersOut}</div>
          <div className="af-tr-count-label">
            {trade.playersOut === 1 ? 'player' : 'players'}
          </div>
        </div>

        {trade.picks > 0 ? (
          <div className="af-tr-side">
            <div className="af-label">Picks</div>
            <div className="af-tr-count af-num">{trade.picks}</div>
            <div className="af-tr-count-label">included</div>
          </div>
        ) : null}
      </div>

      {/*
        The grade slot. Kept in the layout the handoff specifies so the shape is
        right, but filled with the reason no letter can be issued — an empty
        badge would read as a pending grade, and a "C" would read as average.
      */}
      <div className="af-tr-grade" data-ungradable="true">
        <span className="af-tr-grade-badge af-num">n/a</span>
        <span className="af-tr-grade-why">
          {assets > 0
            ? 'Counts only in this view — see Trade grades below for the priced version.'
            : 'Not gradable — nothing was recorded as moving in this trade.'}
        </span>
      </div>
    </li>
  )
}

export function Trades({ data }: TradesProps) {
  return (
    <div className="af-tr">
      {/* ── League-specific grading banner ──────────────────────────── */}
      {data.gradingContext.available ? (
        <div className="af-tr-context">
          <span className="af-label">Scored for this league only</span>
          <p className="af-tr-context-body">
            Grades and recommendations on this page are calculated against{' '}
            <strong>{data.gradingContext.data.leagueName}</strong>
            {data.gradingContext.data.format ? ` — ${data.gradingContext.data.format}` : ''}, {' '}
            {data.gradingContext.data.teamCount} teams. The same trade grades differently in a
            different league.
          </p>
        </div>
      ) : null}

      {/* ── Deadline ────────────────────────────────────────────────── */}
      <div className="af-tr-deadline">
        <span className="af-label">Trade deadline</span>
        {data.deadline.available ? (
          data.deadline.data.none ? (
            /*
              The platform's sentinel for "trades stay open" (99, or any week past
              the end of the regular season). Rendering it literally would print
              "Week 99" on a screen people plan around.
            */
            <span className="af-tr-deadline-value">No deadline — trades stay open all season</span>
          ) : (
            <span className="af-tr-deadline-value">
              Week <span className="af-num">{data.deadline.data.week}</span>
              {data.deadline.data.regularSeasonLength != null ? (
                <span className="af-tr-deadline-why">
                  of a {data.deadline.data.regularSeasonLength}-week regular season
                </span>
              ) : null}
            </span>
          )
        ) : (
          <span className="af-tr-deadline-why">{data.deadline.reason}</span>
        )}
      </div>

      {/* ── Inbox / sent ────────────────────────────────────────────── */}
      <div className="af-tr-pending">
        <section className="af-card af-tr-pending-col">
          <h2 className="af-label">Inbox</h2>
          <Unavailable reason={data.inbox.reason} />
        </section>
        <section className="af-card af-tr-pending-col">
          <h2 className="af-label">Sent</h2>
          <Unavailable reason={data.sent.reason} />
        </section>
      </div>

      {/* ── Completed trades ────────────────────────────────────────── */}
      <section className="af-tr-history">
        <header className="af-tr-history-head">
          <h2 className="af-display af-tr-history-title">Completed trades</h2>
          {data.history.available ? (
            <span className="af-chip af-num">{data.history.data.length}</span>
          ) : null}
        </header>

        {data.history.available ? (
          data.history.data.length > 0 ? (
            <ul className="af-tr-list">
              {data.history.data.map((t) => (
                <TradeCard key={t.transactionId} trade={t} />
              ))}
            </ul>
          ) : (
            <Unavailable reason="No trades recorded in this league." />
          )
        ) : (
          <Unavailable reason={data.history.reason} />
        )}
      </section>

      {/* ── Grades ──────────────────────────────────────────────────── */}
      <section className="af-card af-tr-section">
        <h2 className="af-label">Trade grades</h2>
        {data.grades.available ? (
          <ul className="af-tr-graderows">
            {data.grades.data.slice(0, 12).map((g) => (
              <li key={g.transactionId} className="af-tr-graderow">
                {/*
                  ⚠ A LETTER OR A REASON — NEVER BOTH, AND NEVER A LETTER AS A
                  FALLBACK. A grade withheld for partial coverage must not render
                  as a dimmed "C"; that is the precise failure the engine exists to
                  prevent, and it would be reintroduced here in one line of JSX.
                */}
                {g.letter ? (
                  <span className="af-tr-graderow-letter" data-grade={g.letter}>
                    {g.letter}
                  </span>
                ) : (
                  <span className="af-tr-graderow-letter" data-grade="none" aria-label="not graded">
                    —
                  </span>
                )}
                <span className="af-tr-graderow-main">
                  <span className="af-tr-graderow-meta af-num">
                    {[g.season, g.week ? `WK ${g.week}` : null].filter(Boolean).join(' · ')}
                    {' · '}
                    {g.playersOut} out / {g.playersIn} in
                  </span>
                  <span className="af-tr-graderow-why">
                    {g.letter
                      ? `received ${g.sharePct}% of the traded value`
                      : g.withheldReason}
                  </span>
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <Unavailable reason={data.grades.reason} />
        )}
      </section>
    </div>
  )
}

export default Trades
