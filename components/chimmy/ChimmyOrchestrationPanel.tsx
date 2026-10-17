'use client'

import Link from 'next/link'
import { ExternalLink, Sparkles } from 'lucide-react'
import type { ChimmyOrchestrationMeta } from '@/lib/chimmy-orchestration/types'
import { cn } from '@/lib/utils'

export function ChimmyOrchestrationPanel({
  orchestration,
  className = '',
}: {
  orchestration: ChimmyOrchestrationMeta
  className?: string
}) {
  const { intentLabel, primaryLaunch, secondaryLaunches, confidence, memorySummary } = orchestration

  return (
    <div
      className={cn(
        'mt-3 rounded-xl border border-cyan-400/20 bg-gradient-to-br from-cyan-500/10 via-[#0a1228]/90 to-[#040915]/95 p-3 text-left',
        className
      )}
      data-testid="chimmy-orchestration-panel"
    >
      <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.2em] text-cyan-200/90">
        <Sparkles className="h-3.5 w-3.5" aria-hidden />
        Routed intent · {intentLabel}
      </div>
      <p className="mt-1 text-[11px] text-white/50">
        Routing confidence ~{(confidence * 100).toFixed(0)}% · deeper analysis available in-tool
      </p>
      {memorySummary ? (
        <p className="mt-2 rounded-lg border border-white/10 bg-black/25 px-2 py-1.5 text-[11px] text-white/65">
          {memorySummary}
        </p>
      ) : null}

      <div className="mt-3 flex flex-col gap-2">
        {primaryLaunch ? (
          <Link
            href={primaryLaunch.href}
            className="group flex items-center justify-between gap-2 rounded-lg border border-cyan-400/35 bg-cyan-500/15 px-3 py-2.5 text-sm font-medium text-cyan-50 transition hover:bg-cyan-500/25"
            data-testid="chimmy-orchestration-primary-tool"
          >
            <span className="min-w-0">
              <span className="block truncate">{primaryLaunch.label}</span>
              <span className="block truncate text-[11px] font-normal text-cyan-200/70">
                {primaryLaunch.description}
              </span>
            </span>
            <ExternalLink className="h-4 w-4 shrink-0 text-cyan-300/80" aria-hidden />
          </Link>
        ) : null}
        {secondaryLaunches.length > 0 ? (
          <div className="flex flex-wrap gap-1.5">
            {secondaryLaunches.map((launch) => (
              <Link
                key={`${launch.id}-${launch.href}`}
                href={launch.href}
                className="rounded-md border border-white/12 bg-white/5 px-2.5 py-1 text-[11px] text-white/75 hover:bg-white/10"
                data-testid={`chimmy-orchestration-secondary-${launch.id}`}
              >
                {launch.label}
              </Link>
            ))}
          </div>
        ) : null}
      </div>
    </div>
  )
}
