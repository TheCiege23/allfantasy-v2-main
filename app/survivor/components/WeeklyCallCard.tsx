'use client'

import { useCallback, useEffect, useState } from 'react'
import type { WeeklyCallBoard, WeeklyCallView } from '@/lib/survivor/survivorWeeklyCall'

function lockLabel(iso: string | null): string {
  if (!iso) return ''
  return new Date(iso).toLocaleString(undefined, { weekday: 'short', hour: 'numeric', minute: '2-digit' })
}

function CallResults({ call }: { call: WeeklyCallView }) {
  const total = call.options.reduce((sum, option) => sum + (option.calls ?? 0), 0)
  return (
    <ul className="mt-3 space-y-2">
      {call.options.map(option => {
        const share = total ? Math.round(((option.calls ?? 0) / total) * 100) : 0
        const isAnswer = call.answer?.id === option.id
        return (
          <li key={option.id} className={`rounded-lg border px-3 py-2 text-[13px] ${isAnswer ? 'border-emerald-400/50 bg-emerald-500/10' : 'border-white/10 bg-black/20'}`}>
            <div className="flex items-center justify-between gap-2">
              <span className="text-white">{option.label}{isAnswer ? ' ✓' : ''}{call.myPick === option.id ? ' · your call' : ''}</span>
              <span className="font-mono text-white/60">{option.calls ?? 0} call{option.calls === 1 ? '' : 's'}</span>
            </div>
            <div className="mt-1 h-1.5 rounded-full bg-white/10"><div className={`h-1.5 rounded-full ${isAnswer ? 'bg-emerald-400' : 'bg-amber-400/70'}`} style={{ width: `${share}%` }} /></div>
          </li>
        )
      })}
    </ul>
  )
}

/** "Call the week": make a call before it locks, then see everyone's calls and who got it right. */
export function WeeklyCallCard({ leagueId }: { leagueId: string }) {
  const [board, setBoard] = useState<WeeklyCallBoard | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/survivor/weekly-call?leagueId=${encodeURIComponent(leagueId)}`, { credentials: 'include', cache: 'no-store' })
      if (res.ok) setBoard((await res.json()) as WeeklyCallBoard)
    } catch { /* the card stays empty; the page still works */ }
  }, [leagueId])
  useEffect(() => { void load() }, [load])

  const call = async (challengeId: string, optionId: string) => {
    setBusy(true)
    setError(null)
    try {
      const res = await fetch('/api/survivor/weekly-call', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ leagueId, challengeId, optionId }) })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(typeof json.error === 'string' ? json.error : 'Your call was not saved.')
      await load()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Your call was not saved.')
    } finally { setBusy(false) }
  }

  if (!board) return null
  const current = board.current
  return (
    <section className="survivor-panel mt-6 rounded-2xl p-4 md:p-5" data-testid="weekly-call-card">
      <p className="text-[11px] font-bold uppercase tracking-[0.2em] text-amber-200">Weekly mini-game</p>
      {current ? (
        <>
          <h2 className="mt-1 text-lg font-bold text-white">{current.title}</h2>
          <p className="mt-1 text-[13px] text-white/60">{current.description}</p>
          {current.status === 'open' ? (
            <>
              <p className="mt-2 text-[12px] text-white/50">Locks {lockLabel(current.locksAt)}. You can change your call until then.</p>
              <div className="mt-3 flex flex-wrap gap-2">
                {current.options.map(option => (
                  <button key={option.id} type="button" disabled={busy} onClick={() => void call(current.id, option.id)} aria-pressed={current.myPick === option.id}
                    className={`min-h-[44px] rounded-lg border px-3 text-[13px] font-semibold disabled:opacity-40 ${current.myPick === option.id ? 'border-amber-300 bg-amber-400 text-black' : 'border-white/20 text-white'}`}>
                    {option.label}
                  </button>
                ))}
              </div>
              <p className="mt-2 text-[12px] text-white/50">{current.myPick ? 'Your call is in.' : 'No call yet.'} Everyone&apos;s calls show once it locks.</p>
            </>
          ) : (
            <>
              <p className="mt-2 text-[12px] text-white/50">Calls are locked. {current.callCount} manager{current.callCount === 1 ? '' : 's'} made a call; results post when the week&apos;s scores are final.</p>
              <CallResults call={current} />
            </>
          )}
        </>
      ) : (
        <p className="mt-1 text-[13px] text-white/60">The next call opens when the next week starts.</p>
      )}
      {error ? <p role="alert" className="mt-2 text-[12px] text-red-200">{error}</p> : null}

      {board.past.length ? (
        <div className="mt-5 space-y-2">
          <h3 className="text-[11px] font-bold uppercase tracking-wider text-white/45">Past calls</h3>
          {board.past.slice(0, 6).map(past => (
            <details key={past.id} className="rounded-xl border border-white/10 bg-black/20 p-3">
              <summary className="cursor-pointer text-[13px] font-semibold text-white/85">
                Week {past.week}: {past.answer ? past.answer.label : 'not settled'}{past.myPick ? (past.myPick === past.answer?.id ? ' · you called it' : ' · you missed') : ''}
              </summary>
              <CallResults call={past} />
              <p className="mt-2 text-[12px] text-white/60">{past.correct.length ? `Called it: ${past.correct.join(', ')}` : 'Nobody called it.'}</p>
            </details>
          ))}
        </div>
      ) : null}

      {board.leaderboard.length ? (
        <div className="mt-5">
          <h3 className="text-[11px] font-bold uppercase tracking-wider text-white/45">Season leaderboard</h3>
          <ol className="mt-2 space-y-1 text-[13px] text-white/80">
            {board.leaderboard.slice(0, 10).map((row, index) => (
              <li key={row.userId} className="flex justify-between"><span>{index + 1}. {row.name}</span><span className="font-mono text-white/60">{row.correct} / {row.calls}</span></li>
            ))}
          </ol>
        </div>
      ) : null}
    </section>
  )
}
