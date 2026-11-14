type RootingNeed = {
  matchId: string
  matchDescription: string
  round: string
  /** The team this entry needs to win. */
  rootFor: string
  /** The opposing team this entry needs to lose. */
  against: string
  pointsAtStake: number
  /** Higher-ranked entries that picked the opposite team — they're threats. */
  threatsAbove: number
  /** If rootFor wins AND all threats above misfire: max potential rank gain. */
  maxRankGain: number
  urgency: "critical" | "high" | "moderate" | "low"
}

