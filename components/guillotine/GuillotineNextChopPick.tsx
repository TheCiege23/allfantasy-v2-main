'use client'

import { useState } from 'react'
import type { NextChopPickState } from '@/lib/guillotine/nextChopPickStore'

/**
 * "Who's next?" (lib/guillotine/nextChopPick.ts): a chopped manager picks the team the next chop
 * takes; everyone sees the leaderboard. Saved through POST /api/leagues/[id]/guillotine/summary.
 */
export function GuillotineNextChopPick({
  leagueId,
  state: initial,
}: {
  leagueId: string
  state: NextChopPickState | null | undefined
}) {
  const [state, setState] = useState(initial ?? null)
  const [choice, setChoice] = useState<string>(initial?.myPick ?? '')
  const [status, setStatus] = useState<{ kind: 'idle' | 'saving' | 'saved' } | { kind: 'error'; message: string }>({ kind: 'idle' })
  if (!state || (!state.canPick && state.leaderboard.length === 0)) return null

  const save = async () => {
    if (!state.week || !choice) return
    setStatus({ kind: 'saving' })
    try {
      const res = await fetch(`/api/leagues/${encodeURIComponent(leagueId)}/guillotine/summary`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'next_chop_pick', week: state.week, rosterId: choice }),
      })
      const d = (await res.json().catch(() => ({}))) as { error?: string; nextChopPick?: NextChopPickState | null }
      if (!res.ok) {
        setStatus({ kind: 'error', message: d.error ?? 'Could not save your pick. Try again.' })
        return
      }
      if (d.nextChopPick) setState(d.nextChopPick)
      setStatus({ kind: 'saved' })
    } catch {
      setStatus({ kind: 'error', message: 'Could not reach the server. Try again.' })
    }
  }

  const pickedName = state.candidates.find((c) => c.rosterId === state.myPick)?.name ?? null

  return (
    <section className="rounded-2xl border border-white/10 bg-white/[0.03] p-4 sm:p-6" data-testid="guillotine-next-chop-pick">
      <h2 className="mb-1 text-lg font-semibold text-white">Who’s next?</h2>
      <p className="mb-4 text-[13px] text-white/60">Chopped managers pick the team the next chop takes. One point for every one they call.</p>

      {state.canPick ? (
        state.week == null ? (
          <p className="text-sm text-white/60" data-testid="guillotine-next-chop-closed">The chops are over for this season.</p>
        ) : (
          <div className="space-y-2">
            <label className="block text-[13px] text-white/80" htmlFor="guillotine-next-chop-select">
              Your pick for week {state.week} <span className="text-white/45">(locks when week {state.week} starts)</span>
            </label>
            <div className="flex flex-wrap gap-2">
              <select
                id="guillotine-next-chop-select"
                value={choice}
                onChange={(e) => { setChoice(e.target.value); setStatus({ kind: 'idle' }) }}
                className="min-h-[40px] rounded-lg border border-white/15 bg-black/30 px-3 text-sm text-white"
                data-testid="guillotine-next-chop-select"
              >
                <option value="">Choose a team…</option>
                {state.candidates.map((c) => (
                  <option key={c.rosterId} value={c.rosterId}>{c.name}</option>
                ))}
              </select>
              <button
                type="button"
                onClick={() => void save()}
                disabled={!choice || status.kind === 'saving' || choice === state.myPick}
                className="min-h-[40px] rounded-lg bg-rose-500 px-4 text-sm font-semibold text-white disabled:opacity-50"
                data-testid="guillotine-next-chop-save"
              >
                {status.kind === 'saving' ? 'Saving…' : state.myPick ? 'Change pick' : 'Lock in pick'}
              </button>
            </div>
            {pickedName ? <p className="text-[13px] text-emerald-300" data-testid="guillotine-next-chop-mine">Your pick: {pickedName}</p> : null}
            {status.kind === 'error' ? <p role="alert" className="text-[13px] text-amber-300">{status.message}</p> : null}
          </div>
        )
      ) : null}

      {state.canPick && state.lastResult ? (
        <p className="mt-3 text-[13px] text-white/70" data-testid="guillotine-next-chop-last">
          Week {state.lastResult.week}: you picked {state.lastResult.pickedName} — {state.lastResult.correct ? 'called it.' : 'they survived.'}
        </p>
      ) : null}

      {state.leaderboard.length ? (
        <table className="mt-4 w-full text-[13px]" data-testid="guillotine-next-chop-board">
          <caption className="mb-2 text-left text-[11px] uppercase tracking-wide text-white/50">Leaderboard</caption>
          <thead>
            <tr className="text-left text-[11px] uppercase tracking-wide text-white/50">
              <th scope="col" className="py-1 font-semibold">Manager</th>
              <th scope="col" className="py-1 text-right font-semibold">Called</th>
            </tr>
          </thead>
          <tbody>
            {state.leaderboard.map((r) => (
              <tr key={r.rosterId} className={`border-t border-white/5 ${r.isMe ? 'bg-white/[0.04]' : ''}`} data-testid={`guillotine-next-chop-row-${r.rosterId}`}>
                <td className="py-1.5 text-white/90">{r.isMe ? `You · ${r.name}` : r.name}</td>
                <td className="py-1.5 text-right tabular-nums">{r.correct} of {r.settled}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : null}
    </section>
  )
}
