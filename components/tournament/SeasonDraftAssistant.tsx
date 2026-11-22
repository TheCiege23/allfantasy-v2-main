import { loadSeasonDraftContext } from '@/lib/tournament/seasonDraftRuntime'
import { getSeasonReportAccess } from '@/lib/tournament/seasonReportAccess'
import { SeasonAssistantPanel } from './SeasonAssistantPanel'

export async function SeasonDraftAssistant({ leagueId, userId }: { leagueId: string; userId: string }) {
  const room = await loadSeasonDraftContext(leagueId).catch(() => null)
  if (!room) return null
  const access = await getSeasonReportAccess(room.tournamentId, userId).catch(() => null)
  if (!access || (!access.staff && !room.pool.members.some(member => member.userId === userId && member.id === access.entrantId))) return null

  return <details className="border-b border-white/15 bg-slate-950 px-4 text-white">
    <summary className="min-h-11 cursor-pointer py-3 text-sm font-semibold text-cyan-200">
      Tournament guidance · {room.config.sport} · Stage {room.stage}
    </summary>
    <div className="pb-3"><SeasonAssistantPanel tournamentId={room.tournamentId} leagueId={leagueId} /></div>
  </details>
}
