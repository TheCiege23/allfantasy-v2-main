/**
 * TRADE → CHIMMY grounding adapter (T10).
 *
 * Mirrors the other `build*ContextForChimmy(leagueId, userId)` adapters the shared
 * chat route already composes. Returns a deterministic, permission-filtered trade
 * grounding block (or null when there is no native redraft trade context for the
 * user) — so the shared Chimmy route gains trade intelligence with NO new route.
 *
 * The block carries the deterministic numbers from T2–T9 plus the trade answer
 * policy, so global Chimmy explains/teaches without inventing values, never frames
 * a veto as a command, never accuses collusion, and keeps value sources distinct.
 */
import { buildTradeIntelligenceContext } from './tradeIntelligenceContext'
import { TRADE_INTELLIGENCE_SYSTEM_RULES } from './answerPolicy'

export async function buildTradeContextForChimmy(
  leagueId: string,
  userId: string,
  opts: { playerId?: string | null; partnerRosterId?: string | null } = {},
): Promise<string | null> {
  if (!leagueId || !userId) return null

  let ctx
  try {
    ctx = await buildTradeIntelligenceContext({ leagueId, userId, ...opts })
  } catch {
    return null
  }
  if (ctx.role === 'non_member') return null

  const hasBlock = (ctx.tradeBlock?.data?.leagueVisibleItems.length ?? 0) > 0 || (ctx.tradeBlock?.data?.myInterests.length ?? 0) > 0
  const hasPlayer = Boolean(ctx.playerValue?.ok)
  // Nothing to ground on → stay silent so other formats' answers are unaffected.
  if (!hasBlock && !hasPlayer) return null

  const lines: string[] = []
  lines.push('TRADE CONTEXT (AllFantasy deterministic trade layers T2–T9 — use ONLY these numbers):')
  lines.push(`- Role: ${ctx.role}. Sport: ${ctx.sport ?? 'unknown'}.`)

  if (ctx.playerValue?.data) {
    const v = ctx.playerValue.data
    if (v.published) {
      lines.push(`- Player ${v.playerName ?? v.playerId}: AllFantasy official market value ${v.allFantasyMarketValue} (base ${v.baseValue}, ${v.adjustmentPercent}% , ${v.direction ?? 'steady'}; confidence ${v.confidence}/100, sample ${v.sampleSize}). SEPARATE from provider/ADP/projection + historical snapshots; does not overwrite them.`)
    } else {
      lines.push(`- Player ${v.playerName ?? v.playerId}: no published AllFantasy market value yet (insufficient verified trade history). Provider/ADP/projection are a separate source not shown here.`)
    }
  }

  if (ctx.tradeBlock?.data) {
    const b = ctx.tradeBlock.data
    lines.push(`- Trade block: ${b.leagueVisibleItems.length} league-visible item(s); your private interests: ${b.myInterests.length} (only yours).`)
  }

  if (ctx.limitations.length) lines.push(`- Limitations: ${ctx.limitations.join(' ')}`)

  return `${lines.join('\n')}\n\n${TRADE_INTELLIGENCE_SYSTEM_RULES}`
}
