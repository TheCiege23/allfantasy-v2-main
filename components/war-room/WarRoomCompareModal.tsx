'use client'

import React, { useState } from 'react'

export type WarRoomCompareModalProps = {
  open: boolean
  onClose: () => void
  leagueId: string
  sport: string
  draftSessionId?: string | null
}

export function WarRoomCompareModal({ open, onClose, leagueId, sport, draftSessionId }: WarRoomCompareModalProps) {
  const [aName, setAName] = useState('Player A')
  const [bName, setBName] = useState('Player B')
  const [aPos, setAPos] = useState('WR')
  const [bPos, setBPos] = useState('RB')
  const [aAdp, setAAdp] = useState(18)
  const [bAdp, setBAdp] = useState(22)
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState<Record<string, unknown> | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const structuredResult =
    typeof result?.result === 'object' && result.result !== null ? result.result : null

  const runCompare = async () => {
    setLoading(true)
    setErr(null)
    try {
      const res = await fetch('/api/war-room/compare', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          leagueId,
          draftSessionId,
          a: { name: aName, position: aPos, adp: aAdp },
          b: { name: bName, position: bPos, adp: bAdp },
        }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setErr(typeof data.error === 'string' ? data.error : 'Compare failed')
        return
      }
      setResult(data)
    } catch {
      setErr('Network error')
    } finally {
      setLoading(false)
    }
  }

  if (!open) return null
  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 p-4 sm:items-center"
      role="dialog"
      aria-modal="true"
      data-testid="war-room-compare-modal"
    >
      <div className="max-h-[85vh] w-full max-w-lg overflow-y-auto rounded-2xl border border-white/10 bg-[#0a1228] p-4 shadow-xl">
        <div className="flex items-start justify-between gap-2">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-wider text-white/40">Compare</p>
            <h2 className="text-sm font-semibold text-white">Player A vs B</h2>
            <p className="mt-1 text-[11px] text-white/50">
              POST <code className="text-cyan-200/80">/api/war-room/compare</code> · {sport}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-white/15 px-2 py-1 text-[11px] text-white/70 hover:bg-white/5"
          >
            Close
          </button>
        </div>

        <div className="mt-3 grid grid-cols-2 gap-2">
          <label className="text-[11px] text-white/50">
            Player A
            <input
              value={aName}
              onChange={(e) => setAName(e.target.value)}
              className="mt-0.5 w-full rounded border border-white/10 bg-black/30 px-2 py-1 text-[11px] text-white"
            />
          </label>
          <label className="text-[11px] text-white/50">
            Player B
            <input
              value={bName}
              onChange={(e) => setBName(e.target.value)}
              className="mt-0.5 w-full rounded border border-white/10 bg-black/30 px-2 py-1 text-[11px] text-white"
            />
          </label>
          <label className="text-[11px] text-white/50">
            A pos / ADP
            <div className="mt-0.5 flex gap-1">
              <input
                value={aPos}
                onChange={(e) => setAPos(e.target.value)}
                className="w-12 rounded border border-white/10 bg-black/30 px-1 py-1 text-[11px] text-white"
              />
              <input
                type="number"
                value={aAdp}
                onChange={(e) => setAAdp(Number(e.target.value))}
                className="w-full rounded border border-white/10 bg-black/30 px-1 py-1 text-[11px] text-white"
              />
            </div>
          </label>
          <label className="text-[11px] text-white/50">
            B pos / ADP
            <div className="mt-0.5 flex gap-1">
              <input
                value={bPos}
                onChange={(e) => setBPos(e.target.value)}
                className="w-12 rounded border border-white/10 bg-black/30 px-1 py-1 text-[11px] text-white"
              />
              <input
                type="number"
                value={bAdp}
                onChange={(e) => setBAdp(Number(e.target.value))}
                className="w-full rounded border border-white/10 bg-black/30 px-1 py-1 text-[11px] text-white"
              />
            </div>
          </label>
        </div>

        <button
          type="button"
          onClick={() => void runCompare()}
          disabled={loading}
          className="mt-3 w-full rounded-lg border border-cyan-500/30 bg-cyan-500/15 py-2 text-[11px] font-semibold text-cyan-100 hover:bg-cyan-500/25 disabled:opacity-40"
          data-testid="war-room-compare-run"
        >
          {loading ? 'Comparing…' : 'Run compare'}
        </button>

        {err && <p className="mt-2 text-[11px] text-amber-200/90">{err}</p>}
        {structuredResult && (
          <pre className="mt-2 max-h-40 overflow-auto rounded border border-white/10 bg-black/40 p-2 text-[11px] text-white/70">
            {JSON.stringify(structuredResult, null, 2)}
          </pre>
        )}

        <a
          className="mt-2 inline-block text-[11px] text-cyan-300 underline"
          href={`/tools/player-decision?leagueId=${encodeURIComponent(leagueId)}&sport=${encodeURIComponent(sport)}`}
        >
          Open full Start A vs B
        </a>
      </div>
    </div>
  )
}
