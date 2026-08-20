'use client'

import { useCallback, useEffect, useState } from 'react'
import { toast } from 'sonner'
import { Loader2, Lock, Play, RefreshCw, Check, X } from 'lucide-react'
import Link from 'next/link'

type ContextPayload = {
  league: {
    keeperCount: number | null
    keeperCostSystem: string | null
    keeperPhaseActive: boolean | null
    keeperSelectionDeadline: string | null
  }
  seasons: Array<{ id: string; season: number; status: string }>
  suggestedIncomingSeasonId: string | null
  session: {
    id: string
    seasonId: string
    status: string
    deadline: string
    openedAt: string
    teamsSubmitted: number
    totalTeams: number
    lockedAt: string | null
  } | null
}

type KeeperRecRow = {
  id: string
  rosterId: string
  teamName: string
  ownerLabel: string | null
  playerName: string
  position: string
  status: string
  costRound: number | null
  costLabel: string | null
}

export function KeeperCommissionerDashboard({ leagueId }: { leagueId: string }) {
  const [loading, setLoading] = useState(true)
  const [ctx, setCtx] = useState<ContextPayload | null>(null)
  const [incomingSeasonId, setIncomingSeasonId] = useState('')
  const [deadlineLocal, setDeadlineLocal] = useState('')
  const [busy, setBusy] = useState<'open' | 'lock' | null>(null)
  const [records, setRecords] = useState<KeeperRecRow[]>([])
  const [recordsLoading, setRecordsLoading] = useState(false)
  const [recordBusy, setRecordBusy] = useState<string | null>(null)
  const [approvalSeasonId, setApprovalSeasonId] = useState<string>('')

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch(`/api/keeper/context?leagueId=${encodeURIComponent(leagueId)}`, {
        credentials: 'include',
      })
      const j = await res.json().catch(() => ({}))
      if (!res.ok) {
        toast.error(typeof j.error === 'string' ? j.error : 'Could not load keeper context')
        setCtx(null)
        return
      }
      setCtx(j as ContextPayload)
      const sug = j.suggestedIncomingSeasonId as string | undefined
      const seasons = (j.seasons ?? []) as ContextPayload['seasons']
      const nextIncoming = (sug && seasons.some((s) => s.id === sug) ? sug : seasons[0]?.id) ?? ''
      setIncomingSeasonId(nextIncoming)
      setApprovalSeasonId((prev) => {
        if (prev && seasons.some((s) => s.id === prev)) return prev
        const sess = (j as ContextPayload).session
        if (sess?.seasonId && seasons.some((s) => s.id === sess.seasonId)) return sess.seasonId
        return nextIncoming
      })
      const d = new Date()
      d.setDate(d.getDate() + 7)
      const pad = (n: number) => String(n).padStart(2, '0')
      const local =
        `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
      setDeadlineLocal((prev) => prev || local)
    } finally {
      setLoading(false)
    }
  }, [leagueId])

  useEffect(() => {
    void load()
  }, [load])

  const loadRecords = useCallback(async () => {
    const sid = approvalSeasonId.trim()
    if (!sid) {
      setRecords([])
      return
    }
    setRecordsLoading(true)
    try {
      const res = await fetch(
        `/api/keeper/commissioner/records?leagueId=${encodeURIComponent(leagueId)}&seasonId=${encodeURIComponent(sid)}`,
        { credentials: 'include' },
      )
      const j = await res.json().catch(() => ({}))
      if (!res.ok) {
        setRecords([])
        return
      }
      setRecords(Array.isArray(j.records) ? j.records : [])
    } finally {
      setRecordsLoading(false)
    }
  }, [approvalSeasonId, leagueId])

  useEffect(() => {
    void loadRecords()
  }, [loadRecords])

  const patchRecord = async (keeperRecordId: string, action: 'approve' | 'reject') => {
    setRecordBusy(keeperRecordId)
    try {
      const res = await fetch('/api/keeper/selections', {
        method: 'PATCH',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          leagueId,
          keeperRecordId,
          action: action === 'reject' ? 'reject' : 'confirm',
        }),
      })
      const j = await res.json().catch(() => ({}))
      if (!res.ok) {
        toast.error(typeof j.error === 'string' ? j.error : 'Update failed')
        return
      }
      toast.success(action === 'reject' ? 'Keeper rejected' : 'Keeper confirmed')
      await loadRecords()
    } finally {
      setRecordBusy(null)
    }
  }

  const openPhase = async () => {
    if (!incomingSeasonId || !deadlineLocal) {
      toast.error('Choose a season and declaration deadline.')
      return
    }
    const deadline = new Date(deadlineLocal)
    if (Number.isNaN(deadline.getTime())) {
      toast.error('Invalid deadline.')
      return
    }
    setBusy('open')
    try {
      const res = await fetch('/api/keeper/session', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          leagueId,
          incomingSeasonId,
          deadline: deadline.toISOString(),
          action: 'open',
        }),
      })
      const j = await res.json().catch(() => ({}))
      if (!res.ok) {
        toast.error(typeof j.error === 'string' ? j.error : 'Could not open keeper phase')
        return
      }
      toast.success('Keeper declaration window is open.')
      await load()
    } finally {
      setBusy(null)
    }
  }

  const lockPhase = async () => {
    const sid = ctx?.session?.id
    if (!sid) return
    setBusy('lock')
    try {
      const res = await fetch('/api/keeper/session', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ leagueId, sessionId: sid, action: 'lock' }),
      })
      const j = await res.json().catch(() => ({}))
      if (!res.ok) {
        toast.error(typeof j.error === 'string' ? j.error : 'Could not lock declarations')
        return
      }
      toast.success('Keeper declarations locked.')
      await load()
    } finally {
      setBusy(null)
    }
  }

  if (loading && !ctx) {
    return (
      <div className="flex items-center gap-2 text-[13px] text-white/50">
        <Loader2 className="h-4 w-4 animate-spin" /> Loading keeper tools…
      </div>
    )
  }

  if (!ctx) {
    return <p className="text-[13px] text-white/45">Keeper tools unavailable.</p>
  }

  const pct = ctx.session
    ? Math.round((ctx.session.teamsSubmitted / Math.max(ctx.session.totalTeams, 1)) * 100)
    : 0
  const maxK = ctx.league.keeperCount ?? 3

  return (
    <div className="space-y-5 text-[13px] text-white/85">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="font-medium text-white">Keeper commissioner center</p>
        <button
          type="button"
          onClick={() => void load()}
          className="inline-flex items-center gap-1 rounded-lg border border-white/10 bg-white/[0.04] px-2 py-1 text-[11px] text-white/70 hover:bg-white/[0.07]"
        >
          <RefreshCw className="h-3 w-3" /> Refresh
        </button>
      </div>

      <p className="text-[12px] text-white/50">
        League max keepers: <span className="font-semibold text-white/80">{maxK}</span>
        {ctx.league.keeperCostSystem ? (
          <>
            {' '}
            · Cost mode: <span className="text-white/70">{ctx.league.keeperCostSystem}</span>
          </>
        ) : null}
      </p>

      {!ctx.session ? (
        <div className="rounded-xl border border-amber-500/25 bg-amber-500/10 p-4">
          <p className="text-[12px] font-medium text-amber-100/95">Open keeper declaration</p>
          <p className="mt-1 text-[11px] text-white/55">
            Pick the <strong className="text-white/80">incoming season</strong> and a deadline. Managers can then
            declare keepers before the draft is locked.
          </p>
          <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-end">
            <label className="flex flex-1 flex-col gap-1 text-[11px] text-white/45">
              Season
              <select
                value={incomingSeasonId}
                onChange={(e) => setIncomingSeasonId(e.target.value)}
                className="rounded-lg border border-white/10 bg-[#0a1220] px-3 py-2 text-[13px] text-white"
              >
                {ctx.seasons.length === 0 ? (
                  <option value="">No seasons — create a season first</option>
                ) : (
                  ctx.seasons.map((s) => (
                    <option key={s.id} value={s.id}>
                      Season {s.season} ({s.status})
                    </option>
                  ))
                )}
              </select>
            </label>
            <label className="flex flex-1 flex-col gap-1 text-[11px] text-white/45">
              Declaration deadline (local)
              <input
                type="datetime-local"
                value={deadlineLocal}
                onChange={(e) => setDeadlineLocal(e.target.value)}
                className="rounded-lg border border-white/10 bg-[#0a1220] px-3 py-2 text-[13px] text-white"
              />
            </label>
            <button
              type="button"
              disabled={busy !== null || !incomingSeasonId || ctx.seasons.length === 0}
              onClick={() => void openPhase()}
              className="inline-flex min-h-[44px] items-center justify-center gap-2 rounded-xl bg-amber-500/90 px-4 text-[13px] font-bold text-black hover:bg-amber-400 disabled:opacity-40"
            >
              {busy === 'open' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
              Open window
            </button>
          </div>
        </div>
      ) : (
        <div className="space-y-4 rounded-xl border border-[#ff3d81]/20 bg-[#ff3d81]/5 p-4">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div>
              <p className="text-[12px] font-semibold text-[#ffd7e5]/90">Active declaration session</p>
              <p className="text-[11px] text-white/45">
                Status: <span className="text-white/75">{ctx.session.status}</span> · Session{' '}
                <code className="rounded bg-black/30 px-1 text-[10px] text-white/60">{ctx.session.id}</code>
              </p>
              <p className="mt-1 text-[11px] text-white/55">
                Deadline: {new Date(ctx.session.deadline).toLocaleString()}
              </p>
            </div>
            {ctx.session.status === 'open' ? (
              <button
                type="button"
                disabled={busy !== null}
                onClick={() => void lockPhase()}
                className="inline-flex min-h-[40px] items-center gap-2 rounded-xl border border-white/15 bg-white/[0.06] px-3 py-2 text-[12px] font-semibold text-white hover:bg-white/10 disabled:opacity-40"
              >
                {busy === 'lock' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Lock className="h-4 w-4" />}
                Lock declarations
              </button>
            ) : (
              <span className="rounded-full bg-white/10 px-3 py-1 text-[11px] text-white/60">Locked</span>
            )}
          </div>
          <div className="h-2 w-full overflow-hidden rounded-full bg-white/[0.08]">
            <div
              className="h-full bg-sky-500/70 transition-all"
              style={{ width: `${pct}%` }}
            />
          </div>
          <p className="text-[12px] text-white/60">
            {ctx.session.teamsSubmitted} of {ctx.session.totalTeams} teams submitted ({pct}%)
          </p>
        </div>
      )}

      <div className="rounded-xl border border-white/10 bg-white/[0.02] p-4">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <p className="text-[12px] font-semibold text-white">Review keeper declarations</p>
          {ctx.seasons.length > 0 ? (
            <label className="flex items-center gap-2 text-[11px] text-white/45">
              Season
              <select
                value={approvalSeasonId}
                onChange={(e) => setApprovalSeasonId(e.target.value)}
                className="rounded-lg border border-white/10 bg-[#0a1220] px-2 py-1 text-[12px] text-white"
              >
                {ctx.seasons.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.season} ({s.status})
                  </option>
                ))}
              </select>
            </label>
          ) : null}
        </div>
        {recordsLoading ? (
          <p className="text-[12px] text-white/45">
            <Loader2 className="mr-1 inline h-3 w-3 animate-spin" /> Loading records…
          </p>
        ) : records.length === 0 ? (
          <p className="text-[12px] text-white/45">No keeper records for this season yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[520px] text-left text-[12px]">
              <thead>
                <tr className="border-b border-white/10 text-white/45">
                  <th className="pb-2 pr-2">Team</th>
                  <th className="pb-2 pr-2">Player</th>
                  <th className="pb-2 pr-2">Cost</th>
                  <th className="pb-2 pr-2">Status</th>
                  <th className="pb-2">Actions</th>
                </tr>
              </thead>
              <tbody>
                {records.map((r) => (
                  <tr key={r.id} className="border-b border-white/[0.06] text-white/85">
                    <td className="py-2 pr-2 align-top">
                      <span className="font-medium text-white">{r.teamName}</span>
                      {r.ownerLabel ? (
                        <span className="block text-[10px] text-white/40">{r.ownerLabel}</span>
                      ) : null}
                    </td>
                    <td className="py-2 pr-2 align-top">
                      {r.playerName}
                      <span className="block text-[10px] text-white/40">{r.position}</span>
                    </td>
                    <td className="py-2 pr-2 align-top text-white/70">
                      {r.costLabel ?? (r.costRound != null ? `Round ${r.costRound}` : '—')}
                    </td>
                    <td className="py-2 pr-2 align-top capitalize text-white/60">{r.status}</td>
                    <td className="py-2 align-top">
                      {r.status === 'pending' ? (
                        <div className="flex flex-wrap gap-1">
                          <button
                            type="button"
                            disabled={recordBusy !== null}
                            onClick={() => void patchRecord(r.id, 'approve')}
                            className="inline-flex items-center gap-0.5 rounded-md border border-emerald-500/35 bg-emerald-500/15 px-2 py-1 text-[11px] font-semibold text-emerald-200 hover:bg-emerald-500/25 disabled:opacity-40"
                          >
                            {recordBusy === r.id ? (
                              <Loader2 className="h-3 w-3 animate-spin" />
                            ) : (
                              <Check className="h-3 w-3" />
                            )}{' '}
                            Confirm
                          </button>
                          <button
                            type="button"
                            disabled={recordBusy !== null}
                            onClick={() => void patchRecord(r.id, 'reject')}
                            className="inline-flex items-center gap-0.5 rounded-md border border-rose-500/35 bg-rose-500/10 px-2 py-1 text-[11px] font-semibold text-rose-200 hover:bg-rose-500/20 disabled:opacity-40"
                          >
                            <X className="h-3 w-3" /> Reject
                          </button>
                        </div>
                      ) : (
                        <span className="text-[11px] text-white/35">—</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="rounded-lg border border-white/[0.06] bg-white/[0.02] p-3 text-[11px] text-white/45">
        <p className="font-medium text-white/70">Draft room</p>
        <p className="mt-1">
          Pre-draft keeper picks and commissioner overrides live in the live draft room{' '}
          <span className="text-white/55">(Keeper panel)</span> once the draft session is in pre-draft.
        </p>
        <Link
          href={`/league/${leagueId}?tab=draft`}
          className="mt-2 inline-block text-[12px] font-semibold text-[#ff9ec0] hover:underline"
        >
          Open draft tab →
        </Link>
      </div>
    </div>
  )
}
