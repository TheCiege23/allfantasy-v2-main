'use client'

import { useEffect, useState } from 'react'

interface HaveNotState {
  haveNotRosterIds: string[]
  rosterDisplayNames: Record<string, string>
  source: 'commissioner_override' | 'computed'
  allRosters: { id: string; name: string }[]
  week: number
}

/** Commissioner card for designating Have-Nots for the current week. */
export function HaveNotSelectorCard({
  leagueId,
  rosterDisplayNames,
  allActiveRosterIds,
  onDone,
}: {
  leagueId: string
  rosterDisplayNames: Record<string, string>
  allActiveRosterIds: string[]
  onDone?: () => void
}) {
  const [current, setCurrent] = useState<HaveNotState | null>(null)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [loaded, setLoaded] = useState(false)

  useEffect(() => {
    void (async () => {
      try {
        const res = await fetch(`/api/leagues/${encodeURIComponent(leagueId)}/big-brother/have-not`)
        if (!res.ok) return
        const data = (await res.json()) as HaveNotState
        setCurrent(data)
        setSelected(new Set(data.haveNotRosterIds))
      } finally {
        setLoaded(true)
      }
    })()
  }, [leagueId])

  const toggle = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const save = async () => {
    setBusy(true)
    setErr(null)
    try {
      const res = await fetch(`/api/leagues/${encodeURIComponent(leagueId)}/big-brother/have-not`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ haveNotRosterIds: Array.from(selected) }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error((data as { error?: string }).error ?? 'Failed')
      onDone?.()
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Failed')
    } finally {
      setBusy(false)
    }
  }

  const clear = async () => {
    setBusy(true)
    setErr(null)
    try {
      const res = await fetch(`/api/leagues/${encodeURIComponent(leagueId)}/big-brother/have-not`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ clear: true }),
      })
      if (!res.ok) throw new Error('Failed')
      setSelected(new Set())
      onDone?.()
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Failed')
    } finally {
      setBusy(false)
    }
  }

  if (!loaded) return (
    <div className="rounded-xl border border-slate-600/25 bg-[#0a1228] p-4 animate-pulse">
      <div className="h-4 w-32 rounded bg-white/10" />
    </div>
  )

  const names = { ...rosterDisplayNames, ...(current?.rosterDisplayNames ?? {}) }
  const rosters = allActiveRosterIds.length > 0 ? allActiveRosterIds : Object.keys(names)

  return (
    <div
      className="rounded-xl border border-rose-500/30 bg-[#0a1228] p-4 shadow-lg"
      data-testid="bb-have-not-selector-card"
    >
      <p className="text-[11px] font-bold uppercase tracking-wide text-rose-200/70">Commissioner</p>
      <h3 className="mt-1 text-base font-bold text-white">🍲 Designate Have-Nots</h3>
      {current?.source === 'commissioner_override' && (
        <p className="mt-1 text-[11px] text-rose-200/60">Manual override active — applied for Week {current.week}.</p>
      )}
      {current?.source === 'computed' && (
        <p className="mt-1 text-[11px] text-white/45">Auto-computed. Override by selecting below.</p>
      )}

      <div className="mt-3 max-h-52 space-y-1.5 overflow-y-auto">
        {rosters.map((id) => (
          <button
            key={id}
            type="button"
            onClick={() => toggle(id)}
            className={`flex w-full items-center gap-2 rounded-lg border px-3 py-2 text-left text-[13px] transition-colors ${
              selected.has(id)
                ? 'border-rose-400/50 bg-rose-500/10 text-rose-100'
                : 'border-white/8 bg-white/[0.03] text-white/80 hover:border-white/15'
            }`}
          >
            <span
              className={`inline-flex h-4 w-4 flex-shrink-0 items-center justify-center rounded border text-[11px] ${
                selected.has(id) ? 'border-rose-400 bg-rose-500' : 'border-white/20'
              }`}
            >
              {selected.has(id) ? '✓' : ''}
            </span>
            <span className="truncate">{names[id] ?? id}</span>
          </button>
        ))}
      </div>

      <div className="mt-4 flex gap-2">
        <button
          type="button"
          disabled={busy}
          onClick={() => void save()}
          className="flex-1 rounded-xl border border-rose-500/30 bg-rose-500/10 py-2.5 text-[13px] font-semibold text-rose-100 disabled:opacity-40"
        >
          {busy ? 'Saving…' : 'Set Have-Nots'}
        </button>
        {current?.source === 'commissioner_override' && (
          <button
            type="button"
            disabled={busy}
            onClick={() => void clear()}
            className="rounded-xl border border-white/10 bg-white/[0.04] px-4 py-2.5 text-[12px] text-white/55 disabled:opacity-40"
          >
            Clear
          </button>
        )}
      </div>

      {err && <p className="mt-2 text-[12px] text-red-400">{err}</p>}
    </div>
  )
}
