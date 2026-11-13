export type NewsSentiment = 'bullish' | 'bearish' | 'neutral' | 'injury_concern'

export interface PlayerNewsData {
  playerName: string
  sentiment: NewsSentiment
  news: string[]
  buzz: string
}

export interface NewsValueAdjustment {
  playerName: string
  originalValue: number
  adjustedValue: number
  multiplier: number
  sentiment: NewsSentiment
  severity: 'critical' | 'significant' | 'minor' | 'none'
  reason: string
  newsHeadlines: string[]
}

const CUT_KEYWORDS = [
  'cut candidate', 'cut list', 'likely to be cut', 'expected to be cut',
  'on the bubble', 'roster bubble', 'released', 'waived', 'let go',
  'cut', 'parting ways', 'moving on from', 'not expected to make roster',
  'roster crunch', 'no longer needs to be held', 'expendable',
]

const SERIOUS_BEARISH_KEYWORDS = [
  'suspended', 'suspension', 'holdout', 'trade request', 'wants out',
  'benched', 'demoted', 'lost starting job', 'passed on depth chart',
  'season-ending', 'torn acl', 'torn achilles', 'major surgery',
  'out for season', 'placed on ir', 'career-threatening',
]

const BULLISH_KEYWORDS = [
  'breakout', 'extension', 'signed extension', 'new contract',
  'named starter', 'promoted', 'wr1', 'rb1', 'lead back',
  'alpha', 'target hog', 'snap share increase', 'workhorse',
  'emerging', 'ascending', 'elite', 'top performer',
]

function newsContainsKeywords(news: string[], keywords: string[]): string[] {
  const matched: string[] = []
  const combined = news.join(' ').toLowerCase()
  for (const kw of keywords) {
    if (combined.includes(kw.toLowerCase())) {
      matched.push(kw)
    }
  }
  return matched
}

function classifyNewsSeverity(
  sentiment: NewsSentiment,
  news: string[]
): { severity: NewsValueAdjustment['severity']; multiplier: number; reason: string } {
  const cutMatches = newsContainsKeywords(news, CUT_KEYWORDS)
  const seriousMatches = newsContainsKeywords(news, SERIOUS_BEARISH_KEYWORDS)
  const bullishMatches = newsContainsKeywords(news, BULLISH_KEYWORDS)

  if (cutMatches.length > 0) {
    return {
      severity: 'critical',
      multiplier: 0.35,
      reason: `Cut candidate / roster bubble (${cutMatches[0]}) — value dramatically reduced`,
    }
  }

  if (seriousMatches.length > 0) {
    const isSeasonEnding = seriousMatches.some(m =>
      ['season-ending', 'torn acl', 'torn achilles', 'out for season', 'placed on ir', 'career-threatening'].includes(m)
    )
    if (isSeasonEnding) {
      return {
        severity: 'critical',
        multiplier: 0.50,
        reason: `Season-ending concern (${seriousMatches[0]}) — value significantly reduced`,
      }
    }
    return {
      severity: 'significant',
      multiplier: 0.70,
      reason: `Serious situation concern (${seriousMatches[0]}) — value reduced`,
    }
  }

  if (sentiment === 'bearish') {
    return {
      severity: 'minor',
      multiplier: 0.85,
      reason: 'Bearish sentiment from recent news — minor value reduction',
    }
  }

  if (sentiment === 'injury_concern') {
    return {
      severity: 'minor',
      multiplier: 0.88,
      reason: 'Active injury concern — minor value reduction',
    }
  }

  if (sentiment === 'bullish' && bullishMatches.length > 0) {
    return {
      severity: 'minor',
      multiplier: 1.10,
      reason: `Bullish news (${bullishMatches[0]}) — value slightly boosted`,
    }
  }

  if (sentiment === 'bullish') {
    return {
      severity: 'minor',
      multiplier: 1.05,
      reason: 'Bullish sentiment from recent news — slight value increase',
    }
  }

  return {
    severity: 'none',
    multiplier: 1.0,
    reason: 'No significant news impact',
  }
}

export function computeNewsValueAdjustments(
  playerNews: PlayerNewsData[],
  playerValues: Map<string, { value: number; [key: string]: any }>
): NewsValueAdjustment[] {
  const adjustments: NewsValueAdjustment[] = []

  for (const pn of playerNews) {
    const key = pn.playerName.toLowerCase()
    const playerVal = playerValues.get(key)
    const originalValue = playerVal?.value ?? 200
    const { severity, multiplier, reason } = classifyNewsSeverity(pn.sentiment, pn.news)

    adjustments.push({
      playerName: pn.playerName,
      originalValue,
      adjustedValue: Math.round(originalValue * multiplier),
      multiplier,
      sentiment: pn.sentiment,
      severity,
      reason,
      newsHeadlines: pn.news.slice(0, 3),
    })
  }

  return adjustments
}

export function applyNewsAdjustmentsToValueMap(
  playerValues: Map<string, { value: number; [key: string]: any }>,
  adjustments: NewsValueAdjustment[]
): { adjustedMap: Map<string, any>; appliedCount: number } {
  const adjustedMap = new Map(playerValues)
  let appliedCount = 0

  for (const adj of adjustments) {
    if (adj.severity === 'none') continue
    const key = adj.playerName.toLowerCase()
    const existing = adjustedMap.get(key)
    if (existing) {
      adjustedMap.set(key, {
        ...existing,
        value: adj.adjustedValue,
        newsAdjusted: true,
        newsMultiplier: adj.multiplier,
        newsReason: adj.reason,
        originalValue: adj.originalValue,
      })
      appliedCount++
    }
  }

  return { adjustedMap, appliedCount }
}

export function formatNewsAdjustmentsForPrompt(adjustments: NewsValueAdjustment[]): string {
  const significant = adjustments.filter(a => a.severity !== 'none')
  if (significant.length === 0) return ''

  const lines = significant.map(a => {
    const dir = a.multiplier < 1 ? '↓' : a.multiplier > 1 ? '↑' : '→'
    const pctChange = Math.round((a.multiplier - 1) * 100)
    return `• ${a.playerName}: ${dir} ${Math.abs(pctChange)}% (${a.originalValue} → ${a.adjustedValue}) — ${a.reason}\n  Headlines: ${a.newsHeadlines.join(' | ')}`
  })

  return `\n📰 NEWS-ADJUSTED VALUES (applied BEFORE grade calculation):\n${lines.join('\n')}\n\nThese adjustments have ALREADY been applied to the trade balance numbers above. The grade and verdict reflect current real-world situation, not just static market values.`
}

