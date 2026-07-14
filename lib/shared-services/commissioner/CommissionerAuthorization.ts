/**
 * Commissioner Authorization — Phase 10.
 *
 * Thin wrapper around the ONE real, established authorization helper found
 * during the audit: lib/league/permissions.ts's getLeagueRole()/
 * requireCommissionerRole()/requireCommissionerOnly(). NOT a second
 * authorization framework — every function here delegates directly.
 *
 * A real, documented gap (confirmed during the audit, not solved here):
 * for imported leagues (Sleeper/ESPN/Yahoo/MFL/Fantrax/Fleaflicker),
 * `League.userId` is set to whichever AllFantasy user performed the import
 * (lib/league-import/commissionerGate.ts's assertImportCommissioner only
 * checks league MEMBERSHIP on the source platform, never actual
 * commissioner/owner status there). Self-attestation is recorded
 * (recordImportAttestation) but not enforced. This means "commissioner" as
 * resolved by getLeagueRole() is trustworthy for native AllFantasy leagues
 * and for co-commissioners (a real, first-class AF-only concept via
 * LeagueTeam.isCoCommissioner), but for an imported league it reflects "who
 * imported it," which may or may not be the real source-platform
 * commissioner. Every consumer of this module must treat that as an honest
 * limitation, not a solved problem.
 */

import { getLeagueRole, requireCommissionerRole, requireCommissionerOnly, type LeagueRole } from '@/lib/league/permissions'

export type { LeagueRole }

export interface CommissionerAccessCheck {
  role: LeagueRole
  isCommissioner: boolean
  isCoCommissioner: boolean
  isMember: boolean
  /** True only for native AllFantasy leagues — imported-league commissioner identity is self-attested, not verified against the source platform (see module docstring). */
  commissionerIdentityVerified: boolean
}

export async function resolveCommissionerAccess(leagueId: string, userId: string, platform: string): Promise<CommissionerAccessCheck> {
  const role = await getLeagueRole(leagueId, userId)
  return {
    role,
    isCommissioner: role === 'commissioner',
    isCoCommissioner: role === 'co_commissioner',
    isMember: role != null,
    commissionerIdentityVerified: (role === 'commissioner' || role === 'co_commissioner') && platform === 'native',
  }
}

/** Delegates directly to requireCommissionerRole — throws for anyone who isn't commissioner or co-commissioner. */
export async function requireCommissionerOrCoCommissioner(leagueId: string, userId: string): Promise<void> {
  await requireCommissionerRole(leagueId, userId)
}

/** Delegates directly to requireCommissionerOnly — throws for anyone but the head commissioner. */
export async function requireHeadCommissionerOnly(leagueId: string, userId: string): Promise<void> {
  await requireCommissionerOnly(leagueId, userId)
}
