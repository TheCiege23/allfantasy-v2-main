import { getServerSession } from "next-auth"
import { getToken } from "next-auth/jwt"
import { NextResponse } from "next/server"
import { z } from "zod"
import { authOptions } from "@/lib/auth"
import { isAdminEmailAllowed, isAuthorizedRequest } from "@/lib/adminAuth"
import { prisma } from "@/lib/prisma"
import { resolveAuthSecret } from "@/lib/auth/resolve-auth-secret"
import { userCanManageWorldCupChallenge } from "@/lib/world-cup"
import { WorldCupProviderConfigError } from "@/lib/world-cup/worldCupDataProvider"
import { getWorldCupSimulationAccessState, isWorldCupSimulationAllowed } from "@/lib/world-cup/worldCupSimulationService"

export const worldCupChallengeParamsSchema = z.object({
  challengeId: z.string().min(1),
})

export const worldCupEntryParamsSchema = z.object({
  challengeId: z.string().min(1),
  entryId: z.string().min(1),
})

export const worldCupInviteParamsSchema = z.object({
  inviteCode: z.string().min(4).max(64),
})

type WorldCupApiSessionUser = {
  id: string
  email?: string | null
  name?: string | null
  username?: string | null
}

type WorldCupCreateModePayload = {
  isTestMode?: unknown
  testMode?: unknown
  simulationEnabled?: unknown
  simulationMode?: unknown
  seedTestFixtures?: unknown
  loadTestFixtures?: unknown
  useTestFixtures?: unknown
  demoMode?: unknown
}

type WorldCupSyncErrorKind =
  | "missing_provider_key"
  | "unsupported_provider"
  | "provider_fetch_failed"
  | "database_write_failed"
  | "sync_service_failed"

function sanitizeWorldCupSyncErrorDetail(message: string) {
  return message
    .replace(/(x-apisports-key=)[^&\s]+/gi, "$1[redacted]")
    .replace(/(key=)[^&\s]+/gi, "$1[redacted]")
    .replace(/(Bearer\s+)[A-Za-z0-9._~+/=-]+/gi, "$1[redacted]")
    .replace(/(api[_-]?key["']?\s*[:=]\s*["']?)[^"',\s}]+/gi, "$1[redacted]")
    .replace(/(secret["']?\s*[:=]\s*["']?)[^"',\s}]+/gi, "$1[redacted]")
}

function classifyWorldCupSyncError(error: unknown): {
  kind: WorldCupSyncErrorKind
  message: string
  status: number
  provider?: string
  detail: string
} {
  const detail = sanitizeWorldCupSyncErrorDetail(error instanceof Error ? error.message : String(error))

  if (error instanceof WorldCupProviderConfigError) {
    const missingKey = /not configured|no api key|api key/i.test(detail)
    return {
      kind: missingKey ? "missing_provider_key" : "unsupported_provider",
      message: missingKey
        ? "World Cup data provider is not configured. Set API_SPORTS_KEY or API_FOOTBALL_KEY server-side."
        : "World Cup data provider is not supported for this sync.",
      status: 400,
      provider: error.provider,
      detail,
    }
  }

  if (/api-football|apisports|sportsdata|fetch|network|response\.json|unexpected token|rate limit|timeout|budget|cooldown|quota/i.test(detail)) {
    return {
      kind: "provider_fetch_failed",
      message: "World Cup data provider request failed. Check provider status, credentials, and rate limits.",
      status: 502,
      detail,
    }
  }

  if (/prisma|database|worldCup|unique constraint|foreign key|timed out|connection/i.test(detail)) {
    return {
      kind: "database_write_failed",
      message: "World Cup sync write failed. Check database connectivity and retry.",
      status: 500,
      detail,
    }
  }

  return {
    kind: "sync_service_failed",
    message: "World Cup sync failed. Please retry or check server logs.",
    status: 500,
    detail,
  }
}

export function worldCupProviderSyncErrorResponse(error: unknown, context: {
  route: string
  provider?: string | null
  seasonYear?: number | null
  dryRun?: boolean | null
}) {
  const classified = classifyWorldCupSyncError(error)
  console.error("[world-cup/sync] failed", {
    route: context.route,
    provider: context.provider ?? classified.provider ?? null,
    seasonYear: context.seasonYear ?? null,
    dryRun: context.dryRun ?? null,
    kind: classified.kind,
    detail: classified.detail,
  })

  return NextResponse.json(
    {
      ok: false,
      error: classified.kind,
      message: classified.message,
      provider: context.provider ?? classified.provider ?? null,
      seasonYear: context.seasonYear ?? null,
      syncedAt: new Date().toISOString(),
    },
    { status: classified.status }
  )
}

function serializeWorldCupAuthError(error: unknown) {
  const value = error as { name?: string; message?: string; code?: string }
  return {
    name: value?.name ?? "Error",
    message: value?.message ?? "Unknown error",
    code: typeof value?.code === "string" ? value.code : null,
  }
}

async function getWorldCupApiUserFromToken(request?: Request): Promise<WorldCupApiSessionUser | null> {
  if (!request) return null

  const secret = resolveAuthSecret()
  if (!secret) return null

  const token = (await getToken({ req: request as any, secret })) as {
    id?: string | null
    sub?: string | null
    email?: string | null
    name?: string | null
    username?: string | null
  } | null

  const id = token?.id ?? token?.sub
  if (!id) return null

  return {
    id,
    email: token?.email ?? null,
    name: token?.name ?? null,
    username: token?.username ?? null,
  }
}

export async function getWorldCupApiUser(request?: Request): Promise<WorldCupApiSessionUser | null> {
  try {
    const session = (await getServerSession(authOptions as any)) as {
      user?: { id?: string | null; email?: string | null; name?: string | null; username?: string | null }
    } | null

    const id = session?.user?.id
    if (!id) {
      return await getWorldCupApiUserFromToken(request)
    }

    return {
      id,
      email: session?.user?.email ?? null,
      name: session?.user?.name ?? null,
      username: session?.user?.username ?? null,
    }
  } catch (error) {
    console.error("[world-cup/auth] getServerSession failed", serializeWorldCupAuthError(error))
    return await getWorldCupApiUserFromToken(request)
  }
}

export async function requireWorldCupApiUser(request?: Request) {
  const user = await getWorldCupApiUser(request)
  if (!user) {
    return {
      ok: false as const,
      response: NextResponse.json({ error: "UNAUTHENTICATED" }, { status: 401 }),
    }
  }

  return { ok: true as const, user }
}

export async function getWorldCupAdminState(request: Request, user?: WorldCupApiSessionUser | null) {
  return Boolean(isAuthorizedRequest(request) || isAdminEmailAllowed(user?.email))
}

function requestedPrivilegedWorldCupCreateMode(body: WorldCupCreateModePayload) {
  return Boolean(
    body.isTestMode ||
      body.testMode ||
      body.simulationEnabled ||
      body.simulationMode ||
      body.seedTestFixtures ||
      body.loadTestFixtures ||
      body.useTestFixtures ||
      body.demoMode
  )
}

export async function assertWorldCupCreateModeAccess(
  request: Request,
  user: WorldCupApiSessionUser,
  body: WorldCupCreateModePayload
) {
  if (!requestedPrivilegedWorldCupCreateMode(body)) {
    return { ok: true as const, isAdmin: await getWorldCupAdminState(request, user) }
  }

  const isAdmin = await getWorldCupAdminState(request, user)
  if (!isAdmin) {
    return {
      ok: false as const,
      response: NextResponse.json(
        { error: "World Cup test, demo, and simulation pools can only be created by admins." },
        { status: 403 }
      ),
    }
  }

  return { ok: true as const, isAdmin }
}

export async function assertWorldCupManager(
  request: Request,
  challengeId: string,
  user: WorldCupApiSessionUser
) {
  const challenge = await (prisma as any).worldCupBracketChallenge.findUnique({
    where: { id: challengeId },
    select: { id: true, ownerUserId: true },
  })

  if (!challenge) {
    return {
      ok: false as const,
      response: NextResponse.json({ error: "Challenge not found" }, { status: 404 }),
    }
  }

  const isAdmin = await getWorldCupAdminState(request, user)
  const allowed = userCanManageWorldCupChallenge({
    userId: user.id,
    userEmail: user.email,
    ownerUserId: challenge.ownerUserId,
    isAdmin,
  })

  if (!allowed) {
    return {
      ok: false as const,
      response: NextResponse.json({ error: "Forbidden" }, { status: 403 }),
    }
  }

  return { ok: true as const, challenge, isAdmin }
}

export async function assertWorldCupAdminManager(
  request: Request,
  challengeId: string,
  user: WorldCupApiSessionUser
) {
  const access = await assertWorldCupManager(request, challengeId, user)
  if (!access.ok) return access

  if (!access.isAdmin) {
    return {
      ok: false as const,
      response: NextResponse.json({ error: "Forbidden" }, { status: 403 }),
    }
  }

  return access
}

/** Allows challenge owner/admin OR any participant to read challenge-scoped resources (feed, etc.). */
export async function assertWorldCupChallengeMemberOrManager(
  request: Request,
  challengeId: string,
  user: WorldCupApiSessionUser
) {
  const manager = await assertWorldCupManager(request, challengeId, user)
  if (manager.ok) return manager

  if (manager.response.status === 404) return manager

  const participant = await prisma.worldCupBracketParticipant.findUnique({
    where: {
      challengeId_userId: {
        challengeId,
        userId: user.id,
      },
    },
    select: { id: true },
  })

  if (!participant) return manager

  return { ok: true as const, challenge: null as any, isAdmin: false }
}

export async function assertWorldCupSimulationAccess(input: {
  request: Request
  challengeId: string
  user: WorldCupApiSessionUser
  confirmSimulation: boolean
}) {
  const manager = await assertWorldCupAdminManager(input.request, input.challengeId, input.user)
  if (!manager.ok) return manager

  const simulationState = await getWorldCupSimulationAccessState(input.challengeId)
  const access = isWorldCupSimulationAllowed({
    challengeVisibility: simulationState.visibility,
    isTestMode: simulationState.isTestMode,
    simulationEnabled: simulationState.simulationEnabled,
    confirmSimulation: input.confirmSimulation,
  })

  if (!access.allowed) {
    return {
      ok: false as const,
      response: NextResponse.json({ error: access.reason ?? "Simulation is not allowed for this challenge" }, { status: 403 }),
    }
  }

  return {
    ok: true as const,
    challenge: manager.challenge,
    isAdmin: manager.isAdmin,
    simulationState,
  }
}
