'use client'

import { useMemo, useState } from 'react'
import type { BigBrotherSummary } from '@/components/big-brother/types'
import { useUserTimezone } from '@/hooks/useUserTimezone'

export function VetoDecisionCard({
  leagueId,
  summary,
  onDone,
}: {
  leagueId: string
  summary: BigBrotherSummary
  onDone: () => void
}) {
  const cycle = summary.cycle
  const names = summary.rosterDisplayNames ?? {}
  const { formatInTimezone } = useUserTimezone()
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  const n1 = cycle?.nominee1RosterId
  const n2 = cycle?.nominee2RosterId

  const deadline = useMemo(() => {
    if (!cycle?.voteDeadlineAt) return null
    return formatInTimezone(cycle.voteDeadlineAt)
  }, [cycle?.voteDeadlineAt, formatInTimezone])

  if (!n1 || !n2) return null

  const act = async (action: 'use' | 'pass', saved?: string) => {
    setBusy(true)
    setErr(null)
    try {
      const res = await fetch(`/api/leagues/${encodeURIComponent(leagueId)}/big-brother/veto-decision`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(
          action === 'use' ? { action: 'use', savedRosterId: saved } : { action: 'pass' }
        ),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error((data as { error?: string }).error ?? 'Failed')
      onDone()
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Failed')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="rounded-xl border border-[var(--accent-line)] bg-[var(--surface)] p-4" data-testid="bb-veto-decision-card">
      <h3 className="text-base font-bold text-[var(--text)]">🏅 You hold the Power of Veto.</h3>
      {deadline ? <p className="mt-1 text-[11px] text-[var(--muted)]">Decision window: {deadline}</p> : null}
      <div className="mt-3 space-y-2">
        <button
          type="button"
          disabled={busy}
          onClick={() => void act('use', n1)}
          className="w-full rounded-xl border border-[var(--accent-line)] bg-[var(--accent-soft)] py-2.5 text-[13px] font-semibold text-[var(--accent)] disabled:opacity-40"
        >
          Save Nominee 1: {names[n1] ?? n1}
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() => void act('use', n2)}
          className="w-full rounded-xl border border-[var(--accent-line)] bg-[var(--accent-soft)] py-2.5 text-[13px] font-semibold text-[var(--accent)] disabled:opacity-40"
        >
          Save Nominee 2: {names[n2] ?? n2}
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() => void act('pass')}
          className="w-full rounded-xl border border-[var(--line)] bg-white/[0.05] py-2.5 text-[13px] font-semibold text-[var(--text)] disabled:opacity-40"
        >
          Pass — Nominations Stand
        </button>
      </div>
      {err ? <p className="mt-2 text-[12px] text-[var(--bad)]">{err}</p> : null}
    </div>
  )
}
