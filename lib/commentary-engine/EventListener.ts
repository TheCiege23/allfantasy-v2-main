/**
 * EventListener — interface for commentary-triggering events.
 * Call these when matchup updates, trades, waivers, or playoff events occur.
 */

import type { MatchupCommentaryContext, TradeReactionContext, WaiverReactionContext, PlayoffDramaContext } from './types'
import { generateCommentary } from './CommentaryEngine'

export type CommentaryCallback = (headline: string, body: string, eventType: string) => void

/**
 * Fire matchup commentary (e.g. when scores update or matchup is viewed).
 */
export async function onMatchupCommentary(
  context: MatchupCommentaryContext,
  options?: { skipStats?: boolean; persist?: boolean; onCommentary?: CommentaryCallback }
): Promise<{ headline: string; body: string } | null> {
  const result = await generateCommentary(context, {
    skipStatisticalContext: options?.skipStats,
    persist: options?.persist ?? true,
  })
  if (result && options?.onCommentary) {
    options.onCommentary(result.headline, result.body, 'matchup_commentary')
  }
  return result
}

/**
 * Fire trade reaction (e.g. after a trade is accepted).
 */
export async function onTradeReaction(
  context: TradeReactionContext,
  options?: { skipStats?: boolean; persist?: boolean; onCommentary?: CommentaryCallback }
): Promise<{ headline: string; body: string } | null> {
  const result = await generateCommentary(context, {
    skipStatisticalContext: options?.skipStats,
    persist: options?.persist ?? true,
  })
  if (result && options?.onCommentary) {
    options.onCommentary(result.headline, result.body, 'trade_reaction')
  }
  return result
}

/**
 * Fire waiver reaction (e.g. after add/drop or claim).
 */
export async function onWaiverReaction(
  context: WaiverReactionContext,
  options?: { skipStats?: boolean; persist?: boolean; onCommentary?: CommentaryCallback }
): Promise<{ headline: string; body: string } | null> {
  const result = await generateCommentary(context, {
    skipStatisticalContext: options?.skipStats,
    persist: options?.persist ?? true,
  })
  if (result && options?.onCommentary) {
    options.onCommentary(result.headline, result.body, 'waiver_reaction')
  }
  return result
}

/**
 * Fire playoff drama (e.g. elimination, clinch, upset).
 */
export async function onPlayoffDrama(
  context: PlayoffDramaContext,
  options?: { skipStats?: boolean; persist?: boolean; onCommentary?: CommentaryCallback }
): Promise<{ headline: string; body: string } | null> {
  const result = await generateCommentary(context, {
    skipStatisticalContext: options?.skipStats,
    persist: options?.persist ?? true,
  })
  if (result && options?.onCommentary) {
    options.onCommentary(result.headline, result.body, 'playoff_drama')
  }
  return result
}
