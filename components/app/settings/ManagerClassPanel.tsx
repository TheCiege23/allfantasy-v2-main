'use client'

import { useCallback, useEffect, useState } from 'react'

/**
 * Commissioner controls for the division gate (ADR F2.10a): the league's division, pending requests
 * from managers it refused, and the per-manager exceptions in force. Ported from PR #1753.
 *
 * Reads GET / writes PATCH on `/api/commissioner/leagues/:id/invite`.
 */

type Person = {
  userId: string
  username: string | null
  displayName: string | null
  classLevel: number | null
  division: number | null
  provisional: boolean
}
type Summary = {
  division: number | null
  band: [number, number] | null
  open: boolean
  exceptions: Array<Person & { grantedAt: string; via: 'direct' | 'request'; divisionAtGrant: number | null }>
  requests: Array<Person & { requestedAt: string; divisionAtRequest: number | null }>
}

type Action = 'grant' | 'approve' | 'decline' | 'revoke'

function who(p: Person): string {
  if (p.username) return `@${p.username}`
  return p.displayName ?? 'Manager'
}

/** "Class 17 · Division 4", or why there is no Class yet. */
function standing(p: Person): string {
  if (p.classLevel != null && p.division != null) return `Class ${p.classLevel} · Division ${p.division}`
  return p.provisional ? 'Provisional — no Class yet' : 'Not rated yet'
}

function range([lo, hi]: [number, number]): string {
  return lo === hi ? `Division ${lo}` : `Divisions ${lo}–${hi}`
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
        setError(json.error ?? 'Could not load division settings.')
        return
      }
      setSummary((json.managerClass as Summary | null) ?? null)
    } catch {
      setError('Could not load division settings.')
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
    return <p className="text-xs text-white/50">Loading division settings…</p>
  }

  const requests = summary?.requests ?? []
  const exceptions = summary?.exceptions ?? []
  const band = summary?.band ?? null

  return (
    <div data-testid="manager-class-panel">
      <h4 className="text-xs font-semibold uppercase tracking-wider text-white/70">Division</h4>
      <p className="mt-1 text-xs text-white/50">
        {summary?.division == null || !band
          ? 'This league has no division yet — none of its managers has an established Class — so nobody is turned away.'
          : summary.open
            ? `This league plays in Division ${summary.division}. Because it is open to the public, managers outside ${range(band)} cannot join on their own; they can ask you, and you decide one manager at a time. Anyone you invite directly can always join.`
            : `This league plays in Division ${summary.division}. It is private, so everyone who joins was handed the link by someone in it — nobody is turned away by division. Exceptions only matter once the league is public.`}
      </p>

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
                    {standing(r)} · asked {fmtDay(r.requestedAt)}
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
          Managers you have let in from outside the league’s divisions. They join flagged, so league reviews can see the
          gap. Removing one does not take away a seat they already hold.
        </p>
        {exceptions.length === 0 ? (
          <p className="mt-1 text-xs text-white/50">None.</p>
        ) : (
          <ul className="mt-2 space-y-2">
            {exceptions.map((e) => (
              <li key={e.userId} className="flex items-center justify-between gap-2 rounded-lg border border-white/10 bg-white/[0.03] p-3">
                <div className="min-w-0">
                  <p className="truncate text-sm text-white">{who(e)}</p>
                  <p className="text-xs text-white/50">
                    {standing(e)} · {e.via === 'request' ? 'approved request' : 'added by you'} {fmtDay(e.grantedAt)}
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
            aria-label="Username to let in from outside the league's division"
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

      {error ? <p className="mt-2 text-xs text-red-300">{error}</p> : null}
    </div>
  )
}
