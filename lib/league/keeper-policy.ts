import type { LeagueSport } from '@prisma/client'
import { normalizeToSupportedSport } from '@/lib/sport-scope'

export type KeeperWindow = {
  declarationDeadlineDaysBeforeDraft: number
  maxKeepers: number
  roundCostMode: 'previous_round' | 'fixed_round' | 'salary_value'
  requiresCommissionerApproval: boolean
}

export type KeeperRecommendation = KeeperWindow & {
  sport: LeagueSport
  leagueType: string
  carryoverSupported: boolean
}

export function resolveKeeperPolicy(options: {
  sport: LeagueSport | string
  leagueType?: string | null
  draftType?: string | null
}): KeeperRecommendation {
  const sport = normalizeToSupportedSport(options.sport)
  const leagueType = String(options.leagueType ?? 'redraft').toLowerCase()
  const draftType = String(options.draftType ?? 'snake').toLowerCase()
  const isKeeper = leagueType === 'keeper'
  const isDynasty = leagueType === 'dynasty' || leagueType === 'devy' || leagueType === 'c2c'

  const maxKeepers = isDynasty
    ? 999
    : isKeeper
      ? sport === 'MLB' || sport === 'NHL'
        ? 8
        : 4
      : 0

  return {
    sport,
    leagueType,
    carryoverSupported: isKeeper || isDynasty,
    declarationDeadlineDaysBeforeDraft: draftType === 'slow_draft' ? 7 : 2,
    maxKeepers,
    roundCostMode: draftType === 'auction' ? 'salary_value' : isDynasty ? 'fixed_round' : 'previous_round',
    requiresCommissionerApproval: !isDynasty,
  }
}

export function supportsKeeperDeclarations(leagueType?: string | null): boolean {
  const key = String(leagueType ?? '').toLowerCase()
  return key === 'keeper' || key === 'dynasty' || key === 'devy' || key === 'c2c'
}

/**
 * A league that trades only its current draft's picks. Everything dynasty-family (which keeps a
 * rookie draft and a future inventory), salary-cap, and anything with keeper declarations is not.
 * Also what decides whether last season may shape next season's draft order
 * (lib/playoff-runtime/consolationPlaysFor.ts): a redraft league starts fresh.
 */
export function isRedraftPickLeague(league: { leagueType?: string | null; isDynasty?: boolean | null }): boolean {
  if (league.isDynasty === true) return false
  const type = String(league.leagueType ?? '').trim().toLowerCase()
  if (supportsKeeperDeclarations(type)) return false
  // Compound spellings (`c2c_dynasty`, `devy_dynasty`, `salary_cap`) carry multi-season picks too —
  // the same substring reading the trade-settings resolver uses for its C2C and devy gates.
  return !/dynasty|devy|c2c|keeper|salary/.test(type)
}

/**
 * Commissioner settings: show `/api/keeper/session` progress (KeeperCommissionerDashboard) for any
 * format that uses keeper selection phases — not only `leagueType === 'keeper'`.
 * Honors legacy rows where `isDynasty` is set but `leagueType` was left as redraft.
 */
export function showKeeperSelectionInCommissionerSettings(options: {
  leagueType?: string | null
  isDynasty?: boolean | null
}): boolean {
  if (supportsKeeperDeclarations(options.leagueType)) return true
  return options.isDynasty === true
}

/** Short heading for the keeper-session strip in commissioner settings (sport-agnostic). */
export function commissionerKeeperSectionHeading(options: {
  leagueType?: string | null
  isDynasty?: boolean | null
}): string {
  const key = String(options.leagueType ?? '').toLowerCase()
  if (key === 'keeper') return 'Keeper selection'
  if (key === 'dynasty') return 'Dynasty carryover'
  if (key === 'devy') return 'Devy keeper selection'
  if (key === 'c2c') return 'Campus-to-Campus carryover'
  if (options.isDynasty === true) return 'Dynasty carryover'
  return 'Keeper & carryover'
}
