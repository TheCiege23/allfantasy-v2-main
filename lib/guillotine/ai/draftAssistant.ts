type DraftedPlayer = { playerId: string; name: string; pos: string; team?: string }
type DraftPlayer = { playerId: string; name: string; pos: string }

type GuillotineDraftRec = {
  survivalPick: { playerId: string; name: string; reasoning: string }
  depthPick: { playerId: string; name: string; reasoning: string }
  ceilingPick: { playerId: string; name: string; reasoning: string }
  byeWeekAlert: string | null
}

export async function getGuillotineDraftRecommendation(
  _currentRoster: DraftedPlayer[],
  availablePlayers: DraftPlayer[],
  _sport: string,
  _draftSlot: number,
  _pickNumber: number,
  _leagueSize: number,
): Promise<GuillotineDraftRec> {
  const a = availablePlayers[0]
  const b = availablePlayers[1] ?? a
  const c = availablePlayers[2] ?? a
  return {
    survivalPick: {
      playerId: a?.playerId ?? 'x',
      name: a?.name ?? '—',
      reasoning: 'Highest floor option for survival format.',
    },
    depthPick: {
      playerId: b?.playerId ?? 'x',
      name: b?.name ?? '—',
      reasoning: 'Adds injury insurance.',
    },
    ceilingPick: {
      playerId: c?.playerId ?? 'x',
      name: c?.name ?? '—',
      reasoning: 'Upside swing only if floor is already stable.',
    },
    byeWeekAlert: null,
  }
}
