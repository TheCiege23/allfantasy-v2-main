/**
 * Authoritative roster / lineup validation against league template + IR/taxi/devy rules.
 */
import { getNormalizedLineupSections, collectTemplateSectionIssues } from '@/lib/roster/LineupTemplateValidation'
import type { RosterTemplateDto } from '@/lib/multi-sport/RosterTemplateService'
import type { LineupValidationContext, RosterValidationIssue, RosterValidationResult } from './types'
import { ROSTER_SECTION_KEYS, type RosterSectionKey } from './types'
import { resolveConceptRosterLineupRules } from './conceptRosterRules'
import { isIrEligibleStatus } from './irEligibility'
import { collectStarterSlotIssues } from '@/lib/league/lineupSlotPositions'
import { playerEligibleForSlot } from '@/lib/league/lineup-swap'

function playerStatusUpper(row: Record<string, unknown>): string {
  const s = String(row.status ?? row.injury_status ?? '').trim().toUpperCase()
  return s
}

export function collectDuplicatePlayerIssues(playerData: unknown): RosterValidationIssue[] {
  const sections = getNormalizedLineupSections(playerData)
  const seen = new Map<string, RosterSectionKey>()
  const issues: RosterValidationIssue[] = []
  for (const section of ROSTER_SECTION_KEYS) {
    for (const row of sections[section]) {
      const id = String((row as Record<string, unknown>).id ?? '').trim()
      if (!id) continue
      if (seen.has(id)) {
        issues.push({
          code: 'duplicate_player',
          message: `Player ${id} appears more than once on this roster.`,
          section,
          playerId: id,
        })
      } else {
        seen.set(id, section)
      }
    }
  }
  return issues
}

function readYearsExperience(row: Record<string, unknown>): number | null {
  const raw =
    row.years_exp ??
    row.yearsExp ??
    (row.metadata && typeof row.metadata === 'object' && !Array.isArray(row.metadata)
      ? (row.metadata as Record<string, unknown>).years_exp ??
        (row.metadata as Record<string, unknown>).yearsExp
      : undefined)
  if (typeof raw === 'number' && Number.isFinite(raw)) return Math.max(0, Math.floor(raw))
  if (typeof raw === 'string') {
    const n = parseInt(raw, 10)
    return Number.isFinite(n) ? Math.max(0, n) : null
  }
  return null
}

/**
 * Dynasty taxi: rookie-only and experience caps from `League` columns.
 * Player rows must carry `years_exp` / `yearsExp` (or metadata) when enforcing non-rookie or year limits.
 */
export function validateTaxiSectionAgainstLeague(
  league: LineupValidationContext['league'],
  playerData: unknown,
): RosterValidationIssue[] {
  const taxiSlots = league.taxiSlots ?? 0
  if (taxiSlots <= 0) return []
  const sections = getNormalizedLineupSections(playerData)
  const issues: RosterValidationIssue[] = []
  const limit = league.taxiYearsLimit ?? null
  const allowNonRookies = league.taxiAllowNonRookies === true

  for (const row of sections.taxi) {
    const o = row as Record<string, unknown>
    const id = String(o.id ?? '').trim()
    if (!id) continue
    const y = readYearsExperience(o)
    const who = String(o.name ?? o.playerName ?? '').trim() || `Player ${id}`
    if (!allowNonRookies && y !== null && y > 0) {
      issues.push({
        code: 'taxi_non_rookie_disallowed',
        message: `${who} is not a rookie — taxi is rookie-only in this league.`,
        section: 'taxi',
        playerId: id,
      })
    }
    if (limit != null && limit > 0 && y !== null && y > limit) {
      issues.push({
        code: 'taxi_too_experienced',
        message: `${who} exceeds ${limit} taxi experience years for this league.`,
        section: 'taxi',
        playerId: id,
      })
    }
  }
  return issues
}

/** Taxi player ids in a stored or proposed roster payload. */
export function taxiPlayerIds(playerData: unknown): string[] {
  if (playerData == null) return []
  return getNormalizedLineupSections(playerData)
    .taxi.map((row) => String((row as Record<string, unknown>).id ?? '').trim())
    .filter(Boolean)
}

/**
 * The taxi rookie / years rules for players this save moves ONTO the taxi squad, judged on the
 * experience on file (`ctx.taxiYearsExpById`) because lineup rows carry none. Only new arrivals are
 * judged: a player already on the squad is grandfathered, so a league that tightens its rule, or a
 * roster carried in from an import, never blocks a manager's ordinary lineup save. A row that carries
 * its own `years_exp` is left to `validateTaxiSectionAgainstLeague`, so nothing is reported twice.
 */
export function validateNewTaxiPlayersByKnownExperience(
  ctx: Pick<LineupValidationContext, 'league' | 'previousPlayerData' | 'taxiYearsExpById'>,
  playerData: unknown,
): RosterValidationIssue[] {
  const known = ctx.taxiYearsExpById
  if (!known || known.size === 0 || (ctx.league.taxiSlots ?? 0) <= 0) return []
  const already = new Set(taxiPlayerIds(ctx.previousPlayerData))
  const rows = getNormalizedLineupSections(playerData)
    .taxi.map((row) => row as Record<string, unknown>)
    .filter((o) => {
      const id = String(o.id ?? '').trim()
      return id && !already.has(id) && readYearsExperience(o) === null && known.has(id)
    })
    .map((o) => ({ id: String(o.id).trim(), name: o.name ?? o.playerName, years_exp: known.get(String(o.id).trim())! }))
  if (rows.length === 0) return []
  return validateTaxiSectionAgainstLeague(ctx.league, { lineup_sections: { taxi: rows } })
}

/** Devy slots: flag when row explicitly marks player as no longer devy-eligible. */
export function validateDevySectionAgainstLeague(
  _league: LineupValidationContext['league'],
  playerData: unknown,
): RosterValidationIssue[] {
  const sections = getNormalizedLineupSections(playerData)
  const issues: RosterValidationIssue[] = []
  for (const row of sections.devy) {
    const o = row as Record<string, unknown>
    const id = String(o.id ?? '').trim()
    if (!id) continue
    const eligible = o.devyEligible ?? o.devy_eligible ?? o.is_devy
    if (eligible === false) {
      issues.push({
        code: 'devy_ineligible',
        message: `Player ${id} is marked as not devy-eligible — move off devy slots.`,
        section: 'devy',
        playerId: id,
      })
    }
  }
  return issues
}

export function validateIrSectionAgainstLeague(
  league: LineupValidationContext['league'],
  playerData: unknown,
): RosterValidationIssue[] {
  const sections = getNormalizedLineupSections(playerData)
  const issues: RosterValidationIssue[] = []
  for (const row of sections.ir) {
    const o = row as Record<string, unknown>
    const id = String(o.id ?? '')
    const st = playerStatusUpper(o)
    if (!isIrEligibleStatus(league, st)) {
      issues.push({
        code: 'ir_ineligible_status',
        message: `Player ${id} is not eligible for IR with current injury/status rules.`,
        section: 'ir',
        playerId: id,
      })
    }
  }
  return issues
}

export function validateLifecycleAllowsLineup(lifecycle: string): RosterValidationIssue[] {
  const v = String(lifecycle)
  if (v === 'archived' || v === 'completed') {
    return [
      {
        code: 'lifecycle_locked',
        message: 'League is no longer active; lineup changes are disabled.',
      },
    ]
  }
  return []
}

export function validateRosterPlayerDataAgainstTemplate(
  playerData: unknown,
  template: RosterTemplateDto,
): string | null {
  const list = collectTemplateSectionIssues(playerData, template)
  return list.length ? list.map((i) => i.message).join(' ') : null
}

/**
 * Full validation pipeline for persisted `Roster.playerData` shape.
 */
export function validateCanonicalRosterPayload(
  playerData: unknown,
  ctx: LineupValidationContext,
): RosterValidationResult {
  const issues: RosterValidationIssue[] = []

  issues.push(...validateLifecycleAllowsLineup(String(ctx.league.lifecycleState)))
  if (ctx.league.lockAllMoves) {
    issues.push({ code: 'league_lock_all', message: 'Commissioner has locked all roster moves for this league.' })
  }

  const concept = resolveConceptRosterLineupRules(ctx.league.settings)
  if (!concept.allowLineupEdits) {
    issues.push({
      code: 'concept_lineup_frozen',
      message: 'Lineup edits are disabled for this league phase or concept.',
    })
  }
  if (!concept.allowIrMoves) {
    const sections = getNormalizedLineupSections(playerData)
    if (sections.ir.length > 0) {
      issues.push({
        code: 'concept_ir_blocked',
        message: 'IR moves are not allowed under current specialty rules.',
      })
    }
  }
  if (!concept.allowDevySlots) {
    const sections = getNormalizedLineupSections(playerData)
    if (sections.devy.length > 0) {
      issues.push({
        code: 'concept_devy_blocked',
        message: 'Devy slots are not enabled for this concept.',
      })
    }
  }

  for (const ti of collectTemplateSectionIssues(playerData, ctx.template)) {
    const code =
      ti.code === 'SECTION_OVERFLOW'
        ? 'section_overflow'
        : ti.code === 'STARTER_POSITION_INELIGIBLE'
          ? 'starter_position_ineligible'
          : ti.code === 'ROSTER_TOTAL_OVER_LIMIT'
            ? 'roster_total_over_limit'
            : ti.code.toLowerCase()
    issues.push({ code, message: ti.message, section: ti.section, playerId: ti.playerId })
  }

  issues.push(...collectDuplicatePlayerIssues(playerData))
  issues.push(...validateIrSectionAgainstLeague(ctx.league, playerData))

  const sections = getNormalizedLineupSections(playerData)
  if (ctx.starterSlots) {
    issues.push(
      ...collectStarterSlotIssues({
        starters: sections.starters,
        slots: ctx.starterSlots,
        previousStarters: ctx.previousPlayerData === undefined ? undefined : getNormalizedLineupSections(ctx.previousPlayerData).starters,
        eligible: (slot, position) => playerEligibleForSlot(slot, position),
      }),
    )
  }
  if ((ctx.league.taxiSlots ?? 0) <= 0 && sections.taxi.length > 0) {
    issues.push({
      code: 'taxi_disabled',
      message: 'Taxi squad is not enabled for this league.',
      section: 'taxi',
    })
  }

  issues.push(...validateTaxiSectionAgainstLeague(ctx.league, playerData))
  issues.push(...validateNewTaxiPlayersByKnownExperience(ctx, playerData))
  issues.push(...validateDevySectionAgainstLeague(ctx.league, playerData))

  return {
    ok: issues.length === 0,
    issues,
  }
}
