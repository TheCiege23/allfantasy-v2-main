/**
 * DraftValidationOrchestrator.ts
 *
 * Pre-draft validation suite. Runs against committed Prisma schema:
 *   - `Roster.platformUserId` (NOT `Roster.userId` — roster ownership is keyed
 *     on the AllFantasy `platformUserId` so an empty slot is `platformUserId === ''`)
 *   - `League.rosterSize`, `League.starters`, `League.scoring` carry roster
 *     and scoring shape (no `LeagueSettings.starterSlots/benchSlots/scoringFormat`)
 *   - `DraftSession.draftType` (no top-level `prisma.draft` model)
 *
 * Each check returns a `ValidationResult` with `pass | fail | warning`. The
 * orchestrator returns `{ canStartDraft, results, ... }`. UI renders inline;
 * no navigation, no redirects.
 */

import { prisma } from '@/lib/prisma'
import { getEffectiveLeagueRosterTemplate } from '@/lib/league/getEffectiveLeagueRosterTemplate'

export type ValidationStatus = 'pass' | 'fail' | 'warning'

export type ValidationResult = {
  key: string
  label: string
  status: ValidationStatus
  message?: string
  fixAction?: string
}

export type DraftValidationReport = {
  leagueId: string
  draftId: string
  canStartDraft: boolean
  results: ValidationResult[]
  timestamp: string
}

export class DraftValidationOrchestrator {
  /**
   * Run full pre-draft validation suite.
   * Each check is independent and resilient — if one DB call throws, the
   * other checks still run and the orchestrator returns a structured report.
   */
  static async validateDraft(leagueId: string, draftId: string): Promise<DraftValidationReport> {
    const results: ValidationResult[] = []

    const checks = [
      () => this.checkTeamsFilled(leagueId),
      () => this.checkDraftOrderExists(leagueId, draftId),
      () => this.checkRosterSlotsConfigured(leagueId),
      () => this.checkScoringSettingsPresent(leagueId),
      () => this.checkNoDuplicateUsers(leagueId),
      () => this.checkDraftTypeConfigured(leagueId, draftId),
    ]

    for (const check of checks) {
      try {
        results.push(await check())
      } catch (err) {
        console.error('[DraftValidationOrchestrator] check error:', err)
        results.push({
          key: 'system_error',
          label: 'System Error',
          status: 'fail',
          message: 'An unexpected error occurred during validation',
        })
      }
    }

    const canStartDraft = results.every((r) => r.status !== 'fail')

    return {
      leagueId,
      draftId,
      canStartDraft,
      results,
      timestamp: new Date().toISOString(),
    }
  }

  /**
   * Check 1: All roster slots are claimed by a manager.
   * "Filled" = `platformUserId` non-empty (an unclaimed slot has the empty
   * string as a placeholder owner).
   */
  private static async checkTeamsFilled(leagueId: string): Promise<ValidationResult> {
    const rosters = await prisma.roster.findMany({
      where: { leagueId },
      select: { id: true, platformUserId: true },
    })

    const totalSlots = rosters.length
    const filledSlots = rosters.filter((r) => r.platformUserId && r.platformUserId.trim().length > 0).length

    if (totalSlots === 0) {
      return {
        key: 'teams_filled',
        label: 'Teams Filled',
        status: 'fail',
        message: 'No rosters exist yet for this league',
        fixAction: 'invite_managers',
      }
    }

    if (filledSlots === totalSlots) {
      return {
        key: 'teams_filled',
        label: `Teams Filled (${filledSlots}/${totalSlots})`,
        status: 'pass',
      }
    }

    return {
      key: 'teams_filled',
      label: `Teams Filled (${filledSlots}/${totalSlots})`,
      status: 'fail',
      message: `${totalSlots - filledSlots} slot(s) need a manager`,
      fixAction: 'invite_managers',
    }
  }

  /**
   * Check 2: Draft order is set on the DraftSession.
   */
  private static async checkDraftOrderExists(leagueId: string, draftId: string): Promise<ValidationResult> {
    const session = await prisma.draftSession.findUnique({
      where: { id: draftId },
      select: { slotOrder: true, status: true },
    })

    if (!session) {
      return {
        key: 'draft_order',
        label: 'Draft Order',
        status: 'fail',
        message: 'Draft session not found',
      }
    }

    const slotOrder = Array.isArray(session.slotOrder) ? session.slotOrder : []

    if (slotOrder.length > 0) {
      return {
        key: 'draft_order',
        label: `Draft Order Set (${slotOrder.length} teams)`,
        status: 'pass',
      }
    }

    return {
      key: 'draft_order',
      label: 'Draft Order',
      status: 'fail',
      message: 'Draft order has not been set',
      fixAction: 'set_draft_order',
    }
  }

  /**
   * Check 3: Roster shape is configured — aligned with {@link getEffectiveLeagueRosterTemplate}
   * (`LeagueRosterConfig`, `League.starters`, `settings.rosterPositions`, sport-specific `*_roster_config`).
   */
  private static async checkRosterSlotsConfigured(leagueId: string): Promise<ValidationResult> {
    const league = await prisma.league.findUnique({
      where: { id: leagueId },
      select: { id: true },
    })

    if (!league) {
      return {
        key: 'roster_slots',
        label: 'Roster Configuration',
        status: 'fail',
        message: 'League not found',
      }
    }

    try {
      const eff = await getEffectiveLeagueRosterTemplate(leagueId)
      const totalSlots = eff.template.slots.reduce(
        (sum, s) =>
          sum +
          (Number(s.starterCount) || 0) +
          (Number(s.benchCount) || 0) +
          (Number(s.reserveCount) || 0) +
          (Number(s.taxiCount) || 0) +
          (Number(s.devyCount) || 0),
        0,
      )

      if (eff.hasPersistedRosterSchema && totalSlots > 0) {
        return {
          key: 'roster_slots',
          label: `Roster Configuration (${totalSlots} slots)`,
          status: 'pass',
        }
      }

      return {
        key: 'roster_slots',
        label: 'Roster Configuration',
        status: 'fail',
        message: 'No roster slots configured',
        fixAction: 'configure_roster',
      }
    } catch {
      return {
        key: 'roster_slots',
        label: 'Roster Configuration',
        status: 'fail',
        message: 'Could not resolve roster template',
        fixAction: 'configure_roster',
      }
    }
  }

  /**
   * Check 4: Scoring — `League.scoring`, `League.scoringPresetId`, or merged `settings.scoring_format` /
   * `settings.scoring_format_type` (canonical create stores presets on the league row + JSON settings).
   */
  private static async checkScoringSettingsPresent(leagueId: string): Promise<ValidationResult> {
    const league = await prisma.league.findUnique({
      where: { id: leagueId },
      select: { scoring: true, scoringPresetId: true, settings: true },
    })

    if (!league) {
      return {
        key: 'scoring_settings',
        label: 'Scoring Settings',
        status: 'fail',
        message: 'League not found',
      }
    }

    const settings = (league.settings as Record<string, unknown> | null) ?? {}
    const fromSettingsFormat =
      typeof settings.scoring_format === 'string' && settings.scoring_format.trim().length > 0
        ? settings.scoring_format.trim()
        : typeof settings.scoring_format_type === 'string' && settings.scoring_format_type.trim().length > 0
          ? settings.scoring_format_type.trim()
          : ''

    const preset = league.scoringPresetId?.trim() ?? ''
    const column = league.scoring?.trim() ?? ''

    const effective = column || preset || fromSettingsFormat

    if (effective) {
      const label = column || preset || fromSettingsFormat
      return {
        key: 'scoring_settings',
        label: `Scoring: ${label}`,
        status: 'pass',
      }
    }

    return {
      key: 'scoring_settings',
      label: 'Scoring Settings',
      status: 'fail',
      message: 'Scoring format not configured',
      fixAction: 'configure_scoring',
    }
  }

  /**
   * Check 5: No duplicate manager assignments — every claimed roster slot
   * must reference a unique `platformUserId`.
   */
  private static async checkNoDuplicateUsers(leagueId: string): Promise<ValidationResult> {
    const rosters = await prisma.roster.findMany({
      where: { leagueId },
      select: { platformUserId: true },
    })

    const userIds = rosters
      .map((r) => (r.platformUserId ?? '').trim())
      .filter((id) => id.length > 0)
    const uniqueUsers = new Set(userIds)

    if (userIds.length === uniqueUsers.size) {
      return {
        key: 'no_duplicate_users',
        label: 'Manager Assignments',
        status: 'pass',
        message: `${userIds.length} unique managers assigned`,
      }
    }

    return {
      key: 'no_duplicate_users',
      label: 'Manager Assignments',
      status: 'fail',
      message: 'Some managers are assigned to multiple teams',
      fixAction: 'fix_duplicate_managers',
    }
  }

  /**
   * Check 6: Draft type is set on the DraftSession (no top-level
   * `prisma.draft` model exists on this branch).
   */
  private static async checkDraftTypeConfigured(leagueId: string, draftId: string): Promise<ValidationResult> {
    const session = await prisma.draftSession.findUnique({
      where: { id: draftId },
      select: { draftType: true },
    })

    if (!session) {
      return {
        key: 'draft_type',
        label: 'Draft Type',
        status: 'fail',
        message: 'Draft session not found',
      }
    }

    if (session.draftType && session.draftType.trim().length > 0) {
      return {
        key: 'draft_type',
        label: `Draft Type: ${session.draftType}`,
        status: 'pass',
      }
    }

    return {
      key: 'draft_type',
      label: 'Draft Type',
      status: 'fail',
      message: 'Draft type not configured',
      fixAction: 'configure_draft_type',
    }
  }
}
