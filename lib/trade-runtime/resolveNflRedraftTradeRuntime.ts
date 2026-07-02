import { prisma } from '@/lib/prisma'
import type { Prisma } from '@prisma/client'
import { resolveCanonicalLeagueRules } from '@/lib/league-runtime'
import type { CanonicalLeagueRuntimeEvent } from '@/lib/league-runtime/leagueRuntimeEvents'
import { resolveRedraftRosterConfig } from '@/lib/redraft/rosterConfigResolver'
import {
  validateRedraftLineup,
  type RedraftLineupPlayer,
  type RedraftLineupValidationIssue,
} from '@/lib/redraft/lineupValidation'
import {
  buildNflRedraftTradeRuntimeState,
  buildTradeLifecycleEvents,
  buildTradeRuntimeEvent,
  executeNflRedraftTrade,
  validateNflRedraftTradeProposal,
  type NflRedraftTradeAssetInput,
  type NflRedraftTradeAssetState,
  type NflRedraftTradeProposalInput,
  type NflRedraftTradeProposalState,
  type NflRedraftTradeRuntimeState,
  type NflRedraftTradeTransactionInput,
  type NflRedraftTradeVoteInput,
} from './canonicalNflRedraftTradeRuntime'

type ResolvedRosterRow = {
  id: string
  teamName: string | null
  ownerName: string | null
  ownerId: string | null
  faabBalance: number | null
  waiverPriority: number | null
  players: Array<{
    playerId: string
    playerName: string
    position: string
    team: string | null
    sport: string | null
    slotType: string | null
    isLocked: boolean | null
    injuryStatus: string | null
    byeWeek: number | null
    acquisitionType: string | null
  }>
}

export type NflRedraftTradeRuntimeResolved =
  | {
      ok: true
      state: NflRedraftTradeRuntimeState
      season: { id: string; leagueId: string; sport: string; season: number; currentWeek: number; status: string }
    }
  | { ok: false; reason: 'season_not_found' | 'league_not_found' | 'not_nfl_redraft' }

export type CreateNflRedraftTradeProposalInput = {
  seasonId?: string | null
  leagueId?: string | null
  proposerRosterId: string
  receiverRosterId: string
  assets: NflRedraftTradeAssetInput[]
  vetoMode?: string | null
  vetoThreshold?: number | null
  reason?: string | null
  expiresInHours?: number | null
  actorUserId?: string | null
  commissionerOverride?: boolean
}

type RuntimeActionResult = {
  state: NflRedraftTradeRuntimeState
  proposal: NflRedraftTradeProposalState | null
  events: CanonicalLeagueRuntimeEvent[]
  resolved: boolean
  voteCounts?: { approve: number; veto: number; threshold: number }
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? { ...(value as Record<string, unknown>) } : {}
}

function textOrNull(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function numberOrNull(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value)
    if (Number.isFinite(parsed)) return parsed
  }
  return null
}

function positiveWeek(value: unknown, fallback: number): number {
  const parsed = numberOrNull(value)
  return parsed == null ? Math.max(1, fallback) : Math.max(1, Math.floor(parsed))
}

function positiveHours(value: unknown, fallback: number): number {
  const parsed = numberOrNull(value)
  return parsed == null || parsed <= 0 ? fallback : Math.max(1, Math.floor(parsed))
}

function normalizeVetoMode(value: unknown): 'commissioner' | 'league_vote' | 'no_veto' {
  const raw = String(value ?? 'commissioner').trim().toLowerCase()
  if (raw === 'league_vote') return 'league_vote'
  if (raw === 'no_veto' || raw === 'none' || raw === 'instant') return 'no_veto'
  return 'commissioner'
}

async function resolveSeason(input: { seasonId?: string | null; leagueId?: string | null }) {
  return prisma.redraftSeason.findFirst({
    where: input.seasonId ? { id: input.seasonId } : { leagueId: input.leagueId ?? undefined },
    orderBy: input.seasonId ? undefined : { createdAt: 'desc' },
  })
}

function eventTitle(event: CanonicalLeagueRuntimeEvent): string {
  switch (event.type) {
    case 'trade.proposed':
      return 'Trade proposed'
    case 'trade.accepted':
      return 'Trade accepted'
    case 'trade.rejected':
      return 'Trade rejected'
    case 'trade.cancelled':
      return 'Trade cancelled'
    case 'trade.expired':
      return 'Trade expired'
    case 'trade.vetoed':
      return 'Trade vetoed'
    case 'trade.league_vote.opened':
      return 'Trade vote opened'
    case 'trade.league_vote.cast':
      return 'Trade vote cast'
    case 'trade.league_vote.passed':
      return 'Trade vote passed'
    case 'trade.league_vote.failed':
      return 'Trade vote failed'
    case 'trade.executed':
    case 'trade.processed':
      return 'Trade processed'
    case 'trade.roster.updated':
      return 'Roster updated by trade'
    case 'trade.transaction.recorded':
      return 'Trade transaction recorded'
    case 'commissioner.trade_override':
      return 'Commissioner trade override'
    default:
      return event.type.replace(/\./g, ' ')
  }
}

async function recordTradeLeagueEvents(events: CanonicalLeagueRuntimeEvent[]) {
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
    // Trade settlement should not fail if an older local schema lacks event rows.
  }
}

async function recordTradeAudit(input: {
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
        targetType: 'redraft_trade_proposal',
        targetId: input.seasonId,
        details: input.details,
      },
    })
  } catch {
    // Best effort for local/test runtimes.
  }
}

function assetFaabAmount(asset: Pick<NflRedraftTradeAssetInput, 'faabAmount' | 'metadata'>): number | null {
  const metadata = asRecord(asset.metadata)
  const parsed = numberOrNull(asset.faabAmount ?? metadata.amount ?? metadata.faab ?? metadata.faabAmount)
  return parsed == null ? null : Math.floor(parsed)
}

function toAssetInput(row: {
  id: string
  fromRosterId: string
  toRosterId: string
  assetType: string
  playerId: string | null
  playerName: string | null
  pickSeason: number | null
  pickRound: number | null
  pickNumber: number | null
  metadata: unknown
}): NflRedraftTradeAssetInput {
  const metadata = asRecord(row.metadata)
  return {
    assetId: row.id,
    fromRosterId: row.fromRosterId,
    toRosterId: row.toRosterId,
    assetType: row.assetType,
    playerId: row.playerId,
    playerName: row.playerName,
    pickSeason: row.pickSeason,
    pickRound: row.pickRound,
    pickNumber: row.pickNumber,
    faabAmount: row.assetType === 'faab' ? assetFaabAmount({ metadata }) : null,
    metadata,
  }
}

function toProposalInput(row: {
  id: string
  proposerRosterId: string
  receiverRosterId: string
  status: string
  vetoMode: string
  vetoThreshold: number | null
  reason: string | null
  expiresAt: Date | null
  createdAt: Date
  acceptedAt: Date | null
  rejectedAt: Date | null
  cancelledAt: Date | null
  processedAt: Date | null
  assets: Array<Parameters<typeof toAssetInput>[0]>
  votes?: Array<{ id: string; rosterId: string; vote: string; reason: string | null; createdAt: Date }>
}): NflRedraftTradeProposalInput {
  const votes: NflRedraftTradeVoteInput[] = (row.votes ?? []).map((vote) => ({
    voteId: vote.id,
    rosterId: vote.rosterId,
    vote: vote.vote,
    reason: vote.reason,
    createdAtIso: vote.createdAt.toISOString(),
  }))
  return {
    proposalId: row.id,
    proposerRosterId: row.proposerRosterId,
    receiverRosterId: row.receiverRosterId,
    status: row.status,
    vetoMode: row.vetoMode,
    vetoThreshold: row.vetoThreshold,
    reason: row.reason,
    expiresAtIso: row.expiresAt?.toISOString() ?? null,
    createdAtIso: row.createdAt.toISOString(),
    acceptedAtIso: row.acceptedAt?.toISOString() ?? null,
    rejectedAtIso: row.rejectedAt?.toISOString() ?? null,
    cancelledAtIso: row.cancelledAt?.toISOString() ?? null,
    processedAtIso: row.processedAt?.toISOString() ?? null,
    assets: row.assets.map(toAssetInput),
    votes,
  }
}

function toTransactionInput(row: {
  id: string
  rosterId: string
  type: string
  createdAt: Date
  metadata: unknown
}): NflRedraftTradeTransactionInput {
  const metadata = asRecord(row.metadata)
  return {
    transactionId: row.id,
    rosterId: row.rosterId,
    type: row.type,
    createdAtIso: row.createdAt.toISOString(),
    proposalId: textOrNull(metadata.proposalId),
    metadata,
  }
}

export async function resolveNflRedraftTradeRuntime(input: {
  seasonId?: string | null
  leagueId?: string | null
  week?: number | null
  now?: Date
}): Promise<NflRedraftTradeRuntimeResolved> {
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
    orderBy: [{ playoffSeed: 'asc' }, { createdAt: 'asc' }],
  })
  const proposals = await prisma.redraftTradeProposal.findMany({
    where: { seasonId: season.id, leagueId: season.leagueId },
    include: {
      assets: true,
      votes: true,
    },
    orderBy: { createdAt: 'desc' },
    take: 150,
  })
  const transactions = await prisma.redraftLeagueTransaction.findMany({
    where: {
      seasonId: season.id,
      leagueId: season.leagueId,
      type: { in: ['trade_proposed', 'trade_rejected', 'trade_cancelled', 'trade_vetoed', 'trade_expired', 'trade_vote_cast', 'trade_processed'] },
    },
    orderBy: { createdAt: 'desc' },
    take: 150,
  })

  const rosterInputs = (rosters as ResolvedRosterRow[]).map((roster) => {
    const players = roster.players.map((player) => ({
      playerId: player.playerId,
      playerName: player.playerName,
      position: player.position,
      team: player.team,
      sport: player.sport ?? season.sport,
      slotType: player.slotType ?? 'BENCH',
      isLocked: player.isLocked,
      injuryStatus: player.injuryStatus,
      byeWeek: player.byeWeek,
      acquisitionType: player.acquisitionType,
    }))
    const lineupPlayers: RedraftLineupPlayer[] = players.map(({ acquisitionType: _acquisitionType, ...player }) => player)
    const validation = validateRedraftLineup({
      sport: season.sport,
      week,
      players: lineupPlayers,
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
      validationIssues: validation.issues.map((issue: RedraftLineupValidationIssue) => ({
        code: issue.code,
        severity: issue.severity,
        message: issue.message,
        playerId: issue.playerId ?? null,
      })),
    }
  })

  const state = buildNflRedraftTradeRuntimeState({
    leagueId: season.leagueId,
    seasonId: season.id,
    season: season.season,
    week,
    rules,
    rosters: rosterInputs,
    proposals: proposals.map(toProposalInput),
    transactions: transactions.map(toTransactionInput),
    activeRosterLimit,
    pickInventorySupported: false,
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

async function recordTransaction(input: {
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

async function upsertDecision(input: {
  proposalId: string
  decision: 'accepted' | 'rejected' | 'vetoed' | 'cancelled' | 'expired' | 'processed'
  actorUserId?: string | null
  reason?: string | null
  snapshot?: Record<string, unknown>
}) {
  return prisma.redraftTradeDecision.upsert({
    where: { proposalId: input.proposalId },
    create: {
      id: crypto.randomUUID(),
      proposalId: input.proposalId,
      decision: input.decision,
      decidedByUserId: input.actorUserId ?? null,
      decisionReason: input.reason ?? null,
      snapshot: input.snapshot ?? {},
    },
    update: {
      decision: input.decision,
      decidedByUserId: input.actorUserId ?? null,
      decisionReason: input.reason ?? null,
      snapshot: input.snapshot ?? {},
    },
  })
}

function persistedAssetData(proposalId: string, assets: NflRedraftTradeAssetInput[]) {
  return assets.map((asset) => {
    const metadata = asRecord(asset.metadata)
    const assetType = String(asset.assetType ?? '').trim() || 'future_consideration'
    return {
      id: crypto.randomUUID(),
      proposalId,
      fromRosterId: asset.fromRosterId,
      toRosterId: asset.toRosterId,
      assetType,
      playerId: asset.playerId ?? null,
      playerName: asset.playerName ?? null,
      pickSeason: asset.pickSeason ?? null,
      pickRound: asset.pickRound ?? null,
      pickNumber: asset.pickNumber ?? null,
      metadata: {
        ...metadata,
        ...(assetType === 'faab' ? { amount: assetFaabAmount(asset) ?? 0 } : {}),
      },
    }
  })
}

export async function createNflRedraftTradeProposal(input: CreateNflRedraftTradeProposalInput) {
  const resolved = await resolveNflRedraftTradeRuntime({ seasonId: input.seasonId, leagueId: input.leagueId })
  if (!resolved.ok) throw new Error(resolved.reason)
  const validation = validateNflRedraftTradeProposal({
    state: resolved.state,
    proposerRosterId: input.proposerRosterId,
    receiverRosterId: input.receiverRosterId,
    assets: input.assets,
    commissionerOverride: input.commissionerOverride,
  })
  if (!validation.ok) throw new Error(validation.message)

  const proposalId = crypto.randomUUID()
  const vetoMode = normalizeVetoMode(input.vetoMode)
  const vetoThreshold = Math.max(1, Math.floor(Number(input.vetoThreshold ?? 4)))
  const expiresAt = new Date(Date.now() + positiveHours(input.expiresInHours, resolved.state.settings.reviewHours) * 3600 * 1000)
  const created = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
    const proposal = await tx.redraftTradeProposal.create({
      data: {
        id: proposalId,
        leagueId: resolved.state.leagueId,
        seasonId: resolved.state.seasonId,
        proposerRosterId: input.proposerRosterId,
        receiverRosterId: input.receiverRosterId,
        status: 'pending',
        vetoMode,
        vetoThreshold,
        reason: input.reason?.trim() || null,
        expiresAt,
      },
    })
    await tx.redraftTradeAsset.createMany({
      data: persistedAssetData(proposal.id, input.assets),
    })
    await tx.redraftLeagueTransaction.create({
      data: {
        leagueId: resolved.state.leagueId,
        seasonId: resolved.state.seasonId,
        rosterId: input.proposerRosterId,
        type: 'trade_proposed',
        metadata: {
          proposalId: proposal.id,
          proposerRosterId: input.proposerRosterId,
          receiverRosterId: input.receiverRosterId,
          vetoMode,
          vetoThreshold,
          warnings: validation.warnings,
          rosterImpact: validation.rosterImpact,
          actorUserId: input.actorUserId ?? null,
        },
      },
    })
    return tx.redraftTradeProposal.findUnique({
      where: { id: proposal.id },
      include: { assets: true, votes: true, decision: true },
    })
  })

  const events = buildTradeLifecycleEvents({
    state: resolved.state,
    proposalId,
    type: 'proposed',
    actorUserId: input.actorUserId,
    payload: { proposerRosterId: input.proposerRosterId, receiverRosterId: input.receiverRosterId, vetoMode },
  })
  if (vetoMode === 'league_vote') {
    events.push(
      ...buildTradeLifecycleEvents({
        state: resolved.state,
        proposalId,
        type: 'league_vote_opened',
        actorUserId: input.actorUserId,
        payload: { vetoThreshold },
      }),
    )
  }
  await recordTradeLeagueEvents(events)
  return { proposal: created, validation, events }
}

function proposalAssetsForDb(assets: NflRedraftTradeAssetState[]): Prisma.InputJsonArray {
  return assets.map((asset) => ({
    fromRosterId: asset.fromRosterId,
    toRosterId: asset.toRosterId,
    assetType: asset.assetType,
    playerId: asset.playerId,
    playerName: asset.playerName,
    metadata: asset.metadata as Prisma.InputJsonObject,
  })) as Prisma.InputJsonArray
}

async function applyExecutedTrade(input: {
  state: NflRedraftTradeRuntimeState
  proposalId: string
  actorUserId?: string | null
  commissionerOverride?: boolean
}) {
  const execution = executeNflRedraftTrade({
    state: input.state,
    proposalId: input.proposalId,
    actorUserId: input.actorUserId,
    commissionerOverride: input.commissionerOverride,
  })
  if (!execution.ok) throw new Error(execution.validation.ok ? 'trade_execution_failed' : execution.validation.message)

  const proposal = input.state.proposals.find((row) => row.proposalId === input.proposalId)
  if (!proposal) throw new Error('proposal_not_found')
  const now = new Date()
  await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
    const claimed = await tx.redraftTradeProposal.updateMany({
      where: { id: input.proposalId, status: 'pending' },
      data: { status: 'accepted', acceptedAt: now, processedAt: now },
    })
    if (claimed.count === 0) throw new Error('PROPOSAL_ALREADY_RESOLVED')

    const faabDelta = new Map<string, number>()
    for (const asset of proposal.assets) {
      if (asset.assetType === 'player' && asset.playerId) {
        const moved = await tx.redraftRosterPlayer.updateMany({
          where: { rosterId: asset.fromRosterId, playerId: asset.playerId, droppedAt: null },
          data: { rosterId: asset.toRosterId, acquisitionType: 'trade', slotType: 'BENCH', isLocked: false },
        })
        if (moved.count === 0) throw new Error(`Traded player ${asset.playerId} is no longer on the sending roster`)
      }
      if (asset.assetType === 'faab' && asset.faabAmount) {
        faabDelta.set(asset.fromRosterId, (faabDelta.get(asset.fromRosterId) ?? 0) - asset.faabAmount)
        faabDelta.set(asset.toRosterId, (faabDelta.get(asset.toRosterId) ?? 0) + asset.faabAmount)
      }
    }

    for (const [rosterId, delta] of faabDelta) {
      if (delta === 0) continue
      const roster = await tx.redraftRoster.findUnique({ where: { id: rosterId }, select: { faabBalance: true } })
      const next = Math.max(0, (roster?.faabBalance ?? 0) + delta)
      await tx.redraftRoster.update({ where: { id: rosterId }, data: { faabBalance: next } })
    }

    for (const rosterId of [proposal.proposerRosterId, proposal.receiverRosterId]) {
      await tx.redraftLeagueTransaction.create({
        data: {
          leagueId: input.state.leagueId,
          seasonId: input.state.seasonId,
          rosterId,
          type: 'trade_processed',
          metadata: {
            proposalId: input.proposalId,
            transactionId: execution.transaction.transactionId,
            proposerRosterId: proposal.proposerRosterId,
            receiverRosterId: proposal.receiverRosterId,
            assets: proposalAssetsForDb(proposal.assets),
            rosterImpact: execution.rosterImpact as unknown as Prisma.InputJsonValue,
            actorUserId: input.actorUserId ?? null,
            commissionerOverride: input.commissionerOverride === true,
          } as Prisma.InputJsonObject,
        },
      })
    }

    await tx.redraftTradeDecision.upsert({
      where: { proposalId: input.proposalId },
      create: {
        id: crypto.randomUUID(),
        proposalId: input.proposalId,
        decision: 'accepted',
        decidedByUserId: input.actorUserId ?? null,
        decisionReason: input.commissionerOverride ? 'Commissioner override' : null,
        snapshot: { rosterImpact: execution.rosterImpact },
      },
      update: {
        decision: 'accepted',
        decidedByUserId: input.actorUserId ?? null,
        decisionReason: input.commissionerOverride ? 'Commissioner override' : null,
        snapshot: { rosterImpact: execution.rosterImpact },
      },
    })
  })

  await recordTradeLeagueEvents(execution.events)
  await recordTradeAudit({
    actorUserId: input.actorUserId ?? 'system',
    action: input.commissionerOverride ? 'redraft_trade_commissioner_override_execute' : 'redraft_trade_execute',
    seasonId: input.state.seasonId,
    details: { proposalId: input.proposalId, rosterImpact: execution.rosterImpact },
  })
  const next = await resolveNflRedraftTradeRuntime({ seasonId: input.state.seasonId, week: input.state.week })
  if (!next.ok) throw new Error(next.reason)
  return { state: next.state, proposal: execution.proposal, events: execution.events, resolved: true }
}

async function updateTerminalProposal(input: {
  state: NflRedraftTradeRuntimeState
  proposal: NflRedraftTradeProposalState
  status: 'rejected' | 'cancelled' | 'vetoed' | 'expired'
  actorUserId?: string | null
  reason?: string | null
  commissionerOverride?: boolean
}): Promise<RuntimeActionResult> {
  const now = new Date()
  const timestampField =
    input.status === 'rejected'
      ? { rejectedAt: now, processedAt: now }
      : input.status === 'cancelled'
        ? { cancelledAt: now, processedAt: now }
        : { processedAt: now }
  await prisma.redraftTradeProposal.update({
    where: { id: input.proposal.proposalId },
    data: { status: input.status, ...timestampField },
    include: { assets: true, votes: true, decision: true },
  })
  await upsertDecision({
    proposalId: input.proposal.proposalId,
    decision: input.status,
    actorUserId: input.actorUserId,
    reason: input.reason,
  })
  await recordTransaction({
    leagueId: input.state.leagueId,
    seasonId: input.state.seasonId,
    rosterId: input.proposal.proposerRosterId,
    type: `trade_${input.status}`,
    metadata: {
      proposalId: input.proposal.proposalId,
      proposerRosterId: input.proposal.proposerRosterId,
      receiverRosterId: input.proposal.receiverRosterId,
      reason: input.reason ?? null,
      actorUserId: input.actorUserId ?? null,
      commissionerOverride: input.commissionerOverride === true,
    },
  })
  const lifecycleType =
    input.status === 'cancelled'
      ? 'cancelled'
      : input.status === 'expired'
        ? 'expired'
        : input.status === 'vetoed'
          ? 'vetoed'
          : 'rejected'
  const events = buildTradeLifecycleEvents({
    state: input.state,
    proposalId: input.proposal.proposalId,
    type: lifecycleType,
    actorUserId: input.actorUserId,
    payload: { reason: input.reason ?? null },
  })
  if (input.commissionerOverride) {
    events.push(
      buildTradeRuntimeEvent({
        leagueId: input.state.leagueId,
        type: 'commissioner.trade_override',
        actorUserId: input.actorUserId ?? null,
        payload: { seasonId: input.state.seasonId, proposalId: input.proposal.proposalId, action: input.status },
      }),
    )
  }
  await recordTradeLeagueEvents(events)
  const next = await resolveNflRedraftTradeRuntime({ seasonId: input.state.seasonId, week: input.state.week })
  if (!next.ok) throw new Error(next.reason)
  return {
    state: next.state,
    proposal: next.state.proposals.find((row) => row.proposalId === input.proposal.proposalId) ?? null,
    events,
    resolved: true,
  }
}

export async function actOnNflRedraftTradeProposal(input: {
  proposalId: string
  action: 'accept' | 'reject' | 'cancel' | 'commissioner_veto' | 'commissioner_approve' | 'expire'
  actorUserId?: string | null
  reason?: string | null
  commissionerOverride?: boolean
}): Promise<RuntimeActionResult> {
  const proposalRow = await prisma.redraftTradeProposal.findUnique({
    where: { id: input.proposalId },
    select: { seasonId: true },
  })
  if (!proposalRow) throw new Error('proposal_not_found')
  const resolved = await resolveNflRedraftTradeRuntime({ seasonId: proposalRow.seasonId })
  if (!resolved.ok) throw new Error(resolved.reason)
  const proposal = resolved.state.proposals.find((row) => row.proposalId === input.proposalId)
  if (!proposal) throw new Error('proposal_not_found')
  if (proposal.status !== 'pending') throw new Error('proposal_not_pending')
  if (proposal.expiresAtIso && Date.parse(proposal.expiresAtIso) < Date.now()) {
    return updateTerminalProposal({
      state: resolved.state,
      proposal,
      status: 'expired',
      actorUserId: input.actorUserId,
      reason: 'Proposal expired before action',
    })
  }

  if (input.action === 'accept' || input.action === 'commissioner_approve') {
    return applyExecutedTrade({
      state: resolved.state,
      proposalId: input.proposalId,
      actorUserId: input.actorUserId,
      commissionerOverride: input.action === 'commissioner_approve' || input.commissionerOverride === true,
    })
  }
  if (input.action === 'reject') {
    return updateTerminalProposal({
      state: resolved.state,
      proposal,
      status: 'rejected',
      actorUserId: input.actorUserId,
      reason: input.reason,
    })
  }
  if (input.action === 'cancel') {
    return updateTerminalProposal({
      state: resolved.state,
      proposal,
      status: 'cancelled',
      actorUserId: input.actorUserId,
      reason: input.reason,
    })
  }
  if (input.action === 'commissioner_veto') {
    return updateTerminalProposal({
      state: resolved.state,
      proposal,
      status: 'vetoed',
      actorUserId: input.actorUserId,
      reason: input.reason,
      commissionerOverride: true,
    })
  }
  return updateTerminalProposal({
    state: resolved.state,
    proposal,
    status: 'expired',
    actorUserId: input.actorUserId,
    reason: input.reason ?? 'Proposal expired',
  })
}

export async function castNflRedraftTradeVote(input: {
  proposalId: string
  voterRosterId: string
  vote: 'approve' | 'veto'
  actorUserId?: string | null
  reason?: string | null
}): Promise<RuntimeActionResult> {
  const proposalRow = await prisma.redraftTradeProposal.findUnique({
    where: { id: input.proposalId },
    select: { seasonId: true },
  })
  if (!proposalRow) throw new Error('proposal_not_found')
  const resolved = await resolveNflRedraftTradeRuntime({ seasonId: proposalRow.seasonId })
  if (!resolved.ok) throw new Error(resolved.reason)
  const proposal = resolved.state.proposals.find((row) => row.proposalId === input.proposalId)
  if (!proposal) throw new Error('proposal_not_found')
  if (proposal.status !== 'pending') throw new Error('proposal_not_pending')
  if (proposal.vetoMode !== 'league_vote') throw new Error('league_vote_not_enabled')
  if (input.voterRosterId === proposal.proposerRosterId || input.voterRosterId === proposal.receiverRosterId) {
    throw new Error('trade_parties_cannot_vote')
  }

  await prisma.redraftTradeVote.upsert({
    where: { proposalId_rosterId: { proposalId: input.proposalId, rosterId: input.voterRosterId } },
    create: {
      id: crypto.randomUUID(),
      proposalId: input.proposalId,
      rosterId: input.voterRosterId,
      vote: input.vote,
      reason: input.reason?.trim() || null,
    },
    update: {
      vote: input.vote,
      reason: input.reason?.trim() || null,
    },
  })
  await recordTransaction({
    leagueId: resolved.state.leagueId,
    seasonId: resolved.state.seasonId,
    rosterId: input.voterRosterId,
    type: 'trade_vote_cast',
    metadata: {
      proposalId: input.proposalId,
      vote: input.vote,
      actorUserId: input.actorUserId ?? null,
    },
  })

  const fresh = await resolveNflRedraftTradeRuntime({ seasonId: resolved.state.seasonId })
  if (!fresh.ok) throw new Error(fresh.reason)
  const freshProposal = fresh.state.proposals.find((row) => row.proposalId === input.proposalId)
  if (!freshProposal) throw new Error('proposal_not_found')
  const voteEvents = buildTradeLifecycleEvents({
    state: fresh.state,
    proposalId: input.proposalId,
    type: 'league_vote_cast',
    actorUserId: input.actorUserId,
    payload: { voterRosterId: input.voterRosterId, vote: input.vote, voteCounts: freshProposal.voteCounts },
  })
  await recordTradeLeagueEvents(voteEvents)

  if (freshProposal.voteCounts.veto >= freshProposal.voteCounts.threshold) {
    const failedEvents = buildTradeLifecycleEvents({
      state: fresh.state,
      proposalId: input.proposalId,
      type: 'league_vote_failed',
      actorUserId: input.actorUserId,
      payload: { voteCounts: freshProposal.voteCounts },
    })
    await recordTradeLeagueEvents(failedEvents)
    const vetoed = await updateTerminalProposal({
      state: fresh.state,
      proposal: freshProposal,
      status: 'vetoed',
      actorUserId: input.actorUserId,
      reason: `League vote veto threshold reached (${freshProposal.voteCounts.veto}/${freshProposal.voteCounts.threshold})`,
    })
    vetoed.events.unshift(...failedEvents)
    return { ...vetoed, voteCounts: freshProposal.voteCounts }
  }

  if (freshProposal.voteCounts.approve >= freshProposal.voteCounts.threshold) {
    const passedEvents = buildTradeLifecycleEvents({
      state: fresh.state,
      proposalId: input.proposalId,
      type: 'league_vote_passed',
      actorUserId: input.actorUserId,
      payload: { voteCounts: freshProposal.voteCounts },
    })
    await recordTradeLeagueEvents(passedEvents)
    const approved = await applyExecutedTrade({
      state: fresh.state,
      proposalId: input.proposalId,
      actorUserId: input.actorUserId,
    })
    approved.events.unshift(...passedEvents)
    return { ...approved, voteCounts: freshProposal.voteCounts }
  }

  return { state: fresh.state, proposal: freshProposal, events: voteEvents, resolved: false, voteCounts: freshProposal.voteCounts }
}
