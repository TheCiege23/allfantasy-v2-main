import type { DraftState } from '@/lib/workers/draft-worker'
import { DraftCell } from './DraftCell'
import { OrphanTeamBadge } from './OrphanTeamBadge'

type DraftGridProps = {
  state: DraftState
  bigScreen?: boolean
}

function getSlotForOverall(state: DraftState, overall: number) {
  const teamCount = state.teamCount
  const round = Math.ceil(overall / teamCount)
  const pickInRound = ((overall - 1) % teamCount) + 1

  if (state.draftType === 'linear' || state.draftType === 'auction') {
    return pickInRound
  }

  return round % 2 === 1 ? pickInRound : teamCount - pickInRound + 1
}

export function DraftGrid({ state, bigScreen = false }: DraftGridProps) {
  const picksByOverall = new Map(state.picks.map((pick) => [pick.overall, pick]))
  const activeOverall = state.currentPickNumber

  return (
    <div className="overflow-hidden rounded-2xl border border-white/10 bg-[#081121]">
      <div className="overflow-auto">
        <table className={`min-w-full border-separate border-spacing-0 ${bigScreen ? 'text-sm' : 'text-xs'}`}>
          <thead className="sticky top-0 z-10 bg-[#0b1326]">
            <tr>
              <th className="sticky left-0 z-20 bg-[#0b1326] px-3 py-3 text-left text-[11px] uppercase tracking-wide text-white/45">
                Round
              </th>
              {state.slotOrder.map((team) => (
                <th
                  key={team.rosterId}
                  className={`min-w-[140px] border-b border-l border-white/10 px-3 py-3 text-left ${
                    state.currentUserRosterId && state.currentUserRosterId === team.rosterId
                      ? 'bg-cyan-500/8'
                      : ''
                  }`}
                >
                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-semibold text-white">{team.displayName}</span>
                      {String(team.rosterId || '').startsWith('orphan-') ? <OrphanTeamBadge /> : null}
                    </div>
                    {team.budgetRemaining != null ? (
                      <div className="text-[11px] text-cyan-200">${team.budgetRemaining}</div>
                    ) : null}
                  </div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {Array.from({ length: state.rounds }).map((_, roundIndex) => {
              const round = roundIndex + 1
              return (
                <tr key={round}>
                  <td className="sticky left-0 z-10 border-b border-white/10 bg-[#0b1326] px-3 py-3 align-top text-sm font-semibold text-white/70">
                    <div>R{round}</div>
                    {state.draftType === 'third_round_reversal' && round === 3 ? (
                      <div className="mt-1 text-[11px] uppercase tracking-wide text-cyan-300">Reversal</div>
                    ) : null}
                  </td>
                  {state.slotOrder.map((team) => {
                    const overallBase = roundIndex * state.teamCount
                    const visualSlot = team.slot
                    const overall = overallBase + visualSlot
                    const actualOverall = overallBase + getSlotForOverall(state, overallBase + visualSlot)
                    const pick = picksByOverall.get(actualOverall)
                    return (
                      <td key={`${round}-${team.rosterId}`} className="border-b border-l border-white/10 p-2 align-top">
                        <DraftCell
                          pick={pick}
                          label={`${round}.${String(actualOverall).padStart(2, '0')}`}
                          active={activeOverall === actualOverall}
                        />
                      </td>
                    )
                  })}
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}
