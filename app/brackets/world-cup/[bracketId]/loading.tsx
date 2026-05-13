import { Loader2 } from "lucide-react"

export default function WorldCupBracketLoading() {
  return (
    <div className="flex min-h-[calc(100vh-4rem)] flex-col">
      {/* Header skeleton */}
      <div className="border-b border-white/[0.06] bg-[#0a0a0f] px-4 py-3 sm:px-6">
        <div className="flex items-center gap-3">
          <div className="h-8 w-8 animate-pulse rounded-lg bg-white/[0.06]" />
          <div className="space-y-1.5">
            <div className="h-4 w-40 animate-pulse rounded bg-white/[0.08]" />
            <div className="h-2.5 w-24 animate-pulse rounded bg-white/[0.04]" />
          </div>
        </div>
      </div>

      {/* Ticker skeleton */}
      <div className="border-b border-white/[0.06] bg-black/40 px-4 py-2">
        <div className="flex gap-4 overflow-hidden">
          {Array.from({ length: 4 }).map((_, i) => (
            <div
              key={i}
              className="h-6 w-32 shrink-0 animate-pulse rounded bg-white/[0.06]"
              style={{ animationDelay: `${i * 80}ms` }}
            />
          ))}
        </div>
      </div>

      {/* Tab bar skeleton */}
      <div className="flex gap-2 border-b border-white/[0.06] bg-black/30 px-4 py-2">
        {Array.from({ length: 5 }).map((_, i) => (
          <div
            key={i}
            className="h-8 w-16 animate-pulse rounded-lg bg-white/[0.06]"
            style={{ animationDelay: `${i * 60}ms` }}
          />
        ))}
      </div>

      {/* Main content skeleton */}
      <div className="flex flex-1 items-center justify-center">
        <div className="flex flex-col items-center gap-3 text-white/40">
          <Loader2 className="h-8 w-8 animate-spin text-cyan-400/60" />
          <p className="text-sm font-medium">Loading bracket…</p>
        </div>
      </div>
    </div>
  )
}
