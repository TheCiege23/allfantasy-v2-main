'use client'

/**
 * 6c — Importing.
 *
 * ⚠ THREE STEPS, NOT THE HANDOFF'S FOUR, AND THE REASON IS THE HANDOFF'S OWN
 * RULE 4: "this screen is a real progress state, not a fixed-duration spinner —
 * it must reflect actual import-job status from the backend."
 *
 * The backend has exactly three observable stages, because it is three calls:
 *   1. POST /api/leagues/import/discover  → the league list (real count, real names)
 *   2. POST /api/leagues/import/preview   → the league and its team count
 *   3. POST /api/leagues/import/commit    → the write
 *
 * The handoff's steps 3 and 4 ("Matchups and scoring settings", "Past seasons")
 * both happen INSIDE that third call. It is synchronous and returns no job id, so
 * there is nothing to poll and no moment at which "matchups done, past seasons
 * queued" becomes true — rendering them as two sequential rows would be inventing
 * a sequence, which is precisely what rule 1 ("steps complete strictly in order,
 * never show a later step as DONE while an earlier one is still WORKING") exists
 * to prevent. They are named together in step 3's detail line instead, so nothing
 * the handoff promises the user is lost — only the false granularity is.
 *
 * ⚠ AND THE RING IS A FRACTION OF REAL STEPS, NOT A PERCENTAGE. The capture shows
 * 62%. There is no signal in this flow that could produce 62 — any percentage
 * would be a number chosen to look busy. This repo already made and reverted that
 * exact mistake: ImportV4's `Working` carries a note about a previous version that
 * animated a hardcoded 40% and "2 of 5" on the one screen whose entire promise is
 * that the data is real. The ring fills in thirds, and each third is a call that
 * genuinely returned.
 */

import { ChimmyNote } from '@/components/core-app/import/ChimmyNote'
import '@/components/core-app/af-core.css'
import '@/components/core-app/af-progress.css'

export type ImportStepState = 'done' | 'working' | 'queued' | 'failed'

export type ImportStep = {
  key: string
  title: string
  detail: string
  state: ImportStepState
}

export type ImportProgressProps = {
  /** Provider label + the account or league it is reading, for the subcopy. */
  providerLabel: string
  accountLabel?: string | null
  steps: ImportStep[]
  /*
   * The Chimmy aside. A node rather than a string, and optional rather than
   * defaulted, because a screen with nothing true to say must render nothing —
   * see the note at the top of ChimmyNote.
   */
  note?: React.ReactNode
}

const STATUS_LABEL: Record<ImportStepState, string> = {
  done: 'Done',
  working: 'Working',
  queued: '',
  failed: 'Failed',
}

export function ImportProgress({ providerLabel, accountLabel, steps, note }: ImportProgressProps) {
  const total = steps.length
  const completed = steps.filter((s) => s.state === 'done').length
  const failed = steps.some((s) => s.state === 'failed')
  /*
   * ⚠ ROUNDED FROM A REAL FRACTION, AND ONLY EVER LANDING ON A THIRD. 0 / 33 / 67 /
   * 100 for three steps. The number under the ring is the same fraction the ring
   * draws, so handoff rule 2 ("the ring and the checklist must stay in sync — don't
   * let them drift or disagree") holds by construction rather than by care: both
   * read `completed`, and there is no second source that could disagree.
   */
  const pct = total > 0 ? Math.round((completed / total) * 100) : 0

  return (
    <div className="af-prog" role="status" aria-live="polite">
      <div
        className="af-prog-ring"
        style={{ ['--af-prog-pct' as string]: `${pct}` }}
        data-failed={failed ? 'true' : undefined}
        role="img"
        aria-label={`${completed} of ${total} steps complete`}
      >
        <span className="af-prog-ring-num af-num">{pct}%</span>
      </div>

      <h2 className="af-prog-title">
        {failed ? 'That import stopped early.' : 'Building your read-only copy…'}
      </h2>
      <p className="af-prog-sub">
        {providerLabel}
        {accountLabel ? ` · ${accountLabel}` : ''} · discovery, preview, then commit.
        {failed ? '' : ' Usually under a minute.'}
      </p>

      <ol className="af-prog-steps">
        {steps.map((step) => (
          <li key={step.key} className="af-prog-step" data-state={step.state}>
            <span className="af-prog-mark" aria-hidden>
              {step.state === 'done' ? '✓' : step.state === 'failed' ? '!' : ''}
            </span>
            <span className="af-prog-body">
              <span className="af-prog-step-title">{step.title}</span>
              <span className="af-prog-step-detail">{step.detail}</span>
            </span>
            {STATUS_LABEL[step.state] ? (
              <span className="af-prog-tag af-num">{STATUS_LABEL[step.state]}</span>
            ) : null}
          </li>
        ))}
      </ol>

      {note ? <ChimmyNote>{note}</ChimmyNote> : null}
    </div>
  )
}

export default ImportProgress
