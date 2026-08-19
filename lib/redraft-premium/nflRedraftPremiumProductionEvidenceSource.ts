import { prisma } from '@/lib/prisma'
import {
  buildPlayerIdentityEvidencePacket,
  buildSurfaceContextEvidencePacket,
  type NflRedraftEvidenceType,
  type NflRedraftProviderEvidencePacket,
} from '@/lib/player-data/nflRedraftProviderEvidencePackets'
import { normalizeNflRedraftProviderPlayerIdentity } from '@/lib/nfl-provider/nflRedraftPlayerIdentity'
import type { NflRedraftPremiumApiCanonicalIds } from '@/lib/redraft-premium/nflRedraftPremiumApiContracts'
import type { NflRedraftPremiumServiceId } from '@/lib/redraft-premium/nflRedraftPremiumServices'

type PrismaLike = typeof prisma

export type NflRedraftPremiumProductionEvidenceSourceInput = {
  serviceId: NflRedraftPremiumServiceId
  canonicalIds: NflRedraftPremiumApiCanonicalIds
  ingestedAtIso?: string | null
}

export type NflRedraftPremiumProductionEvidenceSourceDeps = {
  prismaClient?: PrismaLike
  now?: Date
}

type RedraftSeasonRow = {
  id: string
  leagueId: string
  sport: string
  season: number
  status: string
  totalWeeks: number
  playoffStartWeek: number
  currentWeek: number
  updatedAt?: Date | string | null
}

type RedraftRosterRow = {
  id: string
  seasonId: string
  leagueId: string
  ownerId: string
  ownerName: string
  teamName: string | null
  wins: number
  losses: number
  ties: number
  pointsFor: number
  pointsAgainst: number
  playoffSeed: number | null
  faabBalance: number | null
  waiverPriority: number
  players?: RedraftRosterPlayerRow[]
}

type RedraftRosterPlayerRow = {
  id: string
  rosterId: string
  playerId: string
  playerName: string
  position: string
  team: string | null
  slotType: string
  injuryStatus: string | null
  byeWeek: number | null
  addedAt?: Date | string | null
  droppedAt?: Date | string | null
}

type RedraftMatchupRow = {
  id: string
  seasonId: string
  leagueId: string
  week: number
  type: string
  homeRosterId: string
  awayRosterId: string | null
  homeScore: number
  awayScore: number
  homeProjected: number | null
  awayProjected: number | null
  status: string
}

function iso(value: Date | string | null | undefined): string | null {
  if (!value) return null
  if (value instanceof Date) return value.toISOString()
  const parsed = new Date(value)
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString()
}

function missingProductionPacket(input: {
  evidenceType: Extract<NflRedraftEvidenceType, 'roster_context' | 'matchup_context' | 'waiver_context' | 'trade_context' | 'draft_context'>
  canonicalIds: NflRedraftPremiumApiCanonicalIds
  ingestedAtIso?: string | null
  reason: string
}): NflRedraftProviderEvidencePacket {
  return buildSurfaceContextEvidencePacket({
    evidenceType: input.evidenceType,
    leagueId: input.canonicalIds.leagueId,
    teamId: input.canonicalIds.teamId,
    playerId: input.canonicalIds.playerId,
    matchupId: input.canonicalIds.matchupId,
    sourceProvider: 'allfantasy',
    ingestedAtIso: input.ingestedAtIso,
    freshness: { status: 'missing', updatedAtIso: null, stale: false, warnings: [input.reason] },
    fallback: { fallback: true, fields: [`missing:${input.evidenceType}`], labels: [input.reason] },
    canonicalFieldNamesIncluded: ['leagueId', 'reason'],
    facts: {
      leagueId: input.canonicalIds.leagueId,
      teamId: input.canonicalIds.teamId,
      playerId: input.canonicalIds.playerId,
      matchupId: input.canonicalIds.matchupId,
      week: input.canonicalIds.week,
      season: input.canonicalIds.season,
      reason: input.reason,
    },
  })
}

function requestedMissingType(serviceId: NflRedraftPremiumServiceId): Extract<NflRedraftEvidenceType, 'roster_context' | 'matchup_context' | 'waiver_context' | 'trade_context' | 'draft_context'> {
  if (serviceId === 'matchup_prep') return 'matchup_context'
  if (serviceId === 'waiver_report') return 'waiver_context'
  if (serviceId === 'trade_review') return 'trade_context'
  if (serviceId === 'draft_prep') return 'draft_context'
  return 'roster_context'
}

function rosterEvidence(roster: RedraftRosterRow, ingestedAtIso?: string | null): NflRedraftProviderEvidencePacket {
  const starters = roster.players?.filter((player) => player.slotType !== 'BENCH' && player.slotType !== 'IR') ?? []
  return buildSurfaceContextEvidencePacket({
    evidenceType: 'roster_context',
    leagueId: roster.leagueId,
    teamId: roster.id,
    sourceProvider: 'allfantasy',
    ingestedAtIso,
    canonicalFieldNamesIncluded: [
      'rosterId',
      'ownerId',
      'teamName',
      'record',
      'pointsFor',
      'faabBalance',
      'waiverPriority',
      'playerCount',
      'starterCount',
    ],
    facts: {
      rosterId: roster.id,
      ownerId: roster.ownerId,
      teamName: roster.teamName,
      ownerName: roster.ownerName,
      record: { wins: roster.wins, losses: roster.losses, ties: roster.ties },
      pointsFor: roster.pointsFor,
      pointsAgainst: roster.pointsAgainst,
      playoffSeed: roster.playoffSeed,
      faabBalance: roster.faabBalance,
      waiverPriority: roster.waiverPriority,
      playerCount: roster.players?.length ?? 0,
      starterCount: starters.length,
    },
  })
}

function playerIdentityEvidence(args: {
  row: RedraftRosterPlayerRow
  leagueId: string
  teamId: string | null
  ingestedAtIso?: string | null
  now: Date
}): NflRedraftProviderEvidencePacket {
  const identity = normalizeNflRedraftProviderPlayerIdentity({
    providerId: 'deterministic',
    payload: {
      playerId: args.row.playerId,
      playerName: args.row.playerName,
      displayName: args.row.playerName,
      position: args.row.position,
      team: args.row.team,
      byeWeek: args.row.byeWeek,
      activeStatus: args.row.droppedAt ? 'inactive' : 'active',
      updatedAt: iso(args.row.addedAt),
    },
    fetchedAtIso: args.ingestedAtIso ?? args.now.toISOString(),
    sourceUpdatedAtIso: iso(args.row.addedAt),
    now: args.now,
  })
  return buildPlayerIdentityEvidencePacket(identity, {
    leagueId: args.leagueId,
    teamId: args.teamId,
    playerId: args.row.playerId,
    sourceProvider: 'allfantasy',
    ingestedAtIso: args.ingestedAtIso,
  })
}

function matchupEvidence(matchup: RedraftMatchupRow, ingestedAtIso?: string | null): NflRedraftProviderEvidencePacket {
  return buildSurfaceContextEvidencePacket({
    evidenceType: 'matchup_context',
    leagueId: matchup.leagueId,
    teamId: matchup.homeRosterId,
    matchupId: matchup.id,
    sourceProvider: 'allfantasy',
    ingestedAtIso,
    canonicalFieldNamesIncluded: [
      'matchupId',
      'week',
      'status',
      'homeRosterId',
      'awayRosterId',
      'homeScore',
      'awayScore',
      'homeProjected',
      'awayProjected',
    ],
    facts: {
      matchupId: matchup.id,
      week: matchup.week,
      type: matchup.type,
      status: matchup.status,
      homeRosterId: matchup.homeRosterId,
      awayRosterId: matchup.awayRosterId,
      homeScore: matchup.homeScore,
      awayScore: matchup.awayScore,
      homeProjected: matchup.homeProjected,
      awayProjected: matchup.awayProjected,
    },
  })
}

async function loadSeason(client: PrismaLike, canonicalIds: NflRedraftPremiumApiCanonicalIds): Promise<RedraftSeasonRow | null> {
  return (client as any).redraftSeason.findFirst({
    where: {
      leagueId: canonicalIds.leagueId,
      ...(canonicalIds.season ? { season: canonicalIds.season } : {}),
    },
    orderBy: [{ season: 'desc' }, { createdAt: 'desc' }],
  }) as Promise<RedraftSeasonRow | null>
}

export async function loadNflRedraftPremiumProductionEvidence(
  input: NflRedraftPremiumProductionEvidenceSourceInput,
  deps: NflRedraftPremiumProductionEvidenceSourceDeps = {},
): Promise<NflRedraftProviderEvidencePacket[]> {
  const client = deps.prismaClient ?? prisma
  const now = deps.now ?? new Date()
  const packets: NflRedraftProviderEvidencePacket[] = []

  try {
    const season = await loadSeason(client, input.canonicalIds)
    if (!season) {
      return [
        missingProductionPacket({
          evidenceType: requestedMissingType(input.serviceId),
          canonicalIds: input.canonicalIds,
          ingestedAtIso: input.ingestedAtIso,
          reason: 'production_redraft_season_unavailable',
        }),
      ]
    }

    const rosterWhere = input.canonicalIds.teamId
      ? { id: input.canonicalIds.teamId, seasonId: season.id }
      : input.canonicalIds.managerId
        ? { ownerId: input.canonicalIds.managerId, seasonId: season.id }
        : { seasonId: season.id }
    const roster = (await (client as any).redraftRoster.findFirst({
      where: rosterWhere,
      include: { players: { where: { droppedAt: null }, take: 40, orderBy: { addedAt: 'asc' } } },
      orderBy: [{ playoffSeed: 'asc' }, { pointsFor: 'desc' }],
    })) as RedraftRosterRow | null
    if (roster) {
      packets.push(rosterEvidence(roster, input.ingestedAtIso))
      const playerRow =
        roster.players?.find((player) => player.playerId === input.canonicalIds.playerId) ??
        (input.canonicalIds.playerId
          ? ((await (client as any).redraftRosterPlayer.findFirst({
              where: { playerId: input.canonicalIds.playerId, droppedAt: null, roster: { seasonId: season.id } },
            })) as RedraftRosterPlayerRow | null)
          : null)
      if (playerRow) {
        packets.push(
          playerIdentityEvidence({
            row: playerRow,
            leagueId: season.leagueId,
            teamId: roster.id,
            ingestedAtIso: input.ingestedAtIso,
            now,
          }),
        )
      }
    }

    const matchup = (await (client as any).redraftMatchup.findFirst({
      where: {
        seasonId: season.id,
        ...(input.canonicalIds.matchupId ? { id: input.canonicalIds.matchupId } : {}),
        ...(input.canonicalIds.week ? { week: input.canonicalIds.week } : {}),
        ...(input.canonicalIds.teamId
          ? { OR: [{ homeRosterId: input.canonicalIds.teamId }, { awayRosterId: input.canonicalIds.teamId }] }
          : {}),
      },
      orderBy: [{ week: 'asc' }],
    })) as RedraftMatchupRow | null
    if (matchup) packets.push(matchupEvidence(matchup, input.ingestedAtIso))

    if (input.serviceId === 'waiver_report') {
      const claims = (await (client as any).redraftWaiverClaim.findMany({
        where: {
          seasonId: season.id,
          ...(input.canonicalIds.teamId ? { rosterId: input.canonicalIds.teamId } : {}),
          ...(input.canonicalIds.playerId ? { addPlayerId: input.canonicalIds.playerId } : {}),
        },
        take: 20,
        orderBy: [{ submittedAt: 'desc' }],
      })) as Array<{ id: string; addPlayerId: string; addPlayerName: string; status: string; bidAmount: number | null; priority: number | null }>
      if (claims.length > 0) {
        packets.push(
          buildSurfaceContextEvidencePacket({
            evidenceType: 'waiver_context',
            leagueId: season.leagueId,
            teamId: input.canonicalIds.teamId,
            playerId: input.canonicalIds.playerId,
            sourceProvider: 'allfantasy',
            ingestedAtIso: input.ingestedAtIso,
            canonicalFieldNamesIncluded: ['claimCount', 'claims'],
            facts: { claimCount: claims.length, claims },
          }),
        )
      }
    }

    if (input.serviceId === 'trade_review' || input.serviceId === 'commissioner_digest') {
      const proposals = (await (client as any).redraftTradeProposal.findMany({
        where: {
          seasonId: season.id,
          ...(input.canonicalIds.teamId
            ? { OR: [{ proposerRosterId: input.canonicalIds.teamId }, { receiverRosterId: input.canonicalIds.teamId }] }
            : {}),
        },
        include: { assets: true },
        take: 20,
        orderBy: [{ createdAt: 'desc' }],
      })) as Array<{ id: string; status: string; proposerRosterId: string; receiverRosterId: string; assets?: unknown[] }>
      if (proposals.length > 0) {
        packets.push(
          buildSurfaceContextEvidencePacket({
            evidenceType: 'trade_context',
            leagueId: season.leagueId,
            teamId: input.canonicalIds.teamId,
            sourceProvider: 'allfantasy',
            ingestedAtIso: input.ingestedAtIso,
            canonicalFieldNamesIncluded: ['proposalCount', 'proposals'],
            facts: {
              proposalCount: proposals.length,
              proposals: proposals.map((proposal) => ({
                id: proposal.id,
                status: proposal.status,
                proposerRosterId: proposal.proposerRosterId,
                receiverRosterId: proposal.receiverRosterId,
                assetCount: proposal.assets?.length ?? 0,
              })),
            },
          }),
        )
      }
    }

    if (input.serviceId === 'draft_prep') {
      const draft = (await (client as any).redraftDraft.findFirst({
        where: { leagueId: season.leagueId, season: season.season },
        include: { picks: { take: 25, orderBy: { pickNumber: 'asc' } } },
      })) as { id: string; status: string; draftType: string; totalRounds: number; totalPicks: number; picks?: unknown[] } | null
      if (draft) {
        packets.push(
          buildSurfaceContextEvidencePacket({
            evidenceType: 'draft_context',
            leagueId: season.leagueId,
            sourceProvider: 'allfantasy',
            ingestedAtIso: input.ingestedAtIso,
            canonicalFieldNamesIncluded: ['draftId', 'status', 'draftType', 'totalRounds', 'totalPicks', 'pickCount'],
            facts: {
              draftId: draft.id,
              status: draft.status,
              draftType: draft.draftType,
              totalRounds: draft.totalRounds,
              totalPicks: draft.totalPicks,
              pickCount: draft.picks?.length ?? 0,
            },
          }),
        )
      }
    }

    return packets
  } catch {
    return []
  }
}
