'use client'

import { useCallback, useEffect, useState } from 'react'
import { History } from 'lucide-react'
import { WarRoomPanel } from '@/components/tournament/TournamentWarRoomPrimitives'

type LedgerEntry = {
  id: string
  tokenDelta: number
  spendFeatureLabel: string | null
  description: string | null
  createdAt: string
}

export function SurvivorTokenHistoryStrip() {
  const [entries, setEntries] = useState<LedgerEntry[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setError(null)
    try {
      const res = await fetch('/api/tokens/history?limit=12', { cache: 'no-store' })
      const j = (await res.json().catch(() => ({}))) as { entries?: LedgerEntry[]; error?: string }
      if (!res.ok) {
        setEntries([])
        setError(typeof j.error === 'string' ? j.error : 'Failed to load history')
        return
      }
      setEntries(Array.isArray(j.entries) ? j.entries : [])
    } catch {
      setEntries([])
      setError('Network error')
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  return (
    <WarRoomPanel
      title="Recent AF Token activity"
      subtitle="Spends and grants tied to your account — including Survivor Chimmy metered runs."
    >
      <div className="mb-3 flex items-center gap-2 text-[11px] text-white/45">
        <History className="h-3.5 w-3.5" aria-hidden />
        Last 12 ledger lines
        <button
          type="button"
          onClick={() => void load()}
          className="ml-auto font-semibold text-cyan-300 hover:text-cyan-200"
        >
          Refresh
        </button>
      </div>
      {error ? <p className="text-sm text-rose-300/90">{error}</p> : null}
      {!error && entries && entries.length === 0 ? (
        <p className="text-sm text-white/45">No token activity yet.</p>
      ) : null}
      {!error && entries && entries.length > 0 ? (
        <ul className="max-h-52 space-y-2 overflow-y-auto text-[12px] text-white/70">
          {entries.map((e) => (
            <li
              key={e.id}
              className="flex flex-wrap items-baseline justify-between gap-2 rounded-lg border border-white/[0.06] bg-black/30 px-2 py-1.5"
            >
              <span className="text-white/55">{new Date(e.createdAt).toLocaleString()}</span>
              <span className={`font-mono font-semibold ${e.tokenDelta < 0 ? 'text-amber-200' : 'text-emerald-200'}`}>
                {e.tokenDelta > 0 ? '+' : ''}
                {e.tokenDelta}
              </span>
              <span className="w-full text-[11px] text-white/45">
                {e.spendFeatureLabel ?? e.description ?? 'Entry'}
              </span>
            </li>
          ))}
        </ul>
      ) : null}
    </WarRoomPanel>
  )
}
