"use client"

import Link from "next/link"
import { Lock } from "lucide-react"

/**
 * Shown when Bracket Brain AI requires AF Pro (-world-cup matchup Ask AI / Explain, etc.).
 */
export default function BracketBrainLockedCard({
  className = "",
}: {
  className?: string
}) {
  return (
    <div
      data-testid="wc-bracket-brain-locked-card"
      className={`rounded-lg border border-white/12 bg-white/[0.04] px-2.5 py-2 ${className}`}
    >
      <div className="flex items-start gap-2">
        <Lock className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-300/90" aria-hidden />
        <div className="min-w-0 space-y-0.5">
          <p className="text-[11px] font-bold uppercase tracking-wide text-white/55">
            Bracket Brain AI
          </p>
          <p className="text-[11px] leading-snug text-white/45">
            Upgrade to AF Pro for Ask AI and deep matchup explanations. Basic matchup stats above remain
            available without Pro.
          </p>
          <Link
            href="/upgrade?plan=af_pro"
            data-testid="bracket-brain-locked-upgrade-link"
            className="mt-1.5 inline-flex items-center gap-1 rounded border border-cyan-300/25 bg-cyan-300/[0.07] px-2 py-0.5 text-[11px] font-bold text-cyan-200/80 hover:text-cyan-100"
          >
            View AF Pro plans →
          </Link>
        </div>
      </div>
    </div>
  )
}
