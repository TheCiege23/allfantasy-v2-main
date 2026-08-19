import type { CanonicalLeagueRules, CanonicalLeagueRuntimeEvent } from '@/lib/league-runtime'
import type {
  CanonicalDraftRuntimeState,
  SmartDraftRecommendationSet,
  DraftFlowSignal,
} from '@/lib/draft-runtime/canonicalDraftRuntime'

export type DraftRuntimeIntelligenceCard = {
  id: string
  title: string
  audience: 'commissioner' | 'manager'
  category:
    | 'draft_readiness'
    | 'draft_health'
    | 'draft_pace'
    | 'offline_manager_risk'
    | 'commissioner_action'
    | 'best_available'
    | 'roster_need'
    | 'position_run'
    | 'draft_value'
    | 'team_construction'
    | 'trade_opportunity'
  summary: string
  confidence: number
  confidenceLabel: 'High' | 'Medium' | 'Low'
  evidence: Array<{ label: string; value: string; detail?: string }>
  sourceEventTypes: string[]
}

export type DraftRuntimeIntelligenceResult = {
  leagueId: string
  generatedAtIso: string
  commissioner: DraftRuntimeIntelligenceCard[]
  manager: DraftRuntimeIntelligenceCard[]
  insufficientEvidence: boolean
}

function label(confidence: number): DraftRuntimeIntelligenceCard['confidenceLabel'] {
  if (confidence >= 80) return 'High'
  if (confidence >= 55) return 'Medium'
  return 'Low'
}

function card(input: Omit<DraftRuntimeIntelligenceCard, 'confidenceLabel'>): DraftRuntimeIntelligenceCard {
  return { ...input, confidenceLabel: label(input.confidence) }
}

function confidenceFromEvidence(count: number, base = 54): number {
  return Math.min(90, Math.max(34, Math.round(base + count * 8)))
}

function flowSignalEvidence(signals: DraftFlowSignal[]) {
  return signals.slice(0, 4).map((signal) => ({
    label: signal.title,
    value: signal.severity,
    detail: signal.detail,
  }))
}

export function deriveDraftRuntimeIntelligence(input: {
  rules: CanonicalLeagueRules
  state: CanonicalDraftRuntimeState
  recommendations: SmartDraftRecommendationSet
  events?: CanonicalLeagueRuntimeEvent[]
  generatedAt?: Date
}): DraftRuntimeIntelligenceResult {
  const generatedAtIso = (input.generatedAt ?? new Date()).toISOString()
  const sourceEventTypes = (input.events ?? []).map((event) => event.type)
  const commissioner: DraftRuntimeIntelligenceCard[] = []
  const manager: DraftRuntimeIntelligenceCard[] = []
  const blocking = input.state.runtimeInvariants.filter((item) => item.severity === 'blocking')
  const warnings = input.state.runtimeInvariants.filter((item) => item.severity === 'warning')

  commissioner.push(
    card({
      id: 'draft-readiness',
      audience: 'commissioner',
      category: 'draft_readiness',
      title: 'Draft Readiness',
      summary:
        blocking.length > 0
          ? 'Draft setup has blocking canonical-rule mismatches.'
          : input.state.status === 'pre_draft'
            ? 'Draft setup is ready for commissioner start checks.'
            : 'Draft runtime is active or already completed.',
      confidence: confidenceFromEvidence(3 + input.state.runtimeInvariants.length),
      evidence: [
        { label: 'Draft status', value: input.state.status },
        { label: 'Teams', value: String(input.state.teamCount), detail: `Canonical team count ${input.rules.general.teamCount ?? 'unknown'}` },
        { label: 'Rounds', value: String(input.state.rounds), detail: `Canonical rounds ${input.rules.draft.rounds ?? 'unknown'}` },
        ...blocking.map((item) => ({ label: item.code, value: 'Blocking', detail: item.message })),
      ],
      sourceEventTypes,
    }),
  )

  commissioner.push(
    card({
      id: 'draft-health',
      audience: 'commissioner',
      category: 'draft_health',
      title: 'Draft Health',
      summary:
        warnings.length > 0
          ? 'Draft health has items to monitor before the next pick.'
          : 'No canonical runtime health warnings are active.',
      confidence: confidenceFromEvidence(2 + warnings.length, 58),
      evidence: [
        { label: 'Completed picks', value: `${input.state.completedPickCount}/${input.state.totalPicks}` },
        { label: 'Clock', value: input.state.clock.status, detail: input.state.clock.remainingSeconds != null ? `${input.state.clock.remainingSeconds}s remaining` : undefined },
        ...warnings.map((item) => ({ label: item.code, value: 'Watch', detail: item.message })),
      ],
      sourceEventTypes,
    }),
  )

  if (input.state.disconnectedRosterIds.length > 0 || input.state.offlineRosterIds.length > 0) {
    commissioner.push(
      card({
        id: 'offline-manager-risk',
        audience: 'commissioner',
        category: 'offline_manager_risk',
        title: 'Offline Manager Risk',
        summary: 'One or more manager slots may need queue, auto-pick, or substitute manager review.',
        confidence: confidenceFromEvidence(2 + input.state.disconnectedRosterIds.length, 62),
        evidence: [
          { label: 'Disconnected managers', value: String(input.state.disconnectedRosterIds.length) },
          { label: 'Offline managers', value: String(input.state.offlineRosterIds.length) },
          { label: 'Current pick', value: input.state.currentPick?.displayName ?? 'None' },
        ],
        sourceEventTypes,
      }),
    )
  }

  const urgentSignals = input.recommendations.flowSignals.filter((signal) => signal.severity === 'urgent')
  commissioner.push(
    card({
      id: 'commissioner-action-center',
      audience: 'commissioner',
      category: 'commissioner_action',
      title: 'Commissioner Action Center',
      summary:
        urgentSignals.length > 0
          ? 'Draft Flow has urgent runtime signals.'
          : 'No urgent commissioner action is required from available draft evidence.',
      confidence: confidenceFromEvidence(1 + urgentSignals.length, 56),
      evidence: urgentSignals.length
        ? flowSignalEvidence(urgentSignals)
        : [{ label: 'Urgent signals', value: '0', detail: 'Decision OS did not fabricate action items.' }],
      sourceEventTypes,
    }),
  )

  const top = input.recommendations.recommendations[0]
  if (top) {
    manager.push(
      card({
        id: 'best-available',
        audience: 'manager',
        category: 'best_available',
        title: 'Best Available',
        summary: `${top.player.name} is the strongest Smart Recommendation from the current deterministic pool.`,
        confidence: top.confidence,
        evidence: top.evidence.map((item, index) => ({ label: `Evidence ${index + 1}`, value: item })),
        sourceEventTypes,
      }),
    )
    manager.push(
      card({
        id: 'roster-need',
        audience: 'manager',
        category: 'roster_need',
        title: 'Roster Need',
        summary: top.rosterImpact,
        confidence: top.confidence,
        evidence: [
          { label: 'Positional fit', value: top.positionalFit },
          { label: 'Scoring fit', value: top.scoringFit },
          { label: 'Risk', value: top.risk },
        ],
        sourceEventTypes,
      }),
    )
    manager.push(
      card({
        id: 'draft-value',
        audience: 'manager',
        category: 'draft_value',
        title: 'Draft Value',
        summary: `Current value label: ${top.valueLabel}.`,
        confidence: top.confidence,
        evidence: [
          { label: 'Value label', value: top.valueLabel },
          { label: 'Alternatives', value: String(top.alternatives.length) },
        ],
        sourceEventTypes,
      }),
    )
  }

  const runSignals = input.recommendations.flowSignals.filter((signal) => signal.kind === 'position_run')
  if (runSignals.length > 0) {
    manager.push(
      card({
        id: 'position-run-alerts',
        audience: 'manager',
        category: 'position_run',
        title: 'Position Run Alerts',
        summary: 'Draft Flow detected a position run in recent picks.',
        confidence: confidenceFromEvidence(runSignals.length, 64),
        evidence: flowSignalEvidence(runSignals),
        sourceEventTypes,
      }),
    )
  }

  manager.push(
    card({
      id: 'team-construction',
      audience: 'manager',
      category: 'team_construction',
      title: 'Team Construction',
      summary: input.recommendations.insufficientEvidence
        ? 'Not enough available-player evidence to summarize this roster build.'
        : 'Team construction is grounded in current picks and canonical roster rules.',
      confidence: input.recommendations.insufficientEvidence ? 38 : confidenceFromEvidence(input.recommendations.recommendations.length, 58),
      evidence: [
        { label: 'Roster picks', value: String(input.state.picks.filter((pick) => pick.rosterId === input.recommendations.rosterId).length) },
        { label: 'Roster size', value: String(input.rules.roster.size ?? 'Unknown') },
      ],
      sourceEventTypes,
    }),
  )

  if (input.rules.trades.draftPickTrading) {
    manager.push(
      card({
        id: 'draft-trade-opportunity',
        audience: 'manager',
        category: 'trade_opportunity',
        title: 'Trade-Up Opportunities',
        summary: 'Draft pick trading is enabled; opportunity cards can be generated from current board evidence.',
        confidence: confidenceFromEvidence(2, 52),
        evidence: [
          { label: 'Draft pick trading', value: 'Enabled' },
          { label: 'Execution', value: 'Recommendation-only unless trade execution is available' },
        ],
        sourceEventTypes,
      }),
    )
  }

  return {
    leagueId: input.state.leagueId,
    generatedAtIso,
    commissioner,
    manager,
    insufficientEvidence: commissioner.length === 0 && manager.length === 0,
  }
}
