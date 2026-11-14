/**
 * Shared AI request validator — envelope validation, sport normalization, no frontend assumptions.
 */

import type { AIContextEnvelope } from '@/lib/unified-ai/types'
import type { AIErrorCode } from './types'
import { normalizeToSupportedSport } from '@/lib/sport-scope'
import { normalizeOrchestrationToolKey } from './tool-key-normalizer'

export interface ValidationResult {
  valid: boolean
  envelope?: AIContextEnvelope
  errorCode?: AIErrorCode
  errorMessage?: string
}

/**
 * Validate and normalize UnifiedAIRequest. Sport is normalized to supported; featureType accepted if known.
 */
export function validateAIRequest(req: unknown): ValidationResult {
  if (!req || typeof req !== 'object') {
    return { valid: false, errorCode: 'envelope_validation_failed', errorMessage: 'Request body must be an object.' }
  }

  const body = req as Record<string, unknown>
  const envelope = body.envelope as AIContextEnvelope | undefined

  if (!envelope || typeof envelope !== 'object') {
    return { valid: false, errorCode: 'envelope_validation_failed', errorMessage: 'envelope is required.' }
  }

  const featureType = typeof envelope.featureType === 'string' ? envelope.featureType.trim() : ''
  if (!featureType) {
    return { valid: false, errorCode: 'envelope_validation_failed', errorMessage: 'envelope.featureType is required.' }
  }

  const sportRaw = envelope.sport
  const sport = typeof sportRaw === 'string' && sportRaw.trim()
    ? normalizeToSupportedSport(sportRaw)
    : normalizeToSupportedSport(undefined)

  const normalized: AIContextEnvelope = {
    ...envelope,
    featureType: normalizeOrchestrationToolKey(featureType),
    sport,
    deterministicContextEnvelope:
      envelope.deterministicContextEnvelope && typeof envelope.deterministicContextEnvelope === 'object'
        ? {
            ...envelope.deterministicContextEnvelope,
            sport,
          }
        : envelope.deterministicContextEnvelope,
  }

  const mode = body.mode as string | undefined
  if (mode && !['single_model', 'specialist', 'consensus', 'unified_brain'].includes(mode)) {
    return { valid: false, errorCode: 'envelope_validation_failed', errorMessage: `Invalid mode: ${mode}.` }
  }

  return { valid: true, envelope: normalized }
}

/**
 * Validate envelope only (e.g. when received from another layer). Ensures sport is supported.
 */
export function validateEnvelope(envelope: unknown): ValidationResult {
  if (!envelope || typeof envelope !== 'object') {
    return { valid: false, errorCode: 'envelope_validation_failed', errorMessage: 'envelope must be an object.' }
  }

  const e = envelope as AIContextEnvelope
  const featureType = typeof e.featureType === 'string' ? e.featureType.trim() : ''
  if (!featureType) {
    return { valid: false, errorCode: 'envelope_validation_failed', errorMessage: 'envelope.featureType is required.' }
  }

  const sport = typeof e.sport === 'string' && e.sport.trim()
    ? normalizeToSupportedSport(e.sport)
    : normalizeToSupportedSport(undefined)

  return {
    valid: true,
    envelope: {
      ...e,
      featureType: normalizeOrchestrationToolKey(featureType),
      sport,
      deterministicContextEnvelope:
        e.deterministicContextEnvelope && typeof e.deterministicContextEnvelope === 'object'
          ? { ...e.deterministicContextEnvelope, sport }
          : e.deterministicContextEnvelope,
    },
  }
}
