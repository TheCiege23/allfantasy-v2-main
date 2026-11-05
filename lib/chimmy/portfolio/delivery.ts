import 'server-only'
import { appendChatHistory } from '@/lib/ai-memory/chat-history-store'
import { renderPortfolioAnswer } from './render'
import type { PortfolioEvidence } from './types'

export function portfolioEnvelope(evidence: PortfolioEvidence, mode: string, extra: Record<string, unknown> = {}) {
  const answer = renderPortfolioAnswer(evidence, mode)
  const blocked = evidence.status === 'blocked'
  return { response: answer, result: answer, source: 'chimmy_roster_portfolio', meta: {
    ...extra, portfolio: evidence, mode, toolsUsed: ['get_my_rosters'], dataSources: ['own_rosters', 'league_rules', 'portfolio_comparison'],
    followUps: evidence.followUps, delivery: blocked ? { delivered: false, reason: 'insufficient_context' } : { delivered: true },
    ...(blocked ? { free: true, tokenSpend: null } : {}),
    leagueGrounding: { grounded: false, leagueId: null, reason: 'no_league_selected' },
    responseStructure: { shortAnswer: answer.split('\n\n')[0], caveats: evidence.caveats },
  } }
}

export async function persistPortfolioAnswer(args: {
  userId: string; conversationId: string; question: string; evidence: PortfolioEvidence; mode: string; cost: number | null
}): Promise<void> {
  await Promise.allSettled([
    appendChatHistory({ conversationId: args.conversationId, role: 'user', content: args.question, userId: args.userId, leagueId: null }),
    appendChatHistory({ conversationId: args.conversationId, role: 'assistant', content: renderPortfolioAnswer(args.evidence, args.mode), userId: args.userId, leagueId: null,
      meta: { display: { portfolio: args.evidence, portfolioState: args.evidence.state, followUps: args.evidence.followUps, mode: args.mode, cost: args.cost } } }),
  ])
}
