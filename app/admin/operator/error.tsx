"use client"
/**
 * Segment error boundary for the operator console. Catches render/data failures
 * in the overview and any section page so one degraded data source shows a
 * recoverable panel *inside* the shell instead of white-screening the console.
 * (The layout — auth gate + shell — sits above this boundary and stays intact.)
 */
import { useEffect } from "react"
import Link from "next/link"
import { AlertTriangle, RefreshCw } from "lucide-react"

export default function OperatorSectionError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    // Operator-only surface — surface the failure to the console for triage.
    console.error("[operator] section error:", error)
  }, [error])

  return (
    <div className="flex flex-col gap-5">
      <div className="rounded-2xl border border-rose-500/25 bg-[#0c1120]/80 p-5 sm:p-6">
        <div className="flex items-center gap-2 text-rose-300">
          <AlertTriangle className="h-5 w-5" aria-hidden />
          <p className="text-[11px] font-black uppercase tracking-[0.16em]">Section failed to load</p>
        </div>
        <h1 className="mt-3 text-xl font-black tracking-tight text-white">
          This section’s data pipeline threw an error.
        </h1>
        <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-400">
          The console shell is still online — only this section degraded. Retry it, or use a recovery console below.
          Other sections are unaffected.
        </p>
        {error?.message ? (
          <p className="mt-4 break-words rounded-lg border border-rose-500/20 bg-rose-500/[0.06] px-3 py-2 font-mono text-xs leading-6 text-rose-200/90">
            {error.message}
            {error.digest ? <span className="block text-rose-200/50">digest: {error.digest}</span> : null}
          </p>
        ) : null}
        <div className="mt-5 flex flex-wrap gap-2">
          <button
            type="button"
            onClick={reset}
            className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-violet-400/30 bg-violet-500/15 px-3 text-sm font-bold text-violet-200 hover:bg-violet-500/25"
          >
            <RefreshCw className="h-3.5 w-3.5" aria-hidden />
            Retry section
          </button>
          <Link
            href="/admin/operator"
            className="inline-flex h-9 items-center rounded-lg border border-white/12 bg-white/[0.04] px-3 text-sm font-bold text-white hover:bg-white/[0.08]"
          >
            Overview
          </Link>
          <Link
            href="/admin/production-health"
            className="inline-flex h-9 items-center rounded-lg border border-white/12 bg-white/[0.04] px-3 text-sm font-bold text-white hover:bg-white/[0.08]"
          >
            Production health
          </Link>
        </div>
      </div>
    </div>
  )
}
