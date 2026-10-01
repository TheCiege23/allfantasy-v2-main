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

  const { calls, followed, passed, adds, best } = record
  const ask = `This season I followed ${plural(followed.count, 'call')} from Chimmy and AutoCoach (${signedPoints(
    followed.netPoints,
  )} pts vs the players they benched) and passed on ${passed.count}. Where am I leaving points?`

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

      <div className="af-cdr-foot">
        <p className="af-crl-foot">
          Counts Chimmy and AutoCoach advice once its week is final, graded on the platform’s own scores. My Team’s
          suggestions are not recorded yet, so they are not in this.
        </p>
        <button type="button" className="af-crl-chip" onClick={() => askChimmyAboutCareer(ask)}>
          ✦ Where am I leaving points?
        </button>
      </div>
    </section>
  )
}
