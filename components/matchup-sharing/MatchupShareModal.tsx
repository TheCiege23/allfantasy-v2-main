'use client'

import { useCallback, useState } from 'react'
import { MatchupShareCard, MATCHUP_SHARE_CARD_ID } from './MatchupShareCard'
import { MatchupShareBar } from './MatchupShareBar'
import type { MatchupSharePayload } from '@/lib/matchup-sharing/types'

interface MatchupShareModalProps {
  team1Name: string
  team2Name: string
  projectedScore1: number
  projectedScore2: number
  winProbabilityA: number
  winProbabilityB: number
  sport?: string
  weekOrRound?: string
  /** Optional key players (e.g. from lineup) */
  keyPlayers?: string[]
  onClose: () => void
  className?: string
}

export function MatchupShareModal({
  team1Name,
  team2Name,
  projectedScore1,
  projectedScore2,
  winProbabilityA,
  winProbabilityB,
  sport,
  weekOrRound,
  keyPlayers = [],
  onClose,
  className = '',
}: MatchupShareModalProps) {
  const [step, setStep] = useState<'creating' | 'sharing'>('creating')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [shareUrl, setShareUrl] = useState('')
  const [payload, setPayload] = useState<MatchupSharePayload | null>(null)
  const [keyPlayersInput, setKeyPlayersInput] = useState(
    keyPlayers?.length ? keyPlayers.join(', ') : ''
  )
  const resolvedKeyPlayers = keyPlayersInput
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)

  const projectedWinner = projectedScore1 >= projectedScore2 ? team1Name : team2Name
  const winnerProb = projectedScore1 >= projectedScore2 ? winProbabilityA * 100 : winProbabilityB * 100

  const createShare = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/share/matchup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          team1Name,
          team2Name,
          projectedScoreA: projectedScore1,
          projectedScoreB: projectedScore2,
          winProbabilityA: winProbabilityA * 100,
          winProbabilityB: winProbabilityB * 100,
          keyPlayers: resolvedKeyPlayers.length ? resolvedKeyPlayers : keyPlayers?.length ? keyPlayers : undefined,
          sport,
          weekOrRound,
        }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(data.error || 'Failed to create share')
        return
      }
      setShareUrl(data.shareUrl || '')
      setPayload(data.payload || null)
      setStep('sharing')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong')
    } finally {
      setLoading(false)
    }
  }, [
    team1Name,
    team2Name,
    projectedScore1,
    projectedScore2,
    winProbabilityA,
    winProbabilityB,
    resolvedKeyPlayers.length ? resolvedKeyPlayers : keyPlayers,
    sport,
    weekOrRound,
    keyPlayersInput,
  ])

  if (step === 'sharing' && payload) {
    return (
      <div
        className={`fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 ${className}`}
        onClick={(e) => e.target === e.currentTarget && onClose()}
      >
        <div className="bg-zinc-900 rounded-2xl border border-zinc-700 p-6 max-w-full overflow-auto">
          <div className="flex justify-end mb-2">
            <button type="button" onClick={onClose} className="text-zinc-400 hover:text-white text-sm">
              Close
            </button>
          </div>
          <div className="flex flex-col items-center gap-4">
            <MatchupShareCard payload={payload} captureId={MATCHUP_SHARE_CARD_ID} />
            <MatchupShareBar payload={payload} shareUrl={shareUrl} />
          </div>
        </div>
      </div>
    )
  }

  const previewPayload: MatchupSharePayload = {
    team1Name,
    team2Name,
    projectedWinner,
    winProbability: winnerProb,
    projectedScore1,
    projectedScore2,
    keyPlayers: resolvedKeyPlayers.length ? resolvedKeyPlayers : (keyPlayers?.length ? keyPlayers : undefined),
    sport,
    weekOrRound,
  }

  return (
    <div
      className={`fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 ${className}`}
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="bg-zinc-900 rounded-2xl border border-zinc-700 p-6 max-w-xl w-full max-h-[90vh] overflow-auto">
        <div className="flex justify-between items-center mb-4">
          <h3 className="font-bold text-white">Share matchup</h3>
          <button type="button" onClick={onClose} className="text-zinc-400 hover:text-white text-xl leading-none">
            ×
          </button>
        </div>
        <p className="text-sm text-zinc-400 mb-4">
          Create an image and link to share on X, Reddit, Discord, or Instagram.
        </p>
        {error && <p className="text-sm text-red-400 mb-3">{error}</p>}
        <div className="mb-3">
          <label className="block text-xs text-zinc-500 mb-1">Key players (optional, comma-separated)</label>
          <input
            type="text"
            value={keyPlayersInput}
            onChange={(e) => setKeyPlayersInput(e.target.value)}
            placeholder="e.g. Josh Allen, CeeDee Lamb"
            className="w-full rounded-lg border border-zinc-600 bg-zinc-800 px-3 py-2 text-sm text-white placeholder:text-zinc-500"
          />
        </div>
        <div className="mb-4">
          <MatchupShareCard payload={previewPayload} captureId={MATCHUP_SHARE_CARD_ID} />
        </div>
        <button
          type="button"
          disabled={loading}
          onClick={createShare}
          className="w-full rounded-xl bg-amber-600 text-white px-4 py-2.5 font-medium hover:bg-amber-500 disabled:opacity-60"
        >
          {loading ? 'Creating link…' : 'Create share link'}
        </button>
      </div>
    </div>
  )
}
