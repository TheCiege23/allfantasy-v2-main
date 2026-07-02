import { prisma } from '@/lib/prisma'
import { resolveCanonicalLeagueRules } from '@/lib/league-runtime'
import type { CanonicalLeagueRuntimeEvent } from '@/lib/league-runtime/leagueRuntimeEvents'
import { resolveRedraftRosterConfig } from '@/lib/redraft/rosterConfigResolver'
import { validateRedraftLineup } from '@/lib/redraft/lineupValidation'
import {
  applyNflRedraftFreeAgentAdd,
  buildNflRedraftWaiverRuntimeState,
  buildWaiverRuntimeEvent,
  processNflRedraftWaiverClaims,
  validateNflRedraftWaiverClaim,
  type NflRedraftFreeAgentAddInput,
  type NflRedraftWaiverClaimInput,
  type NflRedraftWaiverPlayerInput,
  type NflRedraftWaiverProcessState,
  type NflRedraftWaiverRuntimeState,
  type NflRedraftWaiverTransactionInput,
} from './canonicalNflRedraftWaiverRuntime'

export type NflRedraftWaiverRuntimeResolved =
  | {
      ok: true
      state: NflRedraftWaiverRuntimeState
      season: { id: string; leagueId: string; sport: string; season: number; currentWeek: number; status: string }
    }
  | { ok: false; reason: 'season_not_found' | 'league_not_found' | 'not_nfl_redraft' }

export type SubmitNflRedraftWaiverClaimInput = {
  seasonId?: string | null
  leagueId?: string | null
  rosterId: string
  addPlayerId: string
  addPlayerName?: string | null
  addPlayerPosition?: string | null
  addPlayerTeam?: string | null
  dropPlayerId?: string | null
  dropPlayerName?: string | null
  bidAmount?: number | null
  conditionalGroupId?: string | null
  conditionalRank?: number | null
  actorUserId?: string | null
}
export type EditNflRedraftWaiverClaimInput = SubmitNflRedraftWaiverClaimInput & {
  claimId: string
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {}
}

function numberOrNull(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value)
    if (Number.isFinite(parsed)) return parsed
  }
  return null
}

function textOrNull(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function positiveWeek(value: unknown, fallback: number): number {
  const parsed = numberOrNull(value)
  return parsed == null ? Math.max(1, fallback) : Math.max(1, Math.floor(parsed))
}

async function resolveSeason(input: { seasonId?: string | null; leagueId?: string | null }) {
  return prisma.redraftSeason.findFirst({
    where: input.seasonId ? { id: input.seasonId } : { leagueId: input.leagueId ?? undefined },
    orderBy: input.seasonId ? undefined : { createdAt: 'desc' },
  })
}

function eventTitle(event: CanonicalLeagueRuntimeEvent): string {
  switch (event.type) {
    case 'waiver.period.opened':
      return 'Waiver period opened'
    case 'waiver.period.closed':
      return 'Waiver period closed'
    case 'waiver.claim.submitted':
      return 'Waiver claim submitted'
    case 'waiver.claim.edited':
      return 'Waiver claim edited'
    case 'waiver.claim.cancelled':
      return 'Waiver claim cancelled'
    case 'waiver.processing.started':
      return 'Waiver processing started'
    case 'waiver.claim.won':
      return 'Waiver claim won'
    case 'waiver.claim.failed':
      return 'Waiver claim failed'
    case 'waiver.faab.deducted':
      return 'FAAB deducted'
    case 'waiver.priority.updated':
      return 'Waiver priority updated'
    case 'waiver.free_agent.added':
      return 'Free agent added'
    case 'waiver.processed':
      return 'Waivers processed'
    case 'waiver.transaction.recorded':
      return 'Waiver transaction recorded'
    case 'commissioner.waiver_override':
      return 'Commissioner waiver override'
    case 'roster.player.added':
      return 'Roster player added'
    case 'roster.player.dropped':
      return 'Roster player dropped'
    default:
      return event.type.replace(/\./g, ' ')
  }
}

async function recordLeagueEvents(events: CanonicalLeagueRuntimeEvent[]) {
  if (!events.length) return
  try {
    await prisma.leagueEvent.createMany({
      data: events.map((event) => ({
        leagueId: event.leagueId,
        eventType: event.type,
        title: eventTitle(event),
        description: null,
        payload: event.payload,
        visibility: 'league',
        createdAt: new Date(event.occurredAtIso),
      })),
    })
  } catch {
    // Waiver settlement should not fail if an older local schema lacks event rows.
  }
}

async function recordWaiverAudit(input: {
  actorUserId: string
  action: string
  seasonId: string
  details: Record<string, unknown>
}) {
  try {
    await (prisma as any).adminAuditLog?.create({
      data: {
        adminUserId: input.actorUserId,
        action: input.action,
        targetType: 'redraft_season',
        targetId: input.seasonId,
        details: input.details,
      },
    })
  } catch {
    // Best-effort for local/test runtimes.
  }
}

async function resolvePlayerMeta(input: {
  playerId: string
  playerName?: string | null
  position?: string | null
  team?: string | null
  sport: string
}): Promise<NflRedraftWaiverPlayerInput & { warning: string | null }> {
  const playerId = input.playerId.trim()
  const sportKeys = [input.sport.toUpperCase(), input.sport.toLowerCase()]
  const player = await prisma.sportsPlayer
    .findFirst({
      where: {
        sport: { in: sportKeys },
        OR: [{ id: playerId }, { externalId: playerId }, { sleeperId: playerId }],
      },
      select: { id: true, externalId: true, sleeperId: true, name: true, position: true, team: true },
    })
    .catch(() => null)
  if (player) {
    return {
      playerId,
      playerName: player.name || input.playerName || playerId,
      position: player.position || input.position || 'UNK',
      team: player.team ?? input.team ?? null,
      sport: input.sport,
      slotType: 'BENCH',
      warning: null,
    }
  }

  const identity = await prisma.playerIdentityMap
    .findFirst({
      where: {
        sport: { in: sportKeys },
        OR: [
          { sleeperId: playerId },
          { fantasyCalcId: playerId },
          { rollingInsightsId: playerId },
          { apiSportsId: playerId },
          { espnId: playerId },
          { clearSportsId: playerId },
        ],
      },
      select: { canonicalName: true, position: true, currentTeam: true },
    })
    .catch(() => null)
  if (identity) {
    return {
      playerId,
      playerName: identity.canonicalName || input.playerName || playerId,
      position: identity.position || input.position || 'UNK',
      team: identity.currentTeam ?? input.team ?? null,
      sport: input.sport,
      slotType: 'BENCH',
      warning: null,
    }
  }

  return {
    playerId,
    playerName: input.playerName?.trim() || playerId,
    position: input.position?.trim() || 'UNK',
    team: input.team ?? null,
    sport: input.sport,
    slotType: 'BENCH',
    warning: `No cached player metadata found for ${playerId}; rostered with provided waiver identity only.`,
  }
}

function claimMetaFromTransactions(
  transactions: Array<{ type: string; metadata: unknown; createdAt: Date }>,
): Map<string, Record<string, unknown>> {
  const out = new Map<string, Record<string, unknown>>()
  for (const tx of [...transactions].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())) {
    const meta = asRecord(tx.metadata)
    const claimId = textOrNull(meta.claimId)
    if (!claimId) continue
    if (tx.type === 'waiver_claim_submitted' || tx.type === 'waiver_claim_edited') {
      out.set(claimId, { ...(out.get(claimId) ?? {}), ...meta })
    }
  }
  return out
}

function toRuntimeTransaction(row: {
  id: string
  rosterId: string
  type: string
  createdAt: Date
  metadata: unknown
}): NflRedraftWaiverTransactionInput {
  const metadata = asRecord(row.metadata)
  return {
    transactionId: row.id,
    rosterId: row.rosterId,
    type: row.type,
    createdAtIso: row.createdAt.toISOString(),
    claimId: textOrNull(metadata.claimId),
    addPlayerId: textOrNull(metadata.addPlayerId),
    addPlayerName: textOrNull(metadata.addPlayerName),
    dropPlayerId: textOrNull(metadata.dropPlayerId),
    dropPlayerName: textOrNull(metadata.dropPlayerName),
    bidAmount: numberOrNull(metadata.bidAmount),
    faabSpent: numberOrNull(metadata.faabSpent),
    reason: textOrNull(metadata.reason),
    metadata,
  }
}

export async function resolveNflRedraftWaiverRuntime(input: {
  seasonId?: string | null
  leagueId?: string | null
  week?: number | null
  now?: Date
  includeFreeAgents?: boolean
  extraFreeAgents?: NflRedraftWaiverPlayerInput[]
}): Promise<NflRedraftWaiverRuntimeResolved> {
  const season = await resolveSeason(input)
  if (!season) return { ok: false, reason: 'season_not_found' }
  if (String(season.sport).toUpperCase() !== 'NFL') return { ok: false, reason: 'not_nfl_redraft' }

  const rules = await resolveCanonicalLeagueRules(season.leagueId)
  if (!rules) return { ok: false, reason: 'league_not_found' }
  if (rules.general.sport !== 'NFL' || rules.general.format !== 'redraft') return { ok: false, reason: 'not_nfl_redraft' }

  const week = positiveWeek(input.week, season.currentWeek || 1)
  const league = await prisma.league.findUnique({ where: { id: season.leagueId }, select: { settings: true } })
  const rosterConfig = resolveRedraftRosterConfig(season.sport, league?.settings ?? null)
  const activeRosterLimit = Math.max(1, rosterConfig.maxRosterSize - rosterConfig.irSlots - rosterConfig.taxiSlots)
  const rosters = await prisma.redraftRoster.findMany({
    where: { seasonId: season.id, leagueId: season.leagueId },
    include: { players: { where: { droppedAt: null }, orderBy: { addedAt: 'asc' } } },
    orderBy: [{ waiverPriority: 'asc' }, { createdAt: 'asc' }],
  })
  const transactions = await prisma.redraftLeagueTransaction.findMany({
    where: {
      seasonId: season.id,
      leagueId: season.leagueId,
      type: { in: ['waiver_claim_submitted', 'waiver_claim_edited', 'waiver_claim_cancelled', 'waiver_claim_approved', 'waiver_claim_failed', 'waiver_claim_conditional_skipped', 'free_agent_added'] },
    },
    orderBy: { createdAt: 'desc' },
    take: 100,
  })
  const claimMeta = claimMetaFromTransactions(transactions)
  const claims = await prisma.redraftWaiverClaim.findMany({
    where: { seasonId: season.id, leagueId: season.leagueId },
    orderBy: [{ status: 'asc' }, { submittedAt: 'asc' }, { id: 'asc' }],
    take: 250,
  })

  const rosterInputs = rosters.map((roster) => {
    const players = roster.players.map((player) => ({
      playerId: player.playerId,
      playerName: player.playerName,
      position: player.position,
      team: player.team,
      sport: player.sport,
      slotType: player.slotType,
      isLocked: player.isLocked,
      injuryStatus: player.injuryStatus,
      acquisitionType: player.acquisitionType,
    }))
    const validation = validateRedraftLineup({
      sport: season.sport,
      week,
      players,
      rosterConfig,
    })
    return {
      rosterId: roster.id,
      displayName: roster.teamName ?? roster.ownerName ?? null,
      ownerName: roster.ownerName,
      ownerId: roster.ownerId,
      faabBalance: roster.faabBalance,
      waiverPriority: roster.waiverPriority,
      players,
      validationIssues: validation.issues.map((issue) => ({
        code: issue.code,
        severity: issue.severity,
        message: issue.message,
        playerId: issue.playerId ?? null,
      })),
    }
  })

  const claimInputs: NflRedraftWaiverClaimInput[] = claims.map((claim) => {
    const meta = claimMeta.get(claim.id) ?? {}
    return {
      claimId: claim.id,
      rosterId: claim.rosterId,
      addPlayerId: claim.addPlayerId,
      addPlayerName: claim.addPlayerName,
      addPlayerPosition: textOrNull(meta.addPlayerPosition),
      addPlayerTeam: textOrNull(meta.addPlayerTeam),
      dropPlayerId: claim.dropPlayerId,
      dropPlayerName: claim.dropPlayerName,
      bidAmount: claim.bidAmount,
      priority: claim.priority,
      conditionalGroupId: textOrNull(meta.conditionalGroupId),
      conditionalRank: numberOrNull(meta.conditionalRank),
      status: claim.status,
      submittedAtIso: claim.submittedAt.toISOString(),
      actorUserId: textOrNull(meta.actorUserId),
    }
  })

  const activePlayerIds = new Set(rosters.flatMap((roster) => roster.players.map((player) => player.playerId)))
  const freeAgents = input.includeFreeAgents
    ? await prisma.sportsPlayer
        .findMany({
          where: {
            sport: { in: ['NFL', 'nfl'] },
            id: { notIn: Array.from(activePlayerIds) },
          },
          select: { id: true, externalId: true, sleeperId: true, name: true, position: true, team: true },
          orderBy: [{ name: 'asc' }],
          take: 200,
        })
        .catch(() => [])
    : []
  const freeAgentInputs: NflRedraftWaiverPlayerInput[] = [
    ...freeAgents.map((player) => ({
      playerId: player.id,
      playerName: player.name,
      position: player.position ?? 'UNK',
      team: player.team,
      sport: 'NFL',
      slotType: 'BENCH',
    })),
    ...(input.extraFreeAgents ?? []),
  ].filter((player, index, list) => list.findIndex((candidate) => candidate.playerId === player.playerId) === index)

  const state = buildNflRedraftWaiverRuntimeState({
    leagueId: season.leagueId,
    seasonId: season.id,
    season: season.season,
    week,
    rules,
    rosters: rosterInputs,
    claims: claimInputs,
    transactions: transactions.map(toRuntimeTransaction),
    freeAgents: freeAgentInputs,
    activeRosterLimit,
    now: input.now,
  })

  return {
    ok: true,
    state,
    season: {
      id: season.id,
      leagueId: season.leagueId,
      sport: season.sport,
      season: season.season,
      currentWeek: season.currentWeek,
      status: season.status,
    },
  }
}

async function recordClaimTransaction(input: {
  leagueId: string
  seasonId: string
  rosterId: string
  type: string
  metadata: Record<string, unknown>
}) {
  return prisma.redraftLeagueTransaction.create({
    data: {
      leagueId: input.leagueId,
      seasonId: input.seasonId,
      rosterId: input.rosterId,
      type: input.type,
      metadata: input.metadata,
    },
  })
}

async function createClaimEvents(input: {
  leagueId: string
  seasonId: string
  week: number
  type: 'waiver.claim.submitted' | 'waiver.claim.edited' | 'waiver.claim.cancelled'
  claimId: string
  rosterId: string
  actorUserId?: string | null
  payload?: Record<string, unknown>
}) {
  await recordLeagueEvents([
    buildWaiverRuntimeEvent({
      leagueId: input.leagueId,
      type: input.type,
      actorUserId: input.actorUserId ?? null,
      payload: {
        seasonId: input.seasonId,
        week: input.week,
        claimId: input.claimId,
        rosterId: input.rosterId,
        ...(input.payload ?? {}),
      },
    }),
  ])
}

export async function submitNflRedraftWaiverClaim(input: SubmitNflRedraftWaiverClaimInput) {
  const season = await resolveSeason(input)
  if (!season) throw new Error('season_not_found')
  if (String(season.sport).toUpperCase() !== 'NFL') throw new Error('not_nfl_redraft')
  const meta = await resolvePlayerMeta({
    playerId: input.addPlayerId,
    playerName: input.addPlayerName,
    position: input.addPlayerPosition,
    team: input.addPlayerTeam,
    sport: season.sport,
  })
  const resolved = await resolveNflRedraftWaiverRuntime({
    seasonId: season.id,
    week: season.currentWeek || 1,
    includeFreeAgents: false,
    extraFreeAgents: [meta],
  })
  if (!resolved.ok) throw new Error(resolved.reason)
  const roster = resolved.state.teams.find((team) => team.rosterId === input.rosterId)
  if (!roster) throw new Error('roster_not_found')

  const conditionalGroupId = input.conditionalGroupId?.trim() || `group:${input.rosterId}:${Date.now()}`
  const conditionalRank = Math.max(1, Math.floor(Number(input.conditionalRank ?? 1)))
  const candidate: NflRedraftWaiverClaimInput = {
    claimId: 'candidate',
    rosterId: input.rosterId,
    addPlayerId: input.addPlayerId,
    addPlayerName: meta.playerName,
    addPlayerPosition: meta.position,
    addPlayerTeam: meta.team,
    dropPlayerId: input.dropPlayerId ?? null,
    dropPlayerName: input.dropPlayerName ?? null,
    bidAmount: input.bidAmount ?? 0,
    priority: conditionalRank,
    conditionalGroupId,
    conditionalRank,
    status: 'pending',
    actorUserId: input.actorUserId ?? null,
  }
  const validation = validateNflRedraftWaiverClaim({ state: resolved.state, claim: candidate })
  if (!validation.ok) throw new Error(validation.message)

  const claim = await prisma.redraftWaiverClaim.create({
    data: {
      seasonId: season.id,
      leagueId: season.leagueId,
      rosterId: input.rosterId,
      addPlayerId: input.addPlayerId,
      addPlayerName: meta.playerName,
      dropPlayerId: input.dropPlayerId ?? null,
      dropPlayerName: input.dropPlayerName ?? null,
      bidAmount: input.bidAmount ?? 0,
      priority: conditionalRank,
    },
  })
  await recordClaimTransaction({
    leagueId: season.leagueId,
    seasonId: season.id,
    rosterId: input.rosterId,
    type: 'waiver_claim_submitted',
    metadata: {
      claimId: claim.id,
      addPlayerId: claim.addPlayerId,
      addPlayerName: meta.playerName,
      addPlayerPosition: meta.position,
      addPlayerTeam: meta.team,
      dropPlayerId: claim.dropPlayerId,
      dropPlayerName: claim.dropPlayerName,
      bidAmount: claim.bidAmount,
      conditionalGroupId,
      conditionalRank,
      actorUserId: input.actorUserId ?? null,
      warning: meta.warning,
    },
  })
  await createClaimEvents({
    leagueId: season.leagueId,
    seasonId: season.id,
    week: season.currentWeek || 1,
    type: 'waiver.claim.submitted',
    claimId: claim.id,
    rosterId: claim.rosterId,
    actorUserId: input.actorUserId,
    payload: { addPlayerId: claim.addPlayerId, dropPlayerId: claim.dropPlayerId, bidAmount: claim.bidAmount },
  })
  return { claim, warning: meta.warning }
}

export async function editNflRedraftWaiverClaim(input: EditNflRedraftWaiverClaimInput) {
  const existing = await prisma.redraftWaiverClaim.findFirst({ where: { id: input.claimId, rosterId: input.rosterId, status: 'pending' } })
  if (!existing) throw new Error('claim_not_found')
  const meta = await resolvePlayerMeta({
    playerId: input.addPlayerId || existing.addPlayerId,
    playerName: input.addPlayerName ?? existing.addPlayerName,
    position: input.addPlayerPosition,
    team: input.addPlayerTeam,
    sport: 'NFL',
  })
  const resolved = await resolveNflRedraftWaiverRuntime({
    seasonId: existing.seasonId,
    week: null,
    includeFreeAgents: false,
    extraFreeAgents: [meta],
  })
  if (!resolved.ok) throw new Error(resolved.reason)

  const conditionalGroupId = input.conditionalGroupId?.trim() || `claim:${input.claimId}`
  const conditionalRank = Math.max(1, Math.floor(Number(input.conditionalRank ?? existing.priority ?? 1)))
  const candidate: NflRedraftWaiverClaimInput = {
    claimId: input.claimId,
    rosterId: input.rosterId,
    addPlayerId: input.addPlayerId || existing.addPlayerId,
    addPlayerName: meta.playerName,
    addPlayerPosition: meta.position,
    addPlayerTeam: meta.team,
    dropPlayerId: input.dropPlayerId === undefined ? existing.dropPlayerId : input.dropPlayerId,
    dropPlayerName: input.dropPlayerName === undefined ? existing.dropPlayerName : input.dropPlayerName,
    bidAmount: input.bidAmount === undefined ? existing.bidAmount : input.bidAmount,
    priority: conditionalRank,
    conditionalGroupId,
    conditionalRank,
    status: 'pending',
    actorUserId: input.actorUserId ?? null,
  }
  const validation = validateNflRedraftWaiverClaim({ state: resolved.state, claim: candidate, existingClaimId: input.claimId })
  if (!validation.ok) throw new Error(validation.message)

  const claim = await prisma.redraftWaiverClaim.update({
    where: { id: input.claimId },
    data: {
      addPlayerId: candidate.addPlayerId,
      addPlayerName: candidate.addPlayerName,
      dropPlayerId: candidate.dropPlayerId,
      dropPlayerName: candidate.dropPlayerName,
      bidAmount: candidate.bidAmount,
      priority: conditionalRank,
    },
  })
  await recordClaimTransaction({
    leagueId: existing.leagueId,
    seasonId: existing.seasonId,
    rosterId: existing.rosterId,
    type: 'waiver_claim_edited',
    metadata: {
      claimId: claim.id,
      addPlayerId: claim.addPlayerId,
      addPlayerName: meta.playerName,
      addPlayerPosition: meta.position,
      addPlayerTeam: meta.team,
      dropPlayerId: claim.dropPlayerId,
      dropPlayerName: claim.dropPlayerName,
      bidAmount: claim.bidAmount,
      conditionalGroupId,
      conditionalRank,
      actorUserId: input.actorUserId ?? null,
      warning: meta.warning,
    },
  })
  await createClaimEvents({
    leagueId: existing.leagueId,
    seasonId: existing.seasonId,
    week: resolved.state.week,
    type: 'waiver.claim.edited',
    claimId: claim.id,
    rosterId: claim.rosterId,
    actorUserId: input.actorUserId,
    payload: { addPlayerId: claim.addPlayerId, dropPlayerId: claim.dropPlayerId, bidAmount: claim.bidAmount },
  })
  return { claim, warning: meta.warning }
}

export async function cancelNflRedraftWaiverClaim(input: {
  claimId: string
  rosterId: string
  actorUserId?: string | null
}) {
  const existing = await prisma.redraftWaiverClaim.findFirst({ where: { id: input.claimId, rosterId: input.rosterId, status: 'pending' } })
  if (!existing) throw new Error('claim_not_found')
  const claim = await prisma.redraftWaiverClaim.update({
    where: { id: input.claimId },
    data: { status: 'cancelled' },
  })
  await recordClaimTransaction({
    leagueId: existing.leagueId,
    seasonId: existing.seasonId,
    rosterId: existing.rosterId,
    type: 'waiver_claim_cancelled',
    metadata: {
      claimId: existing.id,
      addPlayerId: existing.addPlayerId,
      addPlayerName: existing.addPlayerName,
      dropPlayerId: existing.dropPlayerId,
      dropPlayerName: existing.dropPlayerName,
      bidAmount: existing.bidAmount,
      actorUserId: input.actorUserId ?? null,
    },
  })
  await createClaimEvents({
    leagueId: existing.leagueId,
    seasonId: existing.seasonId,
    week: 1,
    type: 'waiver.claim.cancelled',
    claimId: claim.id,
    rosterId: claim.rosterId,
    actorUserId: input.actorUserId,
  })
  return { claim }
}

function playerMetaForResult(state: NflRedraftWaiverRuntimeState, playerId: string): NflRedraftWaiverPlayerInput {
  const freeAgent = state.freeAgents.find((player) => player.playerId === playerId)
  return freeAgent ?? { playerId, playerName: playerId, position: 'UNK', team: null, sport: 'NFL', slotType: 'BENCH' }
}

async function applyProcessResult(input: {
  state: NflRedraftWaiverRuntimeState
  result: NflRedraftWaiverProcessState['results'][number]
}) {
  const result = input.result
  if (result.success && result.resultType === 'won') {
    const meta = playerMetaForResult(input.state, result.addPlayerId)
    await prisma.$transaction(async (tx) => {
      if (result.dropPlayerId) {
        const drop = await tx.redraftRosterPlayer.updateMany({
          where: { rosterId: result.rosterId, playerId: result.dropPlayerId, droppedAt: null },
          data: { droppedAt: new Date() },
        })
        if (drop.count === 0) throw new Error('Drop player is not active on this roster.')
      }
      await tx.redraftRosterPlayer.create({
        data: {
          rosterId: result.rosterId,
          playerId: result.addPlayerId,
          playerName: result.addPlayerName,
          position: meta.position,
          team: meta.team,
          sport: 'NFL',
          slotType: 'BENCH',
          acquisitionType: 'waiver',
        },
      })
      await tx.redraftRoster.update({
        where: { id: result.rosterId },
        data: { faabBalance: result.faabAfter, waiverPriority: result.priorityAfter },
      })
      await tx.redraftWaiverClaim.update({
        where: { id: result.claimId },
        data: { status: 'approved', processedAt: new Date(), denialReason: null },
      })
      await tx.redraftLeagueTransaction.create({
        data: {
          leagueId: input.state.leagueId,
          seasonId: input.state.seasonId,
          rosterId: result.rosterId,
          type: result.transaction.type,
          metadata: {
            ...result.transaction.metadata,
            claimId: result.claimId,
            addPlayerId: result.addPlayerId,
            addPlayerName: result.addPlayerName,
            dropPlayerId: result.dropPlayerId,
            dropPlayerName: result.dropPlayerName,
            bidAmount: result.bidAmount,
            faabSpent: result.faabSpent,
          },
        },
      })
    })
    return
  }

  await prisma.$transaction(async (tx) => {
    await tx.redraftWaiverClaim.update({
      where: { id: result.claimId },
      data: {
        status: 'denied',
        processedAt: new Date(),
        denialReason: result.reason ?? 'Claim did not process.',
      },
    })
    await tx.redraftLeagueTransaction.create({
      data: {
        leagueId: input.state.leagueId,
        seasonId: input.state.seasonId,
        rosterId: result.rosterId,
        type: result.transaction.type,
        metadata: {
          ...result.transaction.metadata,
          claimId: result.claimId,
          addPlayerId: result.addPlayerId,
          addPlayerName: result.addPlayerName,
          dropPlayerId: result.dropPlayerId,
          dropPlayerName: result.dropPlayerName,
          bidAmount: result.bidAmount,
          reason: result.reason,
        },
      },
    })
  })
}

export async function processNflRedraftWaiverWindow(input: {
  seasonId?: string | null
  leagueId?: string | null
  week?: number | null
  actorUserId?: string | null
  commissionerOverride?: boolean
}) {
  const resolved = await resolveNflRedraftWaiverRuntime({
    seasonId: input.seasonId,
    leagueId: input.leagueId,
    week: input.week,
    includeFreeAgents: true,
  })
  if (!resolved.ok) throw new Error(resolved.reason)
  const processed = processNflRedraftWaiverClaims({
    state: resolved.state,
    actorUserId: input.actorUserId ?? null,
    commissionerOverride: input.commissionerOverride,
  })
  for (const result of processed.results) {
    await applyProcessResult({ state: resolved.state, result })
  }
  await recordLeagueEvents(processed.events)
  await recordWaiverAudit({
    actorUserId: input.actorUserId ?? 'system',
    action: input.commissionerOverride ? 'redraft_waiver_commissioner_override' : 'redraft_waiver_process',
    seasonId: resolved.state.seasonId,
    details: {
      week: resolved.state.week,
      processed: processed.results.length,
      succeeded: processed.results.filter((result) => result.success).length,
      failed: processed.results.filter((result) => !result.success).length,
    },
  })
  const next = await resolveNflRedraftWaiverRuntime({
    seasonId: resolved.state.seasonId,
    week: resolved.state.week,
    includeFreeAgents: true,
  })
  if (!next.ok) throw new Error(next.reason)
  return { state: next.state, results: processed.results, events: processed.events }
}

export async function addNflRedraftFreeAgent(input: {
  seasonId?: string | null
  leagueId?: string | null
  rosterId: string
  addPlayerId: string
  addPlayerName?: string | null
  addPlayerPosition?: string | null
  addPlayerTeam?: string | null
  dropPlayerId?: string | null
  dropPlayerName?: string | null
  actorUserId?: string | null
  commissionerOverride?: boolean
}) {
  const season = await resolveSeason(input)
  if (!season) throw new Error('season_not_found')
  const meta = await resolvePlayerMeta({
    playerId: input.addPlayerId,
    playerName: input.addPlayerName,
    position: input.addPlayerPosition,
    team: input.addPlayerTeam,
    sport: season.sport,
  })
  const resolved = await resolveNflRedraftWaiverRuntime({
    seasonId: season.id,
    week: season.currentWeek || 1,
    includeFreeAgents: false,
    extraFreeAgents: [meta],
  })
  if (!resolved.ok) throw new Error(resolved.reason)
  const add: NflRedraftFreeAgentAddInput = {
    rosterId: input.rosterId,
    addPlayerId: input.addPlayerId,
    addPlayerName: meta.playerName,
    addPlayerPosition: meta.position,
    addPlayerTeam: meta.team,
    dropPlayerId: input.dropPlayerId ?? null,
    dropPlayerName: input.dropPlayerName ?? null,
    actorUserId: input.actorUserId ?? null,
    commissionerOverride: input.commissionerOverride,
  }
  const result = applyNflRedraftFreeAgentAdd({ state: resolved.state, add })
  if (!result.ok) {
    const validation = result.validation
    throw new Error(validation.ok ? 'free_agent_add_failed' : validation.message)
  }
  const move = result.result
  await prisma.$transaction(async (tx) => {
    if (move.dropPlayerId) {
      const drop = await tx.redraftRosterPlayer.updateMany({
        where: { rosterId: move.rosterId, playerId: move.dropPlayerId, droppedAt: null },
        data: { droppedAt: new Date() },
      })
      if (drop.count === 0) throw new Error('Drop player is not active on this roster.')
    }
    await tx.redraftRosterPlayer.create({
      data: {
        rosterId: move.rosterId,
        playerId: move.addPlayerId,
        playerName: move.addPlayerName,
        position: meta.position,
        team: meta.team,
        sport: 'NFL',
        slotType: 'BENCH',
        acquisitionType: 'free_agent',
      },
    })
    await tx.redraftLeagueTransaction.create({
      data: {
        leagueId: resolved.state.leagueId,
        seasonId: resolved.state.seasonId,
        rosterId: move.rosterId,
        type: 'free_agent_added',
        metadata: {
          addPlayerId: move.addPlayerId,
          addPlayerName: move.addPlayerName,
          addPlayerPosition: meta.position,
          addPlayerTeam: meta.team,
          dropPlayerId: move.dropPlayerId,
          dropPlayerName: move.dropPlayerName,
          actorUserId: input.actorUserId ?? null,
          commissionerOverride: input.commissionerOverride === true,
          warning: meta.warning,
        },
      },
    })
  })
  await recordLeagueEvents(result.events)
  await recordWaiverAudit({
    actorUserId: input.actorUserId ?? 'system',
    action: input.commissionerOverride ? 'redraft_free_agent_commissioner_override' : 'redraft_free_agent_add',
    seasonId: resolved.state.seasonId,
    details: {
      rosterId: move.rosterId,
      addPlayerId: move.addPlayerId,
      dropPlayerId: move.dropPlayerId,
    },
  })
  const next = await resolveNflRedraftWaiverRuntime({ seasonId: resolved.state.seasonId, week: resolved.state.week, includeFreeAgents: true })
  if (!next.ok) throw new Error(next.reason)
  return { state: next.state, transaction: move.transaction, warning: meta.warning }
}
