'use client'

import { describeTrackRecord } from '@/lib/chimmy-outcomes/trackRecord'
import { signedPoints, type DecisionRecord } from '@/lib/core-app/decisionRecordModel'
import { askChimmyAboutCareer } from './CareerAskChimmy'
import '@/components/core-app/af-career-record.css'

/**
 * The Career decision record — this season's Chimmy and AutoCoach calls, and what taking them (or
 * not) did to your score. Data from `lib/core-app/decisionRecord.ts`.
 *
 * ⚠ IT SAYS WHAT IT COVERS. My Team's start/sit suggestions are not stored, so the footer names the
 * two advisers this counts rather than letting "your decision record" read as every call AF made.
 *
 * ⚠ "PASSED" IS NEITHER PRAISE NOR BLAME. A call you went against is reported as what the advice
 * would have changed — and when your own pick beat it, the card says that, in the same tone.
 *
 * With no resolved advice yet it shows how to start one rather than an empty record, which would read
 * as "AF never helped you".
 */

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`

export function DecisionRecordCard({ record }: { record: (DecisionRecord & { season: number }) | null }) {
  if (!record) {
    return (
      <section className="af-cdr af-cdr--empty" aria-label="Your decision record">
        <p className="af-crl-head">Your decision record</p>
        <p className="af-cdr-lede">
          Ask Chimmy who to start, or let AutoCoach suggest a swap — every call lands here once its week is final, with
          what it gained you.
        </p>
        <button
          type="button"
          className="af-crl-chip"
          onClick={() => askChimmyAboutCareer('Who should I start this week? Give me your closest call.')}
        >
          ✦ Ask Chimmy a start/sit
        </button>
      </section>
    )
  }

  const { calls, followed, passed, adds, best, trades, waivers } = record
  const hasTrades = trades != null && trades.called + trades.tooEarly > 0
  const hasWaivers = waivers != null && waivers.scored + waivers.tooEarly + waivers.unscored > 0
  const hasAdvice = calls.total > 0 || adds.advised > 0
  const movesLine = [
    hasTrades && trades && trades.called > 0
      ? `my trades are ${signedPoints(trades.netPoints)} pts net (${trades.ahead} ahead, ${trades.behind} behind)`
      : null,
    hasWaivers && waivers && waivers.scored > 0 ? `my waiver adds have scored ${waivers.points.toFixed(1)} pts for me` : null,
  ]
    .filter(Boolean)
    .join(' and ')
  const ask = hasAdvice
    ? `This season I followed ${plural(followed.count, 'call')} from Chimmy and AutoCoach (${signedPoints(
        followed.netPoints,
      )} pts vs the players they benched) and passed on ${passed.count}.${movesLine ? ` Also, ${movesLine}.` : ''} Where am I leaving points?`
    : `This season ${movesLine || 'my moves are too recent to call'}. Where am I leaving points?`

  return (
    <section className="af-cdr" aria-label="Your decision record">
      <p className="af-crl-head">
        Your decision record
        <span className="af-crl-sp" />
        <span className="af-cdr-season">{record.season}</span>
      </p>

      {followed.count > 0 ? (
        <div className="af-cdr-hero">
          <span className="af-cdr-big af-num" data-tone={followed.netPoints > 0 ? 'good' : followed.netPoints < 0 ? 'bad' : 'even'}>
            {signedPoints(followed.netPoints)} pts
          </span>
          <span className="af-cdr-hero-s">
            from {plural(followed.count, 'call')} you followed, against the player each one benched
          </span>
        </div>
      ) : null}

      <ul className="af-cdr-rows">
        {calls.total > 0 ? (
          <li>
            <span className="af-cdr-k">Start/sit calls</span>
            <span className="af-cdr-v">{describeTrackRecord({ right: calls.right, wrong: calls.wrong, same: calls.same, ratePct: calls.ratePct })}</span>
          </li>
        ) : null}
        {passed.count > 0 ? (
          <li>
            <span className="af-cdr-k">Passed on</span>
            <span className="af-cdr-v">
              {plural(passed.count, 'call')} ·{' '}
              {passed.netPoints > 0
                ? `taking them would have been ${signedPoints(passed.netPoints)} pts`
                : passed.netPoints < 0
                  ? `your own pick won by ${Math.abs(passed.netPoints).toFixed(1)} pts`
                  : 'it came out even'}
            </span>
          </li>
        ) : null}
        {adds.advised > 0 ? (
          <li>
            <span className="af-cdr-k">Chimmy’s adds</span>
            <span className="af-cdr-v">
              took {adds.added} of {adds.advised}
              {adds.added > 0 ? ` · ${adds.points.toFixed(1)} pts on your roster` : ''}
            </span>
          </li>
        ) : null}
        {best ? (
          <li>
            <span className="af-cdr-k">Best call</span>
            <span className="af-cdr-v">
              {best.recommended.name} over {best.instead.name} · {best.leagueName}, week {best.week} ·{' '}
              <strong className="af-num">{signedPoints(best.delta)}</strong>
            </span>
          </li>
        ) : null}
      </ul>

      {hasTrades || hasWaivers ? (
        <>
          <p className="af-cdr-sub">Your moves</p>
          <ul className="af-cdr-rows">
            {hasTrades && trades ? (
              <li>
                <span className="af-cdr-k">Trades</span>
                <span className="af-cdr-v">
                  {trades.called > 0 ? (
                    <>
                      {plural(trades.called, 'trade')} · {trades.ahead} ahead, {trades.behind} behind, {trades.even} even ·{' '}
                      <strong className="af-num">{signedPoints(trades.netPoints)} pts</strong> net
                    </>
                  ) : null}
                  {trades.tooEarly > 0 ? (
                    <span className="af-cdr-note">
                      {trades.called > 0 ? ' · ' : ''}
                      {plural(trades.tooEarly, 'trade')} too early to call
                    </span>
                  ) : null}
                </span>
              </li>
            ) : null}
            {trades?.best ? (
              <li>
                <span className="af-cdr-k">Best trade</span>
                <span className="af-cdr-v">
                  got {trades.best.got.slice(0, 2).join(', ')}
                  {trades.best.got.length > 2 ? ` +${trades.best.got.length - 2}` : ''} · {trades.best.leagueName} ·{' '}
                  <strong className="af-num">{signedPoints(trades.best.netPoints)}</strong>
                </span>
              </li>
            ) : null}
            {hasWaivers && waivers ? (
              <li>
                <span className="af-cdr-k">Waiver adds</span>
                <span className="af-cdr-v">
                  {waivers.scored > 0 ? (
                    <>
                      {plural(waivers.scored, 'add')} · {waivers.points.toFixed(1)} pts on your roster ·{' '}
                      {plural(waivers.starts, 'start')}
                    </>
                  ) : null}
                  {waivers.tooEarly + waivers.unscored > 0 ? (
                    <span className="af-cdr-note">
                      {waivers.scored > 0 ? ' · ' : ''}
                      {waivers.tooEarly > 0 ? `${plural(waivers.tooEarly, 'add')} too recent` : ''}
                      {waivers.tooEarly > 0 && waivers.unscored > 0 ? ', ' : ''}
                      {waivers.unscored > 0 ? `${waivers.unscored} not scored yet` : ''}
                    </span>
                  ) : null}
                </span>
              </li>
            ) : null}
            {waivers?.best ? (
              <li>
                <span className="af-cdr-k">Best add</span>
                <span className="af-cdr-v">
                  {waivers.best.playerName} · {waivers.best.leagueName}, week {waivers.best.week} ·{' '}
                  <strong className="af-num">{waivers.best.points.toFixed(1)} pts</strong>
                </span>
              </li>
            ) : null}
          </ul>
        </>
      ) : null}

      <div className="af-cdr-foot">
        <p className="af-crl-foot">
          Counts Chimmy and AutoCoach advice once its week is final, graded on the platform’s own scores. My Team’s
          suggestions are not recorded yet, so they are not in this.
          {hasTrades || hasWaivers
            ? ' Your trades are net points since each one, and your adds what they scored while yours — Sleeper leagues only for now.'
            : ''}
        </p>
        <button type="button" className="af-crl-chip" onClick={() => askChimmyAboutCareer(ask)}>
          ✦ Where am I leaving points?
        </button>
      </div>
    </section>
  )
}
