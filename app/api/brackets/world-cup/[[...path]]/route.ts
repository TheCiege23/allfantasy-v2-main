import { NextResponse } from "next/server"
import { z } from "zod"
import { isAuthorizedRequest } from "@/lib/adminAuth"
import { prisma } from "@/lib/prisma"
import {
  createAdditionalWorldCupInvite,
  createWorldCupBracketChallenge,
  getWorldCupChallengeByInvite,
  getWorldCupChallengeView,
  joinWorldCupChallengeByInvite,
  recalculateWorldCupChallenge,
  saveWorldCupPicks,
  syncAllOpenWorldCupChallenges,
  syncWorldCupChallenge,
  updateWorldCupChallengeSettings,
} from "@/lib/world-cup"
import {
  assertWorldCupManager,
  getWorldCupAdminState,
  getWorldCupApiUser,
  requireWorldCupApiUser,
  worldCupChallengeParamsSchema,
  worldCupInviteParamsSchema,
} from "../_utils"
import { runWorldCupDiagnostics } from "@/lib/world-cup/worldCupDiagnosticsService"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

type WorldCupRouteContext = {
  params: { path?: string[] }
}

const createWorldCupChallengeSchema = z.object({
  name: z.string().trim().min(2).max(80),
  seasonYear: z.coerce.number().int().min(2026).max(2100).default(2026),
  visibility: z.enum(["public", "private"]).default("private"),
  pickLockStrategy: z.enum(["per_match", "tournament_start"]).default("per_match"),
  pickLockAt: z.string().datetime().nullable().optional(),
  includeThirdPlace: z.boolean().optional(),
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

const patchWorldCupChallengeSchema = z.object({
  name: z.string().trim().min(2).max(80).optional(),
  visibility: z.enum(["public", "private"]).optional(),
  pickLockStrategy: z.enum(["per_match", "tournament_start"]).optional(),
  pickLockAt: z.string().datetime().nullable().optional(),
  status: z.enum(["setup", "open", "locked", "live", "final"]).optional(),
})

const saveWorldCupPicksSchema = z.object({
  picks: z
    .array(
      z.object({
        matchId: z.string().min(1),
        selectedTeamId: z.string().nullable().optional(),
        selectedSlotKey: z.string().nullable().optional(),
      })
    )
    .min(1)
    .max(64),
})

const createInviteSchema = z.object({
  maxUses: z.coerce.number().int().positive().nullable().optional(),
  expiresAt: z.string().datetime().nullable().optional(),
})

const syncWorldCupSchema = z.object({
  challengeId: z.string().min(1).optional(),
})

function notFound() {
  return NextResponse.json({ error: "Route not found" }, { status: 404 })
}

function getPath(context: WorldCupRouteContext) {
  return context.params.path ?? []
}

async function createChallenge(request: Request) {
  const auth = await requireWorldCupApiUser()
  if (!auth.ok) return auth.response

  const body = await request.json().catch(() => ({}))
  const parsed = createWorldCupChallengeSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request", issues: parsed.error.flatten() }, { status: 400 })
  }

  const result = await createWorldCupBracketChallenge({
    user: auth.user,
    name: parsed.data.name,
    seasonYear: parsed.data.seasonYear,
    visibility: parsed.data.visibility,
    pickLockStrategy: parsed.data.pickLockStrategy,
    pickLockAt: parsed.data.pickLockAt ? new Date(parsed.data.pickLockAt) : null,
    includeThirdPlace: parsed.data.includeThirdPlace,
    scoring: parsed.data.scoring,
  })

  const challengeId = result.challengeId ?? (result as { id?: string }).id
  if (!challengeId) {
    console.error("[world-cup/create] service returned no challengeId", result)
    return NextResponse.json({ error: "Bracket created but ID could not be determined. Please refresh." }, { status: 500 })
  }
  return NextResponse.json({
    ok: true,
    challengeId,
    id: challengeId,
    inviteCode: result.inviteCode,
    inviteUrl: result.inviteUrl,
    challenge: { id: challengeId },
  })
}

async function getLiveMatches() {
  try {
    const matches = await (prisma as any).worldCupBracketMatch.findMany({
      where: { status: { in: ["live", "halftime"] } },
      orderBy: [{ startsAt: "asc" }, { matchNumber: "asc" }],
      take: 20,
      select: {
        id: true,
        challengeId: true,
        round: true,
        matchNumber: true,
        homeTeamName: true,
        awayTeamName: true,
        homeScore: true,
        awayScore: true,
        status: true,
        startsAt: true,
      },
    })

    return NextResponse.json({ matches })
  } catch (error) {
    console.error("[world-cup/live] failed to load live matches", error)
    return NextResponse.json({ matches: [] })
  }
}

async function syncChallenges(request: Request) {
  const user = await getWorldCupApiUser()
  const isAdmin = Boolean(isAuthorizedRequest(request) || (await getWorldCupAdminState(request, user)))
  if (!isAdmin) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const body = await request.json().catch(() => ({}))
  const parsed = syncWorldCupSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request", issues: parsed.error.flatten() }, { status: 400 })
  }

  if (parsed.data.challengeId) {
    const result = await syncWorldCupChallenge(parsed.data.challengeId)
    return NextResponse.json({ ok: true, ...result })
  }

  const results = await syncAllOpenWorldCupChallenges()
  return NextResponse.json({ ok: true, results })
}

async function getInvite(inviteCode: string) {
  const params = worldCupInviteParamsSchema.safeParse({ inviteCode })
  if (!params.success) {
    return NextResponse.json({ error: "Invalid invite code" }, { status: 400 })
  }

  const invite = await getWorldCupChallengeByInvite(params.data.inviteCode)
  if (!invite) {
    return NextResponse.json({ error: "Invite not found" }, { status: 404 })
  }

  return NextResponse.json({ invite })
}

async function joinInvite(inviteCode: string) {
  const auth = await requireWorldCupApiUser()
  if (!auth.ok) return auth.response

  const params = worldCupInviteParamsSchema.safeParse({ inviteCode })
  if (!params.success) {
    return NextResponse.json({ error: "Invalid invite code" }, { status: 400 })
  }

  try {
    const result = await joinWorldCupChallengeByInvite({
      inviteCode: params.data.inviteCode,
      user: auth.user,
    })
    return NextResponse.json({ ok: true, ...result })
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to join bracket"
    return NextResponse.json({ error: message }, { status: 400 })
  }
}

async function getChallenge(request: Request, challengeId: string) {
  const params = worldCupChallengeParamsSchema.safeParse({ challengeId })
  if (!params.success) {
    return NextResponse.json({ error: "Invalid challenge id" }, { status: 400 })
  }

  const user = await getWorldCupApiUser()
  const isAdmin = await getWorldCupAdminState(request, user)
  const view = await getWorldCupChallengeView({
    challengeId: params.data.challengeId,
    user,
    isAdmin,
  })

  if (!view) {
    return NextResponse.json({ error: "Challenge not found" }, { status: 404 })
  }

  return NextResponse.json(view)
}

async function patchChallenge(request: Request, challengeId: string) {
  const auth = await requireWorldCupApiUser()
  if (!auth.ok) return auth.response

  const params = worldCupChallengeParamsSchema.safeParse({ challengeId })
  if (!params.success) {
    return NextResponse.json({ error: "Invalid challenge id" }, { status: 400 })
  }

  const access = await assertWorldCupManager(request, params.data.challengeId, auth.user)
  if (!access.ok) return access.response

  const body = await request.json().catch(() => ({}))
  const parsed = patchWorldCupChallengeSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request", issues: parsed.error.flatten() }, { status: 400 })
  }

  await updateWorldCupChallengeSettings({
    challengeId: params.data.challengeId,
    name: parsed.data.name,
    visibility: parsed.data.visibility,
    pickLockStrategy: parsed.data.pickLockStrategy,
    pickLockAt:
      Object.prototype.hasOwnProperty.call(parsed.data, "pickLockAt") && parsed.data.pickLockAt
        ? new Date(parsed.data.pickLockAt)
        : parsed.data.pickLockAt === null
          ? null
          : undefined,
    status: parsed.data.status,
  })

  const view = await getWorldCupChallengeView({
    challengeId: params.data.challengeId,
    user: auth.user,
    isAdmin: access.isAdmin,
  })

  return NextResponse.json({ ok: true, view })
}

async function joinChallenge(challengeId: string) {
  const auth = await requireWorldCupApiUser()
  if (!auth.ok) return auth.response

  const params = worldCupChallengeParamsSchema.safeParse({ challengeId })
  if (!params.success) {
    return NextResponse.json({ error: "Invalid challenge id" }, { status: 400 })
  }

  const challenge = await (prisma as any).worldCupBracketChallenge.findUnique({
    where: { id: params.data.challengeId },
    select: { inviteCode: true, visibility: true },
  })
  if (!challenge) {
    return NextResponse.json({ error: "Challenge not found" }, { status: 404 })
  }
  if (challenge.visibility !== "public") {
    return NextResponse.json({ error: "Invite required to join this bracket" }, { status: 403 })
  }

  const result = await joinWorldCupChallengeByInvite({
    inviteCode: challenge.inviteCode,
    user: auth.user,
  })

  return NextResponse.json({ ok: true, ...result })
}

async function getLeaderboard(request: Request, challengeId: string) {
  const params = worldCupChallengeParamsSchema.safeParse({ challengeId })
  if (!params.success) {
    return NextResponse.json({ error: "Invalid challenge id" }, { status: 400 })
  }

  const user = await getWorldCupApiUser()
  const isAdmin = await getWorldCupAdminState(request, user)
  const view = await getWorldCupChallengeView({
    challengeId: params.data.challengeId,
    user,
    isAdmin,
  })

  if (!view) {
    return NextResponse.json({ error: "Challenge not found" }, { status: 404 })
  }

  return NextResponse.json({
    leaderboard: view.leaderboard,
    lastSyncedAt: view.challenge.lastSyncedAt,
    scoring: view.scoring,
  })
}

async function getPicks(challengeId: string) {
  const auth = await requireWorldCupApiUser()
  if (!auth.ok) return auth.response

  const params = worldCupChallengeParamsSchema.safeParse({ challengeId })
  if (!params.success) {
    return NextResponse.json({ error: "Invalid challenge id" }, { status: 400 })
  }

  const view = await getWorldCupChallengeView({
    challengeId: params.data.challengeId,
    user: auth.user,
  })
  if (!view) {
    return NextResponse.json({ error: "Challenge not found" }, { status: 404 })
  }

  return NextResponse.json({ picks: view.picks, participant: view.participant })
}

async function savePicks(request: Request, challengeId: string) {
  const auth = await requireWorldCupApiUser()
  if (!auth.ok) return auth.response

  const params = worldCupChallengeParamsSchema.safeParse({ challengeId })
  if (!params.success) {
    return NextResponse.json({ error: "Invalid challenge id" }, { status: 400 })
  }

  const body = await request.json().catch(() => ({}))
  const parsed = saveWorldCupPicksSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request", issues: parsed.error.flatten() }, { status: 400 })
  }

  try {
    const view = await saveWorldCupPicks({
      challengeId: params.data.challengeId,
      userId: auth.user.id,
      picks: parsed.data.picks,
    })

    return NextResponse.json({ ok: true, view })
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to save picks"
    const status = message.toLowerCase().includes("locked") ? 409 : 400
    return NextResponse.json({ error: message }, { status })
  }
}

async function createInvite(request: Request, challengeId: string) {
  const auth = await requireWorldCupApiUser()
  if (!auth.ok) return auth.response

  const params = worldCupChallengeParamsSchema.safeParse({ challengeId })
  if (!params.success) {
    return NextResponse.json({ error: "Invalid challenge id" }, { status: 400 })
  }

  const access = await assertWorldCupManager(request, params.data.challengeId, auth.user)
  if (!access.ok) return access.response

  const body = await request.json().catch(() => ({}))
  const parsed = createInviteSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request", issues: parsed.error.flatten() }, { status: 400 })
  }

  const invite = await createAdditionalWorldCupInvite({
    challengeId: params.data.challengeId,
    createdByUserId: auth.user.id,
    maxUses: parsed.data.maxUses ?? null,
    expiresAt: parsed.data.expiresAt ? new Date(parsed.data.expiresAt) : null,
  })

  return NextResponse.json({ ok: true, ...invite })
}

async function recalculateChallenge(request: Request, challengeId: string) {
  const auth = await requireWorldCupApiUser()
  if (!auth.ok) return auth.response

  const params = worldCupChallengeParamsSchema.safeParse({ challengeId })
  if (!params.success) {
    return NextResponse.json({ error: "Invalid challenge id" }, { status: 400 })
  }

  const access = await assertWorldCupManager(request, params.data.challengeId, auth.user)
  if (!access.ok) return access.response

  const leaderboard = await recalculateWorldCupChallenge(params.data.challengeId)
  return NextResponse.json({ ok: true, leaderboard })
}

async function adminListChallenges(request: Request) {
  const user = await getWorldCupApiUser()
  const isAdmin = Boolean(isAuthorizedRequest(request) || (await getWorldCupAdminState(request, user)))
  if (!isAdmin) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const url = new URL(request.url)
  const search = url.searchParams.get("q") ?? ""
  const statusFilter = url.searchParams.get("status") ?? ""
  const limit = Math.min(parseInt(url.searchParams.get("limit") ?? "50", 10), 200)

  const where: Record<string, unknown> = {}
  if (statusFilter) where.status = statusFilter
  if (search) {
    where.OR = [
      { name: { contains: search, mode: "insensitive" } },
      { inviteCode: { contains: search, mode: "insensitive" } },
    ]
  }

  const challenges = await (prisma as any).worldCupBracketChallenge.findMany({
    where,
    orderBy: { createdAt: "desc" },
    take: limit,
    select: {
      id: true,
      name: true,
      ownerUserId: true,
      seasonYear: true,
      inviteCode: true,
      visibility: true,
      status: true,
      includeThirdPlace: true,
      lastSyncedAt: true,
      createdAt: true,
      updatedAt: true,
      _count: { select: { participants: true } },
    },
  })

  // Attach owner display names
  const ownerIds = [...new Set(challenges.map((c: any) => c.ownerUserId))]
  const owners = ownerIds.length
    ? await (prisma as any).appUser.findMany({
        where: { id: { in: ownerIds } },
        select: { id: true, username: true, email: true },
      })
    : []
  const ownerMap = new Map(owners.map((o: any) => [o.id, o]))

  const rows = challenges.map((c: any) => {
    const owner = ownerMap.get(c.ownerUserId) as any
    return {
      ...c,
      participantCount: c._count?.participants ?? 0,
      ownerName: owner?.username ?? owner?.email ?? c.ownerUserId,
    }
  })

  return NextResponse.json({ ok: true, challenges: rows })
}

const adminActionSchema = z.object({
  action: z.enum(["sync", "recalculate", "lock", "unlock", "regenerate_invite", "delete"]),
  challengeId: z.string().min(1),
})

async function adminChallengeAction(request: Request) {
  const user = await getWorldCupApiUser()
  const isAdmin = Boolean(isAuthorizedRequest(request) || (await getWorldCupAdminState(request, user)))
  if (!isAdmin) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const body = await request.json().catch(() => ({}))
  const parsed = adminActionSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request", issues: parsed.error.flatten() }, { status: 400 })
  }

  const { action, challengeId } = parsed.data
  const db = prisma as any

  const challenge = await db.worldCupBracketChallenge.findUnique({ where: { id: challengeId }, select: { id: true, status: true } })
  if (!challenge) return NextResponse.json({ error: "Challenge not found" }, { status: 404 })

  switch (action) {
    case "sync": {
      const result = await syncWorldCupChallenge(challengeId)
      return NextResponse.json({ ok: true, action, ...result })
    }
    case "recalculate": {
      const leaderboard = await recalculateWorldCupChallenge(challengeId)
      return NextResponse.json({ ok: true, action, leaderboard })
    }
    case "lock": {
      await db.worldCupBracketChallenge.update({ where: { id: challengeId }, data: { status: "locked" } })
      return NextResponse.json({ ok: true, action })
    }
    case "unlock": {
      await db.worldCupBracketChallenge.update({ where: { id: challengeId }, data: { status: "open" } })
      return NextResponse.json({ ok: true, action })
    }
    case "regenerate_invite": {
      const newCode = Math.random().toString(36).slice(2, 10) + Math.random().toString(36).slice(2, 6)
      await db.worldCupBracketChallenge.update({ where: { id: challengeId }, data: { inviteCode: newCode } })
      return NextResponse.json({ ok: true, action, inviteCode: newCode })
    }
    case "delete": {
      await db.worldCupBracketChallenge.delete({ where: { id: challengeId } })
      return NextResponse.json({ ok: true, action })
    }
    default:
      return NextResponse.json({ error: "Unknown action" }, { status: 400 })
  }
}

async function adminHealthCheck(request: Request) {
  const user = await getWorldCupApiUser()
  const isAdmin = Boolean(isAuthorizedRequest(request) || (await getWorldCupAdminState(request, user)))
  if (!isAdmin) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const diagnostics = await runWorldCupDiagnostics()
  return NextResponse.json({ ok: true, diagnostics })
}

export async function GET(request: Request, context: WorldCupRouteContext) {
  const path = getPath(context)

  if (path.length === 1 && path[0] === "live") return getLiveMatches()
  if (path.length === 2 && path[0] === "invite") return getInvite(path[1])
  if (path.length === 1) return getChallenge(request, path[0])
  if (path.length === 2 && path[1] === "leaderboard") return getLeaderboard(request, path[0])
  if (path.length === 2 && path[1] === "picks") return getPicks(path[0])
  if (path.length === 2 && path[0] === "admin" && path[1] === "challenges") return adminListChallenges(request)
  if (path.length === 2 && path[0] === "admin" && path[1] === "health") return adminHealthCheck(request)

  return notFound()
}

export async function POST(request: Request, context: WorldCupRouteContext) {
  const path = getPath(context)

  if (path.length === 1 && path[0] === "create") return createChallenge(request)
  if (path.length === 1 && path[0] === "sync") return syncChallenges(request)
  if (path.length === 3 && path[0] === "invite" && path[2] === "join") return joinInvite(path[1])
  if (path.length === 2 && path[1] === "join") return joinChallenge(path[0])
  if (path.length === 2 && path[1] === "picks") return savePicks(request, path[0])
  if (path.length === 2 && path[1] === "invite") return createInvite(request, path[0])
  if (path.length === 2 && path[1] === "recalculate") return recalculateChallenge(request, path[0])
  if (path.length === 2 && path[0] === "admin" && path[1] === "action") return adminChallengeAction(request)

  return notFound()
}

export async function PATCH(request: Request, context: WorldCupRouteContext) {
  const path = getPath(context)

  if (path.length === 1) return patchChallenge(request, path[0])

  return notFound()
}
