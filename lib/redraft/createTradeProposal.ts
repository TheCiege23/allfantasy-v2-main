/**
 * MAKING A REDRAFT TRADE OFFER — the one implementation.
 *
 * Moved verbatim out of app/api/redraft/trade-proposals/route.ts so that anything that makes an offer
 * (a manager through the route, and Chimmy countering for a team it runs) goes through exactly the
 * same steps: the league's review mode, asset checks, creation-time validation (ownership, FAAB,
 * locks, roster limits, the deadline), the post-draft lock, tournament rules, the value snapshot, the
 * notice to the other manager, and the market ledger.
 *
 * WHO may make the offer is the caller's job: the route checks the session user runs the proposing
 * team, and that a Chimmy team on the other side takes offers, before calling.
 */
import type { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { toPrismaJsonInput } from '@/lib/prisma-json'
import { readSeasonTradePolicy, SeasonTradeError, seasonTradeOfferExpiry } from '@/lib/tournament/seasonTradePolicy'
import { postDraftRosterMoveRefusal } from '@/server/services/postDraftRosterLockService'
import { validateRedraftTradeProposalAtCreation } from '@/lib/redraft/tradeProposalValidation'
import { REDRAFT_MOVES_LOCKED_CODE, REDRAFT_MOVES_LOCKED_STATUS } from '@/lib/redraft/tradeMoveLock'
import { resolveRedraftTradeGovernance } from '@/lib/redraft/tradeGovernance'
import { recordAfLearningEvent } from '@/lib/ai-learning-system/recordEvent'
import { resolveLeagueSport } from '@/lib/ai-learning-system/resolveLeagueSport'
import { captureRedraftTradeValueSnapshot } from '@/lib/trade-value/captureSnapshot'
import { recordRedraftTradeMarketEvent } from '@/lib/trade-market/redraftTradeMarketEvents'
import { safeDisplayName } from '@/lib/chat-notifications/displayName'
import { tradeParticipantRosterIds, uninvolvedTradeParticipants } from '@/lib/redraft/tradeParticipants'

/**
 * 🛑 THE RECEIVER OF A REDRAFT TRADE OFFER WAS NEVER TOLD. This route wrote the proposal, its value
 * snapshot, a learning event and two market-ledger rows — and addressed nothing to the manager the
 * offer was made to, so an offer sat unanswered until they happened to open the Trades tab. The
 * native trade engine has sent `trade_proposed` since 2026-09 (tradeService.notifyOnTradeCreated);
 * this is the same notice, in the same `trade_proposals` category, so the same settings govern it.
 *
 * It also posts the offer card into the two managers' DM (lib/chat-notifications/tradeOfferDm.ts).
 *
 * Fire-and-forget through dynamic imports: the proposal is committed before this runs, and a
 * notification or DM failure must never fail or slow the proposal. Each half has its own catch.
 */
export function afterRedraftProposalCreated(input: {
  proposalId: string
  leagueId: string
  proposerUserId: string
  receiverUserId: string | null | undefined
  proposerName: string
  /**
   * Multi-team trades: the owners of the teams beyond the receiver. Each gets the same notice. The DM
   * card is a two-manager card in a two-person thread, so a multi-team offer posts no DM.
   */
  additionalUserIds?: Array<string | null | undefined>
  teamCount?: number
}): void {
  const receiverUserId = input.receiverUserId
  if ((input.teamCount ?? 2) > 2) {
    const userIds = [...new Set([receiverUserId, ...(input.additionalUserIds ?? [])])].filter(
      (id): id is string => typeof id === 'string' && id.length > 0 && id !== input.proposerUserId,
    )
    if (userIds.length === 0) return
    try {
      void import('@/lib/notifications/NotificationDispatcher')
        .then(({ dispatchNotification }) =>
          dispatchNotification({
            userIds,
            category: 'trade_proposals',
            productType: 'app',
            type: 'trade_proposed',
            title: 'New trade offer',
            body: `${input.proposerName} sent you a ${input.teamCount}-team trade offer. Every team has to accept it. Open it to accept or decline.`,
            actionHref: `/league/${encodeURIComponent(input.leagueId)}?view=trades`,
            actionLabel: 'View Trade',
            leagueId: input.leagueId,
            severity: 'medium',
            dedupePrefix: `redraft_trade:${input.proposalId}:proposed`,
            meta: { leagueId: input.leagueId, tradeProposalId: input.proposalId, pushTag: `trade-offer-${input.proposalId}` },
          }).catch(() => null),
        )
        .catch(() => undefined)
    } catch {
      /* never reaches the proposal response */
    }
    return
  }
  if (!receiverUserId || receiverUserId === input.proposerUserId) return
  try {
    void Promise.all([
      import('@/lib/notifications/NotificationDispatcher'),
      import('@/lib/chat-notifications/tradeOfferDm'),
      import('@/lib/chat-notifications/tradeOfferSources'),
    ])
      .then(async ([{ dispatchNotification }, dm, sources]) => {
        await dispatchNotification({
          userIds: [receiverUserId],
          category: 'trade_proposals',
          productType: 'app',
          type: 'trade_proposed',
          title: 'New trade offer',
          body: `${input.proposerName} sent you a trade offer. Open it to accept, counter, or decline.`,
          actionHref: `/league/${encodeURIComponent(input.leagueId)}?view=trades`,
          actionLabel: 'View Trade',
          leagueId: input.leagueId,
          severity: 'medium',
          dedupePrefix: `redraft_trade:${input.proposalId}:proposed`,
          meta: { leagueId: input.leagueId, tradeProposalId: input.proposalId, pushTag: `trade-offer-${input.proposalId}` },
        }).catch(() => null)
        await dm
          .postTradeOfferToDm({
            source: 'redraft',
            tradeId: input.proposalId,
            load: () => sources.loadRedraftTradeOffer(input.proposalId),
          })
          .catch(() => null)
      })
      .catch(() => undefined)
  } catch {
    /* never reaches the proposal response */
  }
}

export type TradeAssetInput = {
  fromRosterId?: string
  toRosterId?: string
  assetType?: string
  playerId?: string
  playerName?: string
  pickSeason?: number
  pickRound?: number
  pickNumber?: number
  metadata?: unknown
}

type RosterRow = { id: string; ownerId: string; ownerName?: string | null; teamName?: string | null }

export type CreateRedraftTradeProposalInput = {
  leagueId: string
  seasonId: string
  season: { sport: string; season?: number | null; league?: { leagueVariant?: string | null } | null }
  proposer: RosterRow
  receiver: RosterRow
  additionalRosters: RosterRow[]
  additionalRosterIds: string[]
  /** Who is making the offer, for the ledger and the notice. The caller has checked they may. */
  actorUserId: string
  /** The name on the notice. Defaults to the proposing team's own name. */
  proposerName?: string
  reason?: string
  expiresInHours?: number
  assets?: TradeAssetInput[]
}

type Refusal = { ok: false; status: number; body: Record<string, unknown> }
const refuse = (body: Record<string, unknown>, init: { status: number }): Refusal => ({ ok: false, status: init.status, body })

export async function createRedraftTradeProposal(input: CreateRedraftTradeProposalInput) {
  const { leagueId, seasonId, season, proposer, receiver, additionalRosters, additionalRosterIds, actorUserId: userId } = input
  const proposerRosterId = proposer.id
  const receiverRosterId = receiver.id
  const multiTeam = additionalRosterIds.length > 0
  const { vetoMode, vetoThreshold } = await resolveRedraftTradeGovernance(prisma, leagueId)
  const expiresHoursInput = Number(input.expiresInHours)
  const expiresHours = Number.isFinite(expiresHoursInput) && expiresHoursInput > 0 ? Math.floor(expiresHoursInput) : 48
  const expiresAt = new Date(Date.now() + expiresHours * 3600 * 1000)

  const rawAssets = Array.isArray(input.assets) ? input.assets : []
  const assets = rawAssets
    .map((asset) => ({
      fromRosterId: asset.fromRosterId?.trim(),
      toRosterId: asset.toRosterId?.trim(),
      assetType: asset.assetType?.trim(),
      playerId: asset.playerId?.trim() || null,
      playerName: asset.playerName?.trim() || null,
      pickSeason: Number.isFinite(Number(asset.pickSeason)) ? Number(asset.pickSeason) : null,
      pickRound: Number.isFinite(Number(asset.pickRound)) ? Number(asset.pickRound) : null,
      pickNumber: Number.isFinite(Number(asset.pickNumber)) ? Number(asset.pickNumber) : null,
      metadata: (asset.metadata ?? {}) as Record<string, unknown>,
    }))
    .filter((asset) => asset.fromRosterId && asset.toRosterId && asset.assetType)

  if (assets.length === 0) {
    return refuse({ error: 'At least one valid asset is required' }, { status: 400 })
  }

  const allowedAssetTypes = new Set(['player', 'draft_pick', 'faab', 'future_consideration', 'zombie_item'])
  // Proposer and receiver for a two-team trade — exactly the pair this always checked.
  const participantRosterIds = tradeParticipantRosterIds({ proposerRosterId, receiverRosterId, additionalRosterIds })
  for (const asset of assets) {
    if (!allowedAssetTypes.has(asset.assetType!)) {
      return refuse({ error: `Invalid assetType: ${asset.assetType}` }, { status: 400 })
    }
    const fromRosterId = asset.fromRosterId!
    const toRosterId = asset.toRosterId!
    if (
      !participantRosterIds.includes(fromRosterId) ||
      !participantRosterIds.includes(toRosterId) ||
      fromRosterId === toRosterId
    ) {
      return refuse({ error: 'Asset roster direction is invalid' }, { status: 400 })
    }
  }
  // Every team in a multi-team trade must send or receive something — a team that does neither is
  // not in the trade. (A two-team trade always passes: every asset moves between its only two teams.)
  if (multiTeam && uninvolvedTradeParticipants(participantRosterIds, assets as Array<{ fromRosterId: string; toRosterId: string }>).length > 0) {
    return refuse(
      { error: 'Every team in a multi-team trade must send or receive at least one asset.', code: 'TEAM_NOT_IN_TRADE' },
      { status: 400 },
    )
  }

  // Ownership, FAAB, duplicates, locks, roster limits, deadline — checked now, not at settlement days later.
  // See lib/redraft/tradeProposalValidation.ts.
  const validation = await validateRedraftTradeProposalAtCreation({
    leagueId,
    seasonId,
    proposerRosterId,
    receiverRosterId,
    ...(multiTeam ? { additionalRosterIds } : {}),
    assets: assets.map((asset) => ({
      fromRosterId: asset.fromRosterId!,
      toRosterId: asset.toRosterId!,
      assetType: asset.assetType!,
      playerId: asset.playerId,
      playerName: asset.playerName,
      pickSeason: asset.pickSeason,
      pickRound: asset.pickRound,
      pickNumber: asset.pickNumber,
      metadata: asset.metadata,
    })),
  })
  if (!validation.ok) {
    // The move lock is league state, not a bad request: 409, for every sport — NFL's runtime refusal included.
    const status = validation.code === REDRAFT_MOVES_LOCKED_CODE ? REDRAFT_MOVES_LOCKED_STATUS : 400
    return refuse({ error: validation.message, code: validation.code }, { status })
  }

  // This path does not go through the lifecycle gate, so it applies the post-draft roster lock itself —
  // after validation (incl. the deadline) so every existing refusal answers exactly as before.
  const postDraftLock = await postDraftRosterMoveRefusal(leagueId, 'trade')
  if (postDraftLock) {
    return refuse(
      { error: postDraftLock.error, code: postDraftLock.code, unlocksAt: postDraftLock.unlocksAt },
      { status: postDraftLock.status },
    )
  }

  const created = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
    let tournamentExpiry = expiresAt
    if (season.league?.leagueVariant === 'season_tournament') {
      const policy = await readSeasonTradePolicy(tx, leagueId, true)
      if (!policy || policy.seasonId !== seasonId || multiTeam || assets.some(asset => asset.assetType !== 'player' && asset.assetType !== 'faab')) {
        throw new SeasonTradeError('This tournament accepts player and FAAB trades between two teams in its active stage.')
      }
      tournamentExpiry = seasonTradeOfferExpiry(policy, expiresAt, new Date())
    }
    const proposal = await tx.redraftTradeProposal.create({
      data: {
        id: crypto.randomUUID(),
        leagueId,
        seasonId,
        proposerRosterId,
        receiverRosterId,
        ...(multiTeam ? { additionalRosterIds } : {}),
        vetoMode,
        vetoThreshold,
        reason: input.reason?.trim() || null,
        expiresAt: tournamentExpiry,
      },
    })

    await tx.redraftTradeAsset.createMany({
      data: assets.map((asset) => ({
        id: crypto.randomUUID(),
        proposalId: proposal.id,
        fromRosterId: asset.fromRosterId!,
        toRosterId: asset.toRosterId!,
        assetType: asset.assetType!,
        playerId: asset.playerId,
        playerName: asset.playerName,
        pickSeason: asset.pickSeason,
        pickRound: asset.pickRound,
        pickNumber: asset.pickNumber,
        metadata: toPrismaJsonInput(asset.metadata),
      })),
    })

    return tx.redraftTradeProposal.findUnique({
      where: { id: proposal.id },
      include: { assets: true, votes: true, decision: true },
    })
  }).catch(error => {
    if (error instanceof SeasonTradeError) return { seasonTradeError: error.message }
    throw error
  })
  if (created && 'seasonTradeError' in created) {
    return refuse({ error: created.seasonTradeError }, { status: 409 })
  }

  // T2: capture the immutable deterministic value snapshot at proposal time. Best-effort — a
  // valuation issue must never block trade creation, but it is expected to succeed.
  // ⚠ Two-team only: the snapshot prices a proposer side against a receiver side, and a multi-team
  // trade has no single other side, so a snapshot of it would be a confident wrong number. The
  // Decision OS evaluation below reads the snapshot, so it is skipped with it.
  if (created?.id && !multiTeam && !assets.some(a => a.assetType === 'zombie_item')) {
    try {
      await captureRedraftTradeValueSnapshot({
        proposalId: created.id,
        seasonId,
        /*
         * ⚠ WITHOUT THIS THE SNAPSHOT IS PRICED AS A STANDARD 12-TEAM 1-QB LEAGUE. The `scoring`
         * string two lines below is a LABEL for the context record and is hardcoded; the real
         * scarcity settings (slots, team count, PPR, TE premium) are read from the league inside
         * `captureRedraftTradeValueSnapshot`, and only when this id is supplied.
         */
        leagueId,
        proposerRosterId,
        receiverRosterId,
        sport: season.sport,
        scoring: season.sport === 'NCAAF' ? 'standard' : 'ppr',
        rosterFormat: 'standard',
        currentSeason: season.season ?? null,
        assets: assets.map((a) => ({
          fromRosterId: a.fromRosterId!,
          toRosterId: a.toRosterId!,
          assetType: a.assetType!,
          playerId: a.playerId,
          playerName: a.playerName,
          pickSeason: a.pickSeason,
          pickRound: a.pickRound,
          metadata: a.metadata,
        })),
      })
    } catch (e) {
      console.error('[redraft/trade-proposals] value snapshot capture failed', e)
    }
  }

  if (created?.id) {
    void resolveLeagueSport(leagueId).then((sport) =>
      recordAfLearningEvent({
        eventType: 'trade_proposal_created',
        sport,
        leagueId,
        userId,
        source: 'redraft_trade_proposal',
        payload: { proposalId: created.id, assetCount: assets.length, vetoMode, ...(multiTeam ? { teamCount: participantRosterIds.length } : {}) },
      }),
    )
  }

  if (created?.id) {
    afterRedraftProposalCreated({
      proposalId: created.id,
      leagueId,
      proposerUserId: userId,
      receiverUserId: receiver.ownerId,
      proposerName: input.proposerName ?? safeDisplayName([proposer.teamName, proposer.ownerName], 'A league mate'),
      ...(multiTeam
        ? { additionalUserIds: additionalRosters.map((r) => r.ownerId), teamCount: participantRosterIds.length }
        : {}),
    })
  }

  const snapshotRow = created?.id
    ? await prisma.redraftTradeValueSnapshot.findUnique({ where: { proposalId: created.id } })
    : null

  // T3 market ledger: proposal_created (+ value_snapshot_created when a snapshot was captured).
  if (created?.id) {
    await recordRedraftTradeMarketEvent({
      leagueId, seasonId, tradeProposalId: created.id, eventType: 'proposal_created', actorUserId: userId,
    })
    if (snapshotRow) {
      await recordRedraftTradeMarketEvent({
        leagueId, seasonId, tradeProposalId: created.id, eventType: 'value_snapshot_created', actorUserId: userId,
      })
    }
  }

  return { ok: true as const, created, snapshotRow, assets, vetoMode }
}
