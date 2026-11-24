'use client'

import { useCallback, useEffect, useState } from 'react'
import { toast } from 'sonner'
import { Loader2, Lock, Play, RefreshCw, Check, X } from 'lucide-react'
import Link from 'next/link'
import '../tabs/keeper/keeper-surfaces.css'

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

/** What a keeper costs, in words. An unlisted system reads with its underscores as spaces. */
const KEEPER_COST_LABELS: Record<string, string> = {
  round_based: 'a draft pick, by round',
  inflation: 'a draft pick, rising each year kept',
  auction_value: 'auction dollars',
  free: 'nothing',
}

/** A keeper record's status in words; `pending` is the commissioner's to decide. */
const STATUS_WORDS: Record<string, string> = { pending: 'Waiting for you', confirmed: 'Confirmed', approved: 'Confirmed', rejected: 'Rejected', locked: 'Locked in' }
const STATUS_TONE: Record<string, string> = { pending: 'kp-warn', confirmed: 'kp-good', approved: 'kp-good', rejected: 'kp-bad', locked: 'kp-good' }
const statusWord = (s: string) => STATUS_WORDS[s] ?? s.replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase())
const plural = (n: number, one: string) => `${n} ${n === 1 ? one : `${one}s`}`

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

  // Locking with teams still to pick takes a second tap that names how many (2026-11-24 audit: one tap locked
  // the window on 5 of 12 teams with nothing said).
  const [lockArmed, setLockArmed] = useState(false)
  const lockPhase = async () => {
    const sid = ctx?.session?.id
    if (!sid) return
    const missingTeams = Math.max(0, (ctx?.session?.totalTeams ?? 0) - (ctx?.session?.teamsSubmitted ?? 0))
    if (missingTeams > 0 && !lockArmed) {
      setLockArmed(true)
      return
    }
    setLockArmed(false)
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
      <div className="kp-muted flex items-center gap-2 text-[13px]">
        <Loader2 className="h-4 w-4 animate-spin" /> Loading keeper tools…
      </div>
    )
  }

  if (!ctx) {
    return <p className="kp-muted text-[13px]">Keeper tools aren’t available right now.</p>
  }

  const pct = ctx.session
    ? Math.round((ctx.session.teamsSubmitted / Math.max(ctx.session.totalTeams, 1)) * 100)
    : 0
  const maxK = ctx.league.keeperCount ?? 3
  const waiting = records.filter((r) => r.status === 'pending').length
  const ordered = [...records].sort((a, b) => Number(b.status === 'pending') - Number(a.status === 'pending'))
  const deadlineText = ctx.session
    ? new Date(ctx.session.deadline).toLocaleString(undefined, { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
    : ''

  return (
    <div className="kp-text space-y-4 text-[13px]">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="kp-text text-[15px] font-bold">Keeper commissioner center</p>
        <button
          type="button"
          onClick={() => void load()}
          className="kp-btn inline-flex min-h-[36px] items-center gap-1 rounded-lg px-3 py-1 text-[12px] font-semibold"
        >
          <RefreshCw className="h-3 w-3" /> Refresh
        </button>
      </div>

      <p className="kp-muted text-[13px]">
        Each team keeps up to <span className="kp-text font-semibold">{plural(maxK, 'player')}</span>.
        {ctx.league.keeperCostSystem ? (
          <> A keeper costs {KEEPER_COST_LABELS[ctx.league.keeperCostSystem] ?? ctx.league.keeperCostSystem.replace(/_/g, ' ')}.</>
        ) : null}
      </p>

      {!ctx.session ? (
        <div className="kp-card rounded-xl p-4" data-testid="keeper-commish-open-window">
          <p className="kp-text text-[14px] font-semibold">Open the keeper window</p>
          <p className="kp-muted mt-1 text-[13px]">
            Pick the season and a deadline. Managers can pick keepers until then.
          </p>
          <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-end">
            <label className="kp-label flex flex-1 flex-col gap-1 text-[12px]">
              Season
              <select
                value={incomingSeasonId}
                onChange={(e) => setIncomingSeasonId(e.target.value)}
                className="kp-field min-h-[40px] rounded-lg px-3 py-2 text-[13px] font-normal"
              >
                {ctx.seasons.length === 0 ? (
                  <option value="">No seasons yet — create one first</option>
                ) : (
                  ctx.seasons.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.season} season
                    </option>
                  ))
                )}
              </select>
            </label>
            <label className="kp-label flex flex-1 flex-col gap-1 text-[12px]">
              Deadline
              <input
                type="datetime-local"
                value={deadlineLocal}
                onChange={(e) => setDeadlineLocal(e.target.value)}
                className="kp-field min-h-[40px] rounded-lg px-3 py-2 text-[13px] font-normal"
              />
            </label>
            <button
              type="button"
              disabled={busy !== null || !incomingSeasonId || ctx.seasons.length === 0}
              onClick={() => void openPhase()}
              className="kp-btn-primary inline-flex min-h-[44px] items-center justify-center gap-2 rounded-xl px-4 text-[13px] font-bold disabled:opacity-40"
            >
              {busy === 'open' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
              Open window
            </button>
          </div>
        </div>
      ) : (
        <div className="kp-card space-y-3 rounded-xl p-4" data-testid="keeper-commish-window">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div>
              <p className="kp-text text-[14px] font-semibold">Keeper window</p>
              <p className="kp-muted text-[13px]">
                {ctx.session.status === 'locked' ? 'Locked. Keepers are final.' : `Open until ${deadlineText}.`}
              </p>
            </div>
            {ctx.session.status === 'open' ? (
              <button
                type="button"
                disabled={busy !== null}
                onClick={() => void lockPhase()}
                className="kp-btn inline-flex min-h-[40px] items-center gap-2 rounded-xl px-3 py-2 text-[13px] font-semibold disabled:opacity-40"
              >
                {busy === 'lock' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Lock className="h-4 w-4" />}
                {lockArmed ? 'Lock anyway' : 'Lock keepers now'}
              </button>
            ) : (
              <span className="kp-chip rounded-full px-3 py-1 text-[12px] font-semibold">Locked</span>
            )}
          </div>
          <div className="h-2 w-full overflow-hidden rounded-full" style={{ background: 'var(--line2, var(--border))' }}
            role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct} aria-label="Teams that have picked keepers">
            <div className="h-full transition-all" style={{ width: `${pct}%`, background: 'var(--accent)' }} />
          </div>
          <p className="kp-text2 text-[13px]">
            {ctx.session.teamsSubmitted} of {ctx.session.totalTeams} teams have picked their keepers
          </p>
          {ctx.session.status === 'open' && ctx.session.teamsSubmitted < ctx.session.totalTeams ? (
            <p className={`text-[13px] ${lockArmed ? 'kp-warn font-semibold' : 'kp-muted'}`} data-testid="keeper-commish-lock-warning">
              {lockArmed
                ? `${ctx.session.totalTeams - ctx.session.teamsSubmitted} teams haven’t picked. Locking now closes the window for them too.`
                : `${ctx.session.totalTeams - ctx.session.teamsSubmitted} teams haven’t picked yet.`}
            </p>
          ) : null}
        </div>
      )}

      <div className="kp-card rounded-xl p-4">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <p className="kp-text text-[14px] font-semibold">
            Review keepers{waiting > 0 ? <span className="kp-accent"> · {waiting} waiting for you</span> : null}
          </p>
          {ctx.seasons.length > 1 ? (
            <label className="kp-label flex items-center gap-2 text-[12px]">
              Season
              <select
                value={approvalSeasonId}
                onChange={(e) => setApprovalSeasonId(e.target.value)}
                className="kp-field min-h-[36px] rounded-lg px-2 py-1 text-[13px] font-normal"
              >
                {ctx.seasons.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.season}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
        </div>
        {recordsLoading ? (
          <p className="kp-muted text-[13px]">
            <Loader2 className="mr-1 inline h-3 w-3 animate-spin" /> Loading keepers…
          </p>
        ) : records.length === 0 ? (
          <p className="kp-muted text-[13px]">No one has picked a keeper for this season yet.</p>
        ) : (
          /* One card per keeper: it stacks on a phone instead of a 520px table scrolled sideways (audit item 3). */
          <ul className="space-y-2">
            {ordered.map((r) => {
              const cost = (r.costLabel ?? (r.costRound != null ? `Round ${r.costRound}` : null))?.replace(/^Round (\d+)$/, 'a round $1 pick') ?? null
              return (
                <li key={r.id} data-testid={`keeper-review-${r.id}`}
                  className="grid gap-2 rounded-lg p-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_200px] sm:items-center"
                  style={{ background: 'var(--bg)', border: '1px solid var(--line, var(--border))' }}>
                  <div className="min-w-0">
                    <p className="kp-text truncate font-semibold">{r.playerName} <span className="kp-muted font-normal">· {r.position}</span></p>
                    <p className="kp-muted truncate text-[12px]">{r.teamName}{r.ownerLabel ? ` · ${r.ownerLabel}` : ''}</p>
                  </div>
                  <div className="kp-text2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px]">
                    {cost ? <span>Costs {cost}</span> : null}
                    <span className={`${STATUS_TONE[r.status] ?? 'kp-muted'} font-semibold`}>{statusWord(r.status)}</span>
                  </div>
                  {r.status === 'pending' ? (
                    <div className="flex gap-2 sm:justify-end">
                      <button
                        type="button"
                        disabled={recordBusy !== null}
                        onClick={() => void patchRecord(r.id, 'approve')}
                        aria-label={`Confirm ${r.playerName}`}
                        className="kp-btn-good inline-flex min-h-[40px] flex-1 items-center justify-center gap-1 rounded-lg px-3 text-[13px] font-semibold disabled:opacity-40 sm:flex-none"
                      >
                        {recordBusy === r.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
                        Confirm
                      </button>
                      <button
                        type="button"
                        disabled={recordBusy !== null}
                        onClick={() => void patchRecord(r.id, 'reject')}
                        aria-label={`Reject ${r.playerName}`}
                        className="kp-btn-bad inline-flex min-h-[40px] flex-1 items-center justify-center gap-1 rounded-lg px-3 text-[13px] font-semibold disabled:opacity-40 sm:flex-none"
                      >
                        <X className="h-3.5 w-3.5" /> Reject
                      </button>
                    </div>
                  ) : (
                    <div aria-hidden className="hidden sm:block" />
                  )}
                </li>
              )
            })}
          </ul>
        )}
      </div>

      {/* The draft-room route to keepers, only while keepers can still change. */}
      {ctx.session?.status === 'open' ? (
      <div className="kp-card rounded-lg p-3 text-[13px]" data-testid="keeper-commish-draft-note">
        <p className="kp-text font-semibold">Draft</p>
        <p className="kp-muted mt-1">
          Before the draft starts, you can still add or change keepers in the draft room’s Keeper panel.
        </p>
        <Link href={`/league/${leagueId}?tab=draft`} className="kp-accent mt-2 inline-block font-semibold hover:underline">
          Open draft →
        </Link>
      </div>
      ) : null}
    </div>
  )
}
