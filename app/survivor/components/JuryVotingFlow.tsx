'use client'

import { useState } from 'react'
import { Crown, Check, AlertTriangle } from 'lucide-react'
import { Button } from '@/components/ui/button'

interface Finalist {
  userId: string
  displayName: string
  avatarUrl?: string
  tribeHistory: string[]
  immunitiesWon: number
  idolsPlayed: number
  journeySummary?: string
}

interface JuryVotingFlowProps {
  leagueId: string
  sessionId: string
  finalists: Finalist[]
  hasVoted: boolean
  existingVote?: string
  deadline: string
  onVoteSubmitted: () => void
}

export function JuryVotingFlow({
  leagueId,
  sessionId,
  finalists,
  hasVoted,
  existingVote,
  deadline,
  onVoteSubmitted,
}: JuryVotingFlowProps) {
  const [selected, setSelected] = useState<string | null>(existingVote ?? null)
  const [confirming, setConfirming] = useState(false)
  const [submitted, setSubmitted] = useState(hasVoted)
  const [error, setError] = useState<string | null>(null)

  const deadlineDate = new Date(deadline)
  const isPastDeadline = Date.now() > deadlineDate.getTime()

  const handleSubmit = async () => {
    if (!selected) return
    setError(null)
    try {
      const res = await fetch(`/api/leagues/${leagueId}/survivor/finale/vote`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId, finalistUserId: selected }),
      })
      if (!res.ok) {
        const data = await res.json()
        throw new Error(data.error ?? 'Vote failed')
      }
      setSubmitted(true)
      setConfirming(false)
      onVoteSubmitted()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to submit vote')
      setConfirming(false)
    }
  }

  if (submitted) {
    const votedFor = finalists.find((f) => f.userId === (existingVote ?? selected))
    return (
      <div className="rounded-2xl border border-emerald-400/20 bg-emerald-400/5 p-6 text-center">
        <Check className="h-8 w-8 text-emerald-400 mx-auto mb-3" />
        <div className="text-sm font-medium text-emerald-100">Your jury vote has been cast</div>
        {votedFor && (
          <div className="mt-2 text-xs text-emerald-300/60">
            You voted for {votedFor.displayName}
          </div>
        )}
        <div className="mt-3 text-xs text-white/30">
          Your vote is final and cannot be changed.
        </div>
      </div>
    )
  }

  if (isPastDeadline) {
    return (
      <div className="rounded-2xl border border-red-400/20 bg-red-400/5 p-6 text-center">
        <AlertTriangle className="h-8 w-8 text-red-400 mx-auto mb-3" />
        <div className="text-sm font-medium text-red-100">Voting deadline has passed</div>
        <div className="mt-2 text-xs text-red-300/60">
          Your vote was recorded as late or not submitted.
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-5">
      <div className="text-center">
        <Crown className="h-6 w-6 text-amber-400 mx-auto mb-2" />
        <div className="text-lg font-semibold text-white">Final Elimination Council</div>
        <div className="text-xs text-white/40 mt-1">
          Vote for the player you believe deserves the title of Sole Survivor
        </div>
        <div className="text-xs text-amber-300/60 mt-2">
          Deadline: {deadlineDate.toLocaleString()}
        </div>
      </div>

      {/* Finalist cards */}
      <div className="grid gap-3 sm:grid-cols-3">
        {finalists.map((f) => (
          <button
            key={f.userId}
            type="button"
            onClick={() => { setSelected(f.userId); setConfirming(false) }}
            className={`rounded-2xl border p-4 text-left transition-all ${
              selected === f.userId
                ? 'border-amber-400/60 bg-amber-400/10 ring-1 ring-amber-400/20 scale-[1.02]'
                : 'border-white/10 bg-white/[0.03] hover:border-white/20'
            }`}
          >
            <div className="flex items-center gap-3 mb-3">
              <div className="h-12 w-12 rounded-full bg-white/10 flex items-center justify-center text-lg">
                {f.avatarUrl ? (
                  <img src={f.avatarUrl} alt="" className="rounded-full h-full w-full object-cover" />
                ) : (
                  <span className="text-white/40">{f.displayName[0]}</span>
                )}
              </div>
              <div>
                <div className="text-sm font-medium text-white">{f.displayName}</div>
                <div className="text-xs text-white/40">{f.tribeHistory.join(' → ')}</div>
              </div>
            </div>
            <div className="flex gap-3 text-xs text-white/50">
              <span>{f.immunitiesWon} immunities</span>
              <span>{f.idolsPlayed} idols</span>
            </div>
            {f.journeySummary && (
              <div className="mt-2 text-xs text-white/30 line-clamp-2">{f.journeySummary}</div>
            )}
          </button>
        ))}
      </div>

      {/* Vote action */}
      {selected && !confirming && (
        <div className="text-center">
          <Button onClick={() => setConfirming(true)}>
            Vote for {finalists.find((f) => f.userId === selected)?.displayName}
          </Button>
        </div>
      )}

      {selected && confirming && (
        <div className="rounded-xl border border-amber-400/30 bg-amber-400/5 p-4 text-center space-y-3">
          <div className="text-sm text-amber-100">
            Cast your vote for <strong>{finalists.find((f) => f.userId === selected)?.displayName}</strong>?
          </div>
          <div className="text-xs text-amber-300/50">This vote is final and cannot be changed.</div>
          <div className="flex justify-center gap-3">
            <Button variant="outline" size="sm" onClick={() => setConfirming(false)}>Cancel</Button>
            <Button size="sm" onClick={handleSubmit}>Confirm Vote</Button>
          </div>
        </div>
      )}

      {error && (
        <div className="rounded-lg border border-red-400/30 bg-red-500/10 px-4 py-2 text-sm text-red-100 text-center">
          {error}
        </div>
      )}
    </div>
  )
}
