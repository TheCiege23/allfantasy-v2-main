type PlayerInsight = { trend: 'rising' | 'falling' | 'stable'; outlookText: string }

export async function generatePlayerInsight(
  _playerId: string,
  _sport: string,
  _week: number,
): Promise<PlayerInsight> {
  return { trend: 'stable', outlookText: 'Player insight pending wiring.' }
}
