import 'server-only'

import type { Prisma } from '@prisma/client'

import { prisma } from '@/lib/prisma'
import { logAction } from '@/server/services/auditService'
import { verifyChimmyActionToken } from './actionToken'
import { executeLineupAction } from './lineupAction'
import { executeTradeAction } from './tradeAction'
import type { ChimmyActionConfirmResult } from './types'

/**
 * The ONE place a Chimmy action changes anything — reached only by the signed-in user tapping
 * Confirm on a card.
 *
 * Order, and every step refuses rather than guessing:
 *   1. the token's signature and expiry (a card cannot be edited or kept for later);
 *   2. the token was minted for THIS signed-in user (a card cannot be replayed by someone else);
 *   3. the action id is CLAIMED exactly once — an insert on a primary key, so two taps, two tabs or a
 *      retried request race to one row and only the winner executes. The loser gets the winner's
 *      recorded outcome back, which is what makes the endpoint idempotent rather than merely guarded;
 *   4. the executor re-validates everything against live data and runs the existing native service;
 *   5. the outcome is written back to the claim row, and an executed action is logged to the league's
 *      audit trail (`LeagueAuditLog`, the existing mechanism).
 *
 * ⚠ A FAILED ATTEMPT BURNS THE CARD. A refusal is final for that card — the user asks Chimmy for a
 * fresh one. The alternative, releasing the claim on failure, would let a request that died AFTER a
 * write (the trade row exists, the response was lost) run a second time and send a second offer.
 */

export const ACTION_CLAIM_PREFIX = 'chimmy-action:'
/** Kept well past the token's life so a late duplicate still finds the recorded outcome. */
const CLAIM_RETENTION_MS = 30 * 24 * 3600 * 1000

type ClaimData = {
  status: 'executing' | 'executed' | 'refused' | 'error'
  userId: string
  leagueId: string
  kind: string
  message?: string
  tradeId?: string
  at: string
}

function isUniqueViolation(e: unknown): boolean {
  return Boolean(e && typeof e === 'object' && (e as { code?: unknown }).code === 'P2002')
}

async function writeOutcome(key: string, data: ClaimData): Promise<void> {
  await prisma.sportsDataCache
    .update({ where: { cacheKey: key }, data: { data: data as unknown as Prisma.InputJsonValue } })
    .catch(() => {})
}

export async function confirmChimmyAction(args: { token: unknown; userId: string | null; now?: Date }): Promise<ChimmyActionConfirmResult> {
  const now = args.now ?? new Date()
  if (!args.userId) return { ok: false, status: 'invalid', message: 'Sign in to confirm this.' }

  const verified = verifyChimmyActionToken(args.token, now)
  if (!verified.ok) {
    if (verified.reason === 'expired') {
      return { ok: false, status: 'expired', message: 'This card expired, so nothing was changed. Ask Chimmy again for a fresh one.' }
    }
    return { ok: false, status: 'invalid', message: "This card couldn't be verified, so nothing was changed." }
  }
  const payload = verified.payload
  if (payload.userId !== args.userId) {
    return { ok: false, status: 'invalid', message: 'This card belongs to a different account, so nothing was changed.' }
  }

  const key = `${ACTION_CLAIM_PREFIX}${payload.actionId}`
  const base = { userId: args.userId, leagueId: payload.leagueId, kind: payload.spec.kind }
  try {
    await prisma.sportsDataCache.create({
      data: {
        cacheKey: key,
        expiresAt: new Date(now.getTime() + CLAIM_RETENTION_MS),
        data: { ...base, status: 'executing', at: now.toISOString() } as unknown as Prisma.InputJsonValue,
      },
    })
  } catch (e) {
    if (!isUniqueViolation(e)) {
      return { ok: false, status: 'refused', kind: payload.spec.kind, message: "This couldn't be recorded just now, so nothing was changed. Try again in a moment." }
    }
    const prior = await prisma.sportsDataCache.findUnique({ where: { cacheKey: key } }).catch(() => null)
    const data = (prior?.data ?? {}) as Partial<ClaimData>
    if (data.status === 'executed') {
      return {
        ok: true,
        status: 'already_executed',
        kind: payload.spec.kind,
        message: data.message ?? 'Already done.',
        ...(data.tradeId ? { tradeId: data.tradeId } : {}),
      }
    }
    if (data.status === 'executing') {
      return { ok: false, status: 'refused', retryable: true, kind: payload.spec.kind, message: 'This is already being processed — tap again in a moment to see how it went.' }
    }
    return {
      ok: false,
      status: 'refused',
      kind: payload.spec.kind,
      message: data.message ?? 'This card was already used. Ask Chimmy again for a fresh one.',
    }
  }

  try {
    if (payload.spec.kind === 'lineup') {
      const r = await executeLineupAction(payload, args.userId, now)
      if (!r.ok) {
        await writeOutcome(key, { ...base, status: 'refused', message: r.message, at: new Date().toISOString() })
        return { ok: false, status: 'refused', kind: 'lineup', message: r.message }
      }
      await writeOutcome(key, { ...base, status: 'executed', message: r.message, at: new Date().toISOString() })
      await logAction({
        leagueId: payload.leagueId,
        userId: args.userId,
        actionType: 'chimmy_lineup_set',
        entityType: 'roster',
        entityId: r.rosterId,
        beforeState: { starters: r.before },
        afterState: { starters: r.after },
        metadata: { source: 'chimmy_action_confirm', actionId: payload.actionId, week: payload.spec.week, season: payload.spec.season },
      }).catch(() => null)
      return { ok: true, status: 'executed', kind: 'lineup', message: r.message }
    }

    const r = await executeTradeAction(payload, args.userId)
    if (!r.ok) {
      await writeOutcome(key, { ...base, status: 'refused', message: r.message, at: new Date().toISOString() })
      return { ok: false, status: 'refused', kind: 'trade', message: r.message }
    }
    await writeOutcome(key, { ...base, status: 'executed', message: r.message, tradeId: r.tradeId, at: new Date().toISOString() })
    await logAction({
      leagueId: payload.leagueId,
      userId: args.userId,
      actionType: 'chimmy_trade_proposed',
      entityType: 'trade',
      entityId: r.tradeId,
      afterState: { status: 'pending' },
      metadata: {
        source: 'chimmy_action_confirm',
        actionId: payload.actionId,
        proposerRosterId: payload.spec.kind === 'trade' ? payload.spec.proposerRosterId : null,
        receiverRosterId: payload.spec.kind === 'trade' ? payload.spec.receiverRosterId : null,
      },
    }).catch(() => null)
    return { ok: true, status: 'executed', kind: 'trade', message: r.message, tradeId: r.tradeId }
  } catch {
    await writeOutcome(key, {
      ...base,
      status: 'error',
      message: 'Something went wrong while applying this. Check your league before trying again.',
      at: new Date().toISOString(),
    })
    return {
      ok: false,
      status: 'refused',
      kind: payload.spec.kind,
      message: 'Something went wrong while applying this. Check your league before trying again — ask Chimmy for a fresh card if nothing changed.',
    }
  }
}
