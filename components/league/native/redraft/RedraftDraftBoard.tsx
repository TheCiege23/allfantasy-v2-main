'use client'

import { LayoutGrid, Settings } from 'lucide-react'
import '@/components/league/native/redraft-home.css'

export type RedraftDraftPhase = 'pre' | 'live' | 'done'
type TimerParts = { days: number; hours: number; mins: number; secs: number } | 'dash'

/**
 * Draft HQ's draftboard card for a native redraft league, in the season-race identity. Same facts,
 * actions and test ids as DraftTab's default card (league-draftboard-*, nfl-redraft-predraft-summary)
 * — only the presentation is the identity's: tokens instead of the hardcoded purple gradient, so it
 * reads in light mode. The countdown shows only while a draft time is set and still ahead.
 */
export function RedraftDraftBoard(props: {
  phase: RedraftDraftPhase
  sportLabel: string
  scoringLabel: string
  draftDateLabel: string
  timer: TimerParts
  hasDraftTime: boolean
  filled: number
  cap: number
  isFull: boolean
  draftTypeLabel: string
  pickTimerLabel: string
  sleeperDraftId: string | null
  canSetDraftTime: boolean
  canEnterDraftRoom: boolean
  onDraftRoom: () => void
  onSettings: () => void
  onMock: () => void
}) {
  const { phase, timer } = props
  const counting = phase === 'pre' && props.hasDraftTime && timer !== 'dash' && timer.days + timer.hours + timer.mins + timer.secs > 0
  const title = phase === 'done' ? 'Draft complete' : phase === 'live' ? 'Draft is live' : 'Draft day'
  const done = phase === 'done'
  // After the draft, "not scheduled yet" and "ready for the draft" stop being true; drop them.
  const showDate = !done || props.hasDraftTime
  const units = timer === 'dash' ? [] : ([['Days', String(timer.days)], ['Hrs', String(timer.hours).padStart(2, '0')], ['Mins', String(timer.mins).padStart(2, '0')], ['Secs', String(timer.secs).padStart(2, '0')]] as const)
  return (
    <section className="rdh-card rdh-draftboard" aria-label="Draftboard" data-testid="league-draftboard-card" data-phase={phase}>
      <div className="rdh-draftboard-head">
        <div className="rdh-draftboard-title">
          <span className="rdh-label">Draft HQ · {props.sportLabel} · {props.scoringLabel}</span>
          <h2>{title}</h2>
          {showDate ? <p>{props.draftDateLabel}</p> : null}
        </div>
        <div className="rdh-draftboard-icons">
          <button type="button" className="rdh-icon-button" onClick={props.onDraftRoom} aria-label="Open draft room" data-testid="league-draftboard-draft-room">
            <LayoutGrid size={18} aria-hidden />
          </button>
          <button type="button" className="rdh-icon-button" onClick={props.onSettings} aria-label="League and draft settings" data-testid="league-draftboard-settings">
            <Settings size={18} aria-hidden />
          </button>
        </div>
      </div>

      {counting ? (
        <div className="rdh-countdown" role="timer" aria-label="Time until the draft" data-testid="redraft-draft-countdown">
          {units.map(([label, value]) => (
            <div key={label} className="rdh-countdown-unit">
              <strong>{value}</strong>
              <span>{label}</span>
            </div>
          ))}
        </div>
      ) : null}

      <dl className="rdh-draftboard-facts" data-testid="nfl-redraft-predraft-summary">
        <div>
          <dt>League fill</dt>
          <dd>{props.filled}/{props.cap} teams</dd>
          {done ? null : <p>{props.isFull ? 'Full and ready for the draft.' : `${Math.max(props.cap - props.filled, 0)} spot${props.cap - props.filled === 1 ? '' : 's'} still open.`}</p>}
        </div>
        <div>
          <dt>Draft type</dt>
          <dd>{props.draftTypeLabel}</dd>
        </div>
        {showDate ? (
          <div>
            <dt>Draft date</dt>
            <dd>{props.draftDateLabel}</dd>
          </div>
        ) : null}
        <div>
          <dt>Pick timer</dt>
          <dd>{props.pickTimerLabel}</dd>
        </div>
      </dl>

      {props.sleeperDraftId ? <p className="rdh-draftboard-note">Sleeper draft id: <span className="rdh-mono">{props.sleeperDraftId}</span></p> : null}

      <div className="rdh-actions">
        <button type="button" className="nl-button" onClick={props.onMock} data-testid="league-draftboard-mock">Mock drafts</button>
        {done ? (
          <button type="button" className="nl-button nl-primary" onClick={props.onDraftRoom} data-testid="league-draftboard-enter-room">Draft board &amp; recap</button>
        ) : props.canSetDraftTime ? (
          <button type="button" className="nl-button nl-primary" onClick={props.onSettings} data-testid="league-draftboard-set-time">Set time</button>
        ) : (
          <button type="button" className="nl-button nl-primary" onClick={props.onDraftRoom} disabled={!props.canEnterDraftRoom} data-testid="league-draftboard-enter-room">Draftroom</button>
        )}
      </div>
      <p className="rdh-draftboard-note" data-testid="league-draftboard-enter-room-help">
        {done ? 'The full board and recap stay in the draft room.' : props.canEnterDraftRoom ? 'The live draft room only opens when you click Enter Draft Room.' : 'Draft room entry is unavailable outside draft setup or live drafting.'}
      </p>
    </section>
  )
}
