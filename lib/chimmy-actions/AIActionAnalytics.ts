import type { AIAction, AIActionContext, AIActionEvent, AIActionType } from './AIActionModel'
import { logAIActionEvent } from './AIActionLogger'

type TrackedEventType = AIActionEvent['event']

interface EventRow {
  id: string
  action_type: AIActionType
  surface: string
  user_id: string
  league_id: string | null
  team_id: string | null
  sport: string | null
  event: TrackedEventType
  timestamp: string
  duration_ms: number | null
  metadata: Record<string, unknown> | null
}

interface ActionMetric {
  actionType: string
  shown: number
  clicked: number
  confirmed: number
  completed: number
  dismissed: number
  saved: number
  failed: number
  followRate: number
  completionRate: number
  avgDurationMs: number
  measurableOutcomeCount: number
}

interface SurfaceMetric {
  surface: string
  shown: number
  clicked: number
  completed: number
  conversionRate: number
}

export interface MeasurableOutcomeEvent {
  outcomeType: string
  value?: number
  direction?: 'positive' | 'negative' | 'neutral'
  source: string
}

export interface MeasurableOutcomeAdapter {
  id: string
  match: (row: EventRow) => boolean
  derive: (row: EventRow) => MeasurableOutcomeEvent | null
}

interface MeasurableOutcomeMetric {
  outcomeType: string
  count: number
  positiveCount: number
  negativeCount: number
  avgValue: number | null
}

export interface ChimmyLearningSnapshot {
  totals: {
    shown: number
    clicked: number
    confirmed: number
    completed: number
    dismissed: number
    saved: number
    failed: number
    followedSuggestion: number
    measurableOutcomes: number
  }
  actionMetrics: ActionMetric[]
  surfaceMetrics: SurfaceMetric[]
  measurableOutcomesByType: MeasurableOutcomeMetric[]
  recommendationStylePreferences: Array<{
    style: string
    shown: number
    completed: number
    dismissals: number
    completionRate: number
    dismissalRate: number
  }>
  notes: string[]
}

const SAFE_METADATA_KEYS = new Set([
  'recommendationStyle',
  'confidenceBucket',
  'featureArea',
  'source',
  'followedSuggestion',
  'measurableOutcome',
  'outcomeType',
  'outcomeValue',
  'outcomeDirection',
  'reason',
  'issues',
])

function sanitizeMetadata(metadata: Record<string, unknown> | undefined): Record<string, unknown> | undefined {
  if (!metadata) return undefined
  const sanitized: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(metadata)) {
    if (!SAFE_METADATA_KEYS.has(key)) continue
    if (Array.isArray(value)) {
      sanitized[key] = value.slice(0, 10).map((item) => String(item).slice(0, 64))
      continue
    }
    if (typeof value === 'string') {
      sanitized[key] = value.slice(0, 120)
      continue
    }
    if (typeof value === 'number' || typeof value === 'boolean' || value === null) {
      sanitized[key] = value
    }
  }
  return Object.keys(sanitized).length > 0 ? sanitized : undefined
}

function deriveActionCompletionOutcome(row: EventRow): MeasurableOutcomeEvent | null {
  if (row.event !== 'completed') return null

  const outcomeTypeByAction: Partial<Record<AIActionType, string>> = {
    claim_player: 'waiver_followthrough',
    drop_player_for_claim: 'waiver_followthrough',
    optimize_lineup: 'lineup_optimization_applied',
    save_lineup: 'lineup_optimization_applied',
    start_player: 'lineup_startsit_applied',
    propose_trade: 'trade_proposal_sent',
    generate_counter: 'trade_counter_sent',
    join_league: 'league_join_completion',
  }

  const outcomeType = outcomeTypeByAction[row.action_type]
  if (!outcomeType) return null

  return {
    outcomeType,
    direction: 'positive',
    source: 'action-completion-adapter',
  }
}

function deriveMetadataOutcome(row: EventRow): MeasurableOutcomeEvent | null {
  const metadata = (row.metadata ?? {}) as Record<string, unknown>
  const hasMeasurableFlag = metadata.measurableOutcome === true
  const outcomeType = typeof metadata.outcomeType === 'string' ? metadata.outcomeType.slice(0, 64) : null

  if (!hasMeasurableFlag && !outcomeType) return null

  let direction: 'positive' | 'negative' | 'neutral' = 'neutral'
  const directionRaw = metadata.outcomeDirection
  if (directionRaw === 'positive' || directionRaw === 'negative' || directionRaw === 'neutral') {
    direction = directionRaw
  }

  const numericValue = typeof metadata.outcomeValue === 'number' && Number.isFinite(metadata.outcomeValue)
    ? metadata.outcomeValue
    : undefined

  return {
    outcomeType: outcomeType ?? 'generic_measurable_outcome',
    value: numericValue,
    direction,
    source: 'metadata-adapter',
  }
}

export function getDefaultOutcomeAdapters(): MeasurableOutcomeAdapter[] {
  return [
    {
      id: 'metadata-outcome-adapter',
      match: (row) => Boolean(row.metadata),
      derive: deriveMetadataOutcome,
    },
    {
      id: 'action-completion-outcome-adapter',
      match: (row) => row.event === 'completed',
      derive: deriveActionCompletionOutcome,
    },
  ]
}

export async function trackAIActionEvent(input: {
  action: AIAction
  context: AIActionContext
  event: TrackedEventType
  durationMs?: number
  metadata?: Record<string, unknown>
}): Promise<void> {
  const event: AIActionEvent = {
    id: crypto.randomUUID(),
    actionType: input.action.type,
    surface: input.action.surface,
    userId: input.context.userId,
    leagueId: input.action.leagueId,
    teamId: input.action.teamId,
    sport: input.action.sport,
    event: input.event,
    timestamp: Date.now(),
    durationMs: input.durationMs,
    metadata: sanitizeMetadata(input.metadata),
  }

  await logAIActionEvent(event)
}

export async function trackAIActionShown(
  actions: AIAction[],
  context: AIActionContext,
  metadata?: Record<string, unknown>,
): Promise<void> {
  await Promise.all(
    actions.map((action) =>
      trackAIActionEvent({
        action,
        context,
        event: 'shown',
        metadata,
      }),
    ),
  )
}

export function buildLearningSnapshotFromEvents(
  rows: EventRow[],
  options?: {
    minActionEvents?: number
    outcomeAdapters?: MeasurableOutcomeAdapter[]
  },
): ChimmyLearningSnapshot {
  const totals = {
    shown: 0,
    clicked: 0,
    confirmed: 0,
    completed: 0,
    dismissed: 0,
    saved: 0,
    failed: 0,
    followedSuggestion: 0,
    measurableOutcomes: 0,
  }

  const actionMap = new Map<string, ActionMetric>()
  const surfaceMap = new Map<string, SurfaceMetric>()
  const styleMap = new Map<string, { shown: number; completed: number; dismissals: number }>()
  const outcomeMap = new Map<string, { count: number; positiveCount: number; negativeCount: number; valueSum: number; valueCount: number }>()
  const outcomeAdapters = options?.outcomeAdapters ?? getDefaultOutcomeAdapters()

  function metricForAction(actionType: string): ActionMetric {
    const existing = actionMap.get(actionType)
    if (existing) return existing
    const created: ActionMetric = {
      actionType,
      shown: 0,
      clicked: 0,
      confirmed: 0,
      completed: 0,
      dismissed: 0,
      saved: 0,
      failed: 0,
      followRate: 0,
      completionRate: 0,
      avgDurationMs: 0,
      measurableOutcomeCount: 0,
    }
    actionMap.set(actionType, created)
    return created
  }

  function metricForSurface(surface: string): SurfaceMetric {
    const existing = surfaceMap.get(surface)
    if (existing) return existing
    const created: SurfaceMetric = {
      surface,
      shown: 0,
      clicked: 0,
      completed: 0,
      conversionRate: 0,
    }
    surfaceMap.set(surface, created)
    return created
  }

  const durationAgg = new Map<string, { sum: number; count: number }>()

  for (const row of rows) {
    const actionMetric = metricForAction(row.action_type)
    const surfaceMetric = metricForSurface(row.surface)
    const metadata = (row.metadata ?? {}) as Record<string, unknown>
    const recommendationStyle = typeof metadata.recommendationStyle === 'string'
      ? metadata.recommendationStyle
      : null

    switch (row.event) {
      case 'shown':
        totals.shown += 1
        actionMetric.shown += 1
        surfaceMetric.shown += 1
        break
      case 'clicked':
        totals.clicked += 1
        actionMetric.clicked += 1
        surfaceMetric.clicked += 1
        break
      case 'confirmed':
        totals.confirmed += 1
        actionMetric.confirmed += 1
        break
      case 'completed':
        totals.completed += 1
        actionMetric.completed += 1
        surfaceMetric.completed += 1
        break
      case 'dismissed':
        totals.dismissed += 1
        actionMetric.dismissed += 1
        break
      case 'saved':
        totals.saved += 1
        actionMetric.saved += 1
        break
      case 'failed':
        totals.failed += 1
        actionMetric.failed += 1
        break
    }

    if (metadata.followedSuggestion === true) {
      totals.followedSuggestion += 1
    }
    const derivedOutcomes = outcomeAdapters
      .filter((adapter) => adapter.match(row))
      .map((adapter) => adapter.derive(row))
      .filter((outcome): outcome is MeasurableOutcomeEvent => Boolean(outcome))

    if (derivedOutcomes.length > 0) {
      totals.measurableOutcomes += derivedOutcomes.length
      actionMetric.measurableOutcomeCount += derivedOutcomes.length

      for (const outcome of derivedOutcomes) {
        const current = outcomeMap.get(outcome.outcomeType) ?? {
          count: 0,
          positiveCount: 0,
          negativeCount: 0,
          valueSum: 0,
          valueCount: 0,
        }
        current.count += 1
        if (outcome.direction === 'positive') current.positiveCount += 1
        if (outcome.direction === 'negative') current.negativeCount += 1
        if (typeof outcome.value === 'number') {
          current.valueSum += outcome.value
          current.valueCount += 1
        }
        outcomeMap.set(outcome.outcomeType, current)
      }
    }

    if (typeof row.duration_ms === 'number' && row.duration_ms >= 0) {
      const agg = durationAgg.get(row.action_type) ?? { sum: 0, count: 0 }
      agg.sum += row.duration_ms
      agg.count += 1
      durationAgg.set(row.action_type, agg)
    }

    if (recommendationStyle) {
      const style = styleMap.get(recommendationStyle) ?? { shown: 0, completed: 0, dismissals: 0 }
      if (row.event === 'shown') style.shown += 1
      if (row.event === 'completed') style.completed += 1
      if (row.event === 'dismissed') style.dismissals += 1
      styleMap.set(recommendationStyle, style)
    }
  }

  for (const metric of actionMap.values()) {
    metric.followRate = metric.clicked > 0 ? metric.completed / metric.clicked : 0
    metric.completionRate = metric.shown > 0 ? metric.completed / metric.shown : 0
    const agg = durationAgg.get(metric.actionType)
    metric.avgDurationMs = agg && agg.count > 0 ? Math.round(agg.sum / agg.count) : 0
  }

  for (const metric of surfaceMap.values()) {
    metric.conversionRate = metric.shown > 0 ? metric.completed / metric.shown : 0
  }

  const recommendationStylePreferences = Array.from(styleMap.entries()).map(([style, value]) => ({
    style,
    shown: value.shown,
    completed: value.completed,
    dismissals: value.dismissals,
    completionRate: value.shown > 0 ? value.completed / value.shown : 0,
    dismissalRate: value.shown > 0 ? value.dismissals / value.shown : 0,
  }))

  const minActionEvents = options?.minActionEvents ?? 3
  const actionMetrics = Array.from(actionMap.values())
    .filter((metric) => metric.shown + metric.clicked + metric.completed + metric.dismissed >= minActionEvents)
    .sort((a, b) => b.shown - a.shown)

  const surfaceMetrics = Array.from(surfaceMap.values()).sort((a, b) => b.shown - a.shown)
  const measurableOutcomesByType: MeasurableOutcomeMetric[] = Array.from(outcomeMap.entries())
    .map(([outcomeType, value]) => ({
      outcomeType,
      count: value.count,
      positiveCount: value.positiveCount,
      negativeCount: value.negativeCount,
      avgValue: value.valueCount > 0 ? Number((value.valueSum / value.valueCount).toFixed(3)) : null,
    }))
    .sort((a, b) => b.count - a.count)
  const styleTop = recommendationStylePreferences
    .slice()
    .sort((a, b) => b.completionRate - a.completionRate)

  const notes: string[] = []
  if (actionMetrics.length > 0) {
    const worstDismissal = actionMetrics
      .slice()
      .sort((a, b) => (b.dismissed / Math.max(1, b.shown)) - (a.dismissed / Math.max(1, a.shown)))[0]
    if (worstDismissal && worstDismissal.shown >= minActionEvents) {
      notes.push(`Users frequently dismiss ${worstDismissal.actionType}; review recommendation style or CTA placement.`)
    }
  }
  if (styleTop.length > 0) {
    notes.push(`Highest-performing style: ${styleTop[0].style}. Bias future recommendations toward this style when context allows.`)
  }
  if (surfaceMetrics.length > 0) {
    const lowSurface = surfaceMetrics
      .filter((s) => s.shown >= minActionEvents)
      .sort((a, b) => a.conversionRate - b.conversionRate)[0]
    if (lowSurface) {
      notes.push(`Low conversion on ${lowSurface.surface}; consider stronger placement or clearer action labels.`)
    }
  }
  if (measurableOutcomesByType.length > 0) {
    notes.push(`Top measurable outcome: ${measurableOutcomesByType[0].outcomeType} (${measurableOutcomesByType[0].count} events).`)
  }

  return {
    totals,
    actionMetrics,
    surfaceMetrics,
    measurableOutcomesByType,
    recommendationStylePreferences,
    notes,
  }
}

