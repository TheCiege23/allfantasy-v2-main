/** Public preview fields only. Never place the locked report or tool output in this object. */
export type DeepAnalysisPreview = {
  version: 1
  summary: string
  sections: { title: string; description: string }[]
  access: 'daily_answer' | 'tokens'
  tokenCost: number
  currentBalance?: number
  canUnlock: boolean
  quote: string
  expiresAt: string
  dailyRemaining?: number
  dailyLimit?: number
  resetsAt?: string
  notice?: string
}

export function readDeepAnalysisPreview(value: unknown): DeepAnalysisPreview | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const v = value as Record<string, unknown>
  if (v.version !== 1 || typeof v.summary !== 'string' || !v.summary.trim() || v.summary.length > 1200) return null
  if (v.access !== 'daily_answer' && v.access !== 'tokens') return null
  if (!Number.isSafeInteger(v.tokenCost) || (v.tokenCost as number) < 0) return null
  if (typeof v.canUnlock !== 'boolean' || typeof v.quote !== 'string' || !v.quote || v.quote.length > 2048) return null
  if (typeof v.expiresAt !== 'string' || !Number.isFinite(Date.parse(v.expiresAt))) return null
  if (!Array.isArray(v.sections) || v.sections.length < 1 || v.sections.length > 4) return null
  const sections: DeepAnalysisPreview['sections'] = []
  for (const section of v.sections) {
    if (!section || typeof section !== 'object' || typeof section.title !== 'string' || typeof section.description !== 'string') return null
    if (!section.title.trim() || section.title.length > 100 || section.description.length > 240) return null
    sections.push({ title: section.title, description: section.description })
  }
  const count = (n: unknown): n is number => Number.isSafeInteger(n) && (n as number) >= 0
  return {
    version: 1, summary: v.summary.trim(), sections, access: v.access, tokenCost: v.tokenCost as number,
    canUnlock: v.canUnlock, quote: v.quote, expiresAt: v.expiresAt,
    ...(count(v.currentBalance) ? { currentBalance: v.currentBalance } : {}),
    ...(count(v.dailyRemaining) ? { dailyRemaining: v.dailyRemaining } : {}),
    ...(count(v.dailyLimit) ? { dailyLimit: v.dailyLimit } : {}),
    ...(typeof v.resetsAt === 'string' ? { resetsAt: v.resetsAt } : {}),
    ...(typeof v.notice === 'string' ? { notice: v.notice.slice(0, 240) } : {}),
  }
}

/** A complete first thought from an engine, never a hidden full report covered by CSS. */
export function analysisSummaryFromAnswer(answer: string): string {
  const text = answer.trim().replace(/\s+/g, ' ')
  const sentences = text.match(/[^.!?]+[.!?](?:\s|$)|[^.!?]+$/g) ?? [text]
  let summary = ''
  for (const sentence of sentences.slice(0, 2)) {
    if ((summary + sentence).length > 500) break
    summary += sentence
  }
  if (summary.trim()) return summary.trim()
  const boundary = text.lastIndexOf(' ', 460)
  return text.length <= 500 ? text : text.slice(0, boundary > 100 ? boundary : 460).trimEnd() + '…'
}

/** Free, bounded guidance based on the question and verified league label; no model call. */
export function buildFreeAnalysisSummary(input: { question: string; leagueName?: string | null; engineAnswer?: string | null }): string {
  if (input.engineAnswer?.trim()) return analysisSummaryFromAnswer(input.engineAnswer)
  const q = input.question.toLowerCase()
  const scope = input.leagueName ? `For ${input.leagueName}, ` : ''
  const lead = (text: string) => scope ? scope + text : text.charAt(0).toUpperCase() + text.slice(1)
  // A new user should get an actual answer to common rules questions before
  // deciding whether more analysis is useful. These are stable definitions,
  // not predictions or claims about unverified league settings.
  const definition = /\b(explain|meaning|difference|what is|what does|how does|how do)\b/.test(q)
  if (definition && /\b(ppr|points? per reception)\b/.test(q)) return 'PPR adds points for each catch: full PPR usually adds 1 point, half PPR adds 0.5, and standard scoring usually adds none. That increases the value of reliable receiving volume; check your league’s actual scoring because it can be customized.'
  if (definition && /\b(superflex|super flex)\b/.test(q)) return 'A superflex spot can usually start a quarterback as well as a running back, receiver or tight end. The extra quarterback opportunity changes positional demand, so confirm your league’s eligible positions and scoring before using ordinary one-quarterback rankings.'
  if (definition && /\b(faab|free agent acquisition budget)\b/.test(q)) return 'FAAB gives each manager a budget for blind waiver bids, with the highest eligible bid usually winning the player. A bid trades future flexibility for help now; minimum bids, ties and budget resets follow your league’s own rules.'
  if (definition && /\b(dynasty)\b/.test(q)) return 'Dynasty leagues usually carry most or all of your roster into the next season, with rookie drafts adding new players. A decision therefore has both current-season value and future value; pick costs, roster limits and your competitive window matter.'
  if (definition && /\b(keeper)\b/.test(q)) return 'Keeper leagues let you carry selected players into another season, often with a draft-pick or other retention cost. Compare that cost with the player’s replacement value and confirm the keeper limit and deadline before deciding.'
  if (/\b(trade|trading|swap)\b/.test(q)) return lead('compare what each side gives up, the effect on your starting lineup, and the depth left behind. A balanced market value alone does not establish that a trade improves your team; scoring, keeper costs and future picks can change the result.')
  if (/\b(start|sit|lineup|bench|flex)\b/.test(q)) return lead('use your scoring rules to compare eligible starters, then check injury status and kickoff locks before making a change. Separate a reliable floor from upside, and treat missing projections as unknown rather than zero.')
  if (/\b(waiver|faab|claim|pickup|add|drop)\b/.test(q)) return lead('weigh the expected lineup improvement against the player you must drop and your remaining budget. Save room for later needs, and check the waiver deadline and your league’s claim rules before acting.')
  if (/\b(draft|rookie|dynasty|keeper)\b/.test(q)) return lead('balance current starting value with roster depth and the time you can wait for an asset to develop. League format, scoring and any keeper cost matter more than a generic ranking; future outcomes remain uncertain.')
  if (/\b(matchup|playoff|win|opponent|chance)\b/.test(q)) return lead('separate the current score from the outcome of games still to play. Projections describe a possible result, not a guarantee; player availability, scoring rules and the remaining schedule determine which scenarios are worth comparing.')
  return lead('I do not have a verified, question-specific conclusion to summarize yet. As a starting point, check your scoring rules, available players and deadlines, then compare the likely lineup benefit with the depth and future flexibility you would give up.')
}

export const DEEP_ANALYSIS_SECTIONS = [
  { title: 'Full reasoning and evidence', description: 'The complete breakdown using the data available for your question.' },
  { title: 'Options and trade-offs', description: 'Relevant alternatives, risks and assumptions; unavailable comparisons are identified.' },
  { title: 'Next steps and caveats', description: 'What to check or do next, with important data gaps made clear.' },
] as const
