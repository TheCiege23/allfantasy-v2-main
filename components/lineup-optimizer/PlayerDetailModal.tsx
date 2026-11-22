'use client'

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import type { LineupRosterPlayer } from './types'

export function PlayerDetailModal({
  open,
  onOpenChange,
  player,
}: {
  open: boolean
  onOpenChange: (o: boolean) => void
  player: LineupRosterPlayer | null
}) {
  if (!player) return null
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] overflow-y-auto border-white/15 bg-[#0a1228] text-white">
        <DialogHeader>
          <DialogTitle className="text-left text-xl">{player.name}</DialogTitle>
          <p className="text-left text-sm text-white/55">
            {player.team ?? '—'} · {player.positions.join('/')}
          </p>
        </DialogHeader>
        <div className="space-y-4 text-sm">
          <section>
            <h4 className="text-xs font-semibold uppercase tracking-wider text-cyan-200/80">This week</h4>
            <p className="mt-1 text-white/75">
              Projection: <span className="font-semibold text-white">{player.projectedPoints.toFixed(1)}</span> · Status:{' '}
              {player.injuryStatus ?? '—'} · {player.opponent ?? 'Matchup TBD'}
            </p>
          </section>
          <section className="rounded-xl border border-white/10 bg-black/25 p-3">
            <h4 className="text-xs font-semibold uppercase text-white/45">Matchup & usage</h4>
            <p className="mt-2 text-white/55">
              Connect league sync for defensive rankings, snap/route usage, and pace — shown here when available.
            </p>
          </section>
          <section className="rounded-xl border border-white/10 bg-black/25 p-3">
            <h4 className="text-xs font-semibold uppercase text-white/45">News & Chimmy outlook</h4>
            <p className="mt-2 text-white/55">
              Injury beats and Chimmy outlook will surface here for connected leagues.
            </p>
          </section>
        </div>
      </DialogContent>
    </Dialog>
  )
}
