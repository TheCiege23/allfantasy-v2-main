/**
 * Phase 6F — DiscoveryRail (UI).
 *
 * Horizontal-scroll rail of `RecommendedLeagueCard`s with a sticky
 * header. Mobile-first: snaps on touch devices, never overflows the
 * viewport, falls back to grid on >= md screens for desktop tidiness.
 */

import * as React from "react"
import { cn } from "@/lib/utils"
import { RecommendedLeagueCardSkeleton } from "./RecommendedLeagueCard"

export function DiscoveryRailSkeleton({ className }: { className?: string }) {
  return (
    <section
      className={cn("w-full", className)}
      aria-busy
      aria-live="polite"
    >
      <div className="px-1 mb-2 sm:mb-3 space-y-1">
        <div className="h-4 w-40 rounded bg-[color:var(--subtle-bg)]" />
        <div className="h-3 w-64 rounded bg-[color:var(--subtle-bg)]" />
      </div>
      <div className="flex gap-3 overflow-hidden pb-2">
        {[0, 1, 2].map((i) => (
          <div key={i} className="min-w-[85%] sm:min-w-[60%] md:min-w-[33%]">
            <RecommendedLeagueCardSkeleton />
          </div>
        ))}
      </div>
    </section>
  )
}
