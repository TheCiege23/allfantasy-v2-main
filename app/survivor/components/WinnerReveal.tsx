'use client'

import { useEffect, useMemo, useRef, useState } from 'react'

interface FinalistProfile {
  userId: string
  displayName: string
  avatarUrl?: string
  tribeHistory: string[]
  immunitiesWon: number
  idolsPlayed: number
  voteCount: number
}

interface WinnerRevealProps {
  finalists: FinalistProfile[]
  winnerId: string
  totalJurors: number
  onComplete?: () => void
}

export function WinnerReveal({ finalists, winnerId, totalJurors, onComplete }: WinnerRevealProps) {
  const [phase, setPhase] = useState<'buildup' | 'counting' | 'reveal' | 'celebration'>('buildup')
  const [revealedVotes, setRevealedVotes] = useState(0)
  const onCompleteRef = useRef(onComplete)
  const winner = finalists.find((f) => f.userId === winnerId)
  const votesNeeded = totalJurors > 0 ? Math.floor(totalJurors / 2) + 1 : 0

  useEffect(() => {
    onCompleteRef.current = onComplete
  }, [onComplete])

  useEffect(() => {
    const timers: ReturnType<typeof setTimeout>[] = []
    timers.push(setTimeout(() => setPhase('counting'), 3000))

    // Reveal votes one by one
    const totalVotes = finalists.reduce((sum, f) => sum + f.voteCount, 0)
    for (let i = 1; i <= totalVotes; i++) {
      timers.push(setTimeout(() => setRevealedVotes(i), 3000 + i * 2500))
    }

    timers.push(setTimeout(() => setPhase('reveal'), 3000 + totalVotes * 2500 + 1500))
    timers.push(setTimeout(() => setPhase('celebration'), 3000 + totalVotes * 2500 + 4000))
    timers.push(setTimeout(() => onCompleteRef.current?.(), 3000 + totalVotes * 2500 + 8000))

    return () => timers.forEach(clearTimeout)
  }, [finalists])

  // Build vote sequence for counting phase
  const voteSequence = useMemo(() => {
    const sequence: string[] = []
    const maxVotes = finalists.reduce((max, finalist) => Math.max(max, finalist.voteCount), 0)

    // Interleave votes for drama without mutating source objects
    for (let round = 0; round < maxVotes; round++) {
      for (const finalist of finalists) {
        if (finalist.voteCount > round) {
          sequence.push(finalist.userId)
        }
      }
    }

    return sequence
  }, [finalists])

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/95 backdrop-blur-md">
      <div className="max-w-2xl w-full mx-4 text-center space-y-8">
        {/* Buildup */}
        {phase === 'buildup' && (
          <div className="animate-pulse space-y-3">
            <div className="text-xs uppercase tracking-[0.4em] text-amber-300/50">Final Elimination Council</div>
            <div className="text-2xl font-bold text-white">The jury has voted.</div>
            <div className="text-sm text-white/40">Once the votes are read, the decision is final.</div>
          </div>
        )}

        {/* Vote counting */}
        {(phase === 'counting' || phase === 'reveal' || phase === 'celebration') && (
          <>
            {/* Finalist cards with live vote counts */}
            <div className="flex justify-center gap-4">
              {finalists.map((f) => {
                const currentVotes = voteSequence.slice(0, revealedVotes).filter((id) => id === f.userId).length
                const isWinner = (phase === 'reveal' || phase === 'celebration') && f.userId === winnerId

                return (
                  <div
                    key={f.userId}
                    className={`rounded-2xl border p-5 w-48 transition-all duration-700 ${
                      isWinner
                        ? 'border-amber-400/60 bg-amber-400/10 scale-105 ring-2 ring-amber-400/30'
                        : 'border-white/10 bg-white/[0.03]'
                    }`}
                  >
                    <div className="h-16 w-16 mx-auto rounded-full bg-white/10 mb-3 flex items-center justify-center text-2xl">
                      {f.avatarUrl ? (
                        <img src={f.avatarUrl} alt="" className="rounded-full h-full w-full object-cover" />
                      ) : (
                        <span className="text-white/40">{f.displayName[0]}</span>
                      )}
                    </div>
                    <div className="text-sm font-medium text-white mb-1">{f.displayName}</div>
                    <div className="text-3xl font-bold text-amber-300">{currentVotes}</div>
                    <div className="text-xs text-white/40">vote{currentVotes !== 1 ? 's' : ''}</div>
                    {f.tribeHistory.length > 0 && (
                      <div className="mt-2 text-xs text-white/30">{f.tribeHistory.join(' → ')}</div>
                    )}
                  </div>
                )
              })}
            </div>

            {/* Votes needed indicator */}
            {phase === 'counting' && (
              <div className="text-xs text-white/40">
                {votesNeeded} votes needed to win · {revealedVotes}/{voteSequence.length} read
              </div>
            )}
          </>
        )}

        {/* Winner reveal */}
        {phase === 'reveal' && winner && (
          <div className="animate-pulse space-y-2">
            <div className="text-xs uppercase tracking-[0.3em] text-amber-300/60">The Sole Survivor is...</div>
            <div className="text-4xl font-bold text-amber-100">{winner.displayName}</div>
          </div>
        )}

        {/* Celebration */}
        {phase === 'celebration' && winner && (
          <div className="space-y-4">
            <div className="text-xs uppercase tracking-[0.3em] text-amber-300/60">Sole Survivor</div>
            <div className="text-4xl font-bold text-amber-100">{winner.displayName}</div>
            <div className="flex justify-center gap-4 text-xs text-white/40">
              <span>{winner.immunitiesWon} immunities</span>
              <span>{winner.idolsPlayed} idols played</span>
              <span>{winner.voteCount}/{totalJurors} jury votes</span>
            </div>
            <button
              onClick={onComplete}
              className="mt-4 rounded-2xl border border-amber-400/40 bg-amber-400/10 px-8 py-3 text-sm font-medium text-amber-100 hover:bg-amber-400/20 transition"
            >
              View Season Recap
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
