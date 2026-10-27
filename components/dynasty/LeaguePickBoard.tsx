'use client'

import { useEffect, useState } from 'react'
import type { LeaguePickBoard as Board } from '@/lib/dynasty-core/leaguePickBoard'

/**
 * Every team's future draft picks on one screen: one row per team, one column per upcoming rookie
 * draft. Acquired picks name the team they came from; a team's own picks held elsewhere are listed
 * under "Traded". Read from `/api/leagues/[leagueId]/pick-board`.
 */
export function LeaguePickBoard({ leagueId }: { leagueId: string }) {
  const [board, setBoard] = useState<Board | null>(null)
  const [state, setState] = useState<'loading' | 'ready' | 'none' | 'error'>('loading')

  useEffect(() => {
    let alive = true
    setState('loading')
    fetch(`/api/leagues/${encodeURIComponent(leagueId)}/pick-board`, { cache: 'no-store' })
      .then(async (r) => {
        if (!r.ok) throw new Error(String(r.status))
        return (await r.json()) as { board: Board | null }
      })
      .then((j) => {
        if (!alive) return
        setBoard(j.board)
        setState(j.board ? 'ready' : 'none')
      })
      .catch(() => alive && setState('error'))
    return () => {
      alive = false
    }
  }, [leagueId])

  if (state === 'loading') return <p className="py-10 text-center text-sm text-white/35">Loading every team’s picks…</p>
  if (state === 'error') return <p className="py-10 text-center text-sm text-white/45">The pick board could not be loaded just now.</p>
  if (state === 'none' || !board) {
    return <p className="py-10 text-center text-sm text-white/45" data-testid="pick-board-none">This league does not track future draft picks yet.</p>
  }

  return (
    <div className="space-y-3" data-testid="league-pick-board">
      {board.coverage === 'traded_only' ? (
        <p className="rounded-lg bg-amber-500/10 px-3 py-2 text-[12px] text-amber-100">
          Only picks that changed hands are shown: this league’s rookie-draft size is unknown, so each team’s own picks are not listed.
        </p>
      ) : null}
      <div className="overflow-x-auto rounded-xl border border-white/[0.07]">
        <table className="w-full min-w-[520px] text-left text-[12px]">
          <thead className="bg-white/[0.04] text-white/55">
            <tr>
              <th scope="col" className="px-3 py-2 font-semibold">Team</th>
              {board.seasons.map((s) => (
                <th key={s} scope="col" className="px-3 py-2 font-semibold">{s}</th>
              ))}
              <th scope="col" className="px-3 py-2 font-semibold">Total</th>
            </tr>
          </thead>
          <tbody>
            {board.teams.map((t) => (
              <tr key={t.rosterId} className={`border-t border-white/[0.06] align-top ${t.isViewer ? 'bg-purple-500/[0.08]' : ''}`}>
                <th scope="row" className="px-3 py-2 font-semibold text-white">
                  {t.name}
                  {t.isViewer ? <span className="ml-1 text-[11px] font-medium text-purple-200">(you)</span> : null}
                </th>
                {board.seasons.map((s) => (
                  <td key={s} className="px-3 py-2">
                    <div className="flex flex-wrap gap-1">
                      {(t.bySeason[s] ?? []).map((p, i) => (
                        <span
                          key={`${p.round}-${i}`}
                          title={p.fromTeam ? `From ${p.fromTeam}` : 'Own pick'}
                          className={`rounded px-1.5 py-0.5 ${p.round === 1 ? 'font-semibold' : ''} ${p.fromTeam ? 'bg-emerald-500/15 text-emerald-100' : 'bg-white/[0.08] text-white/75'}`}
                        >
                          {p.label}
                          {p.fromTeam ? <span className="text-emerald-200/70"> · {p.fromTeam}</span> : null}
                        </span>
                      ))}
                    </div>
                    {(t.tradedAwayBySeason[s] ?? []).length ? (
                      <p className="mt-1 text-[11px] text-rose-200/80">
                        Traded: {(t.tradedAwayBySeason[s] ?? []).map((p) => `${p.label} → ${p.toTeam}`).join(', ')}
                      </p>
                    ) : null}
                  </td>
                ))}
                <td className="px-3 py-2 text-white/75">
                  {t.total}
                  {t.firsts ? <span className="block text-[11px] text-white/45">{t.firsts} first{t.firsts === 1 ? '' : 's'}</span> : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
