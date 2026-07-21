"use client"
/**
 * Full refresh for the operator console. A router.refresh() alone re-runs
 * server components but does not remount client panels (each fetches on its
 * own mount), so a plain reload is the only mechanism that guarantees every
 * server AND client data source refetches together. GET-only navigation —
 * never mutates production data.
 */
import { useState } from "react"
import { RefreshCw } from "lucide-react"

export function RefreshButton({ className = "" }: { className?: string }) {
  const [refreshing, setRefreshing] = useState(false)

  return (
    <button
      type="button"
      disabled={refreshing}
      onClick={() => {
        setRefreshing(true)
        window.location.reload()
      }}
      title="Refetch every panel on this page — server and client"
      className={`inline-flex h-8 items-center gap-1.5 rounded-lg border border-white/10 bg-white/[0.03] px-3 text-xs font-bold text-slate-300 hover:bg-white/[0.06] disabled:opacity-60 ${className}`}
    >
      <RefreshCw className={`h-3.5 w-3.5 ${refreshing ? "animate-spin" : ""}`} aria-hidden />
      {refreshing ? "Refreshing…" : "Refresh"}
    </button>
  )
}
