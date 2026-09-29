import PlayerHeadshot from '@/components/league/PlayerHeadshot'
import CollegePositionPill from '@/components/league/CollegePositionPill'
import type { LeagueRosterSlot } from '@/components/league/types'

function metaLine(slot: LeagueRosterSlot) {
  const parts = [
    slot.player.school,
    slot.player.conference,
    slot.player.classYearLabel,
  ].filter(Boolean)
  return parts.join(' • ')
}

export default function CollegePlayerRow({
  slot,
}: {
  slot: LeagueRosterSlot
}) {
  const isC2CStarter = slot.slot === 'COLLEGE'
  const isLive = isC2CStarter && (slot.player.score ?? 0) > 0
  const statusPill =
    slot.slot === 'DEVY_IR'
      ? 'DEVY IR'
      : slot.slot === 'DEVY_TAXI'
        ? 'DEVY TAXI'
        : isC2CStarter
          ? 'C2C'
          : 'DEVY'

  return (
    <div
      className={`flex items-center gap-3 rounded-xl border px-3 py-3 ${
        isLive
          ? 'border-emerald-400/30 bg-emerald-500/10 shadow-[0_0_0_1px_rgba(16,185,129,0.15)]'
          : 'border-white/5 bg-transparent'
      }`}
    >
      <CollegePositionPill label={slot.player.position || slot.pill} />
      <PlayerHeadshot src={slot.player.headshotUrl} alt={slot.player.name} size={40} />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <div className="truncate text-[15px] font-semibold text-white">{slot.player.name}</div>
          <span className="rounded-full bg-white/5 px-2 py-0.5 text-[11px] font-semibold text-cyan-100">
            {statusPill}
          </span>
          {isLive ? (
            <span className="rounded-full bg-emerald-500/20 px-2 py-0.5 text-[11px] font-semibold text-emerald-100">
              LIVE +{(slot.player.score ?? 0).toFixed(1)}
            </span>
          ) : null}
        </div>
        <div className="truncate text-[12px] text-[#8B9DB8]">
          {(slot.player.position ? `${slot.player.position} • ` : '') + metaLine(slot)}
        </div>
        {slot.player.badges?.length ? (
          <div className="mt-1 flex flex-wrap gap-1">
            {slot.player.badges.map((badge) => (
              <span
                key={`${slot.id}-${badge}`}
                className="rounded-full border border-white/10 bg-white/5 px-2 py-0.5 text-[11px] font-semibold text-white/75"
              >
                {badge}
              </span>
            ))}
          </div>
        ) : null}
      </div>
      <div className="text-right">
        <div className="text-[13px] font-semibold text-white">
          {slot.player.score != null ? slot.player.score.toFixed(2) : slot.player.draftGrade ?? '--'}
        </div>
        <div className="text-[11px] text-[#8B9DB8]">
          {slot.player.nextGameLabel ?? (slot.player.draftYear ? `Draft ${slot.player.draftYear}` : 'College asset')}
        </div>
        {slot.player.projectedLandingSpot ? (
          <div className="mt-1 text-[11px] text-amber-200">→ {slot.player.projectedLandingSpot}</div>
        ) : null}
      </div>
    </div>
  )
}
