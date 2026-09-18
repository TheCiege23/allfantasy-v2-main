'use client'

import Link from 'next/link'
import { useEffect } from 'react'

export default function AfRankingsError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    console.error('[af-rankings]', error)
  }, [error])

  return (
    <div className="min-h-screen bg-gradient-to-b from-[#07071a] to-[#0d0d1f] px-4 py-16 text-white">
      <div className="mx-auto max-w-lg rounded-2xl border border-amber-500/25 bg-[#0a1228]/90 p-8 text-center shadow-[inset_0_1px_0_rgba(255,255,255,0.06)]">
        <p className="text-xs font-semibold uppercase tracking-widest text-amber-200/80">AF Rankings</p>
        <h1 className="mt-2 text-xl font-black text-white">Something went wrong</h1>
        <p className="mt-3 text-sm text-white/55">
          We couldn&apos;t render this page. Try again, or return to your dashboard.
        </p>
        <div className="mt-8 flex flex-col gap-3 sm:flex-row sm:justify-center">
          <button
            type="button"
            onClick={() => reset()}
            className="rounded-xl border border-cyan-500/40 bg-cyan-500/15 px-5 py-2.5 text-sm font-semibold text-cyan-100 hover:border-cyan-400/60 hover:text-white"
          >
            Try again
          </button>
          <Link
            href="/core"
            className="rounded-xl border border-white/15 bg-white/[0.04] px-5 py-2.5 text-center text-sm font-semibold text-white/80 hover:border-white/25 hover:text-white"
          >
            Back to dashboard
          </Link>
        </div>
      </div>
    </div>
  )
}
