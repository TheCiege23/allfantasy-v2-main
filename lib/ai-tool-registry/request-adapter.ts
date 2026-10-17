/**
 * Adapt PROMPT 124 request contract to UnifiedAIRequest (envelope + mode).
 */

import { normalizeToSupportedSport } from '@/lib/sport-scope'
import type { AIContextEnvelope } from '@/lib/unified-ai/types'
import type { UnifiedAIRequest } from '@/lib/ai-orchestration/types'
import type { AIToolRequestContract } from './contracts'
import { getToolRegistration, resolveModeForTool } from './registry'
import {
  buildEnvelopeFromTool,
  DeterministicContextEnvelopeSchema,
  type DeterministicContextEnvelope,
  type EvidenceItem,
  type Confidence,
  type MissingDataBlock,
  type UncertaintyBlock,
} from '@/lib/ai-context-envelope'
import {
  buildEnvelopeForTool as buildToolLayerEnvelope,
  resolveEnvelopeBuilderToolKey,
} from '@/lib/ai-tool-layer'

const GROUNDED_TOOL_KEYS = new Set([
  'trade_analyzer',
  'waiver_ai',
  'draft_helper',
  'matchup',
  'rankings',
  'legacy_score',
  'rivalries',
  'story_creator',
  'ai_commissioner',
  'fantasy_coach',
  'content',
  'blog_generator',
  'social_clip_generator',
])

function buildToolLayerEnvelopeIfSupported(
  contract: AIToolRequestContract,
  sport: string,
  userId?: string | null
): AIContextEnvelope | null {
  const layerTool = resolveEnvelopeBuilderToolKey(contract.tool)
  if (!layerTool) return null

  const base = {
    sport,
    leagueId: contract.leagueId ?? null,
    userId: contract.userId ?? userId ?? null,
    deterministicPayload: contract.deterministicContext ?? null,
    userMessage: contract.userMessage ?? undefined,
  }

  switch (layerTool) {
    case 'trade_analyzer':
      return buildToolLayerEnvelope('trade_analyzer', base)
    case 'waiver_ai':
      return buildToolLayerEnvelope('waiver_ai', base)
    case 'rankings':
      return buildToolLayerEnvelope('rankings', base)
    case 'draft_helper':
      return buildToolLayerEnvelope('draft_helper', base)
    case 'matchup':
      return buildToolLayerEnvelope('matchup', base)
    case 'legacy_score':
      return buildToolLayerEnvelope('legacy_score', base)
    case 'rivalries':
      return buildToolLayerEnvelope('rivalries', base)
    default:
      return null
  }
}

function buildEvidenceItems(
  deterministicContext: Record<string, unknown> | null | undefined,
  requiredFields: string[],
  leagueSettings: Record<string, unknown> | null | undefined,
  sport: string,
  toolKey: string
): EvidenceItem[] {
  if (!deterministicContext || typeof deterministicContext !== 'object') return []
  const evidence: EvidenceItem[] = []
  for (const field of requiredFields) {
    const value = field === 'leagueSettings'
      ? leagueSettings ?? deterministicContext[field]
      : field === 'sport'
        ? sport
        : deterministicContext[field]
    if (value == null) continue
    if (typeof value === 'string' || typeof value === 'number') {
      evidence.push({
        source: `${toolKey}_engine`,
        label: field,
        value,
      })
    } else if (Array.isArray(value)) {
      evidence.push({
        source: `${toolKey}_engine`,
        label: field,
        value: `${value.length} item(s)`,
      })
    } else if (typeof value === 'object') {
      evidence.push({
        source: `${toolKey}_engine`,
        label: field,
        value: 'Structured context provided',
      })
    }
  }

  if (evidence.length < 6) {
    const skip = new Set(requiredFields)
    for (const [key, value] of Object.entries(deterministicContext)) {
      if (skip.has(key)) continue
      if (value == null) continue
      if (typeof value !== 'string' && typeof value !== 'number' && typeof value !== 'boolean') continue
      evidence.push({
        source: `${toolKey}_engine`,
        label: key,
        value: typeof value === 'boolean' ? (value ? 'true' : 'false') : value,
      })
      if (evidence.length >= 8) break
    }
  }

  return evidence
}

function buildConfidenceFromMissing(
  missingFields: string[],
  requiredFieldCount: number
): Confidence {
  const coverage = requiredFieldCount > 0
    ? Math.max(0, Math.min(100, Math.round(((requiredFieldCount - missingFields.length) / requiredFieldCount) * 100)))
    : 75
  const scorePct = Math.max(25, Math.min(90, missingFields.length ? coverage - 10 : coverage))
  const label: Confidence['label'] = scorePct >= 70 ? 'high' : scorePct >= 45 ? 'medium' : 'low'
  return {
    scorePct,
    label,
    reason: missingFields.length
      ? `Missing deterministic fields: ${missingFields.slice(0, 4).join(', ')}`
      : 'Deterministic context includes required fields.',
    cappedByData: missingFields.length > 0,
    capReason: missingFields.length > 0 ? `Missing fields: ${missingFields.join(', ')}` : undefined,
  }
}

function buildMissingAndUncertainty(
  missingFields: string[]
): { missingData?: MissingDataBlock; uncertainty?: UncertaintyBlock } {
  if (missingFields.length === 0) return {}
  const missingData: MissingDataBlock = {
    items: missingFields.map((field) => ({
      what: field,
      impact: 'high',
      suggestedAction: `Provide deterministic value for "${field}" to improve confidence.`,
    })),
    summaryForAI: `Missing deterministic fields: ${missingFields.join(', ')}`,
  }
  const uncertainty: UncertaintyBlock = {
    items: missingFields.map((field) => ({
      what: field,
      impact: 'high',
      reason: 'Deterministic metric not provided.',
    })),
    summaryForAI: `Uncertain due to missing deterministic fields: ${missingFields.join(', ')}`,
  }
  return { missingData, uncertainty }
}

/**
 * Build deterministic envelope for grounded tools so providers get structured evidence/confidence/uncertainty.
 */
export function buildDeterministicEnvelopeForToolRequest(
  contract: AIToolRequestContract,
  userId?: string | null
): DeterministicContextEnvelope | null {
  const reg = getToolRegistration(contract.tool)
  if (!reg) return null
  const toolKey = reg.toolKey
  if (!GROUNDED_TOOL_KEYS.has(toolKey)) return null

  const deterministicContext =
    contract.deterministicContext && typeof contract.deterministicContext === 'object'
      ? contract.deterministicContext
      : null

  const missingFields = reg.requiredContextFields.filter((field) => {
    if (field === 'leagueSettings') {
      return !(contract.leagueSettings && typeof contract.leagueSettings === 'object')
    }
    if (field === 'sport') {
      return !contract.sport
    }
    return deterministicContext?.[field] == null
  })
  const evidenceItems = buildEvidenceItems(
    deterministicContext,
    reg.requiredContextFields,
    contract.leagueSettings,
    normalizeToSupportedSport(contract.sport ?? undefined),
    toolKey
  )
  const confidence = buildConfidenceFromMissing(missingFields, reg.requiredContextFields.length)
  const { missingData, uncertainty } = buildMissingAndUncertainty(missingFields)

  const envelope = buildEnvelopeFromTool(toolKey, normalizeToSupportedSport(contract.sport ?? undefined), {
    leagueId: contract.leagueId ?? null,
    userId: contract.userId ?? userId ?? null,
    evidence: evidenceItems.length
      ? {
          toolId: toolKey,
          items: evidenceItems,
          summaryForAI: evidenceItems.slice(0, 5).map((item) => `${item.label}: ${item.value}`).join('; '),
        }
      : undefined,
    confidence,
    uncertainty,
    missingData,
    deterministicPayload: deterministicContext ?? null,
    hardConstraints: [
      'Use only provided deterministic facts.',
      'Do not invent metrics that are missing from deterministic context.',
      'When confidence is capped, explicitly present caveats.',
    ],
    envelopeId: `det-${toolKey}-${Date.now().toString(36)}`,
    dataQualitySummary: missingFields.length
      ? `Missing required deterministic fields: ${missingFields.join(', ')}`
      : 'Deterministic context complete for required fields.',
  })

  const parsed = DeterministicContextEnvelopeSchema.safeParse(envelope)
  return parsed.success ? parsed.data : null
}

export function requestContractToUnified(
  contract: AIToolRequestContract,
  userId?: string | null
): UnifiedAIRequest {
  const sport = normalizeToSupportedSport(contract.sport ?? undefined)
  const reg = getToolRegistration(contract.tool)
  const featureType = reg?.toolKey ?? contract.tool
  const useSingleProvider =
    contract.provider && reg?.allowedProviders.includes(contract.provider)
  const mode = useSingleProvider ? 'single_model' : resolveModeForTool(featureType, contract.aiMode ?? undefined)

  const toolLayerEnvelope = buildToolLayerEnvelopeIfSupported(contract, sport, userId)
  const deterministicContextEnvelope = buildDeterministicEnvelopeForToolRequest(contract, userId)
  const baseHardConstraints = [
    'Deterministic-first: never override hard engine outputs.',
    'Use only provided deterministic, league, scoring, roster, and sport context.',
    'Never invent player values, rankings, injuries, roster needs, or team context.',
    'If confidence is limited, say so explicitly and explain uncertainty.',
  ]
  const envelope: AIContextEnvelope = {
    ...(toolLayerEnvelope ?? {
      featureType,
      sport,
      leagueId: contract.leagueId ?? null,
      userId: contract.userId ?? userId ?? null,
      deterministicPayload: contract.deterministicContext ?? null,
      statisticsPayload: contract.leagueSettings ?? null,
      userMessage: contract.userMessage ?? undefined,
    }),
    featureType,
    sport,
    statisticsPayload: contract.leagueSettings ?? (toolLayerEnvelope?.statisticsPayload ?? null),
    modelRoutingHints: useSingleProvider && contract.provider ? [contract.provider] : toolLayerEnvelope?.modelRoutingHints,
    deterministicContextEnvelope,
    hardConstraints: Array.from(
      new Set([...(toolLayerEnvelope?.hardConstraints ?? []), ...baseHardConstraints])
    ),
    assistantRoutingHints:
      featureType === 'chimmy_chat'
        ? ['chimmy']
        : featureType === 'openclaw_dev_assistant'
          ? ['openclaw_dev_assistant']
          : featureType === 'openclaw_growth_marketing_assistant'
            ? ['openclaw_growth_marketing_assistant']
            : undefined,
  }
  return {
    envelope,
    mode,
    options: {
      traceId: undefined,
      timeoutMs: 25_000,
      maxRetries: 1,
    },
  }
}
