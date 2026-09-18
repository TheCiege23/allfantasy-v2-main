"use client"

import Link from "next/link"
import { useEffect } from "react"

export default function BracketsError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    try {
      // eslint-disable-next-line no-console
      console.error("[brackets/error] route boundary caught", {
        message: error?.message,
        digest: error?.digest,
        stack: typeof error?.stack === "string" ? error.stack.slice(0, 600) : undefined,
      })
    } catch {
      /* ignore */
    }
  }, [error])

  return (
    <div className="min-h-screen mode-surface mode-readable">
      <div className="mx-auto max-w-5xl space-y-4 p-4 sm:p-6">
        <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-5">
          <h1 className="text-xl font-bold" style={{ color: "var(--text)" }}>
            Bracket Challenges
          </h1>
          <p className="mt-2 text-sm" style={{ color: "var(--muted)" }}>
            We hit a snag loading this page. You can still create or join a pool.
          </p>
          <div className="mt-4 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => reset()}
              className="rounded-lg bg-sky-500 px-3 py-2 text-sm font-semibold text-white"
            >
              Retry
            </button>
            <Link
              href="/brackets/leagues/new"
              className="rounded-lg border border-white/20 px-3 py-2 text-sm font-semibold text-white/85"
            >
              Create Pool
            </Link>
            <Link
              href="/brackets/join"
              className="rounded-lg border border-white/20 px-3 py-2 text-sm font-semibold text-white/85"
            >
              Join Pool
            </Link>
            <Link
              href="/core"
              className="rounded-lg border border-white/20 px-3 py-2 text-sm font-semibold text-white/85"
            >
              Back to Dashboard
            </Link>
          </div>
        </div>
      </div>
    </div>
  )
}
