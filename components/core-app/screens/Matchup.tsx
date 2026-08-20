'use client'

import '@/components/core-app/af-matchup.css'
import type { MatchupData, MatchupSide } from '@/lib/core-app/matchup'

/**
 * Screen 5 — Matchup.
 *
 * "Live head-to-head, what's left to play, and what decides it."
 *
 * The handoff centres a win probability between the two teams. That number is
 * the most authoritative-looking thing in the whole product, and it needs live
 * scores plus players yet to play — neither of which is ingested for imported
 * leagues. So the centre column states what it would take instead of printing a
 * percentage, and a ratio of current points is explicitly NOT substituted: that
 * would look like a probability without being one.
 */

export type MatchupProps = {
  data: MatchupData
}

function TeamCard({ side, align }: { side: MatchupSide; align: 'left' | 'right' }) {
  return (
    <div className="af-mu-team" data-align={align} data-you={side.isYou}>
      <div className="af-mu-crest" aria-hidden>
        {side.teamName.slice(0, 2).toUpperCase()}
      </div>
      <div className="af-mu-team-text">
        <div className="af-mu-team-name">{side.teamName}</div>
        <div className="af-mu-team-meta">
          {[side.isYou ? 'You' : side.ownerName || null, side.record].filter(Boolean).join(' · ') ||
            'no record on file'}
        </div>
      </div>
      <div className="af-mu-score af-num">{side.points.toFixed(1)}</div>
    </div>
  )
}

export function Matchup({ data }: MatchupProps) {
  const leader =
    data.sides.available && data.sides.data.you.points !== data.sides.data.opponent.points
      ? data.sides.data.you.points > data.sides.data.opponent.points
        ? 'you'
        : 'opponent'
      : null

  return (
    <div className="af-mu">
      {/* ── Week banner ─────────────────────────────────────────────── */}
      <header className="af-mu-week">
        {data.week.available ? (
          <>
            <span className="af-label">
              Week {data.week.data.week} · {data.week.data.season}
            </span>
            <span className="af-mu-week-state af-num" data-final={data.week.data.isFinal}>
              {data.week.data.isFinal ? 'Final' : 'Not scored'}
            </span>
          </>
        ) : (
          <span className="af-mu-unavailable">{data.week.reason}</span>
        )}
      </header>

      {/* ── Head to head ────────────────────────────────────────────── */}
      <section className="af-frame af-mu-h2h">
        {data.sides.available ? (
          <>
            <TeamCard side={data.sides.data.you} align="left" />

            <div className="af-mu-centre">
              <div className="af-label af-mu-centre-label">Win probability</div>
              {data.winProbability.available ? (
                <>
                  <div className="af-mu-centre-value af-num">
                    {Math.round(data.winProbability.data.pWin * 100)}%
                  </div>
                  {/*
                    ⚠ THE CONFIDENCE AND THE MODEL'S OWN SENTENCE STAY ATTACHED TO
                    THE NUMBER. A bare percentage reads as a measurement; this one
                    is a Gaussian over projected margins, and the detail line is
                    what stops it being mistaken for a count of simulated seasons.
                  */}
                  <p className="af-mu-centre-why">
                    {data.winProbability.data.detail} · {data.winProbability.data.confidence}{' '}
                    confidence
                  </p>
                </>
              ) : (
                <>
                  {/*
                    No percentage, on purpose. The reason is shown in its place so
                    the gap reads as a known absence rather than a value still
                    loading.
                  */}
                  <div className="af-mu-centre-dash af-num" aria-hidden>
                    —
                  </div>
                  <p className="af-mu-centre-why">{data.winProbability.reason}</p>
                </>
              )}

              {leader ? (
                <div className="af-mu-margin af-num" data-leader={leader}>
                  {leader === 'you' ? 'You lead by ' : 'Behind by '}
                  {Math.abs(
                    data.sides.data.you.points - data.sides.data.opponent.points
                  ).toFixed(1)}
                </div>
              ) : (
                <div className="af-mu-margin af-num" data-leader="tied">
                  Level
                </div>
              )}
            </div>

            <TeamCard side={data.sides.data.opponent} align="right" />
          </>
        ) : (
          <p className="af-mu-unavailable af-mu-unavailable--block">{data.sides.reason}</p>
        )}
      </section>

      {/* ── Per-player scoring ──────────────────────────────────────── */}
      <section className="af-frame af-mu-section">
        <header className="af-mu-section-head">
          <h2 className="af-label">Head to head, slot by slot</h2>
        </header>
        <p className="af-mu-unavailable">{data.playerScoring.reason}</p>
        <p className="af-mu-note">
          When this lands each row will pair your starter against theirs at the same slot, with the
          live game state beside each — the shape the design calls for.
        </p>
      </section>

      {/* ── What decides it ─────────────────────────────────────────── */}
      <section className="af-frame af-mu-section">
        <header className="af-mu-section-head">
          <h2 className="af-label">What decides it</h2>
        </header>
        <ul className="af-mu-missing">
          <li>
            <span className="af-mu-missing-key">Players yet to play</span>
            <span className="af-mu-missing-why">{data.yetToPlay.reason}</span>
          </li>
          <li>
            <span className="af-mu-missing-key">Projected final</span>
            {data.projectedFinal.available ? (
              <span className="af-mu-missing-value af-num">
                {data.projectedFinal.data.you.toFixed(1)} –{' '}
                {data.projectedFinal.data.opponent.toFixed(1)}
                {/*
                  ⚠ SHOWN WHENEVER EITHER SIDE IS SHORT, BECAUSE THE TWO SIDES CAN
                  BE SHORT BY DIFFERENT AMOUNTS. That does not just make both totals
                  low, it tilts the comparison — the side missing more starters
                  looks like it is losing when it may not be.
                */}
                {data.projectedFinal.data.unprojected.you +
                  data.projectedFinal.data.unprojected.opponent >
                0 ? (
                  <em className="af-mu-missing-caveat">
                    {' '}
                    — built without {data.projectedFinal.data.unprojected.you} of your starters and{' '}
                    {data.projectedFinal.data.unprojected.opponent} of theirs, so both totals read
                    low
                  </em>
                ) : null}
              </span>
            ) : (
              <span className="af-mu-missing-why">{data.projectedFinal.reason}</span>
            )}
          </li>
        </ul>
      </section>
    </div>
  )
}

export default Matchup
