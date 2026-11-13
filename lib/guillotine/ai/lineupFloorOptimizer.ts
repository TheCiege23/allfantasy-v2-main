type FloorLineupRec = {
  starters: { playerId: string; slot: string; floor: number }[]
  swaps: string[]
  narrative: string
}

export async function generateFloorLineupRec(
  _rosterId: string,
  _seasonId: string,
  _scoringPeriod: number,
): Promise<FloorLineupRec> {
  return {
    starters: [],
    swaps: [],
    narrative: 'Floor-max lineup recommendation pending projection wiring.',
  }
}
