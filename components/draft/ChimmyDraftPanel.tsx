import type { AIPickRecommendation } from '@/lib/workers/draft-worker'

export function ChimmyDraftPanel({
  headline,
  recommendation,
}: {
  headline?: string | null
  recommendation: AIPickRecommendation | null
}) {
  return (
    <div className="space-y-3 rounded-2xl border border-cyan-400/20 bg-cyan-500/[0.06] p-4">
      <div>
        <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-cyan-200">
          Chimmy Draft Intel
        </p>
        <p className="mt-1 text-sm text-white/75">
          {headline ?? recommendation?.reason ?? 'Queueing your next best moves.'}
        </p>
      </div>

      {recommendation?.player ? (
        <div className="rounded-xl border border-cyan-400/15 bg-black/20 p-3">
          <p className="text-[11px] uppercase tracking-wide text-cyan-200">Top pick</p>
          <p className="mt-1 text-base font-semibold text-white">{recommendation.player.name}</p>
          <p className="text-sm text-white/60">
            {recommendation.player.position}
            {recommendation.player.team ? ` • ${recommendation.player.team}` : ''}
          </p>
          <p className="mt-2 text-xs text-white/65">{recommendation.reason}</p>
        </div>
      ) : null}

      <div className="space-y-2">
        {recommendation?.queue?.slice(0, 3).map((entry, index) => (
          <div key={`${entry.playerName}-${index}`} className="rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2">
            <p className="text-sm font-semibold text-white">
              #{index + 1} {entry.playerName}
            </p>
            <p className="text-xs text-white/60">
              {entry.position}
              {entry.team ? ` • ${entry.team}` : ''}
            </p>
            <p className="mt-1 text-[11px] text-white/50">{entry.reason}</p>
          </div>
        ))}
      </div>

      {recommendation?.alerts?.length ? (
        <div className="space-y-1">
          {recommendation.alerts.map((alert, index) => (
            <p key={`${alert}-${index}`} className="text-xs text-amber-200">
              {alert}
            </p>
          ))}
        </div>
      ) : null}
    </div>
  )
}
