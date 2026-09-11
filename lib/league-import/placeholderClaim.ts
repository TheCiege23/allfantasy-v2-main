/**
 * Generic placeholder-roster claim for any imported league.
 *
 * Imports create Roster rows whose platformUserId is either a raw source
 * manager id (e.g. Sleeper's numeric user id) or a sentinel ("import:...").
 * Neither maps to an AF AppUser.id, so they serve as placeholders waiting
 * for the real manager to accept the invite.
 *
 * On join, we match the joining user to the best placeholder by:
 *   1. platformUserId === source_manager_id already stored on another field
 *   2. Normalized display name / team name / Sleeper username / email local-part
 *
 * On match, we transfer ownership in place — all pre-imported players,
 * LeagueTeam rows, and C2CPlayerState rows (when present) stay bound to
 * the same roster id.
 */

import type { Prisma } from '@prisma/client'

type Tx = Prisma.TransactionClient

function normalize(s: string | null | undefined): string {
  return (s ?? '').toLowerCase().replace(/[^a-z0-9]/g, '').trim()
}

export interface ClaimCandidate {
  appUserId: string
  displayName: string | null
  sleeperUsername: string | null
  email: string | null
  /** Raw source manager id if the joining user linked a provider account. */
  linkedSourceManagerId?: string | null
}

export interface PlaceholderClaimResult {
  claimed: boolean
  rosterId?: string
  matchedBy?: 'source_manager_id' | 'display_name' | 'team_name' | 'sleeper_username' | 'email_local' | 'native_open_slot'
}

interface RosterRow {
  id: string
  platformUserId: string
  playerData: Prisma.JsonValue
}

function rosterImportMeta(row: RosterRow): Record<string, unknown> | null {
  const data = row.playerData as Record<string, unknown> | null
  if (!data) return null
  const meta = data.import
  return meta && typeof meta === 'object' && !Array.isArray(meta)
    ? (meta as Record<string, unknown>)
    : null
}

function rosterFoundationMeta(row: RosterRow): Record<string, unknown> | null {
  const data = row.playerData as Record<string, unknown> | null
  if (!data || typeof data !== 'object' || Array.isArray(data)) return null
  const meta = data.foundation
  return meta && typeof meta === 'object' && !Array.isArray(meta)
    ? (meta as Record<string, unknown>)
    : null
}

function isNativeOpenRoster(row: RosterRow): boolean {
  return rosterFoundationMeta(row)?.openTeam === true
}

function foundationSlotNumber(row: RosterRow): number | null {
  const raw = rosterFoundationMeta(row)?.slotNumber
  const n = Number(raw)
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : null
}

function claimDisplayName(candidate: ClaimCandidate): string {
  const explicit = candidate.displayName?.trim() || candidate.sleeperUsername?.trim()
  if (explicit) return explicit
  const emailLocal = candidate.email?.split('@')[0]?.trim()
  return emailLocal || 'Manager'
}

function sourceManagerIdFromPlatformField(platformUserId: string): string | null {
  if (platformUserId.startsWith('import:')) {
    // "import:<provider>:<teamId>" — teamId is stable; prefer matching on
    // source_manager_id via playerData.import.sourceManagerId instead.
    return null
  }
  return platformUserId
}

/**
 * Find and claim the best-matching placeholder roster for this user. Caller
 * runs this inside the join transaction BEFORE creating a fresh roster.
 */
export async function claimPlaceholderRoster(args: {
  tx: Tx
  leagueId: string
  candidate: ClaimCandidate
}): Promise<PlaceholderClaimResult> {
  const { tx, leagueId, candidate } = args

  // Pull all candidate placeholders in one query: platformUserId is not a
  // real AppUser.id (we check that by attempting to resolve). Heuristic:
  // any platformUserId that doesn't exist in AppUser is a placeholder.
  const allRosters = await tx.roster.findMany({
    where: { leagueId },
    select: { id: true, platformUserId: true, playerData: true },
  })
  if (allRosters.length === 0) return { claimed: false }

  // Check which platformUserIds map to real AppUsers — those are already
  // claimed by someone. Remaining ones are placeholders.
  const platformIds = allRosters.map((r) => r.platformUserId)
  const realUsers = await tx.appUser.findMany({
    where: { id: { in: platformIds } },
    select: { id: true },
  })
  const realUserIds = new Set(realUsers.map((u) => u.id))
  const placeholders = allRosters.filter((r) => !realUserIds.has(r.platformUserId))
  if (placeholders.length === 0) return { claimed: false }

  // 1. Direct source_manager_id match — strongest signal.
  if (candidate.linkedSourceManagerId) {
    const smId = candidate.linkedSourceManagerId
    const bySourceId = placeholders.find(
      (r) =>
        r.platformUserId === smId ||
        (rosterImportMeta(r)?.sourceManagerId as string | undefined) === smId,
    )
    if (bySourceId) {
      await tx.roster.update({
        where: { id: bySourceId.id },
        data: { platformUserId: candidate.appUserId },
      })
      await applyCommissionerRoleFromSource(tx, leagueId, bySourceId.id, rosterImportMeta(bySourceId))
      return { claimed: true, rosterId: bySourceId.id, matchedBy: 'source_manager_id' }
    }
  }

  // Build candidate match keys, all normalized.
  const keys = {
    displayName: normalize(candidate.displayName),
    sleeperUsername: normalize(candidate.sleeperUsername),
    emailLocal: normalize(candidate.email?.split('@')[0] ?? null),
  }

  // Also check LeagueTeam for owner/team/avatar metadata tied to each roster.
  const leagueTeams = await tx.leagueTeam.findMany({
    where: { leagueId, externalId: { in: placeholders.map((r) => r.id) } },
    select: { externalId: true, ownerName: true, teamName: true },
  })
  const teamByRoster = new Map(leagueTeams.map((t) => [t.externalId, t] as const))

  for (const [label, key] of Object.entries(keys) as [keyof typeof keys, string][]) {
    if (!key) continue
    const match = placeholders.find((roster) => {
      const meta = rosterImportMeta(roster)
      const metaName = normalize((meta?.displayName as string | undefined) ?? null)
      const metaOwner = normalize((meta?.ownerName as string | undefined) ?? null)
      const metaTeam = normalize((meta?.teamName as string | undefined) ?? null)
      const team = teamByRoster.get(roster.id)
      const teamOwner = normalize(team?.ownerName ?? null)
      const teamName = normalize(team?.teamName ?? null)
      return [metaName, metaOwner, metaTeam, teamOwner, teamName].some((v) => v.length > 0 && v === key)
    })
    if (match) {
      await tx.roster.update({
        where: { id: match.id },
        data: { platformUserId: candidate.appUserId },
      })
      await applyCommissionerRoleFromSource(tx, leagueId, match.id, rosterImportMeta(match))
      const matchedBy: PlaceholderClaimResult['matchedBy'] =
        label === 'displayName' ? 'display_name' : label === 'sleeperUsername' ? 'sleeper_username' : 'email_local'
      return { claimed: true, rosterId: match.id, matchedBy }
    }
  }

  const nativeOpenRoster = placeholders
    .filter(isNativeOpenRoster)
    .sort((a, b) => (foundationSlotNumber(a) ?? 9999) - (foundationSlotNumber(b) ?? 9999))[0]

  if (nativeOpenRoster) {
    const slotNumber = foundationSlotNumber(nativeOpenRoster)
    const displayName = claimDisplayName(candidate)
    const data = nativeOpenRoster.playerData as Record<string, unknown>
    const foundation = rosterFoundationMeta(nativeOpenRoster) ?? {}
    await tx.roster.update({
      where: { id: nativeOpenRoster.id },
      data: {
        platformUserId: candidate.appUserId,
        playerData: {
          ...data,
          foundation: {
            ...foundation,
            openTeam: false,
            claimedBy: candidate.appUserId,
            claimedAt: new Date().toISOString(),
          },
        } as Prisma.InputJsonValue,
        settings: {
          openSlot: false,
          aiManaged: false,
        },
      },
    })
    await tx.leagueTeam.updateMany({
      where: { leagueId, externalId: nativeOpenRoster.id },
      data: {
        ownerName: displayName,
        teamName: `${displayName}'s Team`,
        platformUserId: candidate.appUserId,
        claimedByUserId: candidate.appUserId,
        isOrphan: false,
        /* A placeholder seat adopted by a real person: still current, now human-run. */
        lifecycleState: 'CURRENT',
        managerKind: 'HUMAN',
      },
    })
    await tx.leagueEntrySlot.updateMany({
      where: { leagueId, rosterId: nativeOpenRoster.id },
      data: { status: 'FILLED' },
    })
    await tx.redraftLeagueMember
      .create({
        data: {
          leagueId,
          userId: candidate.appUserId,
          role: 'MEMBER',
          teamNumber: slotNumber,
        },
      })
      .catch(() => {})
    return { claimed: true, rosterId: nativeOpenRoster.id, matchedBy: 'native_open_slot' }
  }

  return { claimed: false }
}

/**
 * When a placeholder's source metadata marks the manager as a
 * commissioner in the source league, grant them co-commissioner on the
 * AF LeagueTeam so they retain moderator powers. The AF league retains
 * its primary commissioner (the importer).
 */
async function applyCommissionerRoleFromSource(
  tx: Tx,
  leagueId: string,
  rosterId: string,
  meta: Record<string, unknown> | null,
): Promise<void> {
  if (!meta) return
  const sourceIsCommissioner = meta.sourceIsCommissioner
  if (sourceIsCommissioner !== true) return
  await tx.leagueTeam
    .updateMany({
      where: { leagueId, externalId: rosterId },
      data: { isCoCommissioner: true },
    })
    .catch(() => {})
}
