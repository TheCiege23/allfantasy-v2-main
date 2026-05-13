"use client"

import Link from "next/link"
import { AlertTriangle, Home, RotateCcw } from "lucide-react"

export default function WorldCupBracketsError({
  error: _error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  return (
    <div className="flex min-h-[calc(100vh-4rem)] items-center justify-center px-4 py-10">
      <div className="w-full max-w-md overflow-hidden rounded-2xl border border-amber-500/20 bg-[radial-gradient(circle_at_top,rgba(245,158,11,0.12),transparent_55%),linear-gradient(180deg,rgba(17,24,39,0.97),rgba(15,23,42,0.99))] shadow-2xl">
        <div className="h-0.5 w-full bg-gradient-to-r from-amber-400 via-orange-500 to-amber-400" />
        <div className="space-y-5 p-6">
          <div className="flex items-start gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-amber-400/30 bg-amber-500/10">
              <AlertTriangle className="h-5 w-5 text-amber-300" />
            </div>
            <div>
              <p className="text-[10px] font-bold uppercase tracking-[0.22em] text-amber-300/70">
                World Cup Brackets
              </p>
              <h1 className="mt-0.5 text-lg font-semibold text-white">
                Something went wrong
              </h1>
              <p className="mt-1 text-sm leading-5 text-white/60">
                We hit an unexpected error. Please try again.
              </p>
            </div>
          </div>
          <div className="flex flex-wrap gap-2.5">
            <button
              type="button"
              onClick={reset}
              className="inline-flex min-h-[40px] items-center gap-2 rounded-xl border border-amber-400/30 bg-amber-500/10 px-4 py-2 text-sm font-semibold text-amber-200 transition hover:bg-amber-500/20 active:scale-[0.98]"
            >
              <RotateCcw className="h-3.5 w-3.5" />
              Try again
            </button>
            <Link
              href="/"
              className="inline-flex min-h-[40px] items-center gap-2 rounded-xl border border-white/10 bg-white/[0.04] px-4 py-2 text-sm font-semibold text-white/70 transition hover:bg-white/[0.08] active:scale-[0.98]"
            >
              <Home className="h-3.5 w-3.5" />
              Home
            </Link>
          </div>
        </div>
      </div>
    </div>
  )
}
