export function OrphanTeamBadge({ active = true }: { active?: boolean }) {
  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold ${
        active
          ? 'border border-cyan-400/30 bg-cyan-500/10 text-cyan-200'
          : 'border border-white/10 bg-white/5 text-white/50'
      }`}
    >
      AI
    </span>
  )
}
