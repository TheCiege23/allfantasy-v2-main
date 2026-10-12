'use client'

import { useEffect, useState } from 'react'
import { Users, Scale, Calendar } from 'lucide-react'
import type { SurvivorSummary } from './types'
import { SurvivorShareCard } from './SurvivorShareCard'

export interface SurvivorMergeJuryViewProps {
  leagueId: string
  summary: SurvivorSummary
  names: Record<string, string>
  onRefresh?: () => Promise<void> | void
}

/**
 * Merge / Jury View: merged tribe identity, jury members, finalist path, finale timeline.
 */
export function SurvivorMergeJuryView({ leagueId, summary, names, onRefresh }: SurvivorMergeJuryViewProps) {
  const { merged, jury, config, finale } = summary
  const mergeWeek = config.mergeWeek ?? 0
  const [selectedFinalistId, setSelectedFinalistId] = useState<string>(finale?.myJuryVote?.finalistRosterId ?? finale?.finalists[0]?.rosterId ?? '')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const myRosterId = summary.myRosterId ?? null
  const isJuror = Boolean(myRosterId && jury.some((member) => member.rosterId === myRosterId))
  const isFinalist = Boolean(myRosterId && finale?.finalists.some((finalist) => finalist.rosterId === myRosterId))

  useEffect(() => {
    setSelectedFinalistId(finale?.myJuryVote?.finalistRosterId ?? finale?.finalists[0]?.rosterId ?? '')
  }, [finale?.myJuryVote?.finalistRosterId, finale?.finalists])

  async function handleSubmitJuryVote() {
    if (!finale?.open || !selectedFinalistId) return
    setSubmitting(true)
    setError(null)
    setMessage(null)
    try {
      const res = await fetch(`/api/leagues/${encodeURIComponent(leagueId)}/survivor/finale/vote`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          finalistRosterId: selectedFinalistId,
          week: summary.currentWeek,
        }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(data.error ?? `Error ${res.status}`)
        return
      }
      setMessage(
        data.winnerRosterId
          ? `Vote recorded. ${names[data.winnerRosterId] ?? data.winnerRosterId} has been crowned the Survivor winner.`
          : `Vote recorded for ${names[selectedFinalistId] ?? selectedFinalistId}.`
      )
      await onRefresh?.()
    } catch {
      setError('Failed to submit jury vote')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="space-y-6">
      <section className="rounded-2xl border border-white/10 bg-white/[0.03] p-4 sm:p-6">
        <h2 className="mb-4 flex items-center gap-2 text-lg font-semibold text-white">
          <Users className="h-5 w-5 text-amber-400" />
          Merge status
        </h2>
        {merged ? (
          <div className="rounded-xl border border-amber-500/30 bg-amber-950/20 p-3">
            <img src="/survivor/late/merge-banner.svg" alt="" className="mb-3 h-28 w-full object-contain" />
            <p className="font-medium text-amber-200">The merge has happened.</p>
            <p className="mt-1 text-sm text-white/60">All remaining players are one tribe. Elimination Council now includes everyone.</p>
          </div>
        ) : (
          <p className="text-sm text-white/70">
            Merge triggers at week <strong className="text-white">{mergeWeek}</strong> (or by player count if configured). Pre-merge: one tribe attends Elimination Council each week.
          </p>
        )}
      </section>

      <section className="rounded-2xl border border-white/10 bg-white/[0.03] p-4 sm:p-6">
        <h2 className="mb-4 flex items-center gap-2 text-lg font-semibold text-white">
          <Scale className="h-5 w-5 text-cyan-400" />
          Jury
        </h2>
        {jury.length > 0 && <img src="/survivor/late/jury-bench.svg" alt="" className="mb-3 h-32 w-full object-contain" />}
        {config.juryStartAfterMerge && (
          <p className="mb-3 text-sm text-white/50">Jury starts after merge. Voted-out players join the jury.</p>
        )}
        {jury.length === 0 ? (
          <p className="text-sm text-white/50">No jury members yet.</p>
        ) : (
          <ul className="space-y-2">
            {jury.map((j) => (
              <li
                key={j.rosterId}
                className="flex items-center justify-between rounded-lg border border-white/5 px-3 py-2 text-sm"
              >
                <span className="text-white/80">{names[j.rosterId] ?? j.rosterId}</span>
                <span className="text-white/50">Voted out Week {j.votedOutWeek}</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="rounded-2xl border border-white/10 bg-white/[0.03] p-4 sm:p-6">
        <h2 className="mb-2 flex items-center gap-2 text-lg font-semibold text-white">
          <Calendar className="h-5 w-5 text-white/60" />
          Finale timeline
        </h2>
        {!finale ? (
          <p className="text-sm text-white/50">The finale opens once the merged tribe is down to the last finalists and the jury is set.</p>
        ) : finale.closed ? (
          <div className="space-y-3">
            <img src="/survivor/late/champion-trophy.svg" alt="" className="mx-auto h-36 w-36 object-contain" />
            <p className="text-sm text-emerald-200">
              Winner crowned: <strong className="text-white">{finale.winnerRosterId ? (names[finale.winnerRosterId] ?? finale.winnerRosterId) : 'TBD'}</strong>
            </p>
            {finale.voteCount && (
              <ul className="space-y-2">
                {Object.entries(finale.voteCount).map(([rosterId, votes]) => (
                  <li key={rosterId} className="flex items-center justify-between rounded-lg border border-white/5 px-3 py-2 text-sm">
                    <span className="text-white/80">{names[rosterId] ?? rosterId}</span>
                    <span className="text-white/50">{votes} vote(s)</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        ) : (
          <div className="space-y-3">
            <p className="text-sm text-white/70">
              Finalists: <strong className="text-white">{finale.finalists.map((finalist) => names[finalist.rosterId] ?? finalist.rosterId).join(', ') || 'TBD'}</strong>
            </p>
            <p className="text-sm text-white/60">
              Jury votes submitted: <strong className="text-white">{finale.juryVotesSubmitted}</strong> / {finale.juryVotesRequired}
            </p>
            {finale.myJuryVote ? (
              <p className="text-sm text-amber-200">
                Your jury vote is in for <strong className="text-white">{names[finale.myJuryVote.finalistRosterId] ?? finale.myJuryVote.finalistRosterId}</strong>.
              </p>
            ) : (
              <p className="text-sm text-white/50">Use <code className="text-cyan-300">@Chimmy jury vote [finalist]</code> in chat or submit your vote below once the finale opens.</p>
            )}
            {isJuror && !isFinalist ? (
              <div className="rounded-xl border border-amber-500/20 bg-amber-950/10 p-4">
                <p className="mb-3 text-sm text-white/70">
                  Cast your jury vote here. If you vote again, the latest vote replaces the old one.
                </p>
                <div className="flex flex-wrap gap-2">
                  {finale.finalists.map((finalist) => {
                    const selected = selectedFinalistId === finalist.rosterId
                    return (
                      <button
                        key={finalist.rosterId}
                        type="button"
                        onClick={() => setSelectedFinalistId(finalist.rosterId)}
                        className={`rounded-lg px-3 py-2 text-sm ${
                          selected ? 'bg-amber-500/20 text-amber-200' : 'bg-white/5 text-white/80 hover:bg-white/10'
                        }`}
                      >
                        {names[finalist.rosterId] ?? finalist.rosterId}
                      </button>
                    )
                  })}
                </div>
                <div className="mt-3 flex flex-wrap items-center gap-3">
                  <button
                    type="button"
                    onClick={handleSubmitJuryVote}
                    disabled={submitting || !selectedFinalistId}
                    className="rounded-xl border border-amber-500/30 bg-amber-950/30 px-4 py-2 text-sm text-amber-200 hover:bg-amber-950/50 disabled:opacity-50"
                  >
                    {submitting ? 'Submitting...' : 'Submit jury vote'}
                  </button>
                  {error ? <p className="text-sm text-rose-300">{error}</p> : null}
                  {message ? <p className="text-sm text-emerald-300">{message}</p> : null}
                </div>
              </div>
            ) : finale.open ? (
              <p className="text-sm text-white/50">
                {isFinalist ? 'Finalists cannot cast jury votes.' : 'Jury voting is reserved for current jury members.'}
              </p>
            ) : null}
          </div>
        )}
      </section>

      {finale?.closed && finale.winnerRosterId && <SurvivorShareCard moment="champion" sport={summary.seasonCalendar?.sport ?? 'NFL'} leagueName={summary.config.seasonThemeLabel ?? 'Survivor League'} week={summary.currentWeek} headline={`${names[finale.winnerRosterId] ?? 'A manager'} is the champion`} caption="The jury has crowned this season’s winner." />}
    </div>
  )
}
