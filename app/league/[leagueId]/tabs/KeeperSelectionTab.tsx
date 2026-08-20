'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { toast } from 'sonner'
import { Loader2, CheckCircle2, XCircle, AlertCircle } from 'lucide-react'
import { LEAGUE_TYPE_MEDIA } from '@/lib/create-league-v2/theme'

type SessionRow = {
  id: string
  seasonId: string
  status: string
  deadline: string
  teamsSubmitted: number
  totalTeams: number
}

type ContextPayload = {
  league: { keeperCount: number | null }
  session: SessionRow | null
  viewerRoster: { id: string; seasonId: string } | null
}

type RosterPlayer = {
  playerId: string
  playerName: string
  position: string
  team: string | null
}

type EligRow = {
  playerId: string
  isEligible: boolean
  ineligibleReason: string | null
  projectedCost: string | null
  projectedCostRound: number | null
  yearsKept: number
}

type KeeperRec = {
  id: string
  playerId: string
  playerName: string | null
  status: string
  costRound: number | null
  costLabel: string | null
}

export function KeeperSelectionTab({ leagueId }: { leagueId: string }) {
  const [loading, setLoading] = useState(true)
  const [ctx, setCtx] = useState<ContextPayload | null>(null)
  const [players, setPlayers] = useState<RosterPlayer[]>([])
  const [eligibility, setEligibility] = useState<EligRow[]>([])
  const [records, setRecords] = useState<KeeperRec[]>([])
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [submitting, setSubmitting] = useState(false)

  const media = LEAGUE_TYPE_MEDIA.keeper

  const loadContext = useCallback(async () => {
    const res = await fetch(`/api/keeper/context?leagueId=${encodeURIComponent(leagueId)}`, {
      credentials: 'include',
    })
    const j = await res.json().catch(() => ({}))
    if (!res.ok) throw new Error(typeof j.error === 'string' ? j.error : 'Failed to load')
    return j as ContextPayload
  }, [leagueId])

  const refresh = useCallback(async () => {
    setLoading(true)
    try {
      const c = await loadContext()
      setCtx(c)
      if (!c.session || !c.viewerRoster) {
        setPlayers([])
        setEligibility([])
        setRecords([])
        setSelected(new Set())
        return
      }

      const [eligRes, rosterRes, recRes] = await Promise.all([
        fetch(
          `/api/keeper/eligibility?leagueId=${encodeURIComponent(leagueId)}&seasonId=${encodeURIComponent(c.session.seasonId)}&rosterId=${encodeURIComponent(c.viewerRoster.id)}`,
          { credentials: 'include' },
        ),
        fetch(`/api/redraft/roster?rosterId=${encodeURIComponent(c.viewerRoster.id)}&week=1`, {
          credentials: 'include',
        }),
        fetch(
          `/api/keeper/selections?leagueId=${encodeURIComponent(leagueId)}&seasonId=${encodeURIComponent(c.session.seasonId)}&rosterId=${encodeURIComponent(c.viewerRoster.id)}`,
          { credentials: 'include' },
        ),
      ])

      const eligJson = await eligRes.json().catch(() => ({}))
      if (eligRes.ok && Array.isArray(eligJson.raw)) {
        setEligibility(eligJson.raw as EligRow[])
      } else {
        setEligibility([])
      }

      const rosterJson = await rosterRes.json().catch(() => ({}))
      const rp = rosterJson.roster?.players
      if (rosterRes.ok && Array.isArray(rp)) {
        setPlayers(
          rp
            .filter((p: { droppedAt?: string | null }) => !p.droppedAt)
            .map((p: { playerId: string; playerName: string; position: string; team?: string | null }) => ({
              playerId: p.playerId,
              playerName: p.playerName,
              position: p.position,
              team: p.team ?? null,
            })),
        )
      } else {
        setPlayers([])
      }

      const recJson = await recRes.json().catch(() => ({}))
      const recs = Array.isArray(recJson.records) ? (recJson.records as KeeperRec[]) : []
      setRecords(recs)
      setSelected(new Set(recs.filter((r) => r.status !== 'rejected').map((r) => r.playerId)))
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Load failed')
      setCtx(null)
    } finally {
      setLoading(false)
    }
  }, [leagueId, loadContext])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const maxKeepers = ctx?.league.keeperCount ?? 3
  const session = ctx?.session
  const locked = session?.status === 'locked'
  const deadlinePassed = session ? new Date(session.deadline).getTime() < Date.now() : false

  const eligByPlayer = useMemo(() => {
    const m = new Map<string, EligRow>()
    for (const e of eligibility) m.set(e.playerId, e)
    return m
  }, [eligibility])

  const toggle = (pid: string) => {
    if (locked || deadlinePassed) return
    const e = eligByPlayer.get(pid)
    if (e && !e.isEligible) {
      toast.error(e.ineligibleReason ?? 'Not eligible')
      return
    }
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(pid)) next.delete(pid)
      else {
        if (next.size >= maxKeepers) {
          toast.error(`You can keep at most ${maxKeepers} players.`)
          return prev
        }
        next.add(pid)
      }
      return next
    })
  }

  const submit = async () => {
    if (!ctx?.session || !ctx.viewerRoster || locked) return
    setSubmitting(true)
    try {
      const res = await fetch('/api/keeper/selections', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          leagueId,
          seasonId: ctx.session.seasonId,
          rosterId: ctx.viewerRoster.id,
          playerIds: Array.from(selected),
        }),
      })
      const j = await res.json().catch(() => ({}))
      if (!res.ok) {
        toast.error(typeof j.error === 'string' ? j.error : 'Could not save keepers')
        return
      }
      if (Array.isArray(j.conflicted) && j.conflicted.length > 0) {
        toast.message('Some players could not be kept', {
          description: j.conflicted.map((c: { reason: string }) => c.reason).join('; '),
        })
      } else {
        toast.success('Keeper declaration saved')
      }
      await refresh()
    } finally {
      setSubmitting(false)
    }
  }

  if (loading && !ctx) {
    return (
      <div className="flex items-center gap-2 px-4 py-8 text-[13px] text-white/50">
        <Loader2 className="h-4 w-4 animate-spin" /> Loading keeper tools…
      </div>
    )
  }

  return (
    <div className="space-y-4 px-4 py-4">
      <div className="overflow-hidden rounded-2xl border border-amber-500/20 bg-[#0a1220]">
        <div className="relative aspect-[21/9] max-h-[220px] w-full bg-black/40">
          <video
            className="h-full w-full object-cover opacity-90"
            autoPlay
            muted
            loop
            playsInline
            poster={media.fallback}
            src={media.video}
          />
          <div className="absolute inset-0 bg-gradient-to-t from-[#060a18] via-transparent to-transparent" />
          <div className="absolute bottom-3 left-4 right-4">
            <h2 className="text-[18px] font-black text-white drop-shadow-md">Keeper league</h2>
            <p className="text-[12px] text-white/75 drop-shadow">
              Declare keepers before the deadline, then finish the draft with locked players off the board.
            </p>
          </div>
        </div>
      </div>

      <div>
        <h2 className="text-[15px] font-bold text-white">Keeper declaration</h2>
        <p className="mt-1 text-[12px] text-white/45">
          Select up to {maxKeepers} players from your roster. Costs follow your commissioner&apos;s rules
          (round penalty, salary, etc.).
        </p>
      </div>

      {!session ? (
        <div className="rounded-xl border border-white/10 bg-white/[0.03] p-4 text-[13px] text-white/55">
          <AlertCircle className="mb-2 inline h-4 w-4 text-amber-400/90" /> No active declaration window. The
          commissioner must open a keeper phase for the upcoming season.
        </div>
      ) : !ctx?.viewerRoster ? (
        <div className="rounded-xl border border-white/10 bg-white/[0.03] p-4 text-[13px] text-white/55">
          No roster found for you in this season. If you just joined, wait for the commissioner to assign your
          team slot.
        </div>
      ) : (
        <>
          <div
            className={`rounded-xl border px-4 py-3 text-[12px] ${
              locked || deadlinePassed
                ? 'border-white/10 bg-white/[0.04] text-white/55'
                : 'border-amber-500/30 bg-amber-500/10 text-amber-50/95'
            }`}
          >
            <p>
              <span className="font-semibold text-white">Status:</span> {session.status}
              {locked ? ' — editing disabled' : ''}
            </p>
            <p className="mt-1">
              Deadline: {new Date(session.deadline).toLocaleString()}
              {deadlinePassed && !locked ? (
                <span className="ml-2 text-rose-300/90">(passed — commissioner may still override)</span>
              ) : null}
            </p>
            <p className="mt-1 text-white/55">
              League progress: {session.teamsSubmitted}/{session.totalTeams} teams submitted
            </p>
          </div>

          <div className="space-y-2">
            {players.length === 0 ? (
              <p className="text-[12px] text-white/45">No players on your roster for this season yet.</p>
            ) : (
              players.map((p) => {
                const e = eligByPlayer.get(p.playerId)
                const sel = selected.has(p.playerId)
                const ineligible = e && !e.isEligible
                return (
                  <button
                    key={p.playerId}
                    type="button"
                    disabled={locked || deadlinePassed || Boolean(ineligible)}
                    onClick={() => toggle(p.playerId)}
                    className={`flex w-full items-start gap-3 rounded-xl border px-3 py-2.5 text-left transition ${
                      sel
                        ? 'border-amber-400/50 bg-amber-500/15'
                        : 'border-white/[0.07] bg-white/[0.02] hover:border-white/15'
                    } disabled:cursor-not-allowed disabled:opacity-50`}
                  >
                    <span className="mt-0.5 text-amber-300/90">{sel ? <CheckCircle2 className="h-4 w-4" /> : <span className="inline-block h-4 w-4 rounded border border-white/20" />}</span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-[14px] font-semibold text-white">{p.playerName}</span>
                      <span className="text-[11px] text-white/45">
                        {p.position}
                        {p.team ? ` · ${p.team}` : ''}
                      </span>
                      {e?.projectedCost || e?.projectedCostRound != null ? (
                        <span className="mt-0.5 block text-[11px] text-[#ffb8d1]/80">
                          Projected cost:{' '}
                          {e.projectedCost ??
                            (e.projectedCostRound != null ? `Round ${e.projectedCostRound}` : '—')}
                        </span>
                      ) : null}
                      {ineligible ? (
                        <span className="mt-1 flex items-center gap-1 text-[11px] text-rose-300/90">
                          <XCircle className="h-3 w-3" /> {e?.ineligibleReason ?? 'Ineligible'}
                        </span>
                      ) : null}
                    </span>
                  </button>
                )
              })
            )}
          </div>

          {records.length > 0 ? (
            <div className="rounded-xl border border-white/10 bg-white/[0.02] p-3">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-white/45">Submitted</p>
              <ul className="mt-2 space-y-1 text-[12px] text-white/70">
                {records.map((r) => (
                  <li key={r.id}>
                    {r.playerName ?? r.playerId} — {r.status}
                    {r.costLabel ? ` · ${r.costLabel}` : r.costRound != null ? ` · R${r.costRound}` : ''}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          {!locked && !deadlinePassed ? (
            <button
              type="button"
              disabled={submitting}
              onClick={() => void submit()}
              className="inline-flex min-h-[48px] w-full items-center justify-center rounded-xl bg-amber-500/90 text-[14px] font-bold text-black hover:bg-amber-400 disabled:opacity-50"
            >
              {submitting ? <Loader2 className="h-5 w-5 animate-spin" /> : 'Save keeper declaration'}
            </button>
          ) : null}
        </>
      )}

      <div className="rounded-lg border border-white/[0.06] bg-white/[0.02] p-3 text-[11px] text-white/45">
        <p className="font-medium text-white/65">Pre-draft picks in draft room</p>
        <p className="mt-1">
          For snake draft sessions, you can also set keepers from the live draft room&apos;s Keeper panel before the
          clock starts.
        </p>
        <Link href={`/league/${leagueId}?tab=draft`} className="mt-2 inline-block font-semibold text-[#ff9ec0] hover:underline">
          Go to draft →
        </Link>
      </div>
    </div>
  )
}
