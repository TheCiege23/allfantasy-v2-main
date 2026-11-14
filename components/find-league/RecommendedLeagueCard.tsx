/**
 * Phase 6F — the loading skeleton the discovery rail shows while recommendations load.
 *
 * The card it stood in for is gone: nothing rendered it.
 */

import * as React from "react"
import { cn } from "@/lib/utils"

export function RecommendedLeagueCardSkeleton({ className }: { className?: string }) {
  return (
    <div
      className={cn(
        "rounded-2xl p-3 sm:p-4 animate-pulse",
        className
      )}
      style={{ background: "var(--panel)", border: "1px solid var(--border)" }}
      aria-busy
      aria-live="polite"
    >
      <div className="flex justify-between gap-3">
        <div className="space-y-2 w-full">
          <div className="h-4 w-2/3 rounded bg-[color:var(--subtle-bg)]" />
          <div className="h-3 w-1/2 rounded bg-[color:var(--subtle-bg)]" />
        </div>
        <div className="h-5 w-14 rounded-full bg-[color:var(--subtle-bg)]" />
      </div>
      <div className="mt-3 h-3 w-full rounded bg-[color:var(--subtle-bg)]" />
      <div className="mt-2 flex gap-1.5">
        {[0, 1, 2].map((i) => (
          <div key={i} className="h-4 w-14 rounded-full bg-[color:var(--subtle-bg)]" />
        ))}
      </div>
    </div>
  )
}
