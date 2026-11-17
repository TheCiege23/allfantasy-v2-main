'use client'

/**
 * [NEW] Private voting UI: ballot, submit/change, lock after deadline, error state. PROMPT 4.
 */

import { useState } from 'react'
import type { BigBrotherSummary } from './types'
import { useUserTimezone } from '@/hooks/useUserTimezone'

interface BigBrotherVotingBallotProps {
  leagueId: string
  summary: BigBrotherSummary
  onVoted?: () => void
}

export function BigBrotherVotingBallot({ leagueId, summary, onVoted }: BigBrotherVotingBallotProps) {
  const { formatInTimezone } = useUserTimezone()
  const [targetId, setTargetId] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState(false)

  const ballot = summary.ballot
  const cycle = summary.cycle
  const names = summary.rosterDisplayNames ?? {}
  const nominees = summary.finalNomineeRosterIds

  const handleSubmit = async () => {
    if (!targetId || !cycle?.id) return
    setSubmitting(true)
    setError(null)
    setSuccess(false)
    try {
      const res = await fetch(`/api/leagues/${encodeURIComponent(leagueId)}/big-brother/vote`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cycleId: cycle.id, targetRosterId: targetId }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError((data as { error?: string }).error ?? 'Vote failed')
        return
      }
      setSuccess(true)
      onVoted?.()
    } catch {
      setError('Vote failed')
    } finally {
      setSubmitting(false)
    }
  }

  if (!ballot) {
    return (
      <div className="rounded-xl border border-white/10 bg-white/[0.03] p-4 text-sm text-white/50">
        No active ballot for this week.
      </div>
    )
  }

  if (ballot.closed) {
    return (
      <div className="rounded-xl border border-white/10 bg-white/[0.03] p-4">
        <h3 className="text-sm font-medium text-white/90">Voting closed</h3>
        <p className="mt-1 text-sm text-white/50">Eviction results will be announced in league chat.</p>
      </div>
    )
  }

  if (!ballot.canVote) {
    return (
      <div className="rounded-xl border border-amber-500/30 bg-amber-950/20 p-4">
        <h3 className="text-sm font-medium text-amber-200">Not eligible to vote</h3>
        <p className="mt-1 text-sm text-amber-200/80">You are either on the block, the HOH (if voting only in tie), or evicted. Only eligible houseguests can submit an eviction vote.</p>
      </div>
    )
  }

  if (nominees.length < 2) {
    return (
      <div className="rounded-xl border border-white/10 bg-white/[0.03] p-4 text-sm text-white/50">
        Final nominees not yet set. Check back after the veto ceremony.
      </div>
    )
  }

  return (
    <div className="rounded-xl border border-white/10 bg-white/[0.03] p-4">
      <h3 className="text-sm font-medium text-white/90">Eviction vote</h3>
      <p className="mt-1 text-xs text-white/50">Vote for who you want to evict. Last vote before the deadline counts. Votes are private.</p>
      {ballot.voteDeadlineAt && (
        <p className="mt-1 text-xs text-white/50">Deadline: {formatInTimezone(ballot.voteDeadlineAt)}</p>
      )}

      <div className="mt-4 space-y-2">
        {nominees.map((id) => (
          <label key={id} className="flex cursor-pointer items-center gap-3 rounded-lg border border-white/10 bg-white/5 px-3 py-2 hover:bg-white/10">
            <input
              type="radio"
              name="eviction-vote"
              checked={targetId === id}
              onChange={() => setTargetId(id)}
              className="h-4 w-4"
            />
            <span className="text-white/90">{names[id] ?? id}</span>
          </label>
        ))}
      </div>

      {error && <p className="mt-2 text-sm text-red-300">{error}</p>}
      {success && <p className="mt-2 text-sm text-emerald-300">Vote recorded. You can change it until the deadline.</p>}

      <button
        type="button"
        onClick={handleSubmit}
        disabled={!targetId || submitting}
        className="mt-4 rounded-xl bg-amber-500/20 px-4 py-2 text-sm font-medium text-amber-200 hover:bg-amber-500/30 disabled:opacity-50"
      >
        {submitting ? 'Submitting…' : 'Submit vote'}
      </button>
    </div>
  )
}
