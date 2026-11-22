type KeeperDraftStrategy = {
  round1Target: { position: string; reasoning: string }
  round2Target: { position: string; reasoning: string }
  earlyRounds: string
  waitPositions: string[]
  specificTargets: { round: number; playerName: string; reason: string }[]
  strategyLabel: string
  narrative: string
}

export async function generateKeeperAwareDraftStrategy(
  _rosterId: string,
  _leagueId: string,
  _incomingSeasonId: string,
): Promise<KeeperDraftStrategy> {
  return {
    round1Target: { position: 'RB', reasoning: 'Placeholder' },
    round2Target: { position: 'WR', reasoning: 'Placeholder' },
    earlyRounds: 'TBD after keeper pool removal.',
    waitPositions: ['QB', 'TE'],
    specificTargets: [],
    strategyLabel: 'BPA',
    narrative: 'Wire Chimmy + public keeper lists.',
  }
}
