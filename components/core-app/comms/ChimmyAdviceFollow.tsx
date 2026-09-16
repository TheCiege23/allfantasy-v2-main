'use client'

import { useState } from 'react'

/**
 * "Did it / Not doing it" under advice Chimmy put on file (brief item 10, user decision 2026-09-16:
 * "Buttons + inferred").
 *
 * The vote is sent to the existing personalization event route with the advice's key — the same
 * key the Receipts card and the outcome loop use — so changing your mind, or tapping a button for
 * an add Sleeper also shows, still counts once (`lib/chimmy-outcomes/followThrough.ts`).
 *
 * ⚠ OPTIONAL AND QUIET. Nothing is inferred from NOT tapping: the platform fills that in later.
 * The chosen vote is kept on the turn (`onVoted`), so reopening the drawer shows it.
 */

export type ChimmyAdviceRef = {
  key: string
  type: 'add'
  playerName: string
  vote?: ChimmyAdviceVote | null
}

export type ChimmyAdviceVote = 'did' | 'not'

export function ChimmyAdviceFollow({
  advice,
  onVoted,
}: {
  advice: ChimmyAdviceRef
  onVoted?: (vote: ChimmyAdviceVote) => void
}) {
  const [vote, setVote] = useState<ChimmyAdviceVote | null>(advice.vote ?? null)
  const [saving, setSaving] = useState(false)
  const [failed, setFailed] = useState(false)

  const send = async (next: ChimmyAdviceVote) => {
    if (saving || vote === next) return
    setSaving(true)
    setFailed(false)
    try {
      const res = await fetch('/api/user/chimmy-personalization/event', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          type: next === 'did' ? 'recommendation_accepted' : 'recommendation_rejected',
          metadata: { adviceKey: advice.key, adviceType: advice.type, surface: 'core_comms' },
        }),
      })
      if (!res.ok) throw new Error(`status ${res.status}`)
      setVote(next)
      onVoted?.(next)
    } catch {
      setFailed(true)
    } finally {
      setSaving(false)
    }
  }

  const question = `Add ${advice.playerName}?`
  return (
    <div className="af-cm-follow" role="group" aria-label={question}>
      <span className="af-cm-follow-q">{question}</span>
      <button
        type="button"
        className="af-cm-follow-btn"
        aria-pressed={vote === 'did'}
        disabled={saving}
        onClick={() => void send('did')}
      >
        Did it
      </button>
      <button
        type="button"
        className="af-cm-follow-btn"
        aria-pressed={vote === 'not'}
        disabled={saving}
        onClick={() => void send('not')}
      >
        Not doing it
      </button>
      {vote && !failed ? (
        <span className="af-cm-follow-note" role="status">
          Noted. Chimmy learns from what you actually do.
        </span>
      ) : null}
      {failed ? (
        <span className="af-cm-follow-note" data-tone="bad" role="status">
          That did not save. Try again.
        </span>
      ) : null}
    </div>
  )
}
