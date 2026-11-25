import { isAcceptedCoOwnerForRedraftRoster } from '@/lib/team-coowners/access'
import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { assertLeagueMember } from '@/lib/league/league-access'
import {
  REDRAFT_TRADE_GOVERNANCE_REFUSAL,
  prohibitedRedraftGovernanceFields,
} from '@/lib/redraft/tradeGovernance'
import { resolveLeagueSport } from '@/lib/ai-learning-system/resolveLeagueSport'
import { createLeagueTradeGrader, gradeDeal } from '@/lib/decision-os/trade/leagueTradeGrader'
import { createZombieNativeItemGrader } from '@/lib/decision-os/trade/zombieNativeItemGrader'
import { gradeInputsFromRedraftAssets } from '@/lib/decision-os/trade/tradeGradeInputs'
import { receiptIdForGrade, storedTradeLink } from '@/lib/decision-os/trade/recordTradeGrade'
import { shouldRunTradeShadow, shouldRunTradeLive, runTradeShadowForProposal } from '@/lib/decision-os/trade/shadow'
import { toTradeCard, type TradeCard } from '@/lib/decision-os/trade/tradeCardAdapter'
import { getDecisionShadowScopeFilters } from '@/lib/decision-os/core/shadow'
import { emitLiveTelemetry, emitFeedOutcomes } from '@/lib/decision-os/core/parity'
import { createTradeOsLoaders } from '@/lib/decision-os/trade-os'
import { createRedraftTradeProposal, type TradeAssetInput } from '@/lib/redraft/createTradeProposal'
import {
  MULTI_TEAM_CAP_LEAGUE_REFUSAL,
  normalizeAdditionalRosterIds,
} from '@/lib/redraft/tradeParticipants'

export const dynamic = 'force-dynamic'


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

  /*
   * 🛑 THE ONE GRADE PER PROPOSAL (Trade OS, 2026-09-27). The list used to badge each proposal with
   * its `valueSnapshot.grade` — `canonicalFairnessGrade`, an A+..F scale of its own. Each proposal is
   * now graded by the one grader from the PROPOSER's side, without roster need, so every member sees
   * the same letter for it; the grade is recorded as a receipt. One grader for the whole list.
   * `valueSnapshot` stays in the payload for the fields that are not a letter.
   */
  // Built only when some proposal has assets to grade — a list with nothing to price reads no chart.
  let graderPromise: ReturnType<typeof createLeagueTradeGrader> | null = null
  const grader = () => (graderPromise ??= createLeagueTradeGrader({ leagueId, userId }).catch(() => null))
  let zombieItemGraderPromise: ReturnType<typeof createZombieNativeItemGrader> | null = null
  const zombieItemGrader = () => (zombieItemGraderPromise ??= createZombieNativeItemGrader(leagueId))
  const graded = await Promise.all(
    proposals.map(async (p) => {
      const assets = Array.isArray(p.assets) ? p.assets : []
      // A grade is one side against the other. A multi-team trade has no single other side, so it is
      // not graded rather than graded wrong; the screen says grades are shown for two-team trades.
      if (Array.isArray(p.additionalRosterIds) && p.additionalRosterIds.length > 0) {
        return {
          ...p,
          tradeGrade: { grade: null, partnerGrade: null, gradeWithheld: 'Grades are shown for two-team trades.', receiptId: null },
        }
      }
      const give = gradeInputsFromRedraftAssets(assets.filter((a) => a.fromRosterId === p.proposerRosterId))
      const get = gradeInputsFromRedraftAssets(assets.filter((a) => a.toRosterId === p.proposerRosterId))
      const grade = assets.some(a => a.assetType === 'zombie_item')
        ? await zombieItemGrader().then(g => g.grade(p)).catch(() => ({ graded: false as const, reason: 'Zombie item values could not be loaded just now.', basis: null }))
        : assets.length === 0
        ? { graded: false as const, reason: 'This proposal has no assets on record.', basis: null }
        : await Promise.resolve()
            .then(async () => gradeDeal(await grader(), { give, get, viewerSide: false }))
            .catch(() => ({ graded: false as const, reason: 'This trade could not be graded just now.', basis: null }))
      const hasZombieItems = assets.some(a => a.assetType === 'zombie_item')
      // The generic receipt asset union has no item kind. Do not save these item lines as players.
      const receiptId = hasZombieItems ? null : await receiptIdForGrade({
        surface: 'redraft-trade-list',
        leagueId,
        userId,
        give,
        get,
        viewerSide: false,
        grade,
        stored: storedTradeLink({ kind: 'redraft', proposalId: p.id }, { source: 'redraft', platform: 'allfantasy', status: p.status }),
      })
      return {
        ...p,
        tradeGrade: {
          grade: hasZombieItems ? null : grade.graded ? grade.letter : null,
          partnerGrade: hasZombieItems ? null : grade.graded ? grade.partnerLetter : null,
          gradeWithheld: hasZombieItems && grade.graded
            ? 'The future scoring estimate does not yet include infection, revival, loot, or cash payout outcomes.'
            : grade.graded ? null : grade.reason,
          receiptId,
          ...(hasZombieItems ? {
            gradeScope: 'zombie_future_scoring' as const,
            giveValue: grade.graded ? grade.giveValue : null,
            getValue: grade.graded ? grade.getValue : null,
          } : {}),
        },
      }
    }),
  )

  return NextResponse.json({ proposals: graded })
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
    /** Multi-team trades: up to two more teams (four in all). Omitted for a two-team trade. */
    additionalRosterIds?: unknown
    reason?: string
    expiresInHours?: number
    assets?: TradeAssetInput[]
  }
  try {
    body = (await req.json()) as typeof body
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  // Governance is the league's decision: see lib/redraft/tradeGovernance.ts.
  const prohibited = prohibitedRedraftGovernanceFields(body)
  if (prohibited.length) {
    return NextResponse.json({ error: REDRAFT_TRADE_GOVERNANCE_REFUSAL, prohibitedFields: prohibited }, { status: 400 })
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
  // Multi-team trades (lib/redraft/tradeParticipants.ts). A two-team request supplies none and is unchanged.
  const additional = normalizeAdditionalRosterIds(body.additionalRosterIds, proposerRosterId, receiverRosterId)
  if (!additional.ok) return NextResponse.json({ error: additional.error }, { status: 400 })
  const additionalRosterIds = additional.ids
  const multiTeam = additionalRosterIds.length > 0

  const gate = await assertLeagueMember(leagueId, userId)
  if (!gate.ok) return NextResponse.json({ error: 'Forbidden' }, { status: gate.status })

  const [season, proposer, receiver] = await Promise.all([
    prisma.redraftSeason.findFirst({ where: { id: seasonId, leagueId }, include: { league: { select: { leagueVariant: true } } } }),
    prisma.redraftRoster.findFirst({ where: { id: proposerRosterId, seasonId, leagueId } }),
    prisma.redraftRoster.findFirst({ where: { id: receiverRosterId, seasonId, leagueId } }),
  ])

  if (!season) return NextResponse.json({ error: 'Season not found' }, { status: 404 })
  if (!proposer || !receiver) {
    return NextResponse.json({ error: 'Roster not found for season' }, { status: 404 })
  }
  // Every extra team must be in the same league and season.
  const additionalRosters = multiTeam
    ? await prisma.redraftRoster.findMany({ where: { id: { in: additionalRosterIds }, seasonId, leagueId } })
    : []
  if (additionalRosters.length !== additionalRosterIds.length) {
    return NextResponse.json({ error: 'Roster not found for season' }, { status: 404 })
  }
  if (proposer.ownerId !== userId && !await isAcceptedCoOwnerForRedraftRoster(leagueId, proposerRosterId, userId)) {
    return NextResponse.json({ error: 'Only proposer roster owner can create trade' }, { status: 403 })
  }
  /*
   * A team Chimmy runs (lib/inactive-manager/autopilotTrades.ts). Its commissioner chooses whether it
   * takes offers: `off` refuses the offer here, before anything is written; otherwise a two-team offer
   * is made as normal and Chimmy answers it on the hourly run, through the same accept/decline rules a
   * manager's click goes through. Chimmy does not join multi-team trades, so those are still refused.
   */
  const { autopilotTradeModeForOwner } = await import('@/lib/inactive-manager/inactiveManagerService')
  for (const party of [receiver, ...additionalRosters]) {
    const chimmyTrades = await autopilotTradeModeForOwner(leagueId, party.ownerId).catch(() => null)
    if (chimmyTrades === 'off') {
      return NextResponse.json(
        { error: 'Chimmy is running this team while its manager is away, and it is not taking trade offers.', code: 'RECEIVER_ON_AUTOPILOT' },
        { status: 409 },
      )
    }
    if (chimmyTrades && additionalRosters.length > 0) {
      return NextResponse.json(
        { error: 'Chimmy is running one of these teams, and it only takes two-team trade offers.', code: 'RECEIVER_ON_AUTOPILOT' },
        { status: 409 },
      )
    }
  }
  if (multiTeam && (await prisma.iDPCapConfig.findUnique({ where: { leagueId }, select: { id: true } }))) {
    return NextResponse.json({ error: MULTI_TEAM_CAP_LEAGUE_REFUSAL, code: 'MULTI_TEAM_CAP_LEAGUE' }, { status: 409 })
  }

  // Creating the offer lives in lib/redraft/createTradeProposal.ts, so every caller applies the same rules.
  const made = await createRedraftTradeProposal({
    leagueId, seasonId, season, proposer, receiver, additionalRosters, additionalRosterIds,
    actorUserId: userId, reason: body.reason, expiresInHours: body.expiresInHours, assets: body.assets,
  })
  if (!made.ok) return NextResponse.json(made.body, { status: made.status })
  const { created, snapshotRow, assets, vetoMode } = made

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

  /*
   * Trade OS feed, built ONCE per request so drainOutcomes() sees every fact this request resolved.
   * Both branches below get the same instance.
   *
   * ⚠ THIS CHANGES WHERE FACTS COME FROM, NEVER HOW A DECISION IS MADE. The shadow runner already
   * accepts `loadWorldFacts` as an optional dependency with a live default, so supplying it swaps
   * grounding and nothing else.
   *
   * `domain_os_facts` IS MIGRATED (`prisma/migrations/20260901220000_domain_os_facts`), so the feed
   * serves real cache hits. This used to say it "has never been migrated" — stale since that migration
   * (corrected 2026-11-24 re-score). `safeRead` still swallows a read failure and falls through to the
   * live derivation, so an outage of the table degrades to the unwired behaviour rather than an error.
   */
  const { drainOutcomes: drainTradeOsOutcomes, ...tradeOsLoaders } = createTradeOsLoaders()

  if (isLive && shadowArgs) {
    try {
      const liveResult = await runTradeShadowForProposal(shadowArgs, tradeOsLoaders)
      if (liveResult.ran && liveResult.result) {
        const { decision } = liveResult.result
        // The saved three-brain analysis was retired 2026-11-19 (re-score build item 9): nothing produced one,
        // so this read one indexed count per request to find nothing.
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
        await runTradeShadowForProposal(shadowArgs, tradeOsLoaders)
      } catch {
        // shadow must never affect the legacy response
      }
    }
  }

  // One event carrying where each fact actually came from. Signal-level TTLs are short (5min
  // waiver, 3min trade), so the store only pays on repeat requests inside that window -- a
  // property of real traffic, not of this code. If served_store stays 0, the cache is overhead.
  emitFeedOutcomes('trade', drainTradeOsOutcomes())

  return NextResponse.json({ proposal: created, valueSnapshot: snapshotRow, ...(decisionOs ? { decisionOs } : {}) })
}
