'use client'

import { roundPhaseLabel, tournamentStatusLabel } from '@/lib/tournament/commissionerLabels'
import { WarRoomPanel } from '@/components/tournament/TournamentWarRoomPrimitives'

type RoundRow = {
  roundIndex: number
  phase: string
  name: string | null
  startWeek: number | null
  endWeek: number | null
  status: string
}

export function TournamentHistoryArchivePanel({
  rounds,
  tournamentStatus,
}: {
  rounds: RoundRow[]
  tournamentStatus: string
}) {
  return (
    <div className="space-y-6">
      <WarRoomPanel
        title="Phase timeline"
        subtitle="Qualifier → cuts → redrafts → finals, round by round."
      >
        {rounds.length === 0 ? (
          <p className="text-sm text-white/45">No round rows yet.</p>
        ) : (
          <ol className="space-y-3">
            {rounds.map((r) => (
              <li
                key={`${r.roundIndex}-${r.phase}`}
                className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-white/[0.06] bg-black/30 px-4 py-3"
              >
                <div>
                  <p className="font-semibold text-white/90">{r.name ?? roundPhaseLabel(r.phase)}</p>
                  <p className="text-[11px] uppercase tracking-wide text-white/35">{roundPhaseLabel(r.phase)}</p>
                </div>
                <div className="text-right text-xs text-white/50">
                  {r.startWeek != null && r.endWeek != null ? `W${r.startWeek}–${r.endWeek}` : '—'} · {r.status}
                </div>
              </li>
            ))}
          </ol>
        )}
        <p className="mt-4 text-xs text-white/40">
          Tournament status: <span className="text-white/70">{tournamentStatusLabel(tournamentStatus)}</span> · Settings
          requests and their outcomes are in the Approvals tab.
        </p>
      </WarRoomPanel>
    </div>
  )
}
