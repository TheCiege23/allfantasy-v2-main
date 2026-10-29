'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { readTournamentCoCommissioners, SeatlessCoCommissioners, type TournamentCoCommissioner } from '@/components/league-settings/TournamentLeagueNotes'

type Manager = {
  rosterId: string
  userId: string
  username?: string | null
  displayName: string
}

export default function MemberSettingsPanel({ leagueId }: { leagueId?: string }) {
  const [managers, setManagers] = useState<Manager[]>([])
  const [tournamentCos, setTournamentCos] = useState<TournamentCoCommissioner[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [removingRosterId, setRemovingRosterId] = useState<string | null>(null)
  const [transferUserId, setTransferUserId] = useState('')
  const [transferConfirm, setTransferConfirm] = useState(false)
  const [transferring, setTransferring] = useState(false)

  const load = useCallback(async () => {
    if (!leagueId) {
      setLoading(false)
      return
    }
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`/api/commissioner/leagues/${encodeURIComponent(leagueId)}/managers`, { cache: 'no-store' })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(json?.error || 'Failed to load member settings')
        setManagers([])
        return
      }
      const nextManagers = Array.isArray(json?.managers) ? (json.managers as Manager[]) : []
      setManagers(nextManagers)
      setTournamentCos(readTournamentCoCommissioners(json))
    } catch {
      setError('Failed to load member settings')
      setManagers([])
    } finally {
      setLoading(false)
    }
  }, [leagueId])

  useEffect(() => {
    load()
  }, [load])

  const transferableManagers = useMemo(
    () => managers.filter((m) => typeof m.userId === 'string' && m.userId.trim().length > 0 && !m.userId.startsWith('orphan-')),
    [managers]
  )

  const handleRemoveMember = async (rosterId: string) => {
    if (!leagueId || !rosterId || removingRosterId) return
    if (!confirm('Remove this manager from the league? The roster will be marked as orphan.')) return
    setRemovingRosterId(rosterId)
    try {
      const res = await fetch(`/api/commissioner/leagues/${encodeURIComponent(leagueId)}/managers`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rosterId }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) {
        toast.error(json?.error || 'Failed to remove manager')
        return
      }
      toast.success('Manager removed and roster marked orphan')
      await load()
    } catch {
      toast.error('Failed to remove manager')
    } finally {
      setRemovingRosterId(null)
    }
  }

  const handleTransferCommissioner = async () => {
    if (!leagueId || !transferUserId || !transferConfirm || transferring) return
    setTransferring(true)
    try {
      const res = await fetch(`/api/commissioner/leagues/${encodeURIComponent(leagueId)}/transfer`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ newCommissionerUserId: transferUserId, confirm: true }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) {
        toast.error(json?.error || 'Commissioner transfer failed')
        return
      }
      toast.success('Commissioner role transferred')
      setTransferUserId('')
      setTransferConfirm(false)
      await load()
    } catch {
      toast.error('Commissioner transfer failed')
    } finally {
      setTransferring(false)
    }
  }

  if (!leagueId) {
    return (
      <section className="rounded-xl border border-white/10 bg-black/20 p-4">
        <h3 className="text-sm font-semibold text-white">Member Settings</h3>
        <p className="mt-2 text-xs text-white/65">Select a league to manage members.</p>
      </section>
    )
  }

  if (loading) {
    return (
      <section className="rounded-xl border border-white/10 bg-black/20 p-4">
        <h3 className="text-sm font-semibold text-white">Member Settings</h3>
        <p className="mt-2 flex items-center gap-2 text-xs text-white/65">
          <Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading…
        </p>
      </section>
    )
  }

  return (
    <section className="rounded-xl border border-white/10 bg-black/20 p-4">
      <h3 className="text-sm font-semibold text-white">Member Settings</h3>
      <p className="mt-1 text-xs text-white/65">
        Remove managers, mark rosters as orphan, and transfer commissioner role.
      </p>
      {error ? <p className="mt-2 text-xs text-red-400">{error}</p> : null}

      <div className="mt-4 overflow-x-auto rounded-lg border border-white/10">
        <table className="min-w-full text-xs">
          <thead className="bg-black/40 text-white/60">
            <tr>
              <th className="px-3 py-2 text-left">Manager</th>
              <th className="px-3 py-2 text-left">User ID</th>
              <th className="px-3 py-2 text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {managers.length === 0 ? (
              <tr>
                <td className="px-3 py-3 text-white/60" colSpan={3}>
                  No managers found for this league.
                </td>
              </tr>
            ) : (
              managers.map((manager) => (
                <tr key={manager.rosterId} className="border-t border-white/10 text-white/85">
                  <td className="px-3 py-2">{manager.displayName}</td>
                  <td className="px-3 py-2">{manager.userId || '—'}</td>
                  <td className="px-3 py-2 text-right">
                    <button
                      type="button"
                      onClick={() => handleRemoveMember(manager.rosterId)}
                      disabled={!!removingRosterId || !manager.userId || manager.userId.startsWith('orphan-')}
                      data-testid={`commissioner-member-remove-${manager.rosterId}`}
                      className="rounded border border-red-500/30 bg-red-500/10 px-2 py-1 text-[11px] text-red-200 hover:bg-red-500/20 disabled:opacity-50"
                    >
                      {removingRosterId === manager.rosterId ? 'Removing…' : 'Remove'}
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <div className="mt-4">
        <SeatlessCoCommissioners people={tournamentCos} />
      </div>

      <div className="mt-4 space-y-2 rounded-lg border border-cyan-500/20 bg-cyan-500/5 p-3">
        <p className="text-xs font-medium text-cyan-100">Transfer commissioner</p>
        <select
          value={transferUserId}
          onChange={(e) => setTransferUserId(e.target.value)}
          data-testid="commissioner-transfer-select"
          className="w-full max-w-xs rounded-lg border border-white/20 bg-black/30 px-3 py-2 text-xs text-white"
        >
          <option value="">Select manager…</option>
          {transferableManagers.map((manager) => (
            <option key={manager.rosterId} value={manager.userId}>
              {manager.displayName} ({manager.userId.slice(0, 8)}…)
            </option>
          ))}
        </select>
        <label className="flex items-center gap-2 text-xs text-white/80">
          <input
            type="checkbox"
            checked={transferConfirm}
            onChange={(e) => setTransferConfirm(e.target.checked)}
            data-testid="commissioner-transfer-confirm"
            className="rounded border-white/20"
          />
          I confirm this commissioner transfer
        </label>
        <button
          type="button"
          onClick={handleTransferCommissioner}
          disabled={!transferUserId || !transferConfirm || transferring}
          data-testid="commissioner-transfer-submit"
          className="rounded border border-cyan-500/40 bg-cyan-500/15 px-3 py-1.5 text-xs font-medium text-cyan-100 hover:bg-cyan-500/25 disabled:opacity-50"
        >
          {transferring ? 'Transferring…' : 'Transfer commissioner'}
        </button>
      </div>
    </section>
  )
}
