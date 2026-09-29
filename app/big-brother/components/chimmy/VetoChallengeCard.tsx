'use client'

import { useState } from 'react'
import type { BigBrotherSummary } from '@/components/big-brother/types'

interface VetoThemeState {
  themeHints?: string[]
  challengeMode?: string
}

export function VetoChallengeCard({
  leagueId,
  summary,
  onDone,
}: {
  leagueId: string
  summary: BigBrotherSummary
  onDone: () => void
}) {
  const cycle = summary.cycle
  const names = summary.rosterDisplayNames ?? {}
  const isCommissioner = summary.isCommissioner ?? false
  const challengeMode = summary.config?.challengeMode ?? 'hybrid'
  const participants = (summary.vetoChallenge?.competitorRosterIds ?? cycle?.vetoParticipantRosterIds ?? []) as string[]
  const themeHints = summary.vetoChallenge?.themeHints ?? []

  const [scores, setScores] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [revealed, setRevealed] = useState(false)

  if (!cycle?.id || participants.length === 0) return null

  const myRosterId = summary.myRosterId
  const isParticipant = myRosterId ? participants.includes(myRosterId) : false

  // Only show to veto competitors and commissioner
  if (!isParticipant && !isCommissioner) return null

  const resolveChallenge = async (winnerRosterId?: string) => {
    setBusy(true)
    setErr(null)
    try {
      const numericScores: Record<string, number> = {}
      for (const [k, v] of Object.entries(scores)) {
        const n = parseFloat(v)
        if (!isNaN(n)) numericScores[k] = n
      }
      const body: Record<string, unknown> = {}
      if (winnerRosterId) body.winnerRosterId = winnerRosterId
      else if (Object.keys(numericScores).length > 0) body.scores = numericScores
      const res = await fetch(`/api/leagues/${encodeURIComponent(leagueId)}/big-brother/veto-challenge`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error((data as { error?: string }).error ?? 'Failed')
      onDone()
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Failed')
    } finally {
      setBusy(false)
    }
  }

  const showScoreInputs = isCommissioner && challengeMode === 'deterministic_score'
  const randomTheme = themeHints.length > 0 ? themeHints[Math.floor(Math.random() * themeHints.length)] : null

  return (
    <div
      className="rounded-xl border border-violet-500/35 bg-[#0a1228] p-4 shadow-lg"
      data-testid="bb-veto-challenge-card"
    >
      <p className="text-[11px] font-bold uppercase tracking-wide text-violet-200/80">🏆 Power of Veto</p>
      <h3 className="mt-1 text-base font-bold text-white">Veto Challenge Underway</h3>
      <p className="mt-1 text-[12px] text-white/55">
        {isParticipant && !isCommissioner
          ? 'You are competing for the Power of Veto this week. Results will be revealed by your commissioner.'
          : 'Resolve who wins the Power of Veto.'}
      </p>

      {randomTheme && challengeMode !== 'deterministic_score' && (
        <div className="mt-3 rounded-lg border border-violet-500/20 bg-violet-500/10 p-3">
          <p className="text-[11px] text-violet-200/70">Challenge Theme</p>
          <p className="mt-0.5 text-[13px] font-semibold text-white">🎯 {randomTheme}</p>
        </div>
      )}

      <div className="mt-3 space-y-1.5">
        <p className="text-[11px] font-semibold uppercase tracking-wide text-white/45">Competitors</p>
        {participants.map((id) => (
          <div
            key={id}
            className="flex items-center justify-between rounded-lg border border-white/8 bg-white/[0.04] px-3 py-2"
          >
            <span className="text-[13px] font-medium text-white/90">{names[id] ?? id}</span>
            {id === myRosterId && (
              <span className="rounded-full bg-violet-500/20 px-2 py-0.5 text-[11px] font-bold uppercase text-violet-200">
                You
              </span>
            )}
          </div>
        ))}
      </div>

      {showScoreInputs && (
        <div className="mt-4 space-y-2">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-white/55">Enter Weekly Scores</p>
          {participants.map((id) => (
            <div key={id} className="flex items-center gap-2">
              <span className="min-w-0 flex-1 truncate text-[12px] text-white/70">{names[id] ?? id}</span>
              <input
                type="number"
                step="0.01"
                placeholder="pts"
                value={scores[id] ?? ''}
                onChange={(e) => setScores((prev) => ({ ...prev, [id]: e.target.value }))}
                className="w-24 rounded-lg border border-white/15 bg-white/[0.06] px-2 py-1.5 text-right text-[13px] text-white focus:outline-none focus:ring-1 focus:ring-violet-400/40"
              />
            </div>
          ))}
        </div>
      )}

      {isCommissioner && (
        <div className="mt-4 space-y-2">
          {showScoreInputs && (
            <button
              type="button"
              disabled={busy}
              onClick={() => void resolveChallenge()}
              className="w-full rounded-xl border border-violet-500/30 bg-violet-500/10 py-2.5 text-[13px] font-semibold text-violet-100 disabled:opacity-40"
            >
              {busy ? 'Resolving…' : '🎯 Resolve by Score'}
            </button>
          )}

          {challengeMode !== 'deterministic_score' && (
            <button
              type="button"
              disabled={busy}
              onClick={() => void resolveChallenge()}
              className="w-full rounded-xl border border-violet-500/30 bg-violet-500/10 py-2.5 text-[13px] font-semibold text-violet-100 disabled:opacity-40"
            >
              {busy ? 'Resolving…' : '🎲 Reveal Winner (Seeded Random)'}
            </button>
          )}

          {!revealed && (
            <button
              type="button"
              onClick={() => setRevealed(true)}
              className="w-full rounded-xl border border-white/10 bg-white/[0.04] py-2 text-[12px] text-white/55"
            >
              Pick Winner Manually ↓
            </button>
          )}
          {revealed && (
            <div className="space-y-1.5">
              <p className="text-[11px] text-white/45">Select veto winner:</p>
              {participants.map((id) => (
                <button
                  key={id}
                  type="button"
                  disabled={busy}
                  onClick={() => void resolveChallenge(id)}
                  className="w-full rounded-xl border border-white/10 bg-white/[0.04] py-2.5 text-[13px] text-white/85 disabled:opacity-40 hover:border-violet-400/30"
                >
                  {names[id] ?? id}
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {err && <p className="mt-2 text-[12px] text-red-400">{err}</p>}
    </div>
  )
}
