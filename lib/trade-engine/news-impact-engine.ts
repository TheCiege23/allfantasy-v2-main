/**
 * News Impact Engine — scores, categorizes, time-decays, and computes
 * player value adjustments from live news items before injecting them
 * into trade evaluation.
 *
 * Data sources: NewsAPI, Grok live search, SportsDataIO, injury reports.
 * All scoring is deterministic — AI may interpret but not override.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type NewsCategory =
  | 'injury'
  | 'trade'
  | 'depth_chart'
  | 'coaching'
  | 'performance'
  | 'contract'
  | 'suspension'
  | 'general'

type NewsImpactSeverity = 'critical' | 'major' | 'moderate' | 'minor'

export interface RawNewsItem {
  id: string
  title: string
  source: string
  url: string | null
  publishedAt: string // ISO-8601
  playerName: string | null
  team: string | null
  isInjury: boolean
  injuryStatus?: string | null
}

interface ScoredNewsItem {
  id: string
  title: string
  source: string
  url: string | null
  publishedAt: string
  playerName: string | null
  team: string | null

  /** 0-1 raw impact before time decay */
  rawImpact: number
  /** 0-1 impact after time decay */
  decayedImpact: number
  /** Detected category */
  category: NewsCategory
  /** Severity bucket */
  severity: NewsImpactSeverity
  /** Hours since publication */
  ageHours: number
  /** Time-decay multiplier applied (0-1) */
  decayMultiplier: number
}

export interface PlayerValueAdjustment {
  playerName: string
  /** Cumulative percentage adjustment (negative = value loss) */
  adjustmentPct: number
  /** Dominant reason for the adjustment */
  primaryReason: string
  /** All contributing news items */
  contributingNews: ScoredNewsItem[]
  /** Whether this adjustment introduces volatility uncertainty */
  volatilityIncrease: boolean
}

export interface NewsImpactResult {
  /** All scored & decayed news items */
  items: ScoredNewsItem[]
  /** Per-player value adjustments */
  adjustments: PlayerValueAdjustment[]
  /** Summary lines for injection into AI prompts */
  summaryLines: string[]
  /** When this result was computed */
  computedAt: string
  /** Count of items by category */
  categoryCounts: Record<NewsCategory, number>
  /** Count of items by severity */
  severityCounts: Record<NewsImpactSeverity, number>
}

// ---------------------------------------------------------------------------
// Category detection (keyword-based, deterministic)
// ---------------------------------------------------------------------------

const CATEGORY_PATTERNS: [RegExp, NewsCategory][] = [
  // Injury must come first — most specific
  [/injur|surgery|acl|mcl|hamstring|concussion|ir\b|injured reserve|torn|fractur|sprain|strain|broken|dislocat|out\s+\d+|ruled out|sidelined|rehab|recovery|setback|dnp/i, 'injury'],
  [/trad(?:e|ed|ing)|dealt|acquir|swap|ship.*to|sent.*to|deal\b/i, 'trade'],
  [/depth chart|promot|demot|starter|backup|rb1|wr1|first.string|second.string|moved up|moved down|elevated/i, 'depth_chart'],
  [/coach|fired|hired|offensive coordinator|defensive coordinator|play.?call|scheme change|new.*staff/i, 'coaching'],
  [/hot streak|breakout|career.high|personal best|dominant|mvp|surge|slump|bust|disappoint|underperform/i, 'performance'],
  [/contract|extension|sign|signing|franchise tag|restructur|holdout|free agent/i, 'contract'],
  [/suspend|banned|arrest|violation|discipline|conduct|substance/i, 'suspension'],
]

function detectCategory(title: string, isInjury: boolean): NewsCategory {
  if (isInjury) return 'injury'
  const lower = title.toLowerCase()
  for (const [pattern, category] of CATEGORY_PATTERNS) {
    if (pattern.test(lower)) return category
  }
  return 'general'
}

// ---------------------------------------------------------------------------
// Raw impact scoring
// ---------------------------------------------------------------------------

/** Base impact by category (before modifiers) */
const CATEGORY_BASE_IMPACT: Record<NewsCategory, number> = {
  injury: 0.80,
  trade: 0.65,
  depth_chart: 0.55,
  coaching: 0.45,
  performance: 0.35,
  contract: 0.40,
  suspension: 0.70,
  general: 0.15,
}

/** Keywords that amplify impact within a category */
const AMPLIFIERS: [RegExp, number][] = [
  [/acl|achilles|torn|surgery|season.ending|out for season/i, 0.20],
  [/ruled out|placed on ir|injured reserve/i, 0.15],
  [/starter|rb1|wr1|qb1|first.string/i, 0.10],
  [/traded to|blockbuster|major deal/i, 0.15],
  [/mvp|career.high|record.break/i, 0.10],
  [/suspension|banned/i, 0.10],
  [/questionable|doubtful|game.time decision/i, 0.05],
]

/** Keywords that dampen impact */
const DAMPENERS: [RegExp, number][] = [
  [/minor|day.to.day|precaution|rest|load management/i, -0.15],
  [/rumor|reportedly|sources say|could|might|may/i, -0.10],
  [/practice squad|ps\b|taxi/i, -0.10],
]

function computeRawImpact(title: string, category: NewsCategory): number {
  let impact = CATEGORY_BASE_IMPACT[category]

  for (const [pattern, boost] of AMPLIFIERS) {
    if (pattern.test(title)) {
      impact += boost
    }
  }

  for (const [pattern, penalty] of DAMPENERS) {
    if (pattern.test(title)) {
      impact += penalty // penalty is negative
    }
  }

  return Math.max(0, Math.min(1, impact))
}

// ---------------------------------------------------------------------------
// Time decay
// ---------------------------------------------------------------------------

/**
 * Time decay curve:
 *   0-24h  → 100%
 *   24-72h → linear 100%→70%
 *   72-168h → linear 70%→40%
 *   168h+  → 40% floor (stale)
 */
function computeTimeDecay(ageHours: number): number {
  if (ageHours <= 24) return 1.0
  if (ageHours <= 72) {
    // Linear interpolation: 24h→1.0, 72h→0.70
    return 1.0 - ((ageHours - 24) / (72 - 24)) * 0.30
  }
  if (ageHours <= 168) {
    // Linear interpolation: 72h→0.70, 168h→0.40
    return 0.70 - ((ageHours - 72) / (168 - 72)) * 0.30
  }
  return 0.40
}

// ---------------------------------------------------------------------------
// Severity classification
// ---------------------------------------------------------------------------

function classifySeverity(decayedImpact: number): NewsImpactSeverity {
  if (decayedImpact >= 0.75) return 'critical'
  if (decayedImpact >= 0.50) return 'major'
  if (decayedImpact >= 0.25) return 'moderate'
  return 'minor'
}

// ---------------------------------------------------------------------------
// Player value adjustment
// ---------------------------------------------------------------------------

/** Maps (category, severity) → percentage adjustment range */
const VALUE_ADJUSTMENT_TABLE: Record<NewsCategory, Record<NewsImpactSeverity, [number, number]>> = {
  injury: {
    critical: [-60, -40],
    major: [-40, -20],
    moderate: [-20, -10],
    minor: [-10, -5],
  },
  trade: {
    critical: [-5, 5],   // volatile — could go either way
    major: [-3, 3],
    moderate: [-2, 2],
    minor: [-1, 1],
  },
  depth_chart: {
    critical: [15, 25],
    major: [10, 20],
    moderate: [5, 15],
    minor: [3, 10],
  },
  coaching: {
    critical: [-10, 10],
    major: [-5, 5],
    moderate: [-3, 3],
    minor: [-1, 1],
  },
  performance: {
    critical: [5, 15],
    major: [3, 10],
    moderate: [1, 5],
    minor: [0, 3],
  },
  contract: {
    critical: [5, 15],
    major: [3, 8],
    moderate: [1, 5],
    minor: [0, 2],
  },
  suspension: {
    critical: [-50, -30],
    major: [-30, -15],
    moderate: [-15, -5],
    minor: [-5, -2],
  },
  general: {
    critical: [-2, 2],
    major: [-1, 1],
    moderate: [0, 0],
    minor: [0, 0],
  },
}

function computeValueAdjustment(item: ScoredNewsItem): number {
  const range = VALUE_ADJUSTMENT_TABLE[item.category][item.severity]
  // Higher decayedImpact → more extreme end of range
  // For negative ranges (injuries): [min, max] where min is most severe
  // t=1.0 → range[0] (most severe), t=0.0 → range[1] (least severe)
  const t = item.decayedImpact
  return range[1] + (range[0] - range[1]) * t
}

function isVolatileCategory(category: NewsCategory): boolean {
  return category === 'trade' || category === 'coaching' || category === 'injury'
}

// ---------------------------------------------------------------------------
// Main engine
// ---------------------------------------------------------------------------

export function scoreNewsItems(rawItems: RawNewsItem[]): ScoredNewsItem[] {
  const now = Date.now()

  return rawItems.map((item) => {
    const publishedMs = Date.parse(item.publishedAt)
    const ageHours = Number.isFinite(publishedMs)
      ? Math.max(0, (now - publishedMs) / 3_600_000)
      : 168 // treat unparseable as 7 days old

    const category = detectCategory(item.title, item.isInjury)
    const rawImpact = computeRawImpact(item.title, category)
    const decayMultiplier = computeTimeDecay(ageHours)
    const decayedImpact = rawImpact * decayMultiplier
    const severity = classifySeverity(decayedImpact)

    return {
      id: item.id,
      title: item.title,
      source: item.source,
      url: item.url,
      publishedAt: item.publishedAt,
      playerName: item.playerName,
      team: item.team,
      rawImpact,
      decayedImpact,
      category,
      severity,
      ageHours: Math.round(ageHours * 10) / 10,
      decayMultiplier: Math.round(decayMultiplier * 1000) / 1000,
    }
  })
}

export function computePlayerAdjustments(
  scored: ScoredNewsItem[],
): PlayerValueAdjustment[] {
  // Group by player
  const byPlayer = new Map<string, ScoredNewsItem[]>()
  for (const item of scored) {
    if (!item.playerName) continue
    const key = item.playerName.toLowerCase().trim()
    if (!byPlayer.has(key)) byPlayer.set(key, [])
    byPlayer.get(key)!.push(item)
  }

  const adjustments: PlayerValueAdjustment[] = []

  for (const [_key, items] of byPlayer) {
    // Sort by decayed impact descending — most impactful first
    items.sort((a, b) => b.decayedImpact - a.decayedImpact)

    let totalPct = 0
    let primaryReason = ''
    let volatilityIncrease = false

    for (let i = 0; i < items.length; i++) {
      const item = items[i]
      let adj = computeValueAdjustment(item)

      // Diminishing returns: each subsequent item contributes less
      if (i > 0) adj *= Math.max(0.2, 1 - i * 0.3)

      totalPct += adj

      if (i === 0) {
        primaryReason = `[${item.category}] ${item.title}`
      }

      if (isVolatileCategory(item.category)) {
        volatilityIncrease = true
      }
    }

    // Clamp total adjustment
    totalPct = Math.max(-60, Math.min(25, Math.round(totalPct * 10) / 10))

    adjustments.push({
      playerName: items[0].playerName!,
      adjustmentPct: totalPct,
      primaryReason,
      contributingNews: items,
      volatilityIncrease,
    })
  }

  // Sort by absolute adjustment descending
  adjustments.sort((a, b) => Math.abs(b.adjustmentPct) - Math.abs(a.adjustmentPct))

  return adjustments
}

function buildSummaryLines(
  scored: ScoredNewsItem[],
  adjustments: PlayerValueAdjustment[],
): string[] {
  const lines: string[] = []

  // Critical/major items get explicit callouts
  const significant = scored
    .filter((s) => s.severity === 'critical' || s.severity === 'major')
    .slice(0, 8)

  if (significant.length > 0) {
    lines.push('=== BREAKING / HIGH-IMPACT NEWS ===')
    for (const item of significant) {
      const player = item.playerName ? ` (${item.playerName})` : ''
      const decay = item.ageHours <= 24 ? 'LIVE' : `${Math.round(item.ageHours)}h ago`
      lines.push(
        `[${item.category.toUpperCase()}] ${item.title}${player} | impact=${item.decayedImpact.toFixed(2)} | ${decay}`,
      )
    }
  }

  // Value adjustments
  const meaningfulAdj = adjustments.filter((a) => Math.abs(a.adjustmentPct) >= 3)
  if (meaningfulAdj.length > 0) {
    lines.push('')
    lines.push('=== NEWS-DRIVEN VALUE ADJUSTMENTS ===')
    for (const adj of meaningfulAdj.slice(0, 10)) {
      const sign = adj.adjustmentPct > 0 ? '+' : ''
      const vol = adj.volatilityIncrease ? ' [VOLATILE]' : ''
      lines.push(
        `${adj.playerName}: ${sign}${adj.adjustmentPct}% — ${adj.primaryReason}${vol}`,
      )
    }
  }

  return lines
}

const ALL_CATEGORIES: NewsCategory[] = ['injury', 'trade', 'depth_chart', 'coaching', 'performance', 'contract', 'suspension', 'general']
const ALL_SEVERITIES: NewsImpactSeverity[] = ['critical', 'major', 'moderate', 'minor']

function countCategories(items: ScoredNewsItem[]): Record<NewsCategory, number> {
  const counts = {} as Record<NewsCategory, number>
  for (const cat of ALL_CATEGORIES) counts[cat] = 0
  for (const item of items) counts[item.category] = (counts[item.category] || 0) + 1
  return counts
}

function countSeverities(items: ScoredNewsItem[]): Record<NewsImpactSeverity, number> {
  const counts = {} as Record<NewsImpactSeverity, number>
  for (const sev of ALL_SEVERITIES) counts[sev] = 0
  for (const item of items) counts[item.severity] = (counts[item.severity] || 0) + 1
  return counts
}

/**
 * Main entry point: takes raw news items, scores them, computes value
 * adjustments, and returns a structured result ready for injection
 * into trade evaluation.
 */
export function runNewsImpactEngine(rawItems: RawNewsItem[]): NewsImpactResult {
  const scored = scoreNewsItems(rawItems)

  // Sort by decayed impact (most impactful first)
  scored.sort((a, b) => b.decayedImpact - a.decayedImpact)

  const adjustments = computePlayerAdjustments(scored)
  const summaryLines = buildSummaryLines(scored, adjustments)

  return {
    items: scored,
    adjustments,
    summaryLines,
    computedAt: new Date().toISOString(),
    categoryCounts: countCategories(scored),
    severityCounts: countSeverities(scored),
  }
}

/**
 * Format a NewsImpactResult into a text block for AI prompt injection.
 * This is appended to the trade analysis context so both OpenAI and
 * Grok can reason about news-driven value changes.
 */
export function formatNewsImpactForPrompt(result: NewsImpactResult): string {
  if (result.items.length === 0) {
    return '=== NEWS INTELLIGENCE ===\nNo relevant news found for players in this trade.\n'
  }

  const lines = [
    '=== NEWS INTELLIGENCE (deterministic — AI must not override these adjustments) ===',
    `Computed: ${result.computedAt} | Items: ${result.items.length} | Categories: ${Object.entries(result.categoryCounts).map(([k, v]) => `${k}:${v}`).join(', ')}`,
    '',
    ...result.summaryLines,
    '',
    'RULES FOR AI:',
    '- These value adjustments are AUTHORITATIVE. Do not contradict them.',
    '- Reference specific news items in your reasoning when relevant.',
    '- If an adjustment is marked [VOLATILE], note the uncertainty in risk_flags.',
    '- Grok: you may use web/X search to verify or update these items.',
    '- OpenAI: treat these as ground truth; do not invent additional news.',
  ]

  return lines.join('\n')
}
