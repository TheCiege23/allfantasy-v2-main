/**
 * Psychological Profiles Engine — types for profiles, labels, evidence, and sport.
 */

import type { SupportedSport } from '@/lib/sport-scope'
import { SUPPORTED_SPORTS } from '@/lib/sport-scope'

export const PROFILE_LABELS = [
  'aggressive',
  'conservative',
  'trade-heavy',
  'waiver-focused',
  'quiet strategist',
  'chaos agent',
  'value-first',
  'rookie-heavy',
  'win-now',
  'patient rebuilder',
  // Draft vocabulary. Draft is often the ONLY dimension with data — a dynasty
  // league carries hundreds of picks and, until trades are ingested, nothing
  // else. Without these the engine could measure a real difference between
  // managers (early-round rate 26% vs 55%) and had no way to say it, so every
  // profile rendered label-less. These rest on signals that genuinely vary per
  // manager, unlike the old 'rookie-heavy' which was constant by construction.
  'early-round focused',
  'late-round accumulator',
  'position-focused',
  'balanced drafter',
] as const
export type ProfileLabel = (typeof PROFILE_LABELS)[number]

export const EVIDENCE_TYPES = [
  'draft_tendency',
  'trade_frequency',
  'trade_timing',
  'waiver_activity',
  'lineup_changes',
  'benching_pattern',
  'rookie_vs_veteran',
  'position_priority',
  'rebuild_contention',
  'risk_taking',
  // Per-dimension evidence counts, persisted so the READ layer can tell an
  // unmeasured score from a genuinely low one without re-aggregating signals.
  'trade_evidence_count',
  'draft_evidence_count',
  'roster_evidence_count',
] as const
export type EvidenceType = (typeof EVIDENCE_TYPES)[number]

export interface ManagerPsychProfilePayload {
  leagueId: string
  managerId: string
  sport: string
  profileLabels: ProfileLabel[]
  aggressionScore: number
  activityScore: number
  tradeFrequencyScore: number
  waiverFocusScore: number
  riskToleranceScore: number
}

export interface ProfileEvidencePayload {
  managerId: string
  leagueId: string
  sport: string
  evidenceType: EvidenceType
  value: number
  sourceReference?: string | null
  createdAt?: Date
}

export interface BehaviorSignals {
  tradeCount: number
  tradeFrequencyNorm: number
  tradeTimingLateRate: number
  waiverClaimCount: number
  waiverFocusNorm: number
  lineupChangeRate: number
  benchingPatternScore: number
  rookieAcquisitionRate: number
  vetAcquisitionRate: number
  draftPickCount: number
  draftEarlyRoundRate: number
  positionPriorityConcentration: number
  picksTradedAway: number
  picksAcquired: number
  rebuildScore: number
  contentionScore: number
  aggressionNorm: number
  riskNorm: number
}

export const PSYCH_SPORTS: readonly SupportedSport[] = [...SUPPORTED_SPORTS]
export type PsychSport = SupportedSport
