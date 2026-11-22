/**
 * Pick validation: no duplicate player, correct slot, session state, devy eligibility.
 *
 * Commit M — every refusal carries a stable `code` from
 * `pickAuthorityCodes.ts` so the route layer can return a structured
 * 400/403/409 and the client can render a precise inline error.
 */

import { validateUniquePlayer } from '@/lib/mock-draft/draft-engine'
import { isDraftPickRowEmpty } from './draftPickEmpty'
import {
  DRAFT_PICK_DUPLICATE_PLAYER,
  DRAFT_PICK_INVALID_PAYLOAD,
  DRAFT_PICK_NOT_LIVE,
  DRAFT_PICK_NOT_ON_CLOCK,
  type PickAuthorityCode,
} from './pickAuthorityCodes'

export interface ValidatePickInput {
  playerName: string
  position: string
  rosterId: string
  currentOnClockRosterId: string
  existingPicks: { playerName: string; position: string; playerId?: string | null }[]
  /**
   * The pick's player id, when the room sent one. Two different players can share a name (common in a
   * deep college or minor-league pool); with an id on both sides they are told apart by id, not name.
   */
  playerId?: string | null
  sessionStatus: string
  /**
   * Commit M — when true, the caller is a commissioner correction flow
   * (assign-pick / pick-edit). On-clock check is skipped; duplicate and
   * not-live checks still apply. Defaults to false.
   */
  commissionerOverride?: boolean
}

export interface PickValidationResult {
  valid: boolean
  error?: string
  code?: PickAuthorityCode
}

/**
 * Validate a pick submission. Session must be in_progress, or paused with
 * commissionerOverride (editor correction flow only — regular user picks are
 * blocked while paused).
 */
export function validatePickSubmission(input: ValidatePickInput): PickValidationResult {
  if (input.sessionStatus === 'paused' && !input.commissionerOverride) {
    return { valid: false, error: 'Draft is paused; picks not allowed', code: DRAFT_PICK_NOT_LIVE }
  }
  if (input.sessionStatus !== 'in_progress' && input.sessionStatus !== 'paused') {
    return { valid: false, error: 'Draft is not in progress', code: DRAFT_PICK_NOT_LIVE }
  }
  if (!input.commissionerOverride && input.rosterId !== input.currentOnClockRosterId) {
    return {
      valid: false,
      error: 'This roster is not on the clock',
      code: DRAFT_PICK_NOT_ON_CLOCK,
    }
  }
  const name = input.playerName?.trim()
  if (!name) {
    return { valid: false, error: 'Player name is required', code: DRAFT_PICK_INVALID_PAYLOAD }
  }
  const isSkip = (input.position || '').toUpperCase() === 'SKIP'
  if (isSkip) {
    return { valid: true }
  }
  const cleanPicks = input.existingPicks.filter((p) => !isDraftPickRowEmpty(p))
  const newId = String(input.playerId ?? '').trim()
  if (newId && cleanPicks.some((p) => String(p.playerId ?? '').trim() === newId)) {
    return { valid: false, error: `Duplicate draft violation: ${name} selected more than once`, code: DRAFT_PICK_DUPLICATE_PLAYER }
  }
  // A drafted player with a different id is a different person, whatever the name. A pick with no id
  // on either side still falls back to the name.
  const nameComparable = newId ? cleanPicks.filter((p) => !String(p.playerId ?? '').trim()) : cleanPicks
  const dupErrors = validateUniquePlayer([
    ...nameComparable.map((p) => ({
      overall: 0,
      round: 0,
      pick: 0,
      playerName: p.playerName,
      position: p.position,
      manager: '',
    })),
    { overall: 0, round: 0, pick: 0, playerName: name, position: input.position, manager: '' },
  ])
  if (dupErrors.length > 0) {
    return { valid: false, error: dupErrors[0], code: DRAFT_PICK_DUPLICATE_PLAYER }
  }
  return { valid: true }
}

export interface ValidateDevyInput {
  currentRound: number
  playerName: string
  position?: string
  /** When `promoted_devy`, devy rounds accept graduated NFL promotions only. */
  source?: string | null
  devyConfig: { enabled: boolean; devyRounds: number[] } | null
}

/**
 * Validate that a pick in a devy round is a devy-eligible player.
 * When round is devy, player must exist in DevyPlayer with devyEligible and !graduatedToNFL.
 */
export function validateDevyEligibilitySync(input: ValidateDevyInput): PickValidationResult {
  if (!input.devyConfig?.enabled || !Array.isArray(input.devyConfig.devyRounds)) {
    return { valid: true }
  }
  if (!input.devyConfig.devyRounds.includes(input.currentRound)) {
    return { valid: true }
  }
  if (!input.playerName?.trim()) {
    return { valid: false, error: 'Player name is required for devy pick' }
  }
  return { valid: true }
}

/**
 * Async devy check: when round is devy, ensure player exists in DevyPlayer (devyEligible, !graduatedToNFL).
 */
export async function validateDevyEligibilityAsync(
  input: ValidateDevyInput,
  prisma: { devyPlayer: { findFirst: (args: any) => Promise<any> } }
): Promise<PickValidationResult> {
  if (!input.devyConfig?.enabled || !Array.isArray(input.devyConfig.devyRounds)) {
    return { valid: true }
  }
  const name = input.playerName?.trim()
  if (!name) return { valid: false, error: 'Player name is required for devy pick' }
  const normalized = name.toLowerCase()
  const devy = await prisma.devyPlayer.findFirst({
    where: {
      devyEligible: true,
      OR: [
        { normalizedName: normalized },
        { name: { equals: name, mode: 'insensitive' } },
      ],
    },
  })
  const isDevyRound = input.devyConfig.devyRounds.includes(input.currentRound)
  if (isDevyRound && String(input.source ?? '').toLowerCase() === 'promoted_devy') {
    if (!devy) {
      return { valid: false, error: 'Promotion pick must match a known devy record.' }
    }
    if (!devy.graduatedToNFL) {
      return { valid: false, error: 'Promotion picks require a player who has graduated to the pros.' }
    }
    return { valid: true }
  }
  if (isDevyRound) {
    if (!devy || devy.graduatedToNFL) {
      return { valid: false, error: 'This round is devy-only. Select a devy-eligible (college) player.' }
    }
    return { valid: true }
  }
  if (devy && !devy.graduatedToNFL) {
    return { valid: false, error: 'This round is pro-only. Select a major-league player, not a devy asset.' }
  }
  return { valid: true }
}

export interface ValidateC2CInput {
  currentRound: number
  playerName: string
  c2cConfig: { enabled: boolean; collegeRounds: number[] } | null
}

/**
 * C2C: college round => only college-eligible; pro round => only pro (reject college-only).
 */
export async function validateC2CEligibilityAsync(
  input: ValidateC2CInput,
  prisma: { devyPlayer: { findFirst: (args: any) => Promise<any> } }
): Promise<PickValidationResult> {
  if (!input.c2cConfig?.enabled || !Array.isArray(input.c2cConfig.collegeRounds)) {
    return { valid: true }
  }
  const name = input.playerName?.trim()
  if (!name) return { valid: false, error: 'Player name is required' }
  const normalized = name.toLowerCase()
  const isCollegeRound = input.c2cConfig.collegeRounds.includes(input.currentRound)

  const collegePlayer = await prisma.devyPlayer.findFirst({
    where: {
      devyEligible: true,
      graduatedToNFL: false,
      OR: [
        { normalizedName: normalized },
        { name: { equals: name, mode: 'insensitive' } },
      ],
    },
  })

  if (isCollegeRound) {
    if (!collegePlayer) {
      return { valid: false, error: 'This round is college-only (C2C). Select a college-eligible player.' }
    }
    return { valid: true }
  }

  if (collegePlayer) {
    return { valid: false, error: 'This round is pro-only (C2C). Select a pro player, not a college player.' }
  }
  return { valid: true }
}
