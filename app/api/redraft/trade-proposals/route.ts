import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { assertLeagueMember } from '@/lib/league/league-access'
import { recordAfLearningEvent } from '@/lib/ai-learning-system/recordEvent'
import { resolveLeagueSport } from '@/lib/ai-learning-system/resolveLeagueSport'
import { captureRedraftTradeValueSnapshot } from '@/lib/trade-value/captureSnapshot'
import { recordRedraftTradeMarketEvent } from '@/lib/trade-market/redraftTradeMarketEvents'
import { shouldRunTradeShadow, shouldRunTradeLive, runTradeShadowForProposal } from '@/lib/decision-os/trade/shadow'
import { toTradeCard, type TradeCard } from '@/lib/decision-os/trade/tradeCardAdapter'
import { getDecisionShadowScopeFilters } from '@/lib/decision-os/core/shadow'
import { emitLiveTelemetry } from '@/lib/decision-os/core/parity'

export const dynamic = 'force-dynamic'

type TradeAssetInput = {
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

function parseVetoMode(input: string | undefined): 'commissioner' | 'league_vote' | 'no_veto' {
  if (input === 'league_vote' || input === 'no_veto') return input
  return 'commissioner'
}

export async function GET(req: NextRequest) {
  const session = (await getServerSession(authOptions as never)) as { user?: { id?: string } } | null
  const userId = session?.user?.id
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const leagueId = req.nextUrl.searchParams?.get('leagueId')?.trim()
  const seasonId = req.nextUrl.searchParams?.get('seasonId')?.trim()
  const status = req.nextUrl.searchParams?.get('status')?.trim()
  if (!leagueId || !seasonId) {
    return NextResponse.json({ error: 'leagueId and seasonId required' }, { status: 400 })
  }

  const gate = await assertLeagueMember(leagueId, userId)
  if (!gate.ok) return NextResponse.json({ error: 'Forbidden' }, { status: gate.status })

  const proposals = await prisma.redraftTradeProposal.findMany({
    where: {
      leagueId,
      seasonId,
      ...(status ? { status } : {}),
    },
    include: {
      assets: true,
      votes: true,
      decision: true,
      valueSnapshot: true,
    },
    orderBy: { createdAt: 'desc' },
    take: 100,
  })

  return NextResponse.json({ proposals })
}

export async function POST(req: NextRequest) {
  const session = (await getServerSession(authOptions as never)) as { user?: { id?: string } } | null
  const userId = session?.user?.id
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let body: {
    leagueId?: string
    seasonId?: string
    proposerRosterId?: string
    receiverRosterId?: string
    vetoMode?: string
    vetoThreshold?: number
    reason?: string
    expiresInHours?: number
    assets?: TradeAssetInput[]
  }
  try {
    body = (await req.json()) as typeof body
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const leagueId = body.leagueId?.trim()
  const seasonId = body.seasonId?.trim()
  const proposerRosterId = body.proposerRosterId?.trim()
  const receiverRosterId = body.receiverRosterId?.trim()
  if (!leagueId || !seasonId || !proposerRosterId || !receiverRosterId) {
    return NextResponse.json({ error: 'Missing fields' }, { status: 400 })
  }
  if (proposerRosterId === receiverRosterId) {
    return NextResponse.json({ error: 'Rosters must be different' }, { status: 400 })
  }

  const gate = await assertLeagueMember(leagueId, userId)
  if (!gate.ok) return NextResponse.json({ error: 'Forbidden' }, { status: gate.status })

  const [season, proposer, receiver] = await Promise.all([
    prisma.redraftSeason.findFirst({ where: { id: seasonId, leagueId } }),
    prisma.redraftRoster.findFirst({ where: { id: proposerRosterId, seasonId, leagueId } }),
    prisma.redraftRoster.findFirst({ where: { id: receiverRosterId, seasonId, leagueId } }),
  ])

  if (!season) return NextResponse.json({ error: 'Season not found' }, { status: 404 })
  if (!proposer || !receiver) {
    return NextResponse.json({ error: 'Roster not found for season' }, { status: 404 })
  }
  if (proposer.ownerId !== userId) {
    return NextResponse.json({ error: 'Only proposer roster owner can create trade' }, { status: 403 })
  }

  const vetoMode = parseVetoMode(body.vetoMode?.trim())
  const thresholdInput = Number(body.vetoThreshold)
  const vetoThreshold = Number.isFinite(thresholdInput) && thresholdInput > 0 ? Math.floor(thresholdInput) : 4
  const expiresHoursInput = Number(body.expiresInHours)
  const expiresHours = Number.isFinite(expiresHoursInput) && expiresHoursInput > 0 ? Math.floor(expiresHoursInput) : 48
  const expiresAt = new Date(Date.now() + expiresHours * 3600 * 1000)

  const rawAssets = Array.isArray(body.assets) ? body.assets : []
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
    return NextResponse.json({ error: 'At least one valid asset is required' }, { status: 400 })
  }

  const allowedAssetTypes = new Set(['player', 'draft_pick', 'faab', 'future_consideration'])
  for (const asset of assets) {
    if (!allowedAssetTypes.has(asset.assetType!)) {
      return NextResponse.json({ error: `Invalid assetType: ${asset.assetType}` }, { status: 400 })
    }
    const fromRosterId = asset.fromRosterId!
    const toRosterId = asset.toRosterId!
    if (
      ![proposerRosterId, receiverRosterId].includes(fromRosterId) ||
      ![proposerRosterId, receiverRosterId].includes(toRosterId) ||
      fromRosterId === toRosterId
    ) {
      return NextResponse.json({ error: 'Asset roster direction is invalid' }, { status: 400 })
    }
  }

  const created = await prisma.$transaction(async (tx: any) => {
    const proposal = await tx.redraftTradeProposal.create({
      data: {
        id: crypto.randomUUID(),
        leagueId,
        seasonId,
        proposerRosterId,
        receiverRosterId,
        vetoMode,
        vetoThreshold,
        reason: body.reason?.trim() || null,
        expiresAt,
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
        metadata: asset.metadata,
      })),
    })

    return tx.redraftTradeProposal.findUnique({
      where: { id: proposal.id },
      include: { assets: true, votes: true, decision: true },
    })
  })

  // T2: capture the immutable deterministic value snapshot at proposal time. Best-effort — a
  // valuation issue must never block trade creation, but it is expected to succeed.
  if (created?.id) {
    try {
      await captureRedraftTradeValueSnapshot({
        proposalId: created.id,
        seasonId,
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
        payload: { proposalId: created.id, assetCount: assets.length, vetoMode },
      }),
    )
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

  // Decision OS Slice 3 — trade shadow/live runner. Evaluation only; never executes or mutates trades.
  // Stage 0 (SHADOW only): scope-filtered, logs parity, result discarded.
  // Stage 1 (LIVE): unconditional when a snapshot exists, decisionOs appended to response.
  const isLive = shouldRunTradeLive(process.env)
  const liveStart = Date.now()
  const shadowArgs = created?.id && snapshotRow
    ? {
        userId,
        leagueId,
        seasonId,
        proposal: { proposalId: created.id, proposerRosterId, receiverRosterId, status: created.status ?? 'pending', vetoMode },
        assets: assets.map((a) => ({
          fromRosterId: a.fromRosterId!,
          toRosterId: a.toRosterId!,
          assetType: a.assetType!,
          playerId: a.playerId ?? null,
          playerName: a.playerName ?? null,
          faabAmount: a.assetType === 'faab' ? Number((a.metadata as Record<string, unknown>)?.amount ?? 0) || null : null,
        })),
        snapshotPayload: (snapshotRow as { payload?: unknown }).payload,
        snapshotConfidenceScore: (snapshotRow as { confidenceScore?: number | null }).confidenceScore ?? null,
      }
    : null

  let decisionOs: { decisionId: string; card: TradeCard; completeness: number; uncertaintySources: string[] } | null = null

  if (isLive && shadowArgs) {
    try {
      const liveResult = await runTradeShadowForProposal(shadowArgs)
      if (liveResult.ran && liveResult.result) {
        const { decision } = liveResult.result
        decisionOs = {
          decisionId: decision.decision_id,
          card: toTradeCard(decision),
          completeness: decision.data_completeness,
          uncertaintySources: decision.uncertainty_sources,
        }
        emitLiveTelemetry('trade.value', { enriched: true, latency_ms: Date.now() - liveStart, leagueId }, decision.decision_id)
      } else {
        emitLiveTelemetry('trade.value', { enriched: false, reason: 'shadow_no_result', latency_ms: Date.now() - liveStart, leagueId })
      }
    } catch {
      emitLiveTelemetry('trade.value', { enriched: false, reason: 'exception', latency_ms: Date.now() - liveStart, leagueId })
      // live path must never fail the trade route
    }
  } else if (!isLive && shadowArgs) {
    const shadowFilters = getDecisionShadowScopeFilters()
    const shadowProfile = shadowFilters.hasUsernameFilter
      ? await prisma.userProfile.findUnique({
          where: { userId },
          select: { sleeperUsername: true },
        })
      : null

    if (shouldRunTradeShadow(process.env, {
      username: shadowProfile?.sleeperUsername ?? null,
      leagueId,
    })) {
      try {
        await runTradeShadowForProposal(shadowArgs)
      } catch {
        // shadow must never affect the legacy response
      }
    }
  }

  return NextResponse.json({ proposal: created, valueSnapshot: snapshotRow, ...(decisionOs ? { decisionOs } : {}) })
}
