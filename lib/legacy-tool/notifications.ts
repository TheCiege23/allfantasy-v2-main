type PrivateDmCoachingPayload = {
  channel: 'private_dm'
  notification_type: 'ai_trade_coaching' | 'ai_waiver_coaching'
  user_id: string
  title: string
  body: string
  priority: 'low' | 'medium' | 'high'
}

type LeagueChatPayload = {
  channel: 'league_chat'
  notification_type: 'trade_processed' | 'waiver_processed'
  league_id: string
  title: string
  body: string
}

type CommissionerAlertPayload = {
  channel: 'commissioner_alerts'
  notification_type: 'fairness_review'
  league_id: string
  title: string
  body: string
  severity: 'low' | 'medium' | 'high'
}

export function buildPrivateTradeCoachingNotification(args: {
  userId: string
  recommendation: 'accept' | 'reject' | 'counter'
  summary: string
  confidence: number
}): PrivateDmCoachingPayload {
  const title =
    args.recommendation === 'accept'
      ? 'Trade is actionable'
      : args.recommendation === 'counter'
        ? 'Close trade - counter suggested'
        : 'Trade risk is elevated'

  const priority: PrivateDmCoachingPayload['priority'] =
    args.confidence >= 0.8 ? 'high' : args.confidence >= 0.6 ? 'medium' : 'low'

  return {
    channel: 'private_dm',
    notification_type: 'ai_trade_coaching',
    user_id: args.userId,
    title,
    body: args.summary,
    priority,
  }
}

export function buildPrivateWaiverCoachingNotification(args: {
  userId: string
  topPlayer: string
  action: string
  confidence: number
}): PrivateDmCoachingPayload {
  return {
    channel: 'private_dm',
    notification_type: 'ai_waiver_coaching',
    user_id: args.userId,
    title: `Waiver move: ${args.topPlayer}`,
    body: args.action,
    priority: args.confidence >= 0.75 ? 'high' : 'medium',
  }
}

export function buildLeagueTradeProcessedNotification(args: {
  leagueId: string
  sideA: string[]
  sideB: string[]
}): LeagueChatPayload {
  return {
    channel: 'league_chat',
    notification_type: 'trade_processed',
    league_id: args.leagueId,
    title: 'Trade analyzed',
    body: `Team A receives ${args.sideA.join(', ')}; Team B receives ${args.sideB.join(', ')}.`,
  }
}

export function buildCommissionerFairnessNotification(args: {
  leagueId: string
  reasonCodes: string[]
  severity: 'low' | 'medium' | 'high'
}): CommissionerAlertPayload {
  return {
    channel: 'commissioner_alerts',
    notification_type: 'fairness_review',
    league_id: args.leagueId,
    title: 'Trade flagged for review',
    body: `Triggered fairness checks: ${args.reasonCodes.join(', ')}`,
    severity: args.severity,
  }
}

export function buildLeagueWaiverProcessedNotification(args: {
  leagueId: string
  playerName: string
  recommendation: string
}): LeagueChatPayload {
  return {
    channel: 'league_chat',
    notification_type: 'waiver_processed',
    league_id: args.leagueId,
    title: 'Waiver recommendation ready',
    body: args.playerName + ': ' + args.recommendation,
  }
}
