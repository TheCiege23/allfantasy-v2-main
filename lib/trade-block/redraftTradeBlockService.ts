/**
 * T8 — native trade block + interest service (server-only, deterministic). Managers manage only their
 * own roster's block/interest; commissioner views league-wide. No external/LLM calls, no value
 * mutation. Validates ownership (a block item's player must be on the roster).
 */

import { prisma } from '@/lib/prisma'

export const INTEREST_TYPES = ['player_interest', 'position_need', 'package_interest', 'faab_interest', 'pick_interest'] as const
export type InterestType = (typeof INTEREST_TYPES)[number]

/**
 * A refusal a manager can read. `code` is stable, so a client can say it in the reader's language
 * (`tradeCenter.serverError.<code>`); `message` stays the English the routes always sent.
 */
export class TradeBlockValidationError extends Error {
  constructor(
    message: string,
    readonly code: TradeBlockErrorCode,
  ) {
    super(message)
  }
}

export type TradeBlockErrorCode = 'not_owned' | 'item_not_found' | 'own_items_only' | 'interest_not_found' | 'own_interests_only'

/** Resolve the caller's league context: current season, their own roster (if any), commissioner flag. */
export async function resolveCallerContext(
  leagueId: string,
  userId: string,
): Promise<{ seasonId: string | null; rosterId: string | null; isCommissioner: boolean }> {
  const season = await prisma.redraftSeason.findFirst({ where: { leagueId }, select: { id: true }, orderBy: { season: 'desc' } })
  const [roster, league] = await Promise.all([
    season ? prisma.redraftRoster.findFirst({ where: { seasonId: season.id, ownerId: userId }, select: { id: true } }) : Promise.resolve(null),
    prisma.league.findFirst({
      where: { id: leagueId },
      select: { userId: true, teams: { where: { claimedByUserId: userId }, select: { isCommissioner: true, isCoCommissioner: true } } },
    }),
  ])
  const isCommissioner = Boolean(league && (league.userId === userId || league.teams.some((t) => t.isCommissioner || t.isCoCommissioner)))
  return { seasonId: season?.id ?? null, rosterId: roster?.id ?? null, isCommissioner }
}

async function rosterOwnsPlayer(rosterId: string, playerId: string): Promise<boolean> {
  const row = await prisma.redraftRosterPlayer.findFirst({ where: { rosterId, playerId, droppedAt: null }, select: { id: true } })
  return Boolean(row)
}

export interface UpsertBlockInput {
  leagueId: string
  rosterId: string
  playerId: string
  playerName: string
  position?: string | null
  team?: string | null
  askingForPositions?: string[]
  wantsFaab?: boolean
  wantsDraftPicks?: boolean
  packagePreference?: string | null
  note?: string | null
  expiresAt?: Date | null
}

export async function upsertTradeBlockItem(input: UpsertBlockInput) {
  if (!(await rosterOwnsPlayer(input.rosterId, input.playerId))) {
    throw new TradeBlockValidationError('Cannot list a player you do not own on the trade block', 'not_owned')
  }
  const data = {
    playerName: input.playerName,
    position: input.position ?? null,
    team: input.team ?? null,
    askingForPositions: (input.askingForPositions ?? []) as unknown as object,
    wantsFaab: input.wantsFaab ?? false,
    wantsDraftPicks: input.wantsDraftPicks ?? false,
    packagePreference: input.packagePreference ?? null,
    note: input.note ?? null,
    status: 'active',
    expiresAt: input.expiresAt ?? null,
  }
  return prisma.redraftTradeBlockItem.upsert({
    where: { leagueId_rosterId_playerId: { leagueId: input.leagueId, rosterId: input.rosterId, playerId: input.playerId } },
    create: { leagueId: input.leagueId, rosterId: input.rosterId, playerId: input.playerId, ...data },
    update: data,
  })
}

export async function deactivateTradeBlockItem(itemId: string, rosterId: string) {
  const item = await prisma.redraftTradeBlockItem.findUnique({ where: { id: itemId } })
  if (!item) throw new TradeBlockValidationError('Trade block item not found', 'item_not_found')
  if (item.rosterId !== rosterId) throw new TradeBlockValidationError('You can only remove your own trade block items', 'own_items_only')
  return prisma.redraftTradeBlockItem.update({ where: { id: itemId }, data: { status: 'inactive' } })
}

function isExpired(expiresAt: Date | null): boolean {
  return expiresAt != null && expiresAt.getTime() < Date.now()
}

export async function listLeagueTradeBlock(leagueId: string) {
  const items = await prisma.redraftTradeBlockItem.findMany({
    where: { leagueId, status: 'active', visibility: 'league' },
    orderBy: { updatedAt: 'desc' },
    take: 200,
  })
  return items.filter((i) => !isExpired(i.expiresAt))
}

export async function listRosterTradeBlock(rosterId: string) {
  return prisma.redraftTradeBlockItem.findMany({ where: { rosterId, status: 'active' }, orderBy: { updatedAt: 'desc' } })
}

export interface UpsertInterestInput {
  leagueId: string
  fromRosterId: string
  targetRosterId?: string | null
  playerId?: string | null
  playerName?: string | null
  position?: string | null
  interestType: InterestType
  note?: string | null
  visibility?: 'private' | 'public'
}

export async function upsertInterest(input: UpsertInterestInput) {
  return prisma.redraftTradeInterest.create({
    data: {
      leagueId: input.leagueId,
      fromRosterId: input.fromRosterId,
      targetRosterId: input.targetRosterId ?? null,
      playerId: input.playerId ?? null,
      playerName: input.playerName ?? null,
      position: input.position ?? null,
      interestType: input.interestType,
      note: input.note ?? null,
      visibility: input.visibility ?? 'private',
      status: 'active',
    },
  })
}

export async function deactivateInterest(interestId: string, fromRosterId: string) {
  const row = await prisma.redraftTradeInterest.findUnique({ where: { id: interestId } })
  if (!row) throw new TradeBlockValidationError('Interest not found', 'interest_not_found')
  if (row.fromRosterId !== fromRosterId) throw new TradeBlockValidationError('You can only remove your own interests', 'own_interests_only')
  return prisma.redraftTradeInterest.update({ where: { id: interestId }, data: { status: 'inactive' } })
}

export async function listMyInterests(fromRosterId: string) {
  return prisma.redraftTradeInterest.findMany({ where: { fromRosterId, status: 'active' }, orderBy: { updatedAt: 'desc' } })
}

/**
 * Privacy-safe discovery signals: league-visible block items (player ids per roster) + the requesting
 * roster's OWN interests (incl. private) + other managers' PUBLIC interests only.
 */
export async function discoverySignals(leagueId: string, myRosterId: string): Promise<{
  blockPlayerIdsByRoster: Record<string, string[]>
  myInterestPlayerIds: string[]
  myInterestPositions: string[]
  hasNativeBlock: boolean
}> {
  const [block, myInterests, publicInterests] = await Promise.all([
    listLeagueTradeBlock(leagueId),
    prisma.redraftTradeInterest.findMany({ where: { leagueId, fromRosterId: myRosterId, status: 'active' } }),
    prisma.redraftTradeInterest.findMany({ where: { leagueId, status: 'active', visibility: 'public' } }),
  ])

  const blockPlayerIdsByRoster: Record<string, string[]> = {}
  for (const i of block) (blockPlayerIdsByRoster[i.rosterId] ??= []).push(i.playerId)

  const myInterestPlayerIds = [
    ...new Set([
      ...myInterests.map((i) => i.playerId).filter((x): x is string => Boolean(x)),
      // other managers' public interests are a weak signal too
      ...publicInterests.filter((i) => i.fromRosterId !== myRosterId).map((i) => i.playerId).filter((x): x is string => Boolean(x)),
    ]),
  ]
  const myInterestPositions = [...new Set(myInterests.map((i) => i.position).filter((x): x is string => Boolean(x)))]

  return { blockPlayerIdsByRoster, myInterestPlayerIds, myInterestPositions, hasNativeBlock: block.length > 0 }
}
