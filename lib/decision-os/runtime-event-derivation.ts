import type { CanonicalLeagueRules } from '@/lib/league-runtime/canonicalLeagueRules'
import type {
  CanonicalLeagueRuntimeEvent,
  CanonicalLeagueRuntimeEventType,
} from '@/lib/league-runtime/leagueRuntimeEvents'
import { isDecisionOsRuntimeEvent } from '@/lib/league-runtime/leagueRuntimeEvents'

export type DecisionOsRuntimeSignalKind =
  | 'draft_readiness'
  | 'league_health'
  | 'trade_health'
  | 'waiver_activity'
  | 'roster_guidance'
  | 'commissioner_action'
  | 'rules_change'
  | 'insufficient_evidence'

export type DecisionOsRuntimeEvidence = {
  label: string
  value: string
  detail?: string
  eventType?: CanonicalLeagueRuntimeEventType
  occurredAtIso?: string
}

export type DecisionOsRuntimeSignal = {
  id: string
  kind: DecisionOsRuntimeSignalKind
  title: string
  summary: string
  confidence: number
  confidenceLabel: 'High' | 'Medium' | 'Low'
  evidence: DecisionOsRuntimeEvidence[]
  derivation: string[]
  sourceEventTypes: CanonicalLeagueRuntimeEventType[]
  generatedAtIso: string
  rulesVersion: CanonicalLeagueRules['version']
}

export type DecisionOsRuntimeDerivation = {
  leagueId: string
  generatedAtIso: string
  signals: DecisionOsRuntimeSignal[]
  insufficientEvidence: boolean
}

type SignalTemplate = {
  kind: Exclude<DecisionOsRuntimeSignalKind, 'insufficient_evidence'>
  title: string
  summary: string
}

const EVENT_SIGNAL_TEMPLATES: Partial<Record<CanonicalLeagueRuntimeEventType, SignalTemplate>> = {
  'settings.updated': {
    kind: 'rules_change',
    title: 'League rules changed',
    summary: 'Commissioner settings changed, so downstream league views should refresh their rule context.',
  },
  'draft.started': {
    kind: 'draft_readiness',
    title: 'Draft opened',
    summary: 'The draft runtime emitted a start event for this league.',
  },
  'draft.pick': {
    kind: 'draft_readiness',
    title: 'Draft activity detected',
    summary: 'Draft picks are flowing through the league runtime.',
  },
  'draft.completed': {
    kind: 'draft_readiness',
    title: 'Draft completed',
    summary: 'The draft runtime reports completion, so roster and matchup preparation can rely on drafted rosters.',
  },
  'lineup.updated': {
    kind: 'roster_guidance',
    title: 'Lineup activity detected',
    summary: 'A lineup update is available as deterministic roster evidence.',
  },
  'waiver.claim.submitted': {
    kind: 'waiver_activity',
    title: 'Waiver demand changed',
    summary: 'A submitted claim is available as waiver activity evidence.',
  },
  'waiver.processed': {
    kind: 'waiver_activity',
    title: 'Waivers processed',
    summary: 'The waiver runtime emitted a processed event for this league.',
  },
  'trade.proposed': {
    kind: 'trade_health',
    title: 'Trade market activity',
    summary: 'A proposed trade is available as trade-health evidence.',
  },
  'trade.accepted': {
    kind: 'trade_health',
    title: 'Accepted trade needs review context',
    summary: 'An accepted trade is available for commissioner review and league trust context.',
  },
  'trade.processed': {
    kind: 'trade_health',
    title: 'Trade processed',
    summary: 'The trade runtime completed a trade event.',
  },
  'matchup.updated': {
    kind: 'league_health',
    title: 'Matchup state updated',
    summary: 'Matchup runtime state changed and can be used as league activity evidence.',
  },
  'scoring.updated': {
    kind: 'league_health',
    title: 'Scoring state updated',
    summary: 'A scoring update is available as league activity evidence.',
  },
  'standings.updated': {
    kind: 'league_health',
    title: 'Standings changed',
    summary: 'Updated standings are available as league-health evidence.',
  },
  'commissioner.override': {
    kind: 'commissioner_action',
    title: 'Commissioner action logged',
    summary: 'A commissioner override is available for transparency and audit context.',
  },
  'import.completed': {
    kind: 'league_health',
    title: 'League import completed',
    summary: 'Imported league state is available for grounded Decision OS surfaces.',
  },
}

function confidenceLabel(confidence: number): DecisionOsRuntimeSignal['confidenceLabel'] {
  if (confidence >= 80) return 'High'
  if (confidence >= 55) return 'Medium'
  return 'Low'
}

function confidenceFromEvidence(evidenceCount: number): number {
  return Math.min(88, Math.max(38, 46 + evidenceCount * 12))
}

function unique<T>(values: T[]): T[] {
  return Array.from(new Set(values))
}

function fieldList(payload: Record<string, unknown>): string | null {
  const meta = payload.meta
  const fields =
    meta && typeof meta === 'object' && !Array.isArray(meta)
      ? (meta as Record<string, unknown>).updatedFields
      : payload.updatedFields
  if (!Array.isArray(fields)) return null
  const values = fields.filter((field): field is string => typeof field === 'string' && field.length > 0)
  if (!values.length) return null
  return values.slice(0, 6).join(', ')
}

function rulesEvidenceForEvent(
  event: CanonicalLeagueRuntimeEvent,
  rules: CanonicalLeagueRules,
): DecisionOsRuntimeEvidence[] {
  const evidence: DecisionOsRuntimeEvidence[] = [
    {
      label: 'Runtime event',
      value: event.type,
      detail: event.sourceEventType !== event.type ? `Normalized from ${event.sourceEventType}` : undefined,
      eventType: event.type,
      occurredAtIso: event.occurredAtIso,
    },
  ]

  if (event.type === 'settings.updated') {
    const updatedFields = fieldList(event.payload)
    evidence.push({
      label: 'Updated fields',
      value: updatedFields ?? 'Not listed',
      detail: updatedFields ? 'Reported by the settings patch audit payload.' : 'No field list was attached.',
      eventType: event.type,
      occurredAtIso: event.occurredAtIso,
    })
  }

  if (event.type.startsWith('draft.')) {
    evidence.push({
      label: 'Draft rules',
      value: `${rules.draft.type}, ${rules.draft.rounds ?? 'unknown'} rounds`,
      detail: rules.draft.timerSeconds ? `${rules.draft.timerSeconds}s timer` : 'No pick timer configured',
      eventType: event.type,
      occurredAtIso: event.occurredAtIso,
    })
  }

  if (event.type.startsWith('waiver.')) {
    evidence.push({
      label: 'Waiver rules',
      value: rules.waivers.type ?? 'Not configured',
      detail: rules.waivers.faabEnabled
        ? `FAAB budget ${rules.waivers.faabBudget ?? 'unknown'}`
        : 'Priority or free-agent waiver format',
      eventType: event.type,
      occurredAtIso: event.occurredAtIso,
    })
  }

  if (event.type.startsWith('trade.')) {
    evidence.push({
      label: 'Trade rules',
      value: `${rules.trades.reviewHours ?? 0}h review`,
      detail: rules.trades.deadlineWeek ? `Deadline week ${rules.trades.deadlineWeek}` : 'No deadline week configured',
      eventType: event.type,
      occurredAtIso: event.occurredAtIso,
    })
  }

  if (event.type === 'matchup.updated' || event.type === 'scoring.updated' || event.type === 'standings.updated') {
    evidence.push({
      label: 'Scoring rules',
      value: rules.scoring.templateId ?? rules.scoring.presetId ?? 'No template',
      detail: `${rules.scoring.activeRuleCount} active scoring rules`,
      eventType: event.type,
      occurredAtIso: event.occurredAtIso,
    })
  }

  return evidence
}

export function deriveDecisionOsSignalsFromRuntimeEvents(input: {
  rules: CanonicalLeagueRules
  events: CanonicalLeagueRuntimeEvent[]
  generatedAt?: Date
}): DecisionOsRuntimeDerivation {
  const generatedAtIso = (input.generatedAt ?? new Date()).toISOString()
  const supportedEvents = input.events.filter(isDecisionOsRuntimeEvent)
  if (!supportedEvents.length) {
    const signal: DecisionOsRuntimeSignal = {
      id: `runtime-signal-${input.rules.leagueId}-insufficient`,
      kind: 'insufficient_evidence',
      title: 'Decision OS needs league runtime evidence',
      summary: 'No supported runtime events were available, so no league-health or recommendation claims were made.',
      confidence: 32,
      confidenceLabel: 'Low',
      evidence: [
        {
          label: 'Supported runtime events',
          value: '0',
          detail: 'Decision OS reads league events and canonical rules only.',
        },
      ],
      derivation: [
        'Loaded canonical league rules',
        'Checked runtime event stream',
        'Stopped before deriving unsupported recommendations',
      ],
      sourceEventTypes: [],
      generatedAtIso,
      rulesVersion: input.rules.version,
    }
    return {
      leagueId: input.rules.leagueId,
      generatedAtIso,
      signals: [signal],
      insufficientEvidence: true,
    }
  }

  const byKind = new Map<DecisionOsRuntimeSignalKind, CanonicalLeagueRuntimeEvent[]>()
  for (const event of supportedEvents) {
    const template = EVENT_SIGNAL_TEMPLATES[event.type]
    if (!template) continue
    const current = byKind.get(template.kind) ?? []
    current.push(event)
    byKind.set(template.kind, current)
  }

  const signals: DecisionOsRuntimeSignal[] = Array.from(byKind.entries()).map(([kind, events]) => {
    const latest = events
      .slice()
      .sort((a, b) => b.occurredAtIso.localeCompare(a.occurredAtIso))[0]
    const template = latest ? EVENT_SIGNAL_TEMPLATES[latest.type] : null
    const evidence = events.flatMap((event) => rulesEvidenceForEvent(event, input.rules))
    const sourceEventTypes = unique(events.map((event) => event.type))
    const confidence = confidenceFromEvidence(evidence.length)

    return {
      id: `runtime-signal-${input.rules.leagueId}-${kind}`,
      kind,
      title: template?.title ?? 'Runtime signal',
      summary: template?.summary ?? 'Runtime evidence is available for Decision OS.',
      confidence,
      confidenceLabel: confidenceLabel(confidence),
      evidence,
      derivation: [
        'Read canonical league rules from commissioner-controlled settings',
        'Normalized runtime events into Decision OS event types',
        'Derived evidence rows without mutating league state',
      ],
      sourceEventTypes,
      generatedAtIso,
      rulesVersion: input.rules.version,
    }
  })

  return {
    leagueId: input.rules.leagueId,
    generatedAtIso,
    signals,
    insufficientEvidence: signals.length === 0,
  }
}
