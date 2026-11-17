/**
 * Centralized AF Pro / AF Commissioner entitlement helpers for waiver AI gating.
 *
 * Feature IDs:
 * - `pro_waiver_ai`        → AF Pro (user-level personal AI waiver recommendations)
 * - `commissioner_waiver_ai` → AF Commissioner (league-wide commissioner waiver AI tools)
 *
 * Dev bypasses (test/dev only — never trust in production):
 *   AF_PRO_DEV_BYPASS=true
 *   AF_COMMISSIONER_DEV_BYPASS=true
 *
 * Upgrade responses:
 *   AF_PRO_REQUIRED        → { error, message, upgradePath }
 *   AF_COMMISSIONER_REQUIRED → { error, message, upgradePath }
 */

import { EntitlementResolver } from "@/lib/subscription/EntitlementResolver"
import { isCommissioner } from "@/lib/commissioner/permissions"

// Exported so tests can spy on it
export function createEntitlementResolver() {
  return new EntitlementResolver()
}

export type AfAccessResult =
  | { ok: true; userId: string }
  | { ok: false; errorCode: "AF_PRO_REQUIRED" | "AF_COMMISSIONER_REQUIRED"; message: string; upgradePath: string }

export type AfProError = {
  error: "AF_PRO_REQUIRED"
  message: string
  upgradePath: string
}

export type AfCommissionerError = {
  error: "AF_COMMISSIONER_REQUIRED"
  message: string
  upgradePath: string
}

function isDevBypassEnabled(envVar: string): boolean {
  if (process.env.NODE_ENV === "production") return false
  return process.env[envVar] === "true"
}

/**
 * Returns true if the user has AF Pro (or higher) access.
 * Respects AF_PRO_DEV_BYPASS in non-production only.
 */
export async function getUserAfProStatus(userId: string): Promise<boolean> {
  if (isDevBypassEnabled("AF_PRO_DEV_BYPASS")) return true
  const resolver = createEntitlementResolver()
  const result = await resolver.resolveForUser(userId, "pro_waiver_ai")
  return result.hasAccess
}

/**
 * Returns true if the user has AF Commissioner (or higher) access AND is the commissioner of the league.
 * Respects AF_COMMISSIONER_DEV_BYPASS in non-production only.
 */
export async function getCommissionerAfCommissionerStatus(
  userId: string,
  leagueId: string
): Promise<boolean> {
  const commissionerOk = await isCommissioner(leagueId, userId)
  if (!commissionerOk) return false
  if (isDevBypassEnabled("AF_COMMISSIONER_DEV_BYPASS")) return true
  const resolver = createEntitlementResolver()
  const result = await resolver.resolveForUser(userId, "commissioner_waiver_ai")
  return result.hasAccess
}

/**
 * Throws if the user does not have AF Pro waiver AI access.
 * Use in API route handlers — call after authenticating the user.
 */
export async function requireAfProForWaiverAI(userId: string): Promise<void> {
  const hasAccess = await getUserAfProStatus(userId)
  if (!hasAccess) {
    const err = new AfProRequiredError()
    throw err
  }
}

/**
 * Throws if the user does not have AF Commissioner waiver AI access for the given league.
 */
export async function requireAfCommissionerForLeagueWaiverAI(
  userId: string,
  leagueId: string
): Promise<void> {
  const hasAccess = await getCommissionerAfCommissionerStatus(userId, leagueId)
  if (!hasAccess) {
    throw new AfCommissionerRequiredError()
  }
}

/** Convenience: can user get personal AI waiver recommendations? */
export async function canUseWaiverAI(userId: string): Promise<boolean> {
  return getUserAfProStatus(userId)
}

/** Convenience: can user get commissioner-level league waiver AI tools? */
export async function canUseCommissionerWaiverAI(userId: string, leagueId: string): Promise<boolean> {
  return getCommissionerAfCommissionerStatus(userId, leagueId)
}

/** Structured error for AF Pro gate (use in API routes to return 402). */
export class AfProRequiredError extends Error {
  readonly errorCode = "AF_PRO_REQUIRED" as const
  constructor() {
    super("Chimmy waiver recommendations are available with AF Pro.")
    this.name = "AfProRequiredError"
  }
  toResponse(): AfProError {
    return {
      error: "AF_PRO_REQUIRED",
      message: "Chimmy waiver recommendations are available with AF Pro.",
      upgradePath: "/pricing?plan=af-pro&feature=waiver-ai",
    }
  }
}

/** Structured error for AF Commissioner gate (use in API routes to return 402). */
export class AfCommissionerRequiredError extends Error {
  readonly errorCode = "AF_COMMISSIONER_REQUIRED" as const
  constructor() {
    super("League-wide Chimmy waiver tools require AF Commissioner.")
    this.name = "AfCommissionerRequiredError"
  }
  toResponse(): AfCommissionerError {
    return {
      error: "AF_COMMISSIONER_REQUIRED",
      message: "League-wide Chimmy waiver tools require AF Commissioner.",
      upgradePath: "/pricing?plan=af-commissioner&feature=commissioner-waiver-ai",
    }
  }
}
