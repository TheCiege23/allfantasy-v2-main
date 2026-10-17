import type { Pick } from '@/lib/workers/draft-worker'

export function DraftCell({
  pick,
  label,
  active = false,
}: {
  pick?: Pick | null
  label: string
  active?: boolean
}) {
  return (
    <div
      className={`min-h-[88px] rounded-xl border p-2 ${
        active
          ? 'border-cyan-400/60 bg-cyan-500/12 shadow-[0_0_0_1px_rgba(34,211,238,0.2)]'
          : 'border-white/10 bg-white/[0.03]'
      }`}
    >
      {pick ? (
        <div className="space-y-1">
          <p className="text-[11px] uppercase tracking-wide text-white/40">{label}</p>
          <p className="line-clamp-2 text-sm font-semibold text-white">{pick.playerName}</p>
          <p className="text-xs text-white/65">
            {pick.position}
            {pick.team ? ` • ${pick.team}` : ''}
          </p>
          <p className="text-[11px] text-white/35">{pick.displayName ?? 'Manager'}</p>
        </div>
      ) : (
        <div className="space-y-1">
          <p className="text-[11px] uppercase tracking-wide text-white/35">{label}</p>
          <div className="rounded-lg border border-dashed border-white/10 px-2 py-4 text-center text-[11px] text-white/25">
            Empty
          </div>
        </div>
      )}
    </div>
  )
}
