import { NextResponse } from "next/server"
import { z } from "zod"
import { createWorldCupBracketChallenge } from "@/lib/world-cup"
import { requireWorldCupApiUser } from "../_utils"

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

function toWorldCupChallengeRedirectUrl(challengeId: string) {
  return `/brackets/world-cup/${encodeURIComponent(challengeId)}`
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
    includeThirdPlace: parsed.data.includeThirdPlace ?? parsed.data.includeThirdPlaceMatch ?? false,
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

  console.info("[world-cup/create] normalized create data", {
    userId: normalized.user.id,
    seasonYear: normalized.seasonYear,
    visibility: normalized.visibility,
    pickLockStrategy: normalized.pickLockStrategy,
    pickLockAt: normalized.pickLockAt?.toISOString() ?? null,
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
    if (!challengeId) {
      console.error("[world-cup/create] service returned no challengeId", result)
      return NextResponse.json({ error: "Bracket created but ID could not be determined. Please refresh." }, { status: 500 })
    }
    const redirectUrl = toWorldCupChallengeRedirectUrl(challengeId)

    return NextResponse.json({
      ok: true,
      ...result,
      id: challengeId,
      challenge: { id: challengeId },
      redirectUrl,
    })
  } catch (error) {
    console.error("[world-cup/create] failed", serializeCreateError(error))
    return NextResponse.json({ error: "Failed to create World Cup bracket challenge" }, { status: 500 })
  }
}
