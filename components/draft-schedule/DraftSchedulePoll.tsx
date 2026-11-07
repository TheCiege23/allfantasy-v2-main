'use client'

import { useCallback, useEffect, useState } from 'react'

import { MAX_SLOTS, MIN_SLOTS } from '@/lib/draft-schedule/draftSchedule'
import type { DraftScheduleView } from '@/lib/draft-schedule/draftScheduleService'

/**
 * Draft scheduler (commissioner): offer a few start times, the league answers in a league-chat poll,
 * lock the time most managers can make. Every time below is shown in the viewer's own zone; the server
 * stores UTC and members see the poll in theirs.
 */

type View = DraftScheduleView & { isCommissioner: boolean }

const localLabel = (iso: string) =>
  new Date(iso).toLocaleString(undefined, { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZoneName: 'short' })

export function DraftSchedulePoll({ leagueId, disabled = false }: { leagueId: string; disabled?: boolean }) {
  const endpoint = `/api/leagues/${encodeURIComponent(leagueId)}/draft/schedule`
  const [view, setView] = useState<View | null>(null)
  const [slots, setSlots] = useState<string[]>(['', ''])
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<string | null>(null)

  const load = useCallback(async () => {
    const res = await fetch(endpoint, { cache: 'no-store', credentials: 'same-origin' }).catch(() => null)
    const body = res ? await res.json().catch(() => null) : null
    if (res?.ok && body) setView(body as View)
  }, [endpoint])

  useEffect(() => {
    void load()
  }, [load])

  async function post(payload: Record<string, unknown>, done: string) {
    setBusy(true)
    setMessage(null)
    try {
      const res = await fetch(endpoint, { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) })
      const body = (await res.json().catch(() => null)) as { error?: string } | null
      if (!res.ok) {
        setMessage(body?.error ?? `HTTP ${res.status}`)
        return
      }
      setMessage(done)
      await load()
    } finally {
      setBusy(false)
    }
  }

  const poll = view?.poll ?? null
  const open = poll?.status === 'open'

  return (
    <div className="space-y-3 rounded-xl border border-white/10 bg-white/[0.03] p-4" data-testid="draft-schedule-poll">
      <div>
        <p className="text-[13px] font-semibold text-white">Find a draft time</p>
        <p className="mt-0.5 text-[12px] text-white/55">
          Offer a few start times. Your league picks every time it can make in a league-chat poll, each shown in their own time zone. Lock the one that works for most.
        </p>
      </div>

      {open && poll ? (
        <>
          <p className="text-[12px] text-white/55">
            {view!.answered} of {view!.teamCount || '—'} managers have answered · closes {localLabel(poll.closesAt)}
          </p>
          <ul className="space-y-2">
            {view!.tallies.map((t) => {
              const best = view!.best?.id === t.id
              return (
                <li key={t.id} className="flex flex-wrap items-center gap-2 rounded-lg border border-white/10 px-3 py-2" data-best={best || undefined}>
                  <span className="min-w-0 flex-1 text-[13px] text-white">
                    {localLabel(t.startsAt)}
                    {best ? <span className="ml-2 rounded bg-emerald-500/20 px-1.5 py-0.5 text-[11px] font-bold uppercase text-emerald-300">Best so far</span> : null}
                  </span>
                  <span className="text-[12px] text-white/60">
                    {t.count} can make it
                  </span>
                  {view!.isCommissioner && !disabled ? (
                    <button
                      type="button"
                      className="min-h-[44px] rounded-lg border border-white/20 px-3 text-[12px] font-semibold text-white hover:bg-white/10 disabled:opacity-50"
                      disabled={busy}
                      onClick={() => void post({ action: 'lock', slotId: t.id }, 'Draft time locked. Everyone was told, in their own time zone.')}
                    >
                      Lock this time
                    </button>
                  ) : null}
                </li>
              )
            })}
          </ul>
          {view!.isCommissioner && !disabled ? (
            <button type="button" className="text-[12px] text-white/50 underline" disabled={busy} onClick={() => void post({ action: 'cancel' }, 'Poll withdrawn.')}>
              Withdraw the poll
            </button>
          ) : null}
        </>
      ) : view?.isCommissioner && !disabled ? (
        <>
          {poll?.status === 'locked' && poll.lockedSlotId ? (
            <p className="text-[12px] text-emerald-300">
              Last poll locked {localLabel(poll.slots.find((s) => s.id === poll.lockedSlotId)?.startsAt ?? poll.lockedAt ?? poll.createdAt)}.
            </p>
          ) : null}
          <div className="space-y-2">
            {slots.map((v, i) => (
              <div key={i} className="flex gap-2">
                <input
                  type="datetime-local"
                  className="min-h-[44px] min-w-0 flex-1 rounded-lg border border-white/15 bg-[#0d1526] px-3 text-[13px] text-white"
                  value={v}
                  onChange={(e) => setSlots((s) => s.map((x, j) => (j === i ? e.target.value : x)))}
                  aria-label={`Start time ${i + 1}`}
                />
                {slots.length > MIN_SLOTS ? (
                  <button type="button" className="text-[12px] text-white/50 underline" onClick={() => setSlots((s) => s.filter((_, j) => j !== i))}>
                    Remove
                  </button>
                ) : null}
              </div>
            ))}
          </div>
          <div className="flex flex-wrap gap-2">
            {slots.length < MAX_SLOTS ? (
              <button type="button" className="min-h-[44px] rounded-lg border border-white/15 px-3 text-[12px] text-white/70 hover:bg-white/5" onClick={() => setSlots((s) => [...s, ''])}>
                + Add a time
              </button>
            ) : null}
            <button
              type="button"
              className="min-h-[44px] rounded-lg bg-cyan-600/80 px-4 text-[13px] font-semibold text-white hover:bg-cyan-600 disabled:opacity-50"
              disabled={busy || slots.filter(Boolean).length < MIN_SLOTS}
              onClick={() =>
                void post(
                  // `datetime-local` is the commissioner's own clock; toISOString stores that moment in UTC.
                  { action: 'create', slots: slots.filter(Boolean).map((v) => new Date(v).toISOString()) },
                  'Posted to league chat. Members pick every time they can make.',
                )
              }
            >
              Ask the league
            </button>
          </div>
        </>
      ) : null}

      {message ? (
        <p className="text-[12px] text-white/70" role="status">
          {message}
        </p>
      ) : null}
    </div>
  )
}

export default DraftSchedulePoll
