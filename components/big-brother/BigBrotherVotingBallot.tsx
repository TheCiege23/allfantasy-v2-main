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
      <div className="rounded-xl border border-[var(--line)] bg-white/[0.03] p-4 text-sm text-[var(--muted)]">
        No active ballot for this week.
      </div>
    )
  }

  if (ballot.closed) {
    return (
      <div className="rounded-xl border border-[var(--line)] bg-white/[0.03] p-4">
        <h3 className="text-sm font-medium text-[var(--text)]">Voting closed</h3>
        <p className="mt-1 text-sm text-[var(--muted)]">Eviction results will be announced in league chat.</p>
      </div>
    )
  }

  if (!ballot.canVote) {
    // Why there is no ballot (2026-11-23): before the vote opens a safe player was told "Not eligible to vote".
    const status = summary.myStatus
    const voteOpen = summary.cycle?.phase === 'VOTING_OPEN'
    const [title, body] = !voteOpen
      ? ['No vote yet this week', 'The eviction vote opens after the Veto meeting.']
      : status === 'NOMINATED'
        ? ['You’re on the block', 'Nominees don’t vote. The house decides.']
        : status === 'HOH'
          ? ['You don’t vote this time', 'The Head of Household only votes to break a tie.']
          : status === 'ELIMINATED' || status === 'JURY'
            ? ['You’re out of the house', 'Evicted houseguests don’t vote on evictions.']
            : ['You can’t vote this week', 'Only houseguests in the house who aren’t nominated vote.']
    return (
      <div className="rounded-xl border border-[var(--line)] bg-white/[0.03] p-4">
        <h3 className="text-sm font-medium text-[var(--text)]">{title}</h3>
        <p className="mt-1 text-sm text-[var(--text2)]">{body}</p>
      </div>
    )
  }

  if (nominees.length < 2) {
    return (
      <div className="rounded-xl border border-[var(--line)] bg-white/[0.03] p-4 text-sm text-[var(--muted)]">
        Final nominees not yet set. Check back after the veto ceremony.
      </div>
    )
  }

  return (
    <div className="rounded-xl border border-[var(--line)] bg-white/[0.03] p-4">
      <h3 className="text-sm font-medium text-[var(--text)]">Eviction vote</h3>
      <p className="mt-1 text-xs text-[var(--muted)]">Vote for who you want to evict. Last vote before the deadline counts. Votes are private.</p>
      {ballot.voteDeadlineAt && (
        <p className="mt-1 text-xs text-[var(--muted)]">Deadline: {formatInTimezone(ballot.voteDeadlineAt)}</p>
      )}

      <div className="mt-4 space-y-2">
        {nominees.map((id) => (
          <label key={id} className="flex cursor-pointer items-center gap-3 rounded-lg border border-[var(--line)] bg-[var(--chip)] px-3 py-2 hover:bg-[var(--chip)]">
            <input
              type="radio"
              name="eviction-vote"
              checked={targetId === id}
              onChange={() => setTargetId(id)}
              className="h-4 w-4"
            />
            <span className="text-[var(--text)]">{names[id] ?? id}</span>
          </label>
        ))}
      </div>

      {error && <p className="mt-2 text-sm text-[var(--bad)]">{error}</p>}
      {success && <p className="mt-2 text-sm text-[var(--good)]">Vote recorded. You can change it until the deadline.</p>}

      <button
        type="button"
        onClick={handleSubmit}
        disabled={!targetId || submitting}
        className="mt-4 rounded-xl bg-[var(--warn-soft)] px-4 py-2 text-sm font-medium text-[var(--warn)] hover:bg-[var(--warn-soft)] disabled:opacity-50"
      >
        {submitting ? 'Submitting…' : 'Submit vote'}
      </button>
    </div>
  )
}
