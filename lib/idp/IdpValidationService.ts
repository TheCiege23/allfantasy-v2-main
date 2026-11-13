/**
 * IDP validation: roster setup, scoring outliers, position-mode switch, roster legality preview.
 * Prevents broken roster setups; warns when one stat is unrealistically dominant.
 * PROMPT 5/6.
 */

import { getRosterDefaultsForIdpLeague, getIdpLeagueConfig } from '@/lib/idp/IDPLeagueConfig'
import { buildIdpStarterSlots } from '@/lib/idp/IDPRosterPresets'
import { IDP_STAT_KEYS } from '@/lib/idp/IDPScoringPresets'
import type { IdpLeagueConfigLoaded, IdpPositionMode, IdpRosterPreset, IdpSlotOverrides, IdpScoringOverrides } from './types'

const IDP_SLOT_KEYS = ['DE', 'DT', 'LB', 'CB', 'S', 'DL', 'DB', 'IDP_FLEX']

interface RosterImpactPreview {
  totalIdpSlots: number
  slotCounts: Record<string, number>
  warnings: string[]
  errors: string[]
}

/**
 * Count total IDP starter slots from preset + overrides + position mode.
 */
export function countIdpStarterSlots(
  rosterPreset: IdpRosterPreset,
  slotOverrides: IdpSlotOverrides | null,
  positionMode: IdpPositionMode
): number {
  const slots = buildIdpStarterSlots(rosterPreset, slotOverrides, positionMode)
  let n = 0
  for (const key of IDP_SLOT_KEYS) {
    const c = slots[key]
    if (typeof c === 'number' && c > 0) n += c
  }
  return n
}

/**
 * Validate roster setup: fail if zero IDP starters (common mistake).
 */
export function validateRosterSetup(
  rosterPreset: IdpRosterPreset,
  slotOverrides: IdpSlotOverrides | null,
  positionMode: IdpPositionMode
): { valid: boolean; error?: string } {
  const total = countIdpStarterSlots(rosterPreset, slotOverrides, positionMode)
  if (total === 0) {
    return { valid: false, error: 'League has zero IDP starter slots. Add at least one IDP slot (e.g. DL, LB, DB or DE, DT, CB, S).' }
  }
  return { valid: true }
}

/** Threshold: if one stat's point value is this many times the median, warn. */
const DOMINANT_STAT_MULTIPLIER = 5

/**
 * Warn when scoring makes one stat unrealistically dominant (e.g. 10 pts per tackle).
 */
export function validateScoringOutliers(
  scoring: Record<string, number>
): { warnings: string[] } {
  const warnings: string[] = []
  const values = IDP_STAT_KEYS.map((k) => scoring[k] ?? 0).filter((v) => v > 0)
  if (values.length < 2) return { warnings }
  const sorted = [...values].sort((a, b) => a - b)
  const median = sorted[Math.floor(sorted.length / 2)] || 1
  for (const key of IDP_STAT_KEYS) {
    const v = scoring[key] ?? 0
    if (v > median * DOMINANT_STAT_MULTIPLIER) {
      warnings.push(
        `Scoring for "${key}" (${v} pts) is much higher than other IDP stats (median ${median}). This may make one stat dominate scoring.`
      )
    }
  }
  return { warnings }
}

/**
 * Whether position mode / starter counts can be changed (only before settings lock).
 */
export function canChangePositionModeOrStarters(config: IdpLeagueConfigLoaded): boolean {
  return config.settingsLockedAt == null
}

/**
 * Preview roster legality impact of a proposed config (before saving).
 */
export async function previewRosterImpact(
  leagueId: string,
  proposed: {
    positionMode?: IdpPositionMode
    rosterPreset?: IdpRosterPreset
    slotOverrides?: IdpSlotOverrides | null
  }
): Promise<RosterImpactPreview> {
  const current = await getIdpLeagueConfig(leagueId)
  const positionMode = (proposed.positionMode ?? current?.positionMode ?? 'standard') as IdpPositionMode
  const rosterPreset = (proposed.rosterPreset ?? current?.rosterPreset ?? 'standard') as IdpRosterPreset
  const slotOverrides = proposed.slotOverrides !== undefined ? proposed.slotOverrides : current?.slotOverrides ?? null

  const slotCounts = buildIdpStarterSlots(rosterPreset, slotOverrides, positionMode)
  const totalIdpSlots = countIdpStarterSlots(rosterPreset, slotOverrides, positionMode)

  const errors: string[] = []
  const warnings: string[] = []

  const rosterCheck = validateRosterSetup(rosterPreset, slotOverrides, positionMode)
  if (!rosterCheck.valid) errors.push(rosterCheck.error!)

  if (current?.settingsLockedAt && (proposed.positionMode !== undefined || proposed.slotOverrides !== undefined)) {
    warnings.push('Settings are locked. Unlock before changing position mode or starter counts.')
  }

  return {
    totalIdpSlots,
    slotCounts,
    warnings,
    errors,
  }
}

/**
 * Merge preset scoring with per-league overrides for validation.
 * Caller can get preset values from IDPScoringPresets or scoring defaults registry.
 */
export function mergeScoringForValidation(
  presetValues: Record<string, number>,
  overrides: IdpScoringOverrides | null
): Record<string, number> {
  if (!overrides || Object.keys(overrides).length === 0) return { ...presetValues }
  return { ...presetValues, ...overrides }
}
