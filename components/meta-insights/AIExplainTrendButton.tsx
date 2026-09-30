"use client"

import { useState, useEffect } from "react"

export function AIExplainTrendButton({
  sport,
  timeframe,
}: {
  sport: string
  timeframe: string
}) {
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [summary, setSummary] = useState<string | null>(null)
  const [topTrends, setTopTrends] = useState<string[]>([])
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    setOpen(false)
    setSummary(null)
    setTopTrends([])
    setError(null)
  }, [sport, timeframe])

  const handleClick = async () => {
    if (open) {
      setOpen(false)
      return
    }
    setOpen(true)
    if (summary !== null) return
    setLoading(true)
    setError(null)
    try {
      const params = new URLSearchParams({ summary: "ai", sport, timeframe })
      const res = await fetch(`/api/global-meta?${params}`, { cache: "no-store" })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error || "Failed to load")
      setSummary(json.data?.summary ?? "")
      setTopTrends(json.data?.topTrends ?? [])
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="relative">
      <button
        type="button"
        onClick={handleClick}
        className="rounded border border-violet-400/50 bg-violet-500/10 px-2 py-1 text-sm text-violet-300 hover:bg-violet-500/20"
        aria-label="Explain this trend with Chimmy"
      >
        Explain this trend
      </button>
      {open && (
        <div
          className="absolute right-0 top-full z-10 mt-1 w-72 rounded-lg border border-slate-200 bg-white p-3 shadow-lg dark:border-slate-700 dark:bg-slate-800"
          role="dialog"
          aria-label="Chimmy's trend explanation"
        >
          {loading && <p className="text-xs text-slate-500">Loading…</p>}
          {error && <p className="text-xs text-red-500">{error}</p>}
          {!loading && summary && (
            <>
              <p className="text-xs text-slate-600 dark:text-slate-400">{summary}</p>
              {topTrends.length > 0 && (
                <ul className="mt-2 list-inside list-disc text-xs text-slate-500">
                  {topTrends.slice(0, 5).map((t, i) => (
                    <li key={i}>{t}</li>
                  ))}
                </ul>
              )}
            </>
          )}
        </div>
      )}
    </div>
  )
}
