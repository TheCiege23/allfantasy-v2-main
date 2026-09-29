import type { DraftPlayerPoolEntry } from '@/lib/workers/draft-worker'
import { ProjectionDisplay } from '@/components/weather/ProjectionDisplay'

export function PlayerPoolRow({
  player,
  recommended = false,
  onSelect,
}: {
  player: DraftPlayerPoolEntry
  recommended?: boolean
  onSelect?: (playerId: string) => void
}) {
  const isCollege = player.source === 'college' || player.poolType === 'college' || player.isDevy

  return (
    <div
      className={`flex items-center justify-between gap-3 rounded-xl border px-3 py-2 ${
        isCollege
          ? 'border-violet-400/20 bg-violet-500/[0.05]'
          : 'border-white/10 bg-white/[0.03]'
      }`}
    >
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-[11px] text-cyan-200">ADP {player.adp ?? '-'}</span>
          {isCollege ? (
            <span className="rounded-full bg-[#FFB800]/85 px-2 py-0.5 text-[11px] font-semibold text-[#1d1300]">
              COL
            </span>
          ) : null}
          {recommended ? (
            <span className="rounded-full bg-cyan-500/15 px-2 py-0.5 text-[11px] font-semibold text-cyan-100">
              RECOMMENDED
            </span>
          ) : null}
          {player.draftGrade ? (
            <span className="rounded-full bg-amber-500/15 px-2 py-0.5 text-[11px] font-semibold text-amber-100">
              {player.draftGrade}
            </span>
          ) : null}
        </div>
        <p className="truncate text-sm font-semibold text-white">{player.name}</p>
        <p className="text-xs text-white/55 flex flex-wrap items-center gap-x-1">
          <span>{player.position}</span>
          {player.team ? (
            <>
              <span>•</span>
              <span>{player.team}</span>
            </>
          ) : null}
          {player.projectedPoints != null ? (
            <>
              <span>•</span>
              <ProjectionDisplay
                projection={player.projectedPoints}
                suffix="proj"
                afCrestProps={{
                  playerId: player.playerId,
                  playerName: player.name,
                  sport: player.sport ?? 'NFL',
                  position: player.position,
                  lat: player.venueLat ?? null,
                  lng: player.venueLng ?? null,
                  gameTime: player.gameTime ?? null,
                  isIndoor: player.isIndoorVenue ?? false,
                  isDome: player.isDome ?? false,
                }}
              />
            </>
          ) : null}
          {player.weeklyPoints != null ? (
            <>
              <span>•</span>
              <span>{player.weeklyPoints.toFixed(1)} wk</span>
            </>
          ) : null}
        </p>
        {(player.classYearLabel || player.conference || player.projectedLandingSpot || player.nextGameLabel) ? (
          <p className="mt-1 text-[11px] text-white/45">
            {[
              player.classYearLabel,
              player.conference,
              player.projectedLandingSpot ? `-> ${player.projectedLandingSpot}` : null,
              player.nextGameLabel,
            ]
              .filter(Boolean)
              .join(' • ')}
          </p>
        ) : null}
      </div>
      {onSelect ? (
        <button
          type="button"
          onClick={() => onSelect(player.playerId)}
          className="rounded-full border border-cyan-400/30 bg-cyan-500/10 px-3 py-1 text-xs font-semibold text-cyan-100 hover:bg-cyan-500/20"
        >
          Pick
        </button>
      ) : null}
    </div>
  )
}
