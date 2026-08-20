/**
 * AI-assisted league creation — structured contract (Phase 3C).
 * All producer output must match this shape; UI + apply layer validate before touching state.
 */

import type { CanonicalLeagueDiscoveryVisibility } from '@/lib/league-creation/canonical/createLeagueVisibilityMonetization'
import type { LeagueCreationTemplateId } from '@/lib/create-league-v2/templates/types'
import type { SupportedSport } from '@/lib/create-league-v2/state'

/** Narrow, canonical-safe fields the mapper may touch after template hydration. */
export interface LeagueAiExtractedSettings {
  teamCount?: number
  sport?: SupportedSport
  standardDiscoveryVisibility?: CanonicalLeagueDiscoveryVisibility
  /** Only applied when effective league type is dynasty/devy/c2c. */
  dynastyVisibility?: 'public' | 'private'
  /** Only applied when effective league type is best_ball. */
  bestBallVisibility?: 'public' | 'private'
}

export interface LeagueAiRecommendation {
  recommendedTemplateId: LeagueCreationTemplateId | null
  /** 0–1 heuristic or model confidence; never gates validation. */
  confidence: number
  explanation: string
  extractedSettings: LeagueAiExtractedSettings
  warnings: string[]
  /** User asks for formats outside Phase 3C template catalog. */
  unsupportedRequests: string[]
}

export function isLeagueAiRecommendation(value: unknown): value is LeagueAiRecommendation {
  if (!value || typeof value !== 'object') return false
  const v = value as Record<string, unknown>
  if (!('recommendedTemplateId' in v)) return false
  if (v.recommendedTemplateId !== null && typeof v.recommendedTemplateId !== 'string') return false
  if (!('confidence' in v) || typeof v.confidence !== 'number') return false
  if (!('explanation' in v) || typeof v.explanation !== 'string') return false
  if (!('extractedSettings' in v) || typeof v.extractedSettings !== 'object' || v.extractedSettings === null) return false
  if (!Array.isArray(v.warnings)) return false
  if (!Array.isArray(v.unsupportedRequests)) return false
  return true
}

/**
 * Validates external JSON (e.g. future LLM response) against the contract.
 * Does not perform semantic checks on template ids — use `normalizeLeagueAiRecommendation` after parse.
 */
export function parseLeagueAiRecommendationJson(raw: unknown): { ok: true; value: LeagueAiRecommendation } | { ok: false; error: string } {
  try {
    const data = typeof raw === 'string' ? (JSON.parse(raw) as unknown) : raw
    if (!isLeagueAiRecommendation(data)) {
      return { ok: false, error: 'Response is not a valid LeagueAiRecommendation object.' }
    }
    const rec = data as LeagueAiRecommendation
    if (rec.confidence < 0 || rec.confidence > 1) {
      return { ok: false, error: 'confidence must be between 0 and 1.' }
    }
    if (!Array.isArray(rec.warnings) || !rec.warnings.every((w) => typeof w === 'string')) {
      return { ok: false, error: 'warnings must be an array of strings.' }
    }
    if (!Array.isArray(rec.unsupportedRequests) || !rec.unsupportedRequests.every((w) => typeof w === 'string')) {
      return { ok: false, error: 'unsupportedRequests must be an array of strings.' }
    }
    const es = rec.extractedSettings
    if (es && typeof es !== 'object') {
      return { ok: false, error: 'extractedSettings must be an object.' }
    }
    return { ok: true, value: rec }
  } catch {
    return { ok: false, error: 'Invalid JSON.' }
  }
}
