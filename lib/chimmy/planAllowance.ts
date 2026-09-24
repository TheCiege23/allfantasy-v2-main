import 'server-only'

import { createHash } from 'node:crypto'
import { Prisma } from '@prisma/client'

import { prisma } from '@/lib/prisma'
import { EntitlementResolver } from '@/lib/subscription/EntitlementResolver'
import { getDisplayPlanName } from '@/lib/subscription/feature-access'
import { CHIMMY_PLAN_DAILY_INCLUDED, type ChimmyPlanAllowanceView } from './planAllowanceView'

/**
 * Chimmy answers INCLUDED in a subscription, before tokens apply.
 *
 * ── 🛑 WHY: A SUBSCRIPTION BOUGHT NOTHING IN THE CHAT PEOPLE USE ─────────────────────────────────
 * `/api/chat/chimmy` spent 10 tokens a message from everyone, and subscriptions grant no tokens
 * (`subscription-policy.ts`, by design: "a subscription unlocks features outright"). So an AF Pro
 * subscriber paying monthly got exactly the two free questions a day a free account gets — while the
 * catalog, the monetization matrix (`ai_chat: subscription_or_tokens`, "AI Chat is part of AF Pro")
 * and the deprecated `/api/chimmy` route (which does gate on the plan) all said otherwise.
 *
 * Owner's decision, 2026-09-24: **Chimmy is included in AF Pro, 100 answers a day; tokens after.**
 *
 * ── WHO IS INCLUDED ─────────────────────────────────────────────────────────────────────────────
 * Whoever `EntitlementResolver` says holds `ai_chat` — the same predicate every other plan gate uses.
 * Today that is AF Pro and AF Supreme (which bundles Pro). AF Commissioner or AF Legacy ALONE do not
 * carry `ai_chat` in the matrix and keep paying tokens; changing that is a matrix edit, not a route
 * edit, so the two cannot drift.
 *
 * ── WHAT COUNTS ─────────────────────────────────────────────────────────────────────────────────
 * Exactly the turns that would otherwise have been CHARGED. Answers that are free for everyone —
 * stored-data lookups, off-topic deflections, an undecided trade verdict — never touch the counter,
 * and a turn where no model answered is given back (`releaseChimmyPlanAllowance`), mirroring the
 * token refund in `chargeOnDelivery.ts`. You use your allowance on answers, never on our failures.
 *
 * ── A SEPARATE NUMBER FROM THE HARD CAPS, ON PURPOSE ────────────────────────────────────────────
 * `DAILY_CAP_LIMITS.chimmy` (lib/ai/dailyCaps.ts) is a hard STOP (429) on the deprecated route and
 * the World Cup coaching limiter. This is an ALLOWANCE: past it the user can still ask, and pays tokens.
 * Raising that cap to 100 would have silently loosened World Cup coaching as well.
 *
 * The counter lives in `api_rate_limits` under the same `ai_daily` provider and `feature:hash`
 * endpoint shape as those caps, so the admin AI usage monitor reports it (as `chimmy_plan`) without
 * any change there. The user id is hashed, as it is for the caps.
 */

const PROVIDER = 'ai_daily'
const FEATURE = 'chimmy_plan'

function endpointFor(userId: string): string {
  return `${FEATURE}:${createHash('sha256').update(userId).digest('hex').slice(0, 20)}`
}

function utcDayWindow(now: Date): { windowStart: Date; windowEnd: Date } {
  const windowStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()))
  return { windowStart, windowEnd: new Date(windowStart.getTime() + 24 * 60 * 60 * 1000) }
}

export type ChimmyPlanAllowanceState = {
  /** The plan that includes Chimmy, for display ("AF Pro"). */
  planName: string
  limit: number
  used: number
  remaining: number
  /** ISO start of the next UTC day, when the allowance refills. */
  resetsAt: string
}

export interface PlanAllowanceDeps {
  hasChimmyPlan: (userId: string, email: string | null) => Promise<{ included: boolean; planName: string }>
  readUsed: (endpoint: string, window: { windowStart: Date; windowEnd: Date }) => Promise<number>
  /** Atomically take one if fewer than `limit` are used. Returns the new count, or null when none was left. */
  take: (endpoint: string, window: { windowStart: Date; windowEnd: Date }, limit: number) => Promise<number | null>
  giveBack: (endpoint: string, window: { windowStart: Date; windowEnd: Date }) => Promise<void>
  now: () => Date
  limit: () => number
}

const resolver = new EntitlementResolver()

const defaultDeps: PlanAllowanceDeps = {
  hasChimmyPlan: async (userId, email) => {
    const result = await resolver.resolveForUser(userId, 'ai_chat', email)
    const plans = result.entitlement.plans
    return {
      included: result.hasAccess,
      planName: getDisplayPlanName(plans.includes('supreme') ? 'supreme' : 'pro'),
    }
  },
  readUsed: async (endpoint, { windowStart, windowEnd }) => {
    const row = await prisma.apiRateLimitRecord.findFirst({
      where: { provider: PROVIDER, endpoint, windowStart, windowEnd },
      select: { callsMade: true },
    })
    return row?.callsMade ?? 0
  },
  /*
   * ⚠ CREATE, THEN A CONDITIONAL INCREMENT — never read-then-write. Two tabs asking at 99 must not
   * both be included. The unique window key makes the first request's create the lock; every later
   * one is an `updateMany ... WHERE calls_made < limit`, which Postgres evaluates per row under
   * READ COMMITTED, so the 101st cannot slip through. The same shape as `consumeDailyLimit`.
   */
  take: async (endpoint, { windowStart, windowEnd }, limit) => {
    try {
      await prisma.apiRateLimitRecord.create({
        data: { provider: PROVIDER, endpoint, callsMade: 1, callsLimit: limit, windowStart, windowEnd },
      })
      return 1
    } catch (error) {
      if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== 'P2002') throw error
    }
    const updated = await prisma.apiRateLimitRecord.updateMany({
      where: { provider: PROVIDER, endpoint, windowStart, windowEnd, callsMade: { lt: limit } },
      data: { callsMade: { increment: 1 }, callsLimit: limit },
    })
    if (updated.count === 0) return null
    const row = await prisma.apiRateLimitRecord.findFirst({
      where: { provider: PROVIDER, endpoint, windowStart, windowEnd },
      select: { callsMade: true },
    })
    return row?.callsMade ?? limit
  },
  giveBack: async (endpoint, { windowStart, windowEnd }) => {
    await prisma.apiRateLimitRecord.updateMany({
      where: { provider: PROVIDER, endpoint, windowStart, windowEnd, callsMade: { gt: 0 } },
      data: { callsMade: { decrement: 1 } },
    })
  },
  now: () => new Date(),
  limit: () => CHIMMY_PLAN_DAILY_INCLUDED,
}

/**
 * Whether the caller's plan includes Chimmy, and how much of today's allowance is left. Reads only.
 * Null when the plan does not include Chimmy — or when that cannot be established, in which case
 * the caller keeps the token path it always had (never "included" on a guess).
 */
export async function readChimmyPlanAllowance(
  args: { userId: string; email?: string | null },
  deps: PlanAllowanceDeps = defaultDeps,
): Promise<ChimmyPlanAllowanceState | null> {
  let plan: { included: boolean; planName: string }
  try {
    plan = await deps.hasChimmyPlan(args.userId, args.email ?? null)
  } catch {
    return null
  }
  if (!plan.included) return null

  const now = deps.now()
  const window = utcDayWindow(now)
  const limit = deps.limit()
  /*
   * ⚠ A FAILED COUNTER READ IS NOT "ALLOWANCE USED UP". The plan is proven; charging a subscriber
   * because our own counter hiccuped is the worse failure. It reads as 0 used, and `takeChimmyPlanAllowance`
   * — which is atomic — still decides.
   */
  const used = await deps.readUsed(endpointFor(args.userId), window).catch(() => 0)
  return {
    planName: plan.planName,
    limit,
    used: Math.min(used, limit),
    remaining: Math.max(0, limit - used),
    resetsAt: window.windowEnd.toISOString(),
  }
}

/**
 * Take one included answer. Returns the updated state, or null when none was left (another request
 * took the last one) — the caller then falls back to tokens.
 *
 * ⚠ A COUNTER THAT CANNOT BE WRITTEN FAILS OPEN for a proven subscriber — the answer is included and
 * uncounted. One uncounted answer on a database error costs less than billing a subscriber for it.
 */
export async function takeChimmyPlanAllowance(
  args: { userId: string; state: ChimmyPlanAllowanceState },
  deps: PlanAllowanceDeps = defaultDeps,
): Promise<ChimmyPlanAllowanceState | null> {
  const window = utcDayWindow(deps.now())
  let used: number | null
  try {
    used = await deps.take(endpointFor(args.userId), window, args.state.limit)
  } catch {
    return { ...args.state }
  }
  if (used == null) return null
  return { ...args.state, used, remaining: Math.max(0, args.state.limit - used) }
}

/** Give back an included answer that was never delivered. Never throws. */
export async function releaseChimmyPlanAllowance(
  args: { userId: string },
  deps: PlanAllowanceDeps = defaultDeps,
): Promise<void> {
  await deps.giveBack(endpointFor(args.userId), utcDayWindow(deps.now())).catch(() => {})
}

/** The shape the route reports in `meta.planAllowance` — defined once, in the client-safe view module. */
export type ChimmyPlanAllowanceMeta = ChimmyPlanAllowanceView

export function planAllowanceMeta(state: ChimmyPlanAllowanceState, included: boolean): ChimmyPlanAllowanceMeta {
  return { included, planName: state.planName, used: state.used, limit: state.limit, resetsAt: state.resetsAt }
}
