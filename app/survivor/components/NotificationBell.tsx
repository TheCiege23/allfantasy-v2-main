'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { buildSurvivorNotifications } from '@/lib/survivor/notifications'
import type { SurvivorSeasonPayload } from '@/lib/survivor/survivorUiTypes'

type PendingSitOutResponse = {
  sitOutId: string | null
  week: number
}

type SurvivorSummaryLite = {
  sitOuts?: {
    myPendingResponse?: PendingSitOutResponse | null
  }
}

export function NotificationBell({
  leagueId,
  season,
}: {
  leagueId: string
  season: SurvivorSeasonPayload | null
}) {
  const [open, setOpen] = useState(false)
  const [pendingSitOut, setPendingSitOut] = useState<PendingSitOutResponse | null>(null)
  const [submittingDecision, setSubmittingDecision] = useState<'yes' | 'no' | null>(null)
  const [decisionError, setDecisionError] = useState<string | null>(null)
  const items = useMemo(() => buildSurvivorNotifications(leagueId, season), [leagueId, season])

  useEffect(() => {
    if (!open) return
    let cancelled = false

    const loadPendingResponse = async () => {
      try {
        const res = await fetch(`/api/leagues/${leagueId}/survivor/summary`, { cache: 'no-store' })
        if (!res.ok) return
        const data = (await res.json()) as SurvivorSummaryLite
        if (!cancelled) {
          setPendingSitOut(data.sitOuts?.myPendingResponse ?? null)
          setDecisionError(null)
        }
      } catch {
        if (!cancelled) setDecisionError('Unable to load sit-out response status right now.')
      }
    }

    void loadPendingResponse()
    return () => {
      cancelled = true
    }
  }, [open, leagueId])

  const submitDecision = async (decision: 'yes' | 'no') => {
    if (!pendingSitOut?.sitOutId || submittingDecision) return
    setSubmittingDecision(decision)
    setDecisionError(null)
    try {
      const res = await fetch(
        `/api/leagues/${leagueId}/survivor/sit-outs/${pendingSitOut.sitOutId}/respond`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ decision }),
        },
      )
      const payload = (await res.json().catch(() => ({}))) as { error?: string }
      if (!res.ok) {
        setDecisionError(payload.error ?? 'Unable to submit your response right now.')
        return
      }
      setPendingSitOut(null)
    } catch {
      setDecisionError('Network error while sending your sit-out response.')
    } finally {
      setSubmittingDecision(null)
    }
  }

  return (
    <div className="relative">
      <button
        type="button"
        className="relative flex h-11 w-11 items-center justify-center rounded-xl border border-white/[0.08] bg-white/[0.04] text-lg text-white/80"
        aria-label={`Notifications${items.length ? `, ${items.length} items` : ''}`}
        onClick={() => setOpen((v) => !v)}
      >
        🔔
        {items.length ? (
          <span className="absolute -right-0.5 -top-0.5 flex h-5 min-w-[20px] items-center justify-center rounded-full bg-red-500 px-1 text-[11px] font-bold text-white">
            {items.length > 9 ? '9+' : items.length}
          </span>
        ) : null}
      </button>
      {open ? (
        <div className="absolute right-0 top-12 z-50 w-[min(92vw,320px)] rounded-xl border border-white/10 bg-[var(--survivor-panel)] shadow-2xl">
          <div className="max-h-80 overflow-y-auto p-2">
            {pendingSitOut?.sitOutId ? (
              <div className="mb-2 rounded-lg border border-amber-300/35 bg-amber-500/10 p-2">
                <p className="text-[12px] font-semibold text-amber-200">Sit-out nomination pending</p>
                <p className="text-[11px] text-amber-100/80">
                  You were nominated to sit out for week {pendingSitOut.week}. Accept or decline below.
                </p>
                <div className="mt-2 flex gap-2">
                  <button
                    type="button"
                    className="rounded-md border border-emerald-300/40 bg-emerald-500/20 px-2 py-1 text-[11px] font-semibold text-emerald-100 disabled:opacity-50"
                    onClick={() => void submitDecision('yes')}
                    disabled={Boolean(submittingDecision)}
                  >
                    {submittingDecision === 'yes' ? 'Submitting...' : 'Yes, sit me out'}
                  </button>
                  <button
                    type="button"
                    className="rounded-md border border-rose-300/40 bg-rose-500/20 px-2 py-1 text-[11px] font-semibold text-rose-100 disabled:opacity-50"
                    onClick={() => void submitDecision('no')}
                    disabled={Boolean(submittingDecision)}
                  >
                    {submittingDecision === 'no' ? 'Submitting...' : 'No, keep me active'}
                  </button>
                </div>
                {decisionError ? <p className="mt-2 text-[11px] text-rose-200">{decisionError}</p> : null}
              </div>
            ) : null}
            {items.length === 0 ? (
              <p className="px-2 py-4 text-center text-[12px] text-white/45">No alerts right now.</p>
            ) : (
              items.map((n) => (
                <Link
                  key={n.id}
                  href={n.href ?? `#`}
                  onClick={() => setOpen(false)}
                  className="block rounded-lg px-2 py-2 hover:bg-white/[0.05]"
                >
                  <div className="flex gap-2">
                    <span className="text-lg">{n.icon}</span>
                    <div className="min-w-0">
                      <p className="text-[12px] font-semibold text-white">{n.title}</p>
                      <p className="text-[11px] text-white/50">{n.body}</p>
                    </div>
                  </div>
                </Link>
              ))
            )}
          </div>
        </div>
      ) : null}
    </div>
  )
}
