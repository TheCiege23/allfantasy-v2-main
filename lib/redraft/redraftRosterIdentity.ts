import { prisma } from '@/lib/prisma'

type MinimalSeason = {
  id: string
  leagueId: string
}

type MinimalGenericRoster = {
  id: string
  leagueId: string
  platformUserId: string
}

type MinimalLeagueTeam = {
  id: string
  leagueId: string
  externalId: string
  ownerName: string
  teamName: string
  avatarUrl: string | null
  claimedByUserId: string | null
  platformUserId: string | null
}

type MinimalRedraftRoster = {
  id: string
  seasonId: string
  leagueId: string
  ownerId: string
  ownerName: string
  teamName: string | null
  avatarUrl: string | null
}

export type RedraftRosterLookupResult = {
  season: MinimalSeason | null
  roster: MinimalRedraftRoster | null
  resolvedBy: string | null
  repairedOwnerId: string | null
  ownerIdCandidates: string[]
  requestedOwnerIdCandidates: string[]
  requestedRosterId: string | null
  inferredLeagueId: string | null
}

function trimmed(value: string | null | undefined): string | null {
  const v = String(value ?? '').trim()
  return v || null
}

function uniqueNonEmpty(values: Array<string | null | undefined>): string[] {
  const out: string[] = []
  for (const value of values) {
    const next = trimmed(value)
    if (!next || out.includes(next)) continue
    out.push(next)
  }
  return out
}

function genericRosterIdFromOwnerId(value: string | null | undefined): string | null {
  const ownerId = trimmed(value)
  if (!ownerId) return null
  return ownerId.startsWith('roster:') ? ownerId.slice('roster:'.length).trim() || null : null
}

function preferredOwnerIdFromMappings(args: {
  claimedByUserId?: string | null
  teamPlatformUserId?: string | null
  genericRosterPlatformUserId?: string | null
  genericRosterId?: string | null
}): string {
  return (
    trimmed(args.claimedByUserId) ??
    trimmed(args.teamPlatformUserId) ??
    trimmed(args.genericRosterPlatformUserId) ??
    (trimmed(args.genericRosterId) ? `roster:${trimmed(args.genericRosterId)}` : '')
  )
}

export function buildRedraftOwnerIdCandidates(args: {
  preferredOwnerId?: string | null
  appUserId?: string | null
  claimedByUserId?: string | null
  teamPlatformUserId?: string | null
  genericRosterPlatformUserId?: string | null
  genericRosterId?: string | null
}): string[] {
  const fallbackOwnerId = args.genericRosterId ? `roster:${args.genericRosterId}` : null
  return uniqueNonEmpty([
    args.preferredOwnerId,
    args.appUserId,
    args.claimedByUserId,
    args.teamPlatformUserId,
    args.genericRosterPlatformUserId,
    fallbackOwnerId,
  ])
}

async function findSeasonByLeagueId(leagueId: string | null): Promise<MinimalSeason | null> {
  if (!leagueId) return null
  return prisma.redraftSeason.findFirst({
    where: { leagueId },
    orderBy: { createdAt: 'desc' },
    select: { id: true, leagueId: true },
  })
}

async function findGenericRosterByOpaqueRef(opaqueRosterId: string | null): Promise<MinimalGenericRoster | null> {
  if (!opaqueRosterId) return null
  const id = genericRosterIdFromOwnerId(opaqueRosterId) ?? opaqueRosterId
  return prisma.roster.findFirst({
    where: { id },
    select: {
      id: true,
      leagueId: true,
      platformUserId: true,
    },
  })
}

async function findLeagueTeamByOpaqueRef(args: {
  opaqueRosterId: string | null
  leagueId?: string | null
}): Promise<MinimalLeagueTeam | null> {
  const opaqueRosterId = trimmed(args.opaqueRosterId)
  if (!opaqueRosterId) return null

  const select = {
    id: true,
    leagueId: true,
    externalId: true,
    ownerName: true,
    teamName: true,
    avatarUrl: true,
    claimedByUserId: true,
    platformUserId: true,
  } as const

  const byId = await prisma.leagueTeam.findFirst({
    where: { id: opaqueRosterId },
    select,
  })
  if (byId) return byId

  const leagueId = trimmed(args.leagueId)
  if (!leagueId) return null

  return prisma.leagueTeam.findFirst({
    where: {
      leagueId,
      externalId: opaqueRosterId,
    },
    select,
  })
}

async function maybeRepairRedraftRosterOwner(args: {
  roster: MinimalRedraftRoster
  seasonId: string
  team?: MinimalLeagueTeam | null
  genericRoster?: MinimalGenericRoster | null
}): Promise<{ roster: MinimalRedraftRoster; repairedOwnerId: string | null }> {
  const preferredOwnerId = preferredOwnerIdFromMappings({
    claimedByUserId: args.team?.claimedByUserId,
    teamPlatformUserId: args.team?.platformUserId,
    genericRosterPlatformUserId: args.genericRoster?.platformUserId,
    genericRosterId: args.genericRoster?.id ?? genericRosterIdFromOwnerId(args.roster.ownerId),
  })

  const currentOwnerId = trimmed(args.roster.ownerId)
  if (!preferredOwnerId || !currentOwnerId || preferredOwnerId === currentOwnerId) {
    return { roster: args.roster, repairedOwnerId: null }
  }

  const safeToRepair =
    currentOwnerId.startsWith('roster:') ||
    currentOwnerId === trimmed(args.team?.platformUserId) ||
    currentOwnerId === trimmed(args.genericRoster?.platformUserId)

  if (!safeToRepair) {
    return { roster: args.roster, repairedOwnerId: null }
  }

  const conflict = await prisma.redraftRoster.findFirst({
    where: {
      seasonId: args.seasonId,
      ownerId: preferredOwnerId,
      NOT: { id: args.roster.id },
    },
    select: { id: true },
  })
  if (conflict) {
    return { roster: args.roster, repairedOwnerId: null }
  }

  const updated = await prisma.redraftRoster.update({
    where: { id: args.roster.id },
    data: {
      ownerId: preferredOwnerId,
      ...(args.team
        ? {
            ownerName: args.team.ownerName,
            teamName: args.team.teamName,
            avatarUrl: args.team.avatarUrl ?? null,
          }
        : {}),
    },
    select: {
      id: true,
      seasonId: true,
      leagueId: true,
      ownerId: true,
      ownerName: true,
      teamName: true,
      avatarUrl: true,
    },
  })

  return {
    roster: updated,
    repairedOwnerId: preferredOwnerId,
  }
}

export type RedraftRosterLookupArgs = {
  userId: string
  requestedRosterId?: string | null
  seasonId?: string | null
  leagueId?: string | null
}

/**
 * Internal: the owner-repair the write-capable resolver would apply to the resolved roster, captured
 * by the read-only core so the write wrapper can act on it WITHOUT the core itself ever writing.
 * Null when there is no resolved roster to repair.
 */
type RedraftRosterRepairContext = {
  roster: MinimalRedraftRoster
  seasonId: string
  team: MinimalLeagueTeam | null
  genericRoster: MinimalGenericRoster | null
  /** `resolvedBy` to use IF (and only if) a repair actually writes. Undefined = keep base resolvedBy. */
  resolvedByOnRepair?: string
}

/**
 * Pure read-only resolution core. Performs ONLY lookups (no writes, no owner repair, no mutation) and
 * returns the resolved `RedraftRosterLookupResult` (with `repairedOwnerId: null`) alongside the
 * repair context the write-capable wrapper may later act on. Shared by both public entry points so the
 * read-only and write-capable paths resolve identity identically.
 */
async function resolveRedraftRosterLookupCore(args: RedraftRosterLookupArgs): Promise<{
  result: RedraftRosterLookupResult
  repairContext: RedraftRosterRepairContext | null
}> {
  const requestedRosterId = trimmed(args.requestedRosterId)
  const explicitSeasonId = trimmed(args.seasonId)
  const explicitLeagueId = trimmed(args.leagueId)

  let season: MinimalSeason | null = explicitSeasonId
    ? await prisma.redraftSeason.findFirst({
        where: { id: explicitSeasonId },
        select: { id: true, leagueId: true },
      })
    : null

  const exactRedraftRoster = requestedRosterId
    ? await prisma.redraftRoster.findFirst({
        where: { id: requestedRosterId },
        select: {
          id: true,
          seasonId: true,
          leagueId: true,
          ownerId: true,
          ownerName: true,
          teamName: true,
          avatarUrl: true,
        },
      })
    : null

  if (!season && exactRedraftRoster) {
    season = { id: exactRedraftRoster.seasonId, leagueId: exactRedraftRoster.leagueId }
  }

  const requestedGenericRoster = await findGenericRosterByOpaqueRef(requestedRosterId)
  let inferredLeagueId =
    explicitLeagueId ??
    season?.leagueId ??
    exactRedraftRoster?.leagueId ??
    requestedGenericRoster?.leagueId ??
    null

  const requestedTeam = await findLeagueTeamByOpaqueRef({
    opaqueRosterId: requestedRosterId,
    leagueId: inferredLeagueId,
  })

  inferredLeagueId =
    explicitLeagueId ??
    season?.leagueId ??
    exactRedraftRoster?.leagueId ??
    requestedGenericRoster?.leagueId ??
    requestedTeam?.leagueId ??
    null

  if (!season) {
    season = await findSeasonByLeagueId(inferredLeagueId)
  }

  inferredLeagueId = explicitLeagueId ?? season?.leagueId ?? inferredLeagueId

  if (exactRedraftRoster && (!season || exactRedraftRoster.seasonId === season.id)) {
    return {
      result: {
        season: season ?? { id: exactRedraftRoster.seasonId, leagueId: exactRedraftRoster.leagueId },
        roster: exactRedraftRoster,
        resolvedBy: 'requested_redraft_roster_id',
        repairedOwnerId: null,
        ownerIdCandidates: [],
        requestedOwnerIdCandidates: [],
        requestedRosterId,
        inferredLeagueId,
      },
      repairContext: {
        roster: exactRedraftRoster,
        seasonId: exactRedraftRoster.seasonId,
        team: requestedTeam,
        genericRoster: requestedGenericRoster,
      },
    }
  }

  if (!season) {
    return {
      result: {
        season: null,
        roster: null,
        resolvedBy: null,
        repairedOwnerId: null,
        ownerIdCandidates: [],
        requestedOwnerIdCandidates: [],
        requestedRosterId,
        inferredLeagueId,
      },
      repairContext: null,
    }
  }

  const requestedOwnerIdCandidates = buildRedraftOwnerIdCandidates({
    claimedByUserId: requestedTeam?.claimedByUserId,
    teamPlatformUserId: requestedTeam?.platformUserId,
    genericRosterPlatformUserId: requestedGenericRoster?.platformUserId,
    genericRosterId: requestedGenericRoster?.id ?? genericRosterIdFromOwnerId(requestedRosterId),
  })

  if (requestedOwnerIdCandidates.length > 0) {
    const requestedMappedRoster = await prisma.redraftRoster.findFirst({
      where: {
        seasonId: season.id,
        ownerId: { in: requestedOwnerIdCandidates },
      },
      select: {
        id: true,
        seasonId: true,
        leagueId: true,
        ownerId: true,
        ownerName: true,
        teamName: true,
        avatarUrl: true,
      },
    })

    if (requestedMappedRoster) {
      return {
        result: {
          season,
          roster: requestedMappedRoster,
          resolvedBy: 'requested_identity_map',
          repairedOwnerId: null,
          ownerIdCandidates: [],
          requestedOwnerIdCandidates,
          requestedRosterId,
          inferredLeagueId,
        },
        repairContext: {
          roster: requestedMappedRoster,
          seasonId: season.id,
          team: requestedTeam,
          genericRoster: requestedGenericRoster,
        },
      }
    }
  }

  const viewerTeam = await prisma.leagueTeam.findFirst({
    where: {
      leagueId: season.leagueId,
      OR: [{ claimedByUserId: args.userId }, { platformUserId: args.userId }],
    },
    select: {
      id: true,
      leagueId: true,
      externalId: true,
      ownerName: true,
      teamName: true,
      avatarUrl: true,
      claimedByUserId: true,
      platformUserId: true,
    },
  })

  const viewerPlatformIds = uniqueNonEmpty([args.userId, viewerTeam?.platformUserId])
  const viewerGenericRoster =
    viewerPlatformIds.length > 0
      ? await prisma.roster.findFirst({
          where: {
            leagueId: season.leagueId,
            platformUserId: { in: viewerPlatformIds },
          },
          select: {
            id: true,
            leagueId: true,
            platformUserId: true,
          },
        })
      : null

  const ownerIdCandidates = buildRedraftOwnerIdCandidates({
    preferredOwnerId: args.userId,
    appUserId: args.userId,
    claimedByUserId: viewerTeam?.claimedByUserId,
    teamPlatformUserId: viewerTeam?.platformUserId,
    genericRosterPlatformUserId: viewerGenericRoster?.platformUserId,
    genericRosterId: viewerGenericRoster?.id,
  })

  if (ownerIdCandidates.length === 0) {
    return {
      result: {
        season,
        roster: null,
        resolvedBy: null,
        repairedOwnerId: null,
        ownerIdCandidates,
        requestedOwnerIdCandidates,
        requestedRosterId,
        inferredLeagueId,
      },
      repairContext: null,
    }
  }

  const viewerRoster = await prisma.redraftRoster.findFirst({
    where: {
      seasonId: season.id,
      ownerId: { in: ownerIdCandidates },
    },
    select: {
      id: true,
      seasonId: true,
      leagueId: true,
      ownerId: true,
      ownerName: true,
      teamName: true,
      avatarUrl: true,
    },
  })

  if (!viewerRoster) {
    return {
      result: {
        season,
        roster: null,
        resolvedBy: null,
        repairedOwnerId: null,
        ownerIdCandidates,
        requestedOwnerIdCandidates,
        requestedRosterId,
        inferredLeagueId,
      },
      repairContext: null,
    }
  }

  return {
    result: {
      season,
      roster: viewerRoster,
      resolvedBy: 'viewer_owner_candidates',
      repairedOwnerId: null,
      ownerIdCandidates,
      requestedOwnerIdCandidates,
      requestedRosterId,
      inferredLeagueId,
    },
    repairContext: {
      roster: viewerRoster,
      seasonId: season.id,
      team: viewerTeam,
      genericRoster: viewerGenericRoster,
      resolvedByOnRepair: 'viewer_owner_repaired',
    },
  }
}

/**
 * READ-ONLY identity/roster resolver. Performs lookups ONLY — never writes, never repairs an owner,
 * never mutates, syncs, or backfills. Returns the resolved roster exactly as stored (`repairedOwnerId`
 * is always null). This is the seam Decision OS / Canonical World bridge work must call; it cannot
 * violate the shadow read-only invariant. See {@link resolveRedraftRosterLookup} for the legacy
 * write-capable variant.
 */
export async function resolveRedraftRosterLookupReadOnly(
  args: RedraftRosterLookupArgs,
): Promise<RedraftRosterLookupResult> {
  const { result } = await resolveRedraftRosterLookupCore(args)
  return result
}

/**
 * WRITE-CAPABLE legacy resolver. Resolves identity via the read-only core, then applies the existing
 * owner-repair side effect (`prisma.redraftRoster.update` via {@link maybeRepairRedraftRosterOwner})
 * to preserve current production behavior for the legacy routes that depend on it (keeper/context,
 * redraft/roster). Decision OS bridge code MUST NOT call this — use
 * {@link resolveRedraftRosterLookupReadOnly} instead.
 */
export async function resolveRedraftRosterLookup(
  args: RedraftRosterLookupArgs,
): Promise<RedraftRosterLookupResult> {
  const { result, repairContext } = await resolveRedraftRosterLookupCore(args)
  if (!repairContext) return result

  const repaired = await maybeRepairRedraftRosterOwner({
    roster: repairContext.roster,
    seasonId: repairContext.seasonId,
    team: repairContext.team,
    genericRoster: repairContext.genericRoster,
  })

  return {
    ...result,
    roster: repaired.roster,
    repairedOwnerId: repaired.repairedOwnerId,
    resolvedBy:
      repaired.repairedOwnerId && repairContext.resolvedByOnRepair
        ? repairContext.resolvedByOnRepair
        : result.resolvedBy,
  }
}
