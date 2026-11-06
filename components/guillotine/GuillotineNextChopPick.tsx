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
    <section className="gl gl-card rounded-2xl border p-4 sm:p-6" data-testid="guillotine-next-chop-pick">
      <h2 className="gl-text mb-1 text-lg font-semibold">Who’s next?</h2>
      <p className="gl-text2 mb-4 text-[13px]">Chopped managers pick the team the next chop takes. One point for every one they call.</p>

      {state.canPick ? (
        state.week == null ? (
          <p className="gl-text2 text-sm" data-testid="guillotine-next-chop-closed">The chops are over for this season.</p>
        ) : (
          <div className="space-y-2">
            <label className="gl-text block text-[13px]" htmlFor="guillotine-next-chop-select">
              Your pick for week {state.week} <span className="gl-muted">(locks when week {state.week} starts)</span>
            </label>
            <div className="flex flex-wrap gap-2">
              <select
                id="guillotine-next-chop-select"
                value={choice}
                onChange={(e) => { setChoice(e.target.value); setStatus({ kind: 'idle' }) }}
                className="gl-field min-h-[40px] rounded-lg border px-3 text-sm"
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
                className="gl-btn-primary min-h-[40px] rounded-lg px-4 text-sm font-semibold disabled:opacity-50"
                data-testid="guillotine-next-chop-save"
              >
                {status.kind === 'saving' ? 'Saving…' : state.myPick ? 'Change pick' : 'Lock in pick'}
              </button>
            </div>
            {pickedName ? <p className="gl-good text-[13px]" data-testid="guillotine-next-chop-mine">Your pick: {pickedName}</p> : null}
            {status.kind === 'error' ? <p role="alert" className="gl-warn text-[13px]">{status.message}</p> : null}
          </div>
        )
      ) : null}

      {state.canPick && state.lastResult ? (
        <p className="gl-text2 mt-3 text-[13px]" data-testid="guillotine-next-chop-last">
          Week {state.lastResult.week}: you picked {state.lastResult.pickedName} — {state.lastResult.correct ? 'called it.' : 'they survived.'}
        </p>
      ) : null}

      {state.leaderboard.length ? (
        <table className="mt-4 w-full text-[13px]" data-testid="guillotine-next-chop-board">
          <caption className="gl-muted mb-2 text-left text-[11px] uppercase tracking-wide">Leaderboard</caption>
          <thead>
            <tr className="gl-muted text-left text-[11px] uppercase tracking-wide">
              <th scope="col" className="py-1 font-semibold">Manager</th>
              <th scope="col" className="py-1 text-right font-semibold">Called</th>
            </tr>
          </thead>
          <tbody>
            {state.leaderboard.map((r) => (
              <tr key={r.rosterId} className={`gl-line border-t ${r.isMe ? 'gl-me' : ''}`} data-testid={`guillotine-next-chop-row-${r.rosterId}`}>
                <td className="gl-text py-1.5">{r.isMe ? `You · ${r.name}` : r.name}</td>
                <td className="py-1.5 text-right tabular-nums">{r.correct} of {r.settled}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : null}
    </section>
  )
}
