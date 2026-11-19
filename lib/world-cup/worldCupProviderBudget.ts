import "server-only"

import { prisma } from "@/lib/prisma"
import { rateLimitManager } from "@/lib/workers/rate-limit-manager"

export type WorldCupProviderBudgetEndpoint =
  | "world_cup:teams"
  | "world_cup:fixtures"
  | "world_cup:fixtures:today"
  | "world_cup:standings"
  | "world_cup:injuries"
  | "world_cup:squads"
  | "world_cup:gifs"

type BudgetProviderName = "api_football" | "api_sports" | "klipy" | "tenor" | "giphy" | string

const ENDPOINT_COOLDOWN_MS: Record<WorldCupProviderBudgetEndpoint, number> = {
  "world_cup:teams": 12 * 60 * 60 * 1000,
  "world_cup:fixtures": 30 * 60 * 1000,
  "world_cup:fixtures:today": 60 * 1000,
  "world_cup:standings": 5 * 60 * 1000,
  "world_cup:injuries": 6 * 60 * 60 * 1000,
  "world_cup:squads": 24 * 60 * 60 * 1000,
  "world_cup:gifs": 60 * 1000,
}

class WorldCupProviderBudgetError extends Error {
  constructor(
    public readonly provider: string,
    public readonly endpoint: WorldCupProviderBudgetEndpoint,
    message: string
  ) {
    super(`[WorldCupProviderBudget:${provider}:${endpoint}] ${message}`)
    this.name = "WorldCupProviderBudgetError"
  }
}

function normalizeProvider(provider: BudgetProviderName) {
  return provider.trim().toLowerCase()
}

function errorStatus(error: unknown) {
  const status = (error as { status?: unknown })?.status
  return typeof status === "number" && Number.isFinite(status) ? status : 500
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error)
}

export async function assertWorldCupProviderCallAllowed(
  provider: BudgetProviderName,
  endpoint: WorldCupProviderBudgetEndpoint
): Promise<void> {
  const normalized = normalizeProvider(provider)
  const allowedByBudget = await rateLimitManager.canCall(normalized, endpoint)
  if (!allowedByBudget) {
    throw new WorldCupProviderBudgetError(
      normalized,
      endpoint,
      "Provider call budget exhausted for this window. Use cached Neon data until the window resets."
    )
  }

  const cooldownMs = ENDPOINT_COOLDOWN_MS[endpoint] ?? 0
  if (cooldownMs <= 0) return

  try {
    const lastCall = await prisma.apiCallLogRecord.findFirst({
      where: {
        provider: normalized,
        endpoint,
        cached: false,
        status: { gte: 200, lt: 300 },
        calledAt: { gte: new Date(Date.now() - cooldownMs) },
      },
      orderBy: { calledAt: "desc" },
      select: { calledAt: true },
    })
    if (!lastCall) return

    const retryAt = new Date(lastCall.calledAt.getTime() + cooldownMs)
    throw new WorldCupProviderBudgetError(
      normalized,
      endpoint,
      `Endpoint cooldown active. Next provider refresh allowed at ${retryAt.toISOString()}.`
    )
  } catch (error) {
    if (error instanceof WorldCupProviderBudgetError) throw error
    // Logging/cooldown tables should never break a commissioner sync.
  }
}

async function recordWorldCupProviderCall(input: {
  provider: BudgetProviderName
  endpoint: WorldCupProviderBudgetEndpoint
  status: number
  latencyMs: number
  error?: string | null
  cached?: boolean
}) {
  await rateLimitManager.recordCall(
    normalizeProvider(input.provider),
    input.endpoint,
    input.status,
    input.latencyMs,
    {
      error: input.error ?? null,
      cached: input.cached ?? false,
    }
  )
}

export async function withWorldCupProviderBudget<T>(
  provider: BudgetProviderName,
  endpoint: WorldCupProviderBudgetEndpoint,
  operation: () => Promise<T>
): Promise<T> {
  await assertWorldCupProviderCallAllowed(provider, endpoint)
  const started = Date.now()
  try {
    const result = await operation()
    await recordWorldCupProviderCall({
      provider,
      endpoint,
      status: 200,
      latencyMs: Date.now() - started,
    })
    return result
  } catch (error) {
    await recordWorldCupProviderCall({
      provider,
      endpoint,
      status: errorStatus(error),
      latencyMs: Date.now() - started,
      error: errorMessage(error),
    })
    throw error
  }
}
