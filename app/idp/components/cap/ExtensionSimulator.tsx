'use client'

import { useState } from 'react'
import type { IdpSalaryRecordJson } from '@/app/idp/hooks/useIdpTeamCap'

type Props = {
  leagueId: string
  rosterId: string
  contracts: IdpSalaryRecordJson[]
  onApplied?: () => void
}

export function ExtensionSimulator({ leagueId, rosterId, contracts, onApplied }: Props) {
  const [q, setQ] = useState('')
  const [pick, setPick] = useState<IdpSalaryRecordJson | null>(null)
  const [years, setYears] = useState(1)
  const [loading, setLoading] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)

  const filtered = contracts.filter(
    (c) => c.playerName.toLowerCase().includes(q.toLowerCase()) || c.playerId.includes(q),
  )

  const boost = pick?.extensionBoostPct ?? 0.1
  const newSal = pick ? pick.salary * (1 + boost * years) : 0

  const simulate = () => {
    if (!pick) return
    setMsg(
      `Approx new salary ${newSal.toFixed(2)}M/yr for +${years} yr — confirm with league cap rules before applying.`,
    )
  }

  const apply = async () => {
    if (!pick) return
    setLoading(true)
    setMsg(null)
    try {
      const res = await fetch('/api/idp/cap', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          leagueId,
          rosterId,
          action: 'extend',
          salaryRecordId: pick.id,
          additionalYears: years,
        }),
      })
      const data = (await res.json().catch(() => ({}))) as { error?: string }
      if (!res.ok) {
        setMsg(data.error ?? 'Failed')
        return
      }
      setMsg('Extension applied.')
      onApplied?.()
    } finally {
      setLoading(false)
    }
  }

  return (
    <div
      className="space-y-3 rounded-xl border border-white/[0.08] bg-[var(--surface)] p-4"
      data-testid="extension-simulator"
    >
      <h3 className="text-[12px] font-bold uppercase tracking-wide text-[var(--muted)]">Extension simulator</h3>
      <input
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="Search player…"
        className="w-full rounded-lg border border-[var(--line)] bg-[var(--surface2)] px-3 py-2 text-sm text-[var(--text)]"
      />
      <div className="max-h-32 space-y-1 overflow-y-auto">
        {filtered.slice(0, 8).map((c) => (
          <button
            key={c.id}
            type="button"
            onClick={() => setPick(c)}
            className={`flex w-full justify-between rounded-lg border px-2 py-1.5 text-left text-[11px] ${
              pick?.id === c.id ? 'border-[var(--accent-line)] bg-[var(--accent-soft)]' : 'border-white/[0.06] hover:bg-white/[0.04]'
            }`}
          >
            <span>{c.playerName}</span>
            <span className="text-[var(--muted)]">${c.salary.toFixed(1)}M</span>
          </button>
        ))}
      </div>
      <div className="flex gap-2">
        {[1, 2, 3].map((y) => (
          <button
            key={y}
            type="button"
            onClick={() => setYears(y)}
            className={`flex-1 rounded-lg border py-2 text-xs font-bold ${
              years === y ? 'border-[var(--good)] bg-[var(--good-soft)] text-[var(--good)]' : 'border-[var(--line)] text-[var(--muted)]'
            }`}
          >
            +{y} yr
          </button>
        ))}
      </div>
      {pick ? (
        <p className="text-[11px] text-[var(--text2)]">
          Preview: ~${newSal.toFixed(2)}M/yr · Boost {Math.round(boost * 100)}% per year added (UI estimate).
        </p>
      ) : null}
      {msg ? <p className="text-[11px] text-[var(--accent)]">{msg}</p> : null}
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={simulate}
          className="rounded-lg border border-[var(--line)] px-3 py-2 text-xs font-semibold text-[var(--text)]"
        >
          Simulate
        </button>
        <button
          type="button"
          disabled={loading || !pick}
          onClick={() => void apply()}
          className="rounded-lg border border-[var(--accent-line)] bg-[var(--accent-soft)] px-3 py-2 text-xs font-semibold text-[var(--accent)] disabled:opacity-50"
        >
          {loading ? '…' : 'Apply Extension'}
        </button>
      </div>
    </div>
  )
}
