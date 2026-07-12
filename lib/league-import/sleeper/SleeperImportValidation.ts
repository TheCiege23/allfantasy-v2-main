/**
 * Sleeper import validation helpers — Fantasy OS Migration Plan Milestone 2,
 * wired into the real preview/commit flow as of Phase 2B (see
 * app/api/league/import/sleeper/preview/route.ts and both commit routes).
 *
 * Pure checks over a `SleeperImportPayload`. `validateManagerMapping` reads
 * (never writes) through the Identity Service built in Phase 1 — a genuinely
 * new code path, not a migration of any existing consumer such as
 * `commissionerGate.ts`, which this module still does not touch. Findings
 * are exposed in the preview response and, at commit time, persisted as
 * `ImportWarning` rows alongside the existing canonical-bundle warnings
 * (via `toImportWarningRecords` below) — they never block a commit, even at
 * `error` severity; see `runSleeperImportValidation`'s `isValid` field for a
 * caller that wants to react to severity without gating anything.
 */

import { resolvePlatformIdentity } from '@/lib/shared-services/identity/PlatformIdentityService'
import type { ImportWarningRecord, ImportWarningSeverity } from '../types'
import type { SleeperImportPayload } from '../adapters/sleeper/types'

export type ValidationSeverity = 'info' | 'warn' | 'error'

export interface ValidationFinding {
  code: string
  severity: ValidationSeverity
  message: string
}

export interface SleeperImportValidationResult {
  findings: ValidationFinding[]
  /** True when there are no `error`-severity findings. `warn`/`info` findings never block an import. */
  isValid: boolean
}

export function validateLeagueCompleteness(payload: SleeperImportPayload): ValidationFinding[] {
  const findings: ValidationFinding[] = []
  if (!payload.league?.league_id) {
    findings.push({ code: 'league_missing_id', severity: 'error', message: 'League payload has no league_id.' })
  }
  if (!payload.league?.name) {
    findings.push({ code: 'league_missing_name', severity: 'warn', message: 'League has no name.' })
  }
  if (!payload.league?.total_rosters || payload.league.total_rosters <= 0) {
    findings.push({
      code: 'league_missing_roster_count',
      severity: 'error',
      message: 'League has no valid total_rosters count.',
    })
  }
  return findings
}

export function validateRosterCompleteness(payload: SleeperImportPayload): ValidationFinding[] {
  const findings: ValidationFinding[] = []
  const rosters = payload.rosters ?? []
  const expected = payload.league?.total_rosters ?? 0

  if (rosters.length === 0) {
    findings.push({ code: 'rosters_missing', severity: 'error', message: 'No rosters were returned for this league.' })
    return findings
  }

  if (expected > 0 && rosters.length !== expected) {
    findings.push({
      code: 'rosters_count_mismatch',
      severity: 'warn',
      message: `Expected ${expected} rosters, received ${rosters.length}.`,
    })
  }

  const emptyRosters = rosters.filter((r) => !r.players || r.players.length === 0)
  if (emptyRosters.length > 0) {
    findings.push({
      code: 'rosters_partial',
      severity: 'warn',
      message: `${emptyRosters.length} of ${rosters.length} roster(s) have no players.`,
    })
  }

  const unownedRosters = rosters.filter((r) => !r.owner_id)
  if (unownedRosters.length > 0) {
    findings.push({
      code: 'rosters_unowned',
      severity: 'info',
      message: `${unownedRosters.length} roster(s) have no owner_id (orphaned/co-owned team, common on Sleeper).`,
    })
  }

  return findings
}

export function validateScoringSettingsPresence(payload: SleeperImportPayload): ValidationFinding[] {
  const scoring = payload.league?.scoring_settings
  if (!scoring || Object.keys(scoring).length === 0) {
    return [{ code: 'scoring_settings_missing', severity: 'warn', message: 'League has no scoring_settings.' }]
  }
  return []
}

export function validateRosterSettingsPresence(payload: SleeperImportPayload): ValidationFinding[] {
  const positions = payload.league?.roster_positions
  if (!positions || positions.length === 0) {
    return [{ code: 'roster_settings_missing', severity: 'warn', message: 'League has no roster_positions.' }]
  }
  return []
}

export function validateTransactionAvailability(payload: SleeperImportPayload): ValidationFinding[] {
  if (!payload.transactions || payload.transactions.length === 0) {
    return [
      {
        code: 'transactions_unavailable',
        severity: 'info',
        message: 'No transactions were returned — may be a genuinely quiet league, or fetch failures (see fetchWarnings).',
      },
    ]
  }
  return []
}

export function validateDraftAvailability(payload: SleeperImportPayload): ValidationFinding[] {
  if (!payload.draftPicks || payload.draftPicks.length === 0) {
    return [
      {
        code: 'draft_unavailable',
        severity: 'info',
        message: 'No draft picks were returned — league may not have drafted on Sleeper yet, or the fetch failed.',
      },
    ]
  }
  return []
}

/** Sleeper never exposes playoff bracket RESULTS via this payload shape — always reported, never silently treated as success. */
export function validatePlayoffBracketAvailability(_payload: SleeperImportPayload): ValidationFinding[] {
  return [
    {
      code: 'playoff_bracket_results_unsupported',
      severity: 'info',
      message: 'Playoff bracket outcomes are not modeled in the canonical schema yet — this is expected, not a fetch gap.',
    },
  ]
}

/**
 * Confirms the importing AllFantasy user has a resolvable Sleeper identity
 * (via the Identity Service) and, where possible, that it actually appears
 * among this league's Sleeper users. Read-only — never links or writes
 * anything. Does not replace or call `commissionerGate.ts`'s authorization
 * check; this is a status/validation signal, not a permission decision.
 */
export async function validateManagerMapping(
  fantasyUserId: string,
  payload: SleeperImportPayload
): Promise<ValidationFinding[]> {
  const identity = await resolvePlatformIdentity(fantasyUserId, 'sleeper')

  if (identity.resolutionMethod !== 'stored' || !identity.providerUserId) {
    return [
      {
        code: 'manager_identity_unlinked',
        severity: 'warn',
        message: 'This AllFantasy user has no linked Sleeper identity.',
      },
    ]
  }

  const users = payload.users ?? []
  const isMember = users.some((u) => u.user_id === identity.providerUserId)
  if (!isMember) {
    return [
      {
        code: 'manager_identity_not_in_league',
        severity: 'warn',
        message: 'The linked Sleeper identity was not found among this league’s members.',
      },
    ]
  }

  return []
}

/** Runs every synchronous validation. Pass `fantasyUserId` to additionally run the Identity-Service-backed manager mapping check. */
export async function runSleeperImportValidation(
  payload: SleeperImportPayload,
  fantasyUserId?: string
): Promise<SleeperImportValidationResult> {
  const syncFindings = [
    ...validateLeagueCompleteness(payload),
    ...validateRosterCompleteness(payload),
    ...validateScoringSettingsPresence(payload),
    ...validateRosterSettingsPresence(payload),
    ...validateTransactionAvailability(payload),
    ...validateDraftAvailability(payload),
    ...validatePlayoffBracketAvailability(payload),
  ]

  const managerFindings = fantasyUserId ? await validateManagerMapping(fantasyUserId, payload) : []

  const findings = [...syncFindings, ...managerFindings]
  return {
    findings,
    isValid: !findings.some((f) => f.severity === 'error'),
  }
}

/**
 * Maps validation findings onto the existing `ImportWarningRecord` shape so
 * they can be persisted through the same `ImportWarning` mechanism the
 * canonical import bundle's own warnings already use — no new storage, no
 * new audit trail. `code` is prefixed so a persisted row is unambiguously
 * traceable back to this validation layer rather than a fetch/coverage
 * warning. Severity passes through unchanged: `ValidationSeverity` and
 * `ImportWarningSeverity` are the same three-value union.
 */
export function toImportWarningRecords(findings: ValidationFinding[]): ImportWarningRecord[] {
  return findings.map((finding) => ({
    code: `sleeper_validation_${finding.code}`,
    message: finding.message,
    severity: finding.severity as ImportWarningSeverity,
    metadata: { source: 'sleeper_import_validation' },
  }))
}
