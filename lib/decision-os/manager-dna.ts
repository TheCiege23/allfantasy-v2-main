import type { ManagerDnaProfile } from '@/lib/decision-os/phase6/dna/types'
import type { DnaCard } from '@/lib/decision-os/presentation/types'

export type ManagerDnaEvidence = {
  label: string
  value: string
  detail?: string
}

export type ManagerDnaTraitView = {
  label: string
  strength: string
}

export type ManagerDnaViewModel = {
  title: string
  subtitle: string
  status: 'ready' | 'insufficient-data'
  primaryIdentity: string
  decisionStyle: string
  transactionStyle: string
  riskTendency: string
  engagementReliability: string
  confidence: number
  confidenceLabel: 'High' | 'Medium' | 'Low'
  evidence: ManagerDnaEvidence[]
  traits: ManagerDnaTraitView[]
  coachingFocus: string
  lastUpdatedIso: string
  insufficientData?: {
    title: string
    message: string
    missing: string[]
  }
}

type ManagerDnaSource = DnaCard | ManagerDnaProfile | null | undefined

type BuildManagerDnaInput = {
  source: ManagerDnaSource
  now?: Date
}

const DEFAULT_NOW = () => new Date()

function clamp(value: number, min = 0, max = 100) {
  return Math.min(max, Math.max(min, Math.round(value)))
}

function confidenceLabel(confidence: number): ManagerDnaViewModel['confidenceLabel'] {
  if (confidence >= 80) return 'High'
  if (confidence >= 55) return 'Medium'
  return 'Low'
}

function titleCaseToken(value: string | null | undefined, fallback = 'Unknown') {
  const source = String(value ?? '').trim()
  if (!source) return fallback
  return source
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\b\w/g, (match) => match.toUpperCase())
}

function normalizePercent(value: number | null | undefined) {
  if (typeof value !== 'number' || Number.isNaN(value)) return 0
  return value <= 1 ? clamp(value * 100) : clamp(value)
}

function getProfileField(source: ManagerDnaSource, key: keyof ManagerDnaProfile): unknown {
  if (!source) return undefined
  return (source as unknown as Record<string, unknown>)[key]
}

function getCardField(source: ManagerDnaSource, key: keyof DnaCard): unknown {
  if (!source) return undefined
  return (source as unknown as Record<string, unknown>)[key]
}

function resolveCoachingFocus(input: {
  identity: string
  decisionStyle: string
  transactionStyle: string
  riskTendency: string
  engagementReliability: string
}) {
  if (input.engagementReliability === 'unreliable') {
    return 'Start with steady weekly check-ins and lineup reminders.'
  }
  if (input.decisionStyle === 'indecisive') {
    return 'Focus on simpler lineup rules and earlier start/sit decisions.'
  }
  if (input.transactionStyle === 'passive') {
    return 'Coach toward one low-pressure waiver or trade review each week.'
  }
  if (input.riskTendency === 'risk_taking') {
    return 'Keep the aggression, but pair each move with a downside check.'
  }
  if (input.identity === 'committed_grinder') {
    return 'Give this manager deeper strategy prompts and league storyline fuel.'
  }
  return 'Keep coaching focused on one clear weekly roster habit.'
}

export function buildManagerDnaViewModel({
  source,
  now = DEFAULT_NOW(),
}: BuildManagerDnaInput): ManagerDnaViewModel {
  if (!source) {
    return {
      title: 'Manager DNA',
      subtitle: 'Behavior profile',
      status: 'insufficient-data',
      primaryIdentity: 'Needs more history',
      decisionStyle: 'Pending',
      transactionStyle: 'Pending',
      riskTendency: 'Pending',
      engagementReliability: 'Pending',
      confidence: 28,
      confidenceLabel: 'Low',
      evidence: [{ label: 'Manager history', value: 'Not enough yet' }],
      traits: [],
      coachingFocus: 'Play a few more weeks so the profile can be based on real habits.',
      lastUpdatedIso: now.toISOString(),
      insufficientData: {
        title: 'Not enough manager history yet',
        message: 'Manager DNA stays quiet until there is enough behavior history to summarize reliably.',
        missing: ['Lineup behavior', 'Transaction behavior', 'Engagement history'],
      },
    }
  }

  const primaryIdentity = String(
    getCardField(source, 'identityLabel') ??
      getCardField(source, 'primaryIdentity') ??
      getProfileField(source, 'primaryIdentity') ??
      'unknown',
  )
  const rawIdentity = String(
    getCardField(source, 'primaryIdentity') ?? getProfileField(source, 'primaryIdentity') ?? primaryIdentity,
  )
  const decisionStyle = String(getCardField(source, 'decisionStyle') ?? getProfileField(source, 'decisionStyle') ?? '')
  const transactionStyle = String(
    getCardField(source, 'transactionStyle') ?? getProfileField(source, 'transactionStyle') ?? '',
  )
  const riskTendency = String(getCardField(source, 'riskTendency') ?? getProfileField(source, 'riskTendency') ?? '')
  const engagementReliability = String(
    getCardField(source, 'engagementReliability') ?? getProfileField(source, 'engagementReliability') ?? '',
  )
  const confidence = normalizePercent(
    Number(getProfileField(source, 'confidence') ?? getCardField(source, 'completeness') ?? 0),
  )
  const completeness = normalizePercent(Number(getCardField(source, 'completeness') ?? getProfileField(source, 'completeness') ?? 0))
  const traits = Array.isArray(getCardField(source, 'traits') ?? getProfileField(source, 'traits'))
    ? ((getCardField(source, 'traits') ?? getProfileField(source, 'traits')) as Array<Record<string, unknown>>)
        .slice(0, 5)
        .map((trait) => ({
          label: titleCaseToken(String(trait.trait ?? 'Trait')),
          strength: titleCaseToken(String(trait.strength ?? 'observed')),
        }))
    : []
  const derivation = Array.isArray(getCardField(source, 'derivation') ?? getProfileField(source, 'derivation'))
    ? ((getCardField(source, 'derivation') ?? getProfileField(source, 'derivation')) as string[])
    : []

  return {
    title: 'Manager DNA',
    subtitle: 'Behavior profile',
    status: rawIdentity === 'unknown' || confidence < 25 ? 'insufficient-data' : 'ready',
    primaryIdentity: titleCaseToken(primaryIdentity),
    decisionStyle: titleCaseToken(decisionStyle),
    transactionStyle: titleCaseToken(transactionStyle),
    riskTendency: titleCaseToken(riskTendency),
    engagementReliability: titleCaseToken(engagementReliability),
    confidence,
    confidenceLabel: confidenceLabel(confidence),
    evidence: [
      { label: 'Profile confidence', value: `${confidence}%` },
      { label: 'Data completeness', value: `${completeness}%` },
      { label: 'Signals reviewed', value: String(derivation.length || traits.length || 1) },
    ],
    traits,
    coachingFocus: resolveCoachingFocus({
      identity: rawIdentity,
      decisionStyle,
      transactionStyle,
      riskTendency,
      engagementReliability,
    }),
    lastUpdatedIso: now.toISOString(),
    insufficientData:
      rawIdentity === 'unknown' || confidence < 25
        ? {
            title: 'Profile still forming',
            message: 'The available history does not support a strong manager identity yet.',
            missing: ['More weekly activity', 'More transaction events', 'More lineup decisions'],
          }
        : undefined,
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

export function extractManagerDnaSource(payload: unknown): ManagerDnaSource {
  if (!isRecord(payload)) return null
  const direct = payload.managerDna ?? payload.managerDNA ?? payload.dnaProfile ?? payload.dnaCard
  if (isRecord(direct)) return direct as unknown as ManagerDnaSource
  const nested = payload.intelligence ?? payload.decisionIntelligence ?? payload.profile
  if (isRecord(nested)) return extractManagerDnaSource(nested)
  return null
}
