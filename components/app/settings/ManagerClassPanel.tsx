'use client'

import { useCallback, useEffect, useState } from 'react'

/**
 * Commissioner controls for the ±2 manager-class band
 * (`lib/league-join/managerClass.ts`): the league's level range, pending
 * requests from managers outside it, and the per-manager exceptions in force.
 *
 * Reads GET / writes PATCH on `/api/commissioner/leagues/:id/invite`.
 */

type Person = { userId: string; username: string | null; displayName: string | null; level: number; skillClass: number | null }
type Summary = {
  range: { center: number; min: number; max: number } | null
  basis: 'skill' | 'level'
  sport: string | null
  ratedMembers: number
  exceptions: Array<Person & { grantedAt: string; via: 'direct' | 'request' }>
  requests: Array<Person & { requestedAt: string }>
}

type Action = 'grant' | 'approve' | 'decline' | 'revoke'

function who(p: Person): string {
  if (p.username) return `@${p.username}`
  return p.displayName ?? 'Manager'
}

/** "NFL Class 14 · Lvl 9", or just the level while the manager is unrated in this sport. */
function standing(p: Person, sport: string | null): string {
  return p.skillClass != null ? `${sport ?? ''} Class ${p.skillClass} · Lvl ${p.level}`.trim() : `Lvl ${p.level} · not rated in ${sport ?? 'this sport'} yet`
}

function fmtDay(iso: string): string {
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

export default function ManagerClassPanel({ leagueId }: { leagueId: string }) {
  const [summary, setSummary] = useState<Summary | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [username, setUsername] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`/api/commissioner/leagues/${encodeURIComponent(leagueId)}/invite`, { cache: 'no-store' })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(json.error ?? 'Could not load level settings.')
        return
      }
      setSummary((json.managerClass as Summary | null) ?? null)
    } catch {
      setError('Could not load level settings.')
    } finally {
      setLoading(false)
    }
  }, [leagueId])

  useEffect(() => {
    void load()
  }, [load])

  const decide = useCallback(
    async (action: Action, target: { userId?: string; username?: string }, key: string) => {
      setBusy(key)
      setError(null)
      try {
        const res = await fetch(`/api/commissioner/leagues/${encodeURIComponent(leagueId)}/invite`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action, ...target }),
        })
        const json = await res.json().catch(() => ({}))
        if (!res.ok) {
          setError(json.error ?? 'That did not save. Try again.')
          return
        }
        setSummary((json.managerClass as Summary | null) ?? null)
        if (action === 'grant') setUsername('')
      } catch {
        setError('That did not save. Try again.')
      } finally {
        setBusy(null)
      }
    },
    [leagueId],
  )

  if (loading) {
    return <p className="text-xs text-white/50">Loading level settings…</p>
  }

  const range = summary?.range ?? null
  const requests = summary?.requests ?? []
  const exceptions = summary?.exceptions ?? []

  return (
    <div data-testid="manager-class-panel">
      <h4 className="text-xs font-semibold uppercase tracking-wider text-white/70">
        {summary?.basis === 'skill' ? 'Skill class' : 'Level range'}
      </h4>
      <p className="mt-1 text-xs text-white/50">
        {!range
          ? 'This league has no class, so anyone with an invite can join. Leagues imported from another platform keep their own members.'
          : summary?.basis === 'skill'
            ? `This league plays at ${summary.sport ?? ''} skill Class ${range.min}–${range.max} — two classes either side of Class ${range.center}, the middle of its ${summary.ratedMembers} rated ${summary.ratedMembers === 1 ? 'manager' : 'managers'}. A joiner not yet rated in this sport is measured by level instead. Anyone outside can ask you to let them in, and you decide one manager at a time.`
            : `This league is for managers at Level ${range.min}–${range.max} — two levels either side of Level ${range.center}. It switches to skill classes once its managers have rated games in this sport. Anyone outside can ask you to let them in, and you decide one manager at a time.`}
      </p>

      {range ? (
        <>
          <div className="mt-3">
            <p className="text-xs font-semibold text-white/80">
              Requests{requests.length ? ` (${requests.length})` : ''}
            </p>
            {requests.length === 0 ? (
              <p className="mt-1 text-xs text-white/50">No pending requests.</p>
            ) : (
              <ul className="mt-2 space-y-2">
                {requests.map((r) => (
                  <li
                    key={r.userId}
                    className="flex flex-col gap-2 rounded-lg border border-amber-400/30 bg-amber-400/5 p-3 sm:flex-row sm:items-center sm:justify-between"
                  >
                    <div className="min-w-0">
                      <p className="truncate text-sm text-white">{who(r)}</p>
                      <p className="text-xs text-white/50">
                        {standing(r, summary?.sport ?? null)} · asked {fmtDay(r.requestedAt)}
                      </p>
                    </div>
                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={() => void decide('approve', { userId: r.userId }, `approve:${r.userId}`)}
                        disabled={busy !== null}
                        data-testid="manager-class-approve"
                        className="min-h-[44px] flex-1 rounded-lg border border-emerald-500/40 px-3 py-2 text-xs text-emerald-200 hover:bg-emerald-500/20 disabled:opacity-50 sm:flex-none"
                      >
                        {busy === `approve:${r.userId}` ? 'Approving…' : 'Let them in'}
                      </button>
                      <button
                        type="button"
                        onClick={() => void decide('decline', { userId: r.userId }, `decline:${r.userId}`)}
                        disabled={busy !== null}
                        data-testid="manager-class-decline"
                        className="min-h-[44px] flex-1 rounded-lg border border-white/20 px-3 py-2 text-xs text-white/80 hover:bg-white/10 disabled:opacity-50 sm:flex-none"
                      >
                        {busy === `decline:${r.userId}` ? 'Declining…' : 'Decline'}
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="mt-4">
            <p className="text-xs font-semibold text-white/80">Exceptions</p>
            <p className="mt-1 text-xs text-white/50">
              Managers you have let in from outside the range. Removing one does not take away a seat they already hold.
            </p>
            {exceptions.length === 0 ? (
              <p className="mt-1 text-xs text-white/50">None.</p>
            ) : (
              <ul className="mt-2 space-y-2">
                {exceptions.map((e) => (
                  <li
                    key={e.userId}
                    className="flex items-center justify-between gap-2 rounded-lg border border-white/10 bg-white/[0.03] p-3"
                  >
                    <div className="min-w-0">
                      <p className="truncate text-sm text-white">{who(e)}</p>
                      <p className="text-xs text-white/50">
                        {standing(e, summary?.sport ?? null)} · {e.via === 'request' ? 'approved request' : 'added by you'} {fmtDay(e.grantedAt)}
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => void decide('revoke', { userId: e.userId }, `revoke:${e.userId}`)}
                      disabled={busy !== null}
                      className="min-h-[44px] rounded-lg border border-white/20 px-3 py-2 text-xs text-white/80 hover:bg-white/10 disabled:opacity-50"
                    >
                      {busy === `revoke:${e.userId}` ? 'Removing…' : 'Remove'}
                    </button>
                  </li>
                ))}
              </ul>
            )}

            <form
              className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-center"
              onSubmit={(ev) => {
                ev.preventDefault()
                if (username.trim()) void decide('grant', { username: username.trim() }, 'grant')
              }}
            >
              <input
                type="text"
                value={username}
                onChange={(ev) => setUsername(ev.target.value)}
                placeholder="AllFantasy username"
                aria-label="Username to let in from outside the league's class"
                data-testid="manager-class-grant-input"
                className="min-h-[44px] min-w-0 flex-1 rounded border border-white/20 bg-black/40 px-3 py-2 text-sm text-white"
              />
              <button
                type="submit"
                disabled={busy !== null || !username.trim()}
                data-testid="manager-class-grant"
                className="min-h-[44px] rounded-lg border border-cyan-500/40 px-3 py-2 text-xs text-cyan-200 hover:bg-cyan-500/20 disabled:opacity-50"
              >
                {busy === 'grant' ? 'Adding…' : 'Let this manager in'}
              </button>
            </form>
          </div>
        </>
      ) : null}

      {error ? <p className="mt-2 text-xs text-red-300">{error}</p> : null}
    </div>
  )
}
