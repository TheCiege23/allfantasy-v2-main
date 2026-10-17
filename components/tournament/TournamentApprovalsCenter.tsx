'use client'

import { useCallback, useEffect, useState } from 'react'
import { toast } from 'sonner'
import { Check, X } from 'lucide-react'

type RequestRow = {
  id: string
  leagueId: string
  leagueName: string
  status: string
  createdAt: string
  proposedPatch: Record<string, unknown>
  requester: { id: string; username: string | null; displayName: string }
}

export function TournamentApprovalsCenter({ tournamentId }: { tournamentId: string }) {
  const [rows, setRows] = useState<RequestRow[]>([])
  const [loading, setLoading] = useState(true)
  const [busyId, setBusyId] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch(`/api/tournament/${encodeURIComponent(tournamentId)}/league-settings-request`, {
        cache: 'no-store',
      })
      const j = await res.json().catch(() => ({}))
      if (!res.ok) {
        setRows([])
        return
      }
      setRows(Array.isArray(j.requests) ? j.requests : [])
    } catch {
      setRows([])
    } finally {
      setLoading(false)
    }
  }, [tournamentId])

  useEffect(() => {
    void load()
  }, [load])

  async function resolve(requestId: string, action: 'approve' | 'reject') {
    setBusyId(requestId)
    try {
      const res = await fetch(
        `/api/tournament/${encodeURIComponent(tournamentId)}/league-settings-request/${encodeURIComponent(requestId)}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action }),
        },
      )
      const j = await res.json().catch(() => ({}))
      if (!res.ok) {
        toast.error(typeof j.error === 'string' ? j.error : 'Could not update request')
        return
      }
      toast.success(action === 'approve' ? 'Approved and applied' : 'Request rejected')
      await load()
    } finally {
      setBusyId(null)
    }
  }

  const pending = rows.filter((r) => r.status === 'pending')

  return (
    <div className="space-y-4" data-testid="tournament-approvals-center">
      <p className="text-sm text-white/55">
        Co-commissioners propose patches to <span className="text-white/80">league.settings</span>. You approve or reject
        before changes apply.
      </p>
      {loading ? (
        <p className="text-sm text-white/45">Loading requests…</p>
      ) : pending.length === 0 ? (
        <p className="rounded-xl border border-white/10 bg-white/[0.03] px-4 py-6 text-sm text-white/50">
          No pending co-commissioner requests.
        </p>
      ) : (
        <ul className="space-y-3">
          {pending.map((r) => (
            <li
              key={r.id}
              className="rounded-xl border border-white/10 bg-black/25 px-4 py-3"
            >
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-white">{r.leagueName}</p>
                  <p className="text-[11px] text-white/45">
                    {r.requester.displayName}
                    {r.createdAt ? ` · ${new Date(r.createdAt).toLocaleString()}` : ''}
                  </p>
                </div>
                <div className="flex gap-2">
                  <button
                    type="button"
                    disabled={busyId === r.id}
                    onClick={() => void resolve(r.id, 'approve')}
                    className="inline-flex items-center gap-1 rounded-lg border border-emerald-500/35 bg-emerald-500/15 px-3 py-1.5 text-xs font-semibold text-emerald-100 hover:bg-emerald-500/25 disabled:opacity-50"
                    data-testid={`tournament-approval-approve-${r.id}`}
                  >
                    <Check className="h-3.5 w-3.5" /> Approve
                  </button>
                  <button
                    type="button"
                    disabled={busyId === r.id}
                    onClick={() => void resolve(r.id, 'reject')}
                    className="inline-flex items-center gap-1 rounded-lg border border-rose-500/35 bg-rose-500/10 px-3 py-1.5 text-xs font-semibold text-rose-100 hover:bg-rose-500/20 disabled:opacity-50"
                    data-testid={`tournament-approval-reject-${r.id}`}
                  >
                    <X className="h-3.5 w-3.5" /> Reject
                  </button>
                </div>
              </div>
              <pre className="mt-3 max-h-40 overflow-auto rounded-lg border border-white/5 bg-black/40 p-2 text-[11px] leading-relaxed text-cyan-100/80">
                {JSON.stringify(r.proposedPatch, null, 2)}
              </pre>
            </li>
          ))}
        </ul>
      )}

      {!loading && rows.some((r) => r.status !== 'pending') ? (
        <details className="rounded-xl border border-white/8 bg-white/[0.02] px-4 py-3 text-sm text-white/55">
          <summary className="cursor-pointer text-xs font-semibold uppercase tracking-wide text-white/40">
            History ({rows.filter((r) => r.status !== 'pending').length})
          </summary>
          <ul className="mt-3 space-y-2 text-[12px]">
            {rows
              .filter((r) => r.status !== 'pending')
              .map((r) => (
                <li key={r.id} className="flex justify-between gap-2 border-b border-white/5 pb-2 last:border-0">
                  <span className="text-white/70">{r.leagueName}</span>
                  <span className="shrink-0 text-white/35">
                    {r.status} · {new Date(r.createdAt).toLocaleDateString()}
                  </span>
                </li>
              ))}
          </ul>
        </details>
      ) : null}
    </div>
  )
}
