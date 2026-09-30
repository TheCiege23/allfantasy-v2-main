/**
 * Guess limit for 6-digit password-reset codes.
 *
 * WHY. An SMS reset code is 6 digits (900,000 values) and lives 15 minutes.
 * Before this, `confirm` and `verify-code` compared a guess with no attempt
 * counter and no rate limit, and a wrong guess did not burn the code — so an
 * attacker who knew a phone number could request a reset and enumerate the
 * code space inside the window, then set the victim's password.
 *
 * HOW. Every guess against a user's code CONSUMES an attempt BEFORE the code is
 * compared (atomic INCR). Counting first is the point: "check the count, then
 * compare" lets a burst of parallel requests all read a count below the limit.
 * Past the limit the user's outstanding reset codes are deleted and further
 * guesses are refused until the window lapses, so a fresh code does not reset
 * the budget either.
 *
 * WHERE. Upstash Redis over REST, shared by every instance and surviving
 * deploys, with an in-process counter always applied alongside it — so if Redis
 * is unset or down the limit degrades to per-instance, never to "unlimited".
 *
 * Keyed on userId, not on phone or email: the `email + code` branch of confirm
 * accepts the same SMS code, so a per-phone key would leave a second door open.
 */

import { prisma } from "@/lib/prisma"

/** Guesses allowed per window: a typo or two plus verify-then-confirm, never a search. */
export const RESET_CODE_MAX_ATTEMPTS = 8
/** Matches the SMS code lifetime in app/api/auth/password/reset/request/route.ts. */
export const RESET_CODE_WINDOW_S = 15 * 60

const KEY = (userId: string) => `af:auth:pwreset-attempts:${userId}`
const TIMEOUT_MS = 800

const localAttempts = new Map<string, { count: number; resetAt: number }>()

function redisConfig(): { url: string; token: string } | null {
  const url = process.env.UPSTASH_REDIS_REST_URL?.trim()
  const token = process.env.UPSTASH_REDIS_REST_TOKEN?.trim()
  return url && token ? { url, token } : null
}

async function redis(args: (string | number)[]): Promise<unknown | undefined> {
  const cfg = redisConfig()
  if (!cfg) return undefined
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)
  try {
    const res = await fetch(cfg.url, {
      method: "POST",
      headers: { Authorization: `Bearer ${cfg.token}`, "Content-Type": "application/json" },
      body: JSON.stringify(args),
      signal: controller.signal,
      cache: "no-store",
    })
    if (!res.ok) return undefined
    const json = (await res.json()) as { result?: unknown }
    return json.result
  } catch {
    return undefined
  } finally {
    clearTimeout(timer)
  }
}

function consumeLocal(userId: string, now = Date.now()): number {
  const hit = localAttempts.get(userId)
  if (!hit || hit.resetAt <= now) {
    localAttempts.set(userId, { count: 1, resetAt: now + RESET_CODE_WINDOW_S * 1000 })
    return 1
  }
  hit.count += 1
  return hit.count
}

/**
 * Spend one guess for this user. Returns false when the budget is exhausted —
 * the caller must refuse WITHOUT comparing the code. On the first refusal the
 * user's outstanding reset codes are deleted.
 */
export async function consumeResetCodeAttempt(userId: string): Promise<boolean> {
  const local = consumeLocal(userId)
  const shared = await redis(["INCR", KEY(userId)])
  const sharedCount = typeof shared === "number" ? shared : Number(shared)
  if (Number.isFinite(sharedCount) && sharedCount === 1) {
    await redis(["EXPIRE", KEY(userId), RESET_CODE_WINDOW_S])
  }
  const count = Math.max(local, Number.isFinite(sharedCount) ? sharedCount : 0)
  if (count <= RESET_CODE_MAX_ATTEMPTS) return true

  try {
    await (prisma as any).passwordResetToken.deleteMany({ where: { userId } })
  } catch {
    // The refusal stands whether or not the burn succeeded.
  }
  return false
}

/** After a successful reset: the next reset starts with a full budget. */
export async function clearResetCodeAttempts(userId: string): Promise<void> {
  localAttempts.delete(userId)
  await redis(["DEL", KEY(userId)])
}

export function __resetPasswordResetAttemptsForTests(): void {
  localAttempts.clear()
}
