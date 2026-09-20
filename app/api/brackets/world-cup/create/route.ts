import { NextResponse } from "next/server"
import { z } from "zod"
import { createWorldCupBracketChallenge } from "@/lib/world-cup"
import { prisma } from "@/lib/prisma"
import { userHasWorldCupCommissionerAccess } from "@/lib/world-cup/worldCupCommissionerAccess"
import { assertWorldCupCreateModeAccess, requireWorldCupApiUser } from "../_utils"
import {
  buildWorldCupBracketLeadMetaEvent,
  buildWorldCupPoolLeadMetaEvent,
} from "@/lib/world-cup/worldCupMetaEvents"
import { trackMetaServerEvent } from "@/lib/meta-capi"
import {
  WORLD_CUP_ENTRIES_CLOSED_CODE,
  isWorldCupCreationOpen,
  worldCupEntriesCloseAt,
  worldCupEntriesClosedMessage,
} from "@/lib/world-cup/worldCupSeasonWindow"

export const runtime = "nodejs"

const createWorldCupChallengeSchema = z.object({
  name: z.string().trim().min(2).max(80),
  seasonYear: z.coerce.number().int().min(2026).max(2100).default(2026),
  visibility: z.enum(["public", "private"]).optional(),
  privacy: z.enum(["public", "private"]).optional(),
  isPrivate: z.boolean().optional(),
  pickLockStrategy: z.enum(["per_match", "tournament_start"]).optional(),
  lockRule: z.enum(["per_match", "tournament_start"]).optional(),
  pickLockAt: z.string().datetime().nullable().optional(),
  knockoutMode: z.enum(["predictive", "reseeded", "knockout_only"]).optional(),
  includeThirdPlace: z.boolean().optional(),
  includeThirdPlaceMatch: z.boolean().optional(),
  maxParticipants: z.coerce.number().int().min(2).max(100).optional(),
  maxUsers: z.coerce.number().int().min(2).max(100).optional(),
  maxEntriesPerParticipant: z.coerce.number().int().min(1).max(5).optional(),
  bracketsPerUser: z.coerce.number().int().min(1).max(5).optional(),
  isTestMode: z.boolean().optional(),
  simulationEnabled: z.boolean().optional(),
  seedTestFixtures: z.boolean().optional(),
  loadTestFixtures: z.boolean().optional(),
  useTestFixtures: z.boolean().optional(),
  scoring: z
    .object({
      roundOf32Points: z.number().int().min(0).optional(),
      roundOf16Points: z.number().int().min(0).optional(),
      quarterFinalPoints: z.number().int().min(0).optional(),
      semiFinalPoints: z.number().int().min(0).optional(),
      finalPoints: z.number().int().min(0).optional(),
      championBonusPoints: z.number().int().min(0).optional(),
      thirdPlacePoints: z.number().int().min(0).nullable().optional(),
    })
    .optional(),
})

function serializeCreateError(error: unknown) {
  const value = error as {
    name?: string
    message?: string
    code?: string
    meta?: unknown
  }

  return {
    name: value?.name ?? "Error",
    message: value?.message ?? "Unknown error",
    code: typeof value?.code === "string" ? value.code : null,
    meta: value?.meta ?? null,
  }
}

export async function POST(request: Request) {
  console.info("[world-cup/create] route reached")

  const auth = await requireWorldCupApiUser(request)
  console.info("[world-cup/create] auth state", { hasUserId: auth.ok ? Boolean(auth.user.id) : false })
  if (!auth.ok) return auth.response

  const body = await request.json().catch(() => ({}))
  console.info("[world-cup/create] parsed payload", {
    name: typeof body?.name === "string" ? body.name : null,
    seasonYear: body?.seasonYear ?? null,
    visibility: body?.visibility ?? null,
    privacy: body?.privacy ?? null,
    isPrivate: body?.isPrivate ?? null,
    pickLockStrategy: body?.pickLockStrategy ?? null,
    lockRule: body?.lockRule ?? null,
    knockoutMode: body?.knockoutMode ?? null,
    includeThirdPlace: body?.includeThirdPlace ?? null,
    includeThirdPlaceMatch: body?.includeThirdPlaceMatch ?? null,
    maxParticipants: body?.maxParticipants ?? null,
    maxUsers: body?.maxUsers ?? null,
    maxEntriesPerParticipant: body?.maxEntriesPerParticipant ?? null,
    bracketsPerUser: body?.bracketsPerUser ?? null,
    isTestMode: body?.isTestMode ?? null,
    simulationEnabled: body?.simulationEnabled ?? null,
    seedTestFixtures: body?.seedTestFixtures ?? body?.loadTestFixtures ?? body?.useTestFixtures ?? null,
    hasScoring: Boolean(body?.scoring),
  })

  const parsed = createWorldCupChallengeSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request", issues: parsed.error.flatten() }, { status: 400 })
  }

  const modeAccess = await assertWorldCupCreateModeAccess(request, auth.user, body)
  if (!modeAccess.ok) return modeAccess.response

  const normalized = {
    user: auth.user,
    name: parsed.data.name,
    seasonYear: parsed.data.seasonYear,
    visibility:
      parsed.data.visibility ??
      parsed.data.privacy ??
      (parsed.data.isPrivate === undefined ? "private" : parsed.data.isPrivate ? "private" : "public"),
    pickLockStrategy: parsed.data.pickLockStrategy ?? parsed.data.lockRule ?? "tournament_start",
    pickLockAt: parsed.data.pickLockAt ? new Date(parsed.data.pickLockAt) : null,
    knockoutMode: parsed.data.knockoutMode ?? "predictive",
    includeThirdPlace:
      parsed.data.knockoutMode === "knockout_only"
        ? false
        : parsed.data.includeThirdPlace ?? parsed.data.includeThirdPlaceMatch ?? false,
    maxParticipants: parsed.data.maxParticipants ?? parsed.data.maxUsers ?? 100,
    maxEntriesPerParticipant: parsed.data.maxEntriesPerParticipant ?? parsed.data.bracketsPerUser ?? 5,
    isTestMode: parsed.data.isTestMode ?? parsed.data.seedTestFixtures ?? parsed.data.loadTestFixtures ?? parsed.data.useTestFixtures ?? false,
    simulationEnabled: parsed.data.simulationEnabled ?? false,
    seedTestFixtures:
      parsed.data.seedTestFixtures ??
      parsed.data.loadTestFixtures ??
      parsed.data.useTestFixtures ??
      parsed.data.isTestMode ??
      parsed.data.simulationEnabled ??
      false,
    scoring: parsed.data.scoring,
  } as const

  const advancedCreateMode =
    normalized.pickLockStrategy !== "tournament_start" ||
    normalized.knockoutMode !== "predictive"
  if (advancedCreateMode && !modeAccess.isAdmin) {
    const hasAfCommissioner = await userHasWorldCupCommissionerAccess(
      auth.user.id,
      auth.user.email ?? null
    )
    if (!hasAfCommissioner) {
      return NextResponse.json(
        {
          error: "AF Commissioner is required for custom World Cup lock rules and advanced bracket formats.",
          upgrade: true,
          upgradePath: "/commissioner-upgrade?feature=advanced_scoring",
        },
        { status: 403 }
      )
    }
  }

  /*
   * The tournament is over, so this is the last gate before a pool is actually written.
   *
   * ⚠ IT SITS HERE, AFTER EVERY AUTHORIZATION CHECK, ON PURPOSE. Placed earlier it preempted the
   * AF Commissioner 403 with a 409 and quietly rewrote an existing contract — caught by
   * `world-cup-api-routes.test.ts`. Last means the only requests whose answer changes are the
   * ones that would otherwise have succeeded.
   *
   * Admins keep creating: test, demo and simulation pools are how this stack gets exercised out
   * of season. Reading, joining and scoring existing challenges are untouched — there are pools
   * in production and a date must never retroactively hide them.
   */
  if (!isWorldCupCreationOpen() && !modeAccess.isAdmin) {
    return NextResponse.json(
      {
        error: worldCupEntriesClosedMessage(),
        code: WORLD_CUP_ENTRIES_CLOSED_CODE,
        closedAt: worldCupEntriesCloseAt()?.toISOString() ?? null,
      },
      { status: 409 }
    )
  }

  console.info("[world-cup/create] normalized create data", {
    userId: normalized.user.id,
    seasonYear: normalized.seasonYear,
    visibility: normalized.visibility,
    pickLockStrategy: normalized.pickLockStrategy,
    pickLockAt: normalized.pickLockAt?.toISOString() ?? null,
    knockoutMode: normalized.knockoutMode,
    includeThirdPlace: normalized.includeThirdPlace,
    maxParticipants: normalized.maxParticipants,
    maxEntriesPerParticipant: normalized.maxEntriesPerParticipant,
    isTestMode: normalized.isTestMode,
    simulationEnabled: normalized.simulationEnabled,
    seedTestFixtures: normalized.seedTestFixtures,
    hasScoring: Boolean(normalized.scoring),
  })

  try {
    const result = await createWorldCupBracketChallenge(normalized)
    const challengeId = result.challengeId ?? (result as { id?: string }).id
    const firstEntry = challengeId && (prisma as any).worldCupBracketEntry?.findFirst
      ? await prisma.worldCupBracketEntry.findFirst({
          where: { challengeId, userId: auth.user.id },
          orderBy: { createdAt: "asc" },
          select: { id: true, name: true },
        }).catch(() => null)
      : null
    const poolMetaEvent = challengeId
      ? buildWorldCupPoolLeadMetaEvent({
          challengeId,
          poolName: normalized.name,
          seasonYear: normalized.seasonYear,
          visibility: normalized.visibility,
        })
      : null
    const bracketMetaEvent =
      challengeId && firstEntry
        ? buildWorldCupBracketLeadMetaEvent({
            challengeId,
            entryId: firstEntry.id,
            entryName: firstEntry.name,
            poolName: normalized.name,
          })
        : null

    await Promise.all(
      [poolMetaEvent, bracketMetaEvent].filter(Boolean).map((event) =>
        trackMetaServerEvent({
          eventName: event!.eventName,
          eventId: event!.eventId,
          customData: event!.customData,
          email: auth.user.email ?? null,
          userId: auth.user.id,
          request,
          source: "world_cup_create",
        }).catch((metaError) => {
          console.warn("[world-cup/create] Meta Lead failed:", metaError)
        })
      )
    )

    return NextResponse.json({
      ok: true,
      ...result,
      id: challengeId,
      challenge: { id: challengeId },
      metaEvents: {
        worldCupPool: poolMetaEvent,
        worldCupBracket: bracketMetaEvent,
      },
    })
  } catch (error) {
    console.error("[world-cup/create] failed", serializeCreateError(error))
    return NextResponse.json({ error: "Failed to create World Cup bracket challenge" }, { status: 500 })
  }
}
