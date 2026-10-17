'use client'

/**
 * Glowing "Created by TheCiege" badge for league headers.
 * Displays next to the league name in salary cap and flagship leagues.
 */
export function CreatedByTheCiegeBadge({ className }: { className?: string }) {
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full border border-amber-400/30 bg-amber-400/[0.08] px-2.5 py-0.5 text-[11px] font-bold tracking-wide text-amber-300 shadow-[0_0_8px_rgba(251,191,36,0.3)] ${className ?? ''}`}
      title="Created by TheCiege — AllFantasy.AI"
    >
      <span className="animate-pulse text-amber-400">✦</span>
      Created by TheCiege
    </span>
  )
}
