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
      <div className="rounded-xl border border-purple-500/20 bg-purple-950/20 p-4">
        <h3 className="flex items-center gap-2 text-sm font-medium text-purple-200">
          <span className="text-base">&#9878;</span> Jury members
        </h3>
        {jury.length === 0 ? (
          <p className="mt-2 text-sm text-white/50">No jury yet. Jury starts per league config (after X eliminations or when X players remain).</p>
        ) : (
          <ul className="mt-2 space-y-1 text-sm">
            {jury.map((j) => (
              <li key={j.rosterId} className="flex items-center justify-between rounded-lg border border-purple-500/10 bg-purple-950/10 px-3 py-1.5">
                <span className="text-purple-100">{names[j.rosterId] ?? j.rosterId}</span>
                <span className="text-[11px] text-white/40">evicted week {j.evictedWeek}</span>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Finalists */}
      {finaleReached && (
        <div className="rounded-xl border border-amber-500/30 bg-gradient-to-b from-amber-950/20 to-transparent p-4">
          <h3 className="flex items-center gap-2 text-sm font-medium text-amber-200">
            <span className="text-base">&#127942;</span> Final {finaleSize}
          </h3>
          <p className="mt-1 text-xs text-white/50">
            These houseguests made it to the end. The jury will now decide the winner.
          </p>
          <div className="mt-3 grid gap-2 sm:grid-cols-2">
            {finalists.map((f) => (
              <div
                key={f.rosterId}
                className="rounded-lg border border-amber-500/20 bg-amber-950/10 p-3"
              >
                <p className="text-sm font-medium text-amber-100">{names[f.rosterId] ?? f.rosterId}</p>
                {f.stats && (
                  <p className="mt-1 text-[11px] text-white/50">
                    {f.stats.hohWins ?? 0} HOH wins · {f.stats.vetoWins ?? 0} Veto wins · {f.stats.timesNominated ?? 0}x nominated
                  </p>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Finale vote ballot — inline for jury members */}
      {isJuryMember && finaleReached && (
        <div className="rounded-xl border border-cyan-500/20 bg-cyan-950/15 p-4">
          <h3 className="flex items-center gap-2 text-sm font-medium text-cyan-200">
            <span className="text-base">&#128499;</span> Your finale vote
          </h3>
          <p className="mt-1 text-xs text-white/50">
            As a jury member, you decide who wins. Your vote is private and counted by the game engine.
          </p>

          {voteResult ? (
            <div className="mt-3 rounded-lg border border-emerald-500/20 bg-emerald-950/20 px-3 py-2 text-xs text-emerald-300">
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
                        ? 'border-cyan-500/40 bg-cyan-500/10'
                        : 'border-white/10 bg-white/[0.02] hover:bg-white/[0.04]'
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
                    <span className="text-sm text-white/90">{names[f.rosterId] ?? f.rosterId}</span>
                  </label>
                ))}
              </div>

              {voteError && (
                <div className="mt-2 rounded-lg border border-red-500/20 bg-red-950/20 px-3 py-2 text-xs text-red-300">
                  {voteError}
                </div>
              )}

              <button
                type="button"
                disabled={!selectedFinalist || submitting}
                onClick={submitFinaleVote}
                className="mt-3 rounded-lg bg-gradient-to-r from-cyan-600/80 to-purple-600/80 px-4 py-2 text-sm font-medium text-white hover:from-cyan-600 hover:to-purple-600 disabled:opacity-50"
              >
                {submitting ? 'Submitting...' : 'Cast finale vote'}
              </button>
            </>
          )}
        </div>
      )}

      <p className="text-xs text-white/40">
        Finalist summaries and season narratives are available from the AI Finale Moderator (Chimmy / Big Brother AI).
      </p>
    </div>
  )
}
