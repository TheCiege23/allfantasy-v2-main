import { prisma } from '@/lib/prisma'

export type TournamentStaffPermissions = {
  dashboard?: boolean
  manageLeagues?: boolean
  manageDrafts?: boolean
  manageChat?: boolean
  manageSettings?: boolean
  /** Grants all of the above */
  fullAdmin?: boolean
}

type LegacyTournamentAccess = {
  isCreator: boolean
  staff: { permissions: TournamentStaffPermissions } | null
}

function hasPerm(p: TournamentStaffPermissions, key: keyof TournamentStaffPermissions): boolean {
  if (p.fullAdmin) return true
  return p[key] === true
}

export function canViewCommissionerDashboard(access: LegacyTournamentAccess): boolean {
  if (access.isCreator) return true
  if (!access.staff) return false
  return hasPerm(access.staff.permissions, 'dashboard') || hasPerm(access.staff.permissions, 'fullAdmin')
}

export function canUseControlConsole(access: LegacyTournamentAccess): boolean {
  if (access.isCreator) return true
  if (!access.staff) return false
  return (
    hasPerm(access.staff.permissions, 'manageLeagues') ||
    hasPerm(access.staff.permissions, 'manageDrafts') ||
    hasPerm(access.staff.permissions, 'fullAdmin')
  )
}

export function canEditHubSettings(access: LegacyTournamentAccess): boolean {
  if (access.isCreator) return true
  if (!access.staff) return false
  return hasPerm(access.staff.permissions, 'manageSettings') || hasPerm(access.staff.permissions, 'fullAdmin')
}

export function canManageStaff(access: LegacyTournamentAccess): boolean {
  return access.isCreator
}

/**
 * Whether the user may read legacy tournament standings via `/api/tournament/standings`.
 * - `public` hub: anyone (including anonymous).
 * - `unlisted`: any signed-in user (link-style access).
 * - `private`: creator, tournament staff with dashboard access, or registered participant only.
 */
export async function canViewLegacyTournamentStandings(
  t: { id: string; creatorId: string; settings: unknown; hubSettings: unknown },
  userId: string | null,
): Promise<boolean> {
  const settings = (t.settings as Record<string, unknown>) ?? {}
  const hub = (t.hubSettings as Record<string, unknown>) ?? {}
  const visibility =
    typeof hub.visibility === 'string'
      ? hub.visibility
      : typeof settings.universalPageVisibility === 'string'
        ? settings.universalPageVisibility
        : 'unlisted'

  if (visibility === 'public') return true
  if (!userId) return false
  if (t.creatorId === userId) return true

  const access = await getLegacyTournamentAccess(userId, t.id)
  if (canViewCommissionerDashboard(access)) return true

  const participant = await prisma.legacyTournamentParticipant.findUnique({
    where: { tournamentId_userId: { tournamentId: t.id, userId } },
    select: { id: true },
  })
  if (participant) return true

  if (visibility === 'unlisted') return true

  return false
}

/**
 * Resolve creator vs staff row for a legacy tournament.
 */
export async function getLegacyTournamentAccess(
  userId: string | null | undefined,
  tournamentId: string,
): Promise<LegacyTournamentAccess> {
  if (!userId) return { isCreator: false, staff: null }
  const t = await prisma.legacyTournament.findUnique({
    where: { id: tournamentId },
    select: { creatorId: true },
  })
  if (!t) return { isCreator: false, staff: null }
  if (t.creatorId === userId) return { isCreator: true, staff: null }

  const row = await prisma.legacyTournamentStaff.findUnique({
    where: { tournamentId_userId: { tournamentId, userId } },
    select: { permissions: true },
  })
  if (!row) return { isCreator: false, staff: null }
  const permissions =
    typeof row.permissions === 'object' && row.permissions !== null && !Array.isArray(row.permissions)
      ? (row.permissions as TournamentStaffPermissions)
      : {}
  return { isCreator: false, staff: { permissions } }
}
