'use client'

import { useMemo } from 'react'
import { DraftBoardPreview } from '@/components/app/draft-room/DraftBoardPreview'
import { getSlotInRoundForOverall } from '@/lib/live-draft-engine/DraftOrderService'
import type { DraftPickRecord, DraftPickOrderEntry } from '../types'

type Props = {
  numTeams: number
  numRounds: number
  pickOrder: DraftPickOrderEntry[]
  picks: DraftPickRecord[]
  currentOverall: number
}

export function DraftBoard({ numTeams, numRounds, pickOrder, picks, currentOverall }: Props) {
  const teams = useMemo(() => Array.from({ length: numTeams }, (_, i) => ({
    id: pickOrder[i]?.id ?? String(i + 1), slot: i + 1,
    name: pickOrder[i]?.label ?? ('Team ' + (i + 1)),
    avatarUrl: pickOrder[i]?.avatarUrl, isCpu: pickOrder[i]?.isCpu,
  })), [pickOrder, numTeams])
  const boardPicks = useMemo(() => picks.map(pick => ({
    overall: pick.overallPick, round: pick.round,
    slot: getSlotInRoundForOverall({ overall: pick.overallPick, teamCount: numTeams, draftType: 'snake', thirdRoundReversal: false }),
    rosterId: pick.currentOwnerId, originalRosterId: pick.originalOwnerId,
    playerId: pick.playerId, playerName: pick.playerName, position: pick.position, team: pick.team,
  })), [picks, numTeams])

  return <div data-testid="legacy-draft-board" className="max-h-[50vh] min-h-[200px] overflow-auto">
    <DraftBoardPreview teams={teams} picks={boardPicks} teamCount={numTeams} rounds={numRounds}
      sport="NFL" currentOverall={currentOverall <= numTeams * numRounds ? currentOverall : null} />
  </div>
}
