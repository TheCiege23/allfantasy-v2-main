import type { LeagueSport, Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { trackRecommendationOutcome } from '@/lib/ai/outcomes/trackRecommendationOutcome'

/**
 * 🛑 WHY THIS FUNCTION WRITES TWO TABLES.
 *
 * `lib/ai/admin/getAIMetrics.ts` reads `ai_recommendation_outcomes` FIVE times, behind two live
 * admin routes (`/api/admin/ai/metrics`, `/api/admin/ai/recommendations`). Measured 2026-09-07 the
 * table held **0 rows, `newest` NULL** — never written — because its only writer,
 * `trackRecommendationOutcome`, had zero callers. So those dashboards reported "no recommendations
 * were followed" when the truth was "nothing was ever recorded", and an empty result is
 * indistinguishable from a never-populated one on a chart.
 *
 * ⚠ THIS IS THE THIRD TABLE IN THIS REPO WITH A LIVE READER AND A DARK WRITER — after
 * `ai_adp_snapshots` and `ai_player_outlooks_cache`. CLAUDE.md's rule from the `ingestCFBDStats`
 * case is the fix: wire the read and the write TOGETHER, or not at all. Writing both here means
 * they cannot drift, because there is one call site rather than two lists to keep in step.
 *
 * ⚠ AND IT IS DELIBERATELY NOT WIRED INTO `lib/draft-helper/RecommendationEngine`, WHICH WOULD HAVE
 * BEEN THE OBVIOUS CHOKE POINT (12 importers). Four of those importers — `CPUDrafterService`,
 * `DraftLookaheadService`, `deterministic-pick-engine`, `autopickBestAvailableSubmit` — are
 * INTERNAL: a CPU drafter picking for a bot is not "a recommendation served to a manager".
 * Instrumenting there would fill the dashboard with numbers that are WRONG rather than absent,
 * which is worse than the empty table it replaces. This function is the user-facing surface: seven
 * war-room routes call it and nothing else does.
 */
export async function logAiRecommendation(args: {
  userId: string
  leagueId?: string | null
  draftSessionId?: string | null
  feature: string
  recommendationType?: string | null
  inputJson: Prisma.InputJsonValue
  outputJson: Prisma.InputJsonValue
  providerSummary?: string | null
  tokenEstimate?: number | null
  confidencePct?: number | null
  accepted?: boolean | null
}) {
  const row = await prisma.aiRecommendationLog.create({
    data: {
      userId: args.userId,
      leagueId: args.leagueId ?? undefined,
      draftSessionId: args.draftSessionId ?? undefined,
      feature: args.feature,
      recommendationType: args.recommendationType ?? undefined,
      inputJson: args.inputJson,
      outputJson: args.outputJson,
      providerSummary: args.providerSummary ?? undefined,
      tokenEstimate: args.tokenEstimate ?? undefined,
      confidencePct: args.confidencePct ?? undefined,
      accepted: args.accepted ?? undefined,
    },
    select: { id: true, createdAt: true },
  })

  /*
   * The log row's id IS the recommendation id, so the two tables join without a second identifier
   * to keep in sync. `followed` is only set when the caller already knows — `accepted` is optional
   * here and usually unknown at serve time. ⚠ It is left NULL rather than defaulted to false:
   * "not yet resolved" and "the manager ignored it" are different facts, and `getAIMetrics`
   * computes a follow RATE from this column, so defaulting would silently invent a denominator.
   * `resolveRecommendationOutcome(recommendationId, { followed })` fills it in later.
   *
   * Awaited, not fire-and-forget: one indexed insert on a route that already did an LLM call is
   * not a latency question, and awaiting guarantees the row rather than racing a serverless
   * shutdown. `trackRecommendationOutcome` swallows its own errors and returns null, so a
   * telemetry failure can never turn a served recommendation into a 500.
   */
  await trackRecommendationOutcome({
    recommendationId: row.id,
    type: args.recommendationType ?? args.feature,
    userId: args.userId,
    leagueId: args.leagueId ?? null,
    followed: args.accepted ?? null,
    resolvedAt: args.accepted == null ? null : new Date(),
    // ⚠ The catch is HERE and not only inside the callee. `trackRecommendationOutcome` swallows
    // its own errors today, but that is its choice to change; this await is what would turn such a
    // change into a 500 on a served recommendation. The guarantee belongs to the caller that made
    // the promise.
  }).catch(() => null)

  return row
}

export async function createWarRoomSnapshot(args: {
  leagueId: string
  userId: string
  draftSessionId?: string | null
  sport: LeagueSport
  season?: number | null
  snapshotKind?: string
  payload: Prisma.InputJsonValue
}) {
  return prisma.warRoomSnapshot.create({
    data: {
      leagueId: args.leagueId,
      userId: args.userId,
      draftSessionId: args.draftSessionId ?? undefined,
      sport: args.sport,
      season: args.season ?? undefined,
      snapshotKind: args.snapshotKind ?? 'in_draft',
      payload: args.payload,
    },
    select: { id: true, createdAt: true },
  })
}

export async function upsertPlayerOutlook(args: {
  userId: string
  leagueId?: string | null
  sport: LeagueSport
  season?: number | null
  playerId: string
  playerName: string
  position?: string | null
  team?: string | null
  summary: string
  confidence?: number | null
  detailJson?: Prisma.InputJsonValue | null
  validUntil?: Date | null
}) {
  const existing = await prisma.playerOutlook.findFirst({
    where: {
      userId: args.userId,
      playerId: args.playerId,
      sport: args.sport,
      season: args.season ?? undefined,
    },
    orderBy: { updatedAt: 'desc' },
    select: { id: true },
  })

  if (existing) {
    return prisma.playerOutlook.update({
      where: { id: existing.id },
      data: {
        leagueId: args.leagueId ?? undefined,
        playerName: args.playerName,
        position: args.position ?? undefined,
        team: args.team ?? undefined,
        summary: args.summary,
        confidence: args.confidence ?? undefined,
        detailJson: args.detailJson === null ? undefined : args.detailJson ?? undefined,
        validUntil: args.validUntil ?? undefined,
      },
      select: { id: true, updatedAt: true },
    })
  }

  return prisma.playerOutlook.create({
    data: {
      userId: args.userId,
      leagueId: args.leagueId ?? undefined,
      sport: args.sport,
      season: args.season ?? undefined,
      playerId: args.playerId,
      playerName: args.playerName,
      position: args.position ?? undefined,
      team: args.team ?? undefined,
      summary: args.summary,
      confidence: args.confidence ?? undefined,
      detailJson: args.detailJson === null ? undefined : args.detailJson ?? undefined,
      validUntil: args.validUntil ?? undefined,
    },
    select: { id: true, updatedAt: true },
  })
}

export async function upsertManagerTendency(args: {
  leagueId: string
  season: number
  rosterId: string
  sport: LeagueSport
  label?: string | null
  tendenciesJson: Prisma.InputJsonValue
  samplePicks?: number
}) {
  return prisma.managerTendency.upsert({
    where: {
      leagueId_rosterId_season: {
        leagueId: args.leagueId,
        rosterId: args.rosterId,
        season: args.season,
      },
    },
    create: {
      leagueId: args.leagueId,
      season: args.season,
      rosterId: args.rosterId,
      sport: args.sport,
      label: args.label ?? undefined,
      tendenciesJson: args.tendenciesJson,
      samplePicks: args.samplePicks ?? 0,
    },
    update: {
      label: args.label ?? undefined,
      tendenciesJson: args.tendenciesJson,
      samplePicks: args.samplePicks ?? undefined,
      lastComputedAt: new Date(),
    },
    select: { id: true, updatedAt: true },
  })
}

export async function replaceDraftQueueEntries(args: {
  draftSessionId: string
  userId: string
  entries: Array<{ playerId: string; playerName?: string | null; priority: number }>
}) {
  await prisma.draftQueueEntry.deleteMany({
    where: { draftSessionId: args.draftSessionId, userId: args.userId },
  })
  if (args.entries.length === 0) {
    return { count: 0 }
  }
  await prisma.draftQueueEntry.createMany({
    data: args.entries.map((e, i) => ({
      draftSessionId: args.draftSessionId,
      userId: args.userId,
      playerId: e.playerId,
      playerName: e.playerName ?? undefined,
      priority: e.priority ?? i,
    })),
  })
  return { count: args.entries.length }
}
