type FaabRecommendation = {
  playerId: string
  playerName: string
  recommendedBid: number
  maxBid: number
  strategy: string
  reasoning: string
  urgency: string
  survivorContext: string
}

export async function generateFaabRecommendations(
  _rosterId: string,
  _seasonId: string,
  _scoringPeriod: number,
): Promise<{ recommendations: FaabRecommendation[]; spendPhilosophy: string; estimatedCompetition: string }> {
  return {
    recommendations: [],
    spendPhilosophy: 'Hold FAAB until survival risk elevates — wire league FAAB balances.',
    estimatedCompetition: 'Unknown until waiver snapshot.',
  }
}
