'use client'

/**
 * [UPDATED] Jury Center: jury members list, finalist summary cards, inline finale vote ballot.
 */

import { useCallback, useState } from 'react'
import type { BigBrotherSummary } from './types'

interface BigBrotherJuryCenterProps {
  leagueId: string
  summary: BigBrotherSummary
}

/** "1 Veto win", "2 Veto wins", "nominated 1 time" (it printed "1 Veto wins" and "0x nominated"). */
const plural = (n: number, one: string) => `${n} ${n === 1 ? one : `${one}s`}`

export function BigBrotherJuryCenter({ leagueId, summary }: BigBrotherJuryCenterProps) {
  const names = summary.rosterDisplayNames ?? {}
  const jury = summary.jury ?? []
  const finalists = summary.finalists ?? []

  const isJuryMember = summary.myRosterId && jury.some((j) => j.rosterId === summary.myRosterId)
  const finaleSize = summary.config?.finaleFormat === 'final_3' ? 3 : 2
  const remainingCount = summary.remainingCount ?? 0
  const finaleReached = remainingCount > 0 && remainingCount <= finaleSize

  const [selectedFinalist, setSelectedFinalist] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [voteResult, setVoteResult] = useState<string | null>(null)
  const [voteError, setVoteError] = useState<string | null>(null)

  const submitFinaleVote = useCallback(async () => {
    if (!selectedFinalist) return
    setSubmitting(true)
    setVoteError(null)
    try {
      const res = await fetch(`/api/leagues/${encodeURIComponent(leagueId)}/big-brother/finale-vote`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ targetRosterId: selectedFinalist }),
      })
      const data = await res.json()
      if (res.ok) {
        setVoteResult(`Vote recorded for ${names[selectedFinalist] ?? 'finalist'}. You can change it until the commissioner closes voting.`)
      } else {
        setVoteError(data.error ?? 'Failed to submit vote')
      }
    } catch {
      setVoteError('Request failed')
    } finally {
      setSubmitting(false)
    }
  }, [leagueId, selectedFinalist, names])

  return (
    <div className="space-y-4">
      {/* Jury members */}
      <div className="rounded-xl border border-[var(--accent-line)] bg-[var(--accent-soft)] p-4">
        <h3 className="flex items-center gap-2 text-sm font-medium text-[var(--accent)]">
          <span className="text-base">&#9878;</span> Jury members
        </h3>
        {jury.length === 0 ? (
          <p className="mt-2 text-sm text-[var(--muted)]">No jury yet. It starts later in the season, as set in your league settings.</p>
        ) : (
          <ul className="mt-2 space-y-1 text-sm">
            {jury.map((j) => (
              <li key={j.rosterId} className="flex items-center justify-between rounded-lg border border-[var(--accent-line)] bg-[var(--accent-soft)] px-3 py-1.5">
                <span className="text-[var(--accent)]">{names[j.rosterId] ?? j.rosterId}</span>
                <span className="text-[11px] text-[var(--muted)]">evicted week {j.evictedWeek}</span>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Finalists */}
      {finaleReached && (
        <div className="rounded-xl border border-[var(--line2)] bg-[var(--warn-soft)] p-4">
          <h3 className="flex items-center gap-2 text-sm font-medium text-[var(--warn)]">
            <span className="text-base">&#127942;</span> Final {finaleSize}
          </h3>
          <p className="mt-1 text-xs text-[var(--muted)]">
            These houseguests made it to the end. The jury will now decide the winner.
          </p>
          <div className="mt-3 grid gap-2 sm:grid-cols-2">
            {finalists.map((f) => (
              <div
                key={f.rosterId}
                className="rounded-lg border border-[var(--line2)] bg-[var(--warn-soft)] p-3"
              >
                <p className="text-sm font-medium text-[var(--warn)]">{names[f.rosterId] ?? f.rosterId}</p>
                {f.stats && (
                  <p className="mt-1 text-[11px] text-[var(--muted)]">
                    {plural(f.stats.hohWins ?? 0, 'HOH win')} · {plural(f.stats.vetoWins ?? 0, 'Veto win')} · nominated {plural(f.stats.timesNominated ?? 0, 'time')}
                  </p>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Finale vote ballot — inline for jury members */}
      {isJuryMember && finaleReached && (
        <div className="rounded-xl border border-[var(--accent-line)] bg-[var(--accent-soft)] p-4">
          <h3 className="flex items-center gap-2 text-sm font-medium text-[var(--accent)]">
            <span className="text-base">&#128499;</span> Your finale vote
          </h3>
          <p className="mt-1 text-xs text-[var(--muted)]">
            As a jury member, you decide who wins. Your vote is private.
          </p>

          {voteResult ? (
            <div className="mt-3 rounded-lg border border-[var(--good)] bg-[var(--good-soft)] px-3 py-2 text-xs text-[var(--good)]">
              {voteResult}
            </div>
          ) : (
            <>
              <div className="mt-3 space-y-2">
                {finalists.map((f) => (
                  <label
                    key={f.rosterId}
                    className={`flex cursor-pointer items-center gap-3 rounded-lg border p-3 transition ${
                      selectedFinalist === f.rosterId
                        ? 'border-[var(--accent-line)] bg-[var(--accent-soft)]'
                        : 'border-[var(--line)] bg-white/[0.02] hover:bg-white/[0.04]'
                    }`}
                  >
                    <input
                      type="radio"
                      name="finale-vote"
                      value={f.rosterId}
                      checked={selectedFinalist === f.rosterId}
                      onChange={() => setSelectedFinalist(f.rosterId)}
                      className="accent-cyan-500"
                    />
                    <span className="text-sm text-[var(--text)]">{names[f.rosterId] ?? f.rosterId}</span>
                  </label>
                ))}
              </div>

              {voteError && (
                <div className="mt-2 rounded-lg border border-[var(--bad)] bg-[var(--bad-soft)] px-3 py-2 text-xs text-[var(--bad)]">
                  {voteError}
                </div>
              )}

              <button
                type="button"
                disabled={!selectedFinalist || submitting}
                onClick={submitFinaleVote}
                className="mt-3 rounded-lg bg-[var(--accent)] px-4 py-2 text-sm font-semibold text-[var(--accent-ink)] hover:opacity-90 disabled:opacity-50"
              >
                {submitting ? 'Submitting...' : 'Cast finale vote'}
              </button>
            </>
          )}
        </div>
      )}

      <p className="text-xs text-[var(--muted)]">Ask Chimmy for each finalist’s season story.</p>
    </div>
  )
}
