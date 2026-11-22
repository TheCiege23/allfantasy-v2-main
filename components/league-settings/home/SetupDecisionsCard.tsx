'use client'

import { useEffect, useState } from 'react'
import { Check } from 'lucide-react'
import type { SettingsSubPageId } from '@/lib/league-settings-home/buildLeagueSettingsHome'
import {
  nextSetupDecision,
  readSetupProgress,
  writeSetupProgress,
  type SetupDecision,
  type SetupDecisionId,
  type SetupProgress,
} from '@/lib/league-settings-home/setupDecisions'

/**
 * "Set up your league in 5 decisions": one question at a time, with the league's current answer.
 * "Keep this" moves on; "Change it" opens the same editor the settings row opens, and the
 * commissioner comes back here to keep the new answer. Saving stays with each editor.
 */
export function SetupDecisionsCard({
  leagueId,
  decisions,
  onOpen,
}: {
  leagueId: string
  decisions: SetupDecision[]
  onOpen: (target: SettingsSubPageId) => void
}) {
  // Read after mount so the server render and the first client render agree.
  const [progress, setProgress] = useState<SetupProgress | null>(null)
  const [picked, setPicked] = useState<SetupDecisionId | null>(null)
  useEffect(() => setProgress(readSetupProgress(leagueId)), [leagueId])

  if (!progress || progress.dismissed || decisions.length === 0) return null

  const save = (next: SetupProgress) => {
    setProgress(next)
    writeSetupProgress(leagueId, next)
  }
  const kept = progress.kept
  const decided = decisions.filter((d) => kept.includes(d.id)).length
  const current = decisions.find((d) => d.id === picked) ?? nextSetupDecision(decisions, kept)
  const step = current ? decisions.indexOf(current) + 1 : decisions.length

  return (
    <section className="lsh-setup" aria-labelledby="lsh-setup-title" data-testid="lsh-setup">
      <div className="lsh-setup-head">
        <h2 id="lsh-setup-title">Set up your league in {decisions.length} decisions</h2>
        <span className="lsh-setup-count" data-testid="lsh-setup-count">
          {decided} of {decisions.length} decided
        </span>
      </div>
      <div className="lsh-setup-bar" aria-hidden>
        <span style={{ width: `${Math.round((decided / decisions.length) * 100)}%` }} />
      </div>

      <ol className="lsh-setup-steps">
        {decisions.map((d) => {
          const done = kept.includes(d.id)
          return (
            <li key={d.id}>
              <button
                type="button"
                aria-current={current?.id === d.id ? 'step' : undefined}
                data-done={done ? 'true' : undefined}
                onClick={() => setPicked(d.id)}
                data-testid={`lsh-setup-step-${d.id}`}
              >
                {done ? <Check size={13} aria-hidden /> : null}
                {d.label}
              </button>
            </li>
          )
        })}
      </ol>

      {current ? (
        <div className="lsh-setup-body" data-testid="lsh-setup-current" data-decision={current.id}>
          <p className="lsh-setup-kicker">
            Decision {step} of {decisions.length}
          </p>
          <h3>{current.question}</h3>
          <p className="lsh-setup-value" data-pending={current.pending ? 'true' : undefined}>
            {current.value}
          </p>
          <p className="lsh-help">{current.why}</p>
          <div className="lsh-setup-actions">
            <button type="button" className="lsh-secondary" onClick={() => onOpen(current.target)} data-testid="lsh-setup-change">
              Change it
            </button>
            <button
              type="button"
              className="lsh-primary"
              disabled={current.pending}
              onClick={() => {
                save({ ...progress, kept: [...new Set([...kept, current.id])] })
                setPicked(null)
              }}
              data-testid="lsh-setup-keep"
            >
              Keep this
            </button>
          </div>
        </div>
      ) : (
        <div className="lsh-setup-body" data-testid="lsh-setup-done">
          <h3>Your league is set up</h3>
          <p className="lsh-help">Everything else has a sensible default. You can still change any setting below before the draft.</p>
        </div>
      )}

      <button type="button" className="lsh-setup-hide" onClick={() => save({ ...progress, dismissed: true })} data-testid="lsh-setup-hide">
        {current ? 'Hide this' : 'Done'}
      </button>
    </section>
  )
}
