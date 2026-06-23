/**
 * T10 — deterministic trade-intent classifier. No LLM, no hidden-id guessing.
 * Maps a free-text question to one of the known trade intents (or general_trade).
 */
import type { TradeIntentKind } from './types'

export interface ClassifiedTradeIntent {
  kind: TradeIntentKind
  isTradeRelated: boolean
  teaching: boolean
}

const TRADE_SIGNAL = /\b(trade|trades|trading|deal|offer|package|swap|veto|fair|fairness|grade|market value|trade block|trade partner)\b/i

const RULES: Array<{ kind: TradeIntentKind; re: RegExp }> = [
  // Order matters — first match wins.
  { kind: 'commissioner_review', re: /\b(veto|review (?:this|the) trade|commissioner review|should i veto|flag(?:ged)? trade|collude|collusion|unfair veto)\b/i },
  { kind: 'suggest_packages', re: /\b(what (?:can|should) i offer|build (?:a|me)? ?(?:trade|package)|package for|put together|construct (?:a )?trade|offer for|trade for [a-z])\b/i },
  { kind: 'find_partners', re: /\b(who (?:should|can) i trade with|trade partner|find (?:a )?partner|who needs|who wants|match me|trade target team)\b/i },
  { kind: 'explain_player_value', re: /\b(player(?:'s)? value|why is .* value|value (?:moving|rising|falling|up|down)|market value of|worth in a trade|how much is .* worth)\b/i },
  { kind: 'summarize_block', re: /\b(trade block|who is on the block|on the block|block list|who'?s available|listed for trade)\b/i },
  { kind: 'explain_trade', re: /\b(is this trade fair|grade (?:this|my) trade|explain (?:this|the) trade|fairness of|how good is this (?:trade|deal)|should i accept|should i reject)\b/i },
]

const TEACH = /\b(beginner|new to|explain (?:it )?(?:like|to) (?:a )?(?:beginner|noob|kid|5)|eli5|what (?:does|is) (?:fairness|a grade|faab|a snapshot)|teach me|simple terms|how does trading work)\b/i

export function classifyTradeIntent(message: string): ClassifiedTradeIntent {
  const text = (message ?? '').trim()
  if (!text) return { kind: 'general_trade', isTradeRelated: false, teaching: false }

  const teaching = TEACH.test(text)
  const isTradeRelated = TRADE_SIGNAL.test(text) || teaching

  for (const r of RULES) {
    if (r.re.test(text)) return { kind: r.kind, isTradeRelated: true, teaching }
  }
  if (teaching && isTradeRelated) return { kind: 'teach', isTradeRelated: true, teaching: true }
  if (isTradeRelated) return { kind: 'general_trade', isTradeRelated: true, teaching }
  return { kind: 'general_trade', isTradeRelated: false, teaching: false }
}
