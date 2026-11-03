/**
 * Claim eligibility: limits per period/week and conceptRules hooks (deterministic).
 */

import { prisma } from '@/lib/prisma'
import { DAILY_LOCKED_MESSAGE, type DailyTransactionPolicy } from '@/lib/waivers/dailyWaiverSchedule'

export type ClaimLimitContext = {
  leagueId: string
  rosterId: string
  userId?: string | null
}

function startOfWeekUtc(d: Date): Date {
  const x = new Date(d)
  const day = x.getUTCDay()
  const diff = (day + 6) % 7
  x.setUTCDate(x.getUTCDate() - diff)
  x.setUTCHours(0, 0, 0, 0)
  return x
}

/**
 * Count claims submitted by roster in the current UTC week (pending + processed).
 */
/**
 * Count drop actions in the current UTC week: completed waiver transactions with a drop
 * plus pending claims that specify a drop (optional exclude for claim edits).
 */
export async function countWeeklyDropActions(
  leagueId: string,
  rosterId: string,
  opts?: { excludeClaimId?: string },
): Promise<number> {
  const from = startOfWeekUtc(new Date())
  const txDrops = await (prisma as any).waiverTransaction.count({
    where: {
      leagueId,
      rosterId,
      dropPlayerId: { not: null },
      processedAt: { gte: from },
    },
  })
  const pendingWhere: Record<string, unknown> = {
    leagueId,
    rosterId,
    status: 'pending',
    dropPlayerId: { not: null },
  }
  if (opts?.excludeClaimId) {
    pendingWhere.id = { not: opts.excludeClaimId }
  }
  const pendingDrops = await (prisma as any).waiverClaim.count({ where: pendingWhere })
  return txDrops + pendingDrops
}

export async function assertWeeklyDropLimit(
  leagueId: string,
  rosterId: string,
  maxDropsPerWeek: number | null | undefined,
  opts?: { excludeClaimId?: string; additionalDrops?: number },
): Promise<{ ok: true } | { ok: false; message: string }> {
  if (maxDropsPerWeek == null || maxDropsPerWeek <= 0) return { ok: true }
  const n = await countWeeklyDropActions(leagueId, rosterId, opts)
  if (n + Math.max(0, opts?.additionalDrops ?? 0) >= maxDropsPerWeek) {
    return {
      ok: false,
      message: `Weekly drop limit reached (${maxDropsPerWeek} max).`,
    }
  }
  return { ok: true }
}

export async function countClaimsThisWeekUtc(leagueId: string, rosterId: string): Promise<number> {
  const from = startOfWeekUtc(new Date())
  return (prisma as any).waiverClaim.count({
    where: {
      leagueId,
      rosterId,
      createdAt: { gte: from },
      status: { in: ['pending', 'processed'] },
    },
  })
}

/**
 * Count claims in the rolling "period" approximated as calendar week UTC.
 * When claimLimitPerPeriod is set on settings, it applies to the same window unless overridden later.
 */
export async function assertClaimWithinLimits(
  leagueId: string,
  rosterId: string,
  claimLimitPerWeek: number | null | undefined,
  claimLimitPerPeriod: number | null | undefined
): Promise<{ ok: true } | { ok: false; message: string }> {
  const weekLimit = claimLimitPerWeek ?? null
  const periodLimit = claimLimitPerPeriod ?? null
  const effective = weekLimit ?? periodLimit
  if (effective == null || effective <= 0) return { ok: true }

  const n = await countClaimsThisWeekUtc(leagueId, rosterId)
  if (n >= effective) {
    return {
      ok: false,
      message: `Claim limit reached for this period (${effective} max).`,
    }
  }
  return { ok: true }
}

/**
 * Pending queue depth for the next waiver run (rolling / FAAB batch).
 */
export async function assertClaimWithinPerRunLimit(
  leagueId: string,
  rosterId: string,
  claimLimitPerRun: number | null | undefined
): Promise<{ ok: true } | { ok: false; message: string }> {
  if (claimLimitPerRun == null || claimLimitPerRun <= 0) return { ok: true }
  const n = await (prisma as any).waiverClaim.count({
    where: { leagueId, rosterId, status: 'pending' },
  })
  if (n >= claimLimitPerRun) {
    return {
      ok: false,
      message: `You already have the maximum pending claims for this waiver run (${claimLimitPerRun} max). Cancel or wait for processing.`,
    }
  }
  return { ok: true }
}

export type WaiverSubmissionWindowInput = {
  freeAgentWindowRules: unknown | null
  processingDays: unknown | null
  lockType: string | null
}

/**
 * Deterministic gates from JSON rules (commissioner / league settings).
 * - submissionLocked, submissionLockedUntil
 * - allowedSubmissionWeekdaysUtc: 0–6 (UTC)
 * - restrictSubmissionsToProcessingDays: only allow claims on `processingDays` weekdays
 */
export function assertWaiverSubmissionWindow(
  input: WaiverSubmissionWindowInput
): { ok: true } | { ok: false; message: string } {
  const rules = input.freeAgentWindowRules
  if (rules && typeof rules === 'object') {
    const o = rules as Record<string, unknown>
    if (o.submissionLocked === true) {
      return {
        ok: false,
        message: 'Waiver claims are closed until the submission window opens.',
      }
    }
    if (typeof o.submissionLockedUntil === 'string') {
      const until = new Date(o.submissionLockedUntil)
      if (!Number.isNaN(until.getTime()) && until.getTime() > Date.now()) {
        return {
          ok: false,
          message: 'Waiver submissions are temporarily locked.',
        }
      }
    }
    const allowed = o.allowedSubmissionWeekdaysUtc
    if (Array.isArray(allowed) && allowed.length > 0) {
      const wd = new Date().getUTCDay()
      const nums = allowed.map((x) => Number(x)).filter((n) => n >= 0 && n <= 6)
      if (nums.length > 0 && !nums.includes(wd)) {
        return {
          ok: false,
          message: 'Waiver claims cannot be submitted on this day (league schedule).',
        }
      }
    }
    if (o.restrictSubmissionsToProcessingDays === true && input.processingDays) {
      const pd = input.processingDays
      if (Array.isArray(pd) && pd.length > 0) {
        const wd = new Date().getUTCDay()
        const raw = pd.map((x) => Number(x)).filter((n) => Number.isFinite(n))
        const normalized = raw.map((n) => {
          if (n >= 1 && n <= 7) return n === 7 ? 0 : n
          return n
        })
        const asUtcDay = normalized.map((n) => (n >= 0 && n <= 6 ? n : -1)).filter((n) => n >= 0)
        if (asUtcDay.length > 0 && !asUtcDay.includes(wd)) {
          return {
            ok: false,
            message: 'Claims can only be submitted on configured waiver processing days.',
          }
        }
      }
    }
  }

  const lt = (input.lockType ?? '').trim().toLowerCase()
  if (lt === 'waiver_submissions_frozen' || lt === 'submission_frozen') {
    return {
      ok: false,
      message: 'Waiver submissions are frozen for this league (lock policy).',
    }
  }

  return { ok: true }
}

/**
 * Optional conceptRules override: if settings.specialtyConceptOverrides.waiverBlocked === true, reject.
 */
export function conceptOverridesBlockWaivers(overrides: unknown): string | null {
  if (!overrides || typeof overrides !== 'object') return null
  const o = overrides as Record<string, unknown>
  if (o.waiverBlocked === true) return 'Waivers are temporarily blocked for this league concept.'
  return null
}

/**
 * Per-day waiver schedule gate for a CLAIM (lib/waivers/dailyWaiverSchedule.ts). `policy` is null
 * when the league has no enabled daily schedule. A Locked day refuses claims; every other day accepts
 * them (a claim made on a free-agent day waits for the next waiver run).
 */
export function assertDailyScheduleAllowsClaim(
  policy: DailyTransactionPolicy | null | undefined,
): { ok: true } | { ok: false; message: string } {
  if (!policy || policy.claimsAllowed) return { ok: true }
  return { ok: false, message: DAILY_LOCKED_MESSAGE }
}
