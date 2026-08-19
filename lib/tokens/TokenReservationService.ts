/**
 * TRUE token reservation lifecycle on the EXISTING token system (UserTokenBalance + TokenLedger). This is NOT a
 * parallel ledger — it adds a pending-hold stage in front of the immutable spend ledger:
 *
 *   reserve  → atomically HOLD spendable balance (UserTokenBalance.reservedBalance += amount) without debiting
 *              `balance`. Concurrent runs cannot overspend; a held reservation is NOT a charge.
 *   finalize → only after a persisted success: debit `balance`, release the hold, and write ONE immutable
 *              TokenLedger SPEND entry (the settled consumption).
 *   release  → return the hold to spendable. No ledger entry (nothing was consumed).
 *
 * Because `balance` is debited ONLY on finalize, a failure/timeout/crash can never leave a finalized charge —
 * the worst case is a pending hold that auto-expires and is released (lazily on the next reserve for that user,
 * and by `recoverExpired` as a safety net). Every operation is idempotent on the canonical run key.
 *
 * The overspend guard is a single conditional UPDATE (`... WHERE (balance - reserved_balance) >= amount`), which
 * stays correct under Postgres READ COMMITTED: a concurrent writer re-evaluates the WHERE against the committed
 * row (EvalPlanQual), so exactly one of two racing reservations can succeed when only one fits.
 */
import 'server-only'
import { createHash } from 'node:crypto'
import { Prisma } from '@prisma/client'
import { prisma as defaultPrisma } from '@/lib/prisma'
import { isSubscriptionEntitlementBypassUserId } from '@/lib/dev-admin/access'
import { TOKEN_ENTRY_TYPES } from '@/lib/tokens/constants'
import { TokenInsufficientBalanceError } from '@/lib/tokens/TokenSpendService'

/**
 * Deterministic, domain-separated, collision-resistant ledger identity for a canonical run key. A canonical
 * key can exceed `token_ledger.source_id` (VarChar 128) / `idempotency_key` (VarChar 191); TRUNCATING it would
 * let two keys sharing a 128-char prefix collide. A `dintel:` + SHA-256 digest (71 chars) fits every field,
 * maps the SAME canonical execution to the SAME identity, and keeps distinct executions distinct. The FULL
 * canonical key is preserved on the reservation (`idempotency_key`) and run (`result_key`) records. No secret
 * is hashed — the canonical key is derived from evidence ids + non-secret scope.
 */
export function intelligenceLedgerIdentity(canonicalRunKey: string): string {
  return `dintel:${createHash('sha256').update(canonicalRunKey).digest('hex')}`
}

type PrismaLike = typeof defaultPrisma

const DEFAULT_RESERVATION_TTL_MS = 5 * 60_000

export type ReservationView = {
  id: string
  status: 'reserved' | 'finalized' | 'released'
  amount: number
  idempotencyKey: string
  ledgerId: string | null
  /** True when reserve found an existing (already-held or already-finalized) reservation — no new hold created. */
  alreadyExisted: boolean
}

export class TokenReservationService {
  constructor(private readonly db: PrismaLike = defaultPrisma) {}

  /** Spendable = balance - reservedBalance (excludes pending holds). */
  async getSpendable(userId: string): Promise<number> {
    const row = await this.db.userTokenBalance.findUnique({
      where: { userId },
      select: { balance: true, reservedBalance: true },
    })
    if (!row) return 0
    return Math.max(0, Number(row.balance) - Number(row.reservedBalance))
  }

  /** Lazily release this user's expired holds inside a transaction (automatic recovery; owner-gated per row). */
  private async releaseExpiredForUser(tx: PrismaLike, userId: string, balanceId: string, now: Date): Promise<void> {
    const expired = await tx.tokenReservation.findMany({
      where: { userId, status: 'reserved', expiresAt: { lt: now } },
      select: { id: true, amount: true },
    })
    for (const r of expired) {
      const upd = await tx.tokenReservation.updateMany({
        where: { id: r.id, status: 'reserved' },
        data: { status: 'released', releasedAt: now, reason: 'expired' },
      })
      if (upd.count === 1) {
        await tx.userTokenBalance.update({
          where: { id: balanceId },
          data: { reservedBalance: { decrement: r.amount } },
        })
      }
    }
  }

  /** Atomic overspend-guarded hold. Returns true if applied, false if insufficient spendable balance. */
  private async applyHold(tx: PrismaLike, balanceId: string, amount: number, now: Date): Promise<boolean> {
    const affected = await tx.$executeRaw(
      Prisma.sql`UPDATE "user_token_balances"
                 SET "reserved_balance" = "reserved_balance" + ${amount}, "updatedAt" = ${now}
                 WHERE "id" = ${balanceId} AND ("balance" - "reserved_balance") >= ${amount}`,
    )
    return Number(affected) === 1
  }

  async reserve(input: {
    userId: string
    /** Effective (already discount-resolved) token cost to HOLD. Computed by the caller's pricing layer. */
    amount: number
    idempotencyKey: string
    spendRuleCode?: string | null
    sourceType?: string
    sourceId?: string | null
    intelligenceRunId?: string | null
    expiresInMs?: number
    userEmail?: string | null
  }): Promise<ReservationView> {
    if (isSubscriptionEntitlementBypassUserId(input.userId, input.userEmail)) {
      return devAdminReservation(input.idempotencyKey, 'reserved') // platform-admin bypass — never touches DB
    }
    const ttlMs = input.expiresInMs ?? DEFAULT_RESERVATION_TTL_MS

    return this.db.$transaction(async (tx) => {
      const now = new Date()
      const balance = await tx.userTokenBalance.upsert({
        where: { userId: input.userId },
        update: {},
        create: { userId: input.userId },
        select: { id: true },
      })

      await this.releaseExpiredForUser(tx as PrismaLike, input.userId, balance.id, now)

      const existing = await tx.tokenReservation.findUnique({ where: { idempotencyKey: input.idempotencyKey } })
      if (existing && existing.status === 'reserved') {
        return view(existing, true) // share the live hold — no new charge
      }
      if (existing && existing.status === 'finalized') {
        return view(existing, true) // already consumed once — idempotent
      }

      const amount = Math.max(1, Math.floor(input.amount))
      const ok = await this.applyHold(tx as PrismaLike, balance.id, amount, now)
      if (!ok) {
        const latest = await tx.userTokenBalance.findUnique({
          where: { id: balance.id },
          select: { balance: true, reservedBalance: true },
        })
        throw new TokenInsufficientBalanceError(
          amount,
          Math.max(0, Number(latest?.balance ?? 0) - Number(latest?.reservedBalance ?? 0)),
        )
      }

      const expiresAt = new Date(now.getTime() + ttlMs)
      const row = existing
        ? await tx.tokenReservation.update({
            where: { id: existing.id },
            data: {
              status: 'reserved',
              amount,
              reservedAt: now,
              releasedAt: null,
              reason: null,
              expiresAt,
              intelligenceRunId: input.intelligenceRunId ?? existing.intelligenceRunId,
            },
          })
        : await tx.tokenReservation.create({
            data: {
              userId: input.userId,
              userTokenBalanceId: balance.id,
              amount,
              status: 'reserved',
              spendRuleCode: input.spendRuleCode ?? null,
              sourceType: input.sourceType ?? 'decision_os_intelligence',
              sourceId: input.sourceId ?? input.idempotencyKey,
              idempotencyKey: input.idempotencyKey,
              intelligenceRunId: input.intelligenceRunId ?? null,
              expiresAt,
            },
          })
      return view(row, false)
    })
  }

  async finalize(input: {
    userId: string
    idempotencyKey: string
    userEmail?: string | null
    description?: string
  }): Promise<ReservationView> {
    if (isSubscriptionEntitlementBypassUserId(input.userId, input.userEmail)) {
      return devAdminReservation(input.idempotencyKey, 'finalized')
    }
    return this.db.$transaction(async (tx) => {
      const res = await tx.tokenReservation.findUnique({ where: { idempotencyKey: input.idempotencyKey } })
      if (!res) throw new Error(`No reservation for key ${input.idempotencyKey}`)
      if (res.status === 'finalized') return view(res, true) // idempotent
      if (res.status === 'released') return view(res, true) // cannot finalize a released hold; no-op

      const now = new Date()
      // Atomically CLAIM the finalize: only ONE concurrent worker wins the reserved→finalized transition. A
      // loser sees count 0 (the row was finalized/released by another worker) and returns without debiting —
      // this prevents a double debit + a duplicate SPEND ledger under concurrent reconciliation.
      const claimed = await tx.tokenReservation.updateMany({
        where: { id: res.id, status: 'reserved' },
        data: { status: 'finalized', finalizedAt: now },
      })
      if (claimed.count !== 1) {
        const current = await tx.tokenReservation.findUnique({ where: { id: res.id } })
        return view(current ?? { ...res, status: 'finalized' }, true)
      }

      // We own the finalize → debit balance + count lifetime spend.
      await tx.userTokenBalance.update({
        where: { id: res.userTokenBalanceId },
        data: {
          balance: { decrement: res.amount },
          reservedBalance: { decrement: res.amount },
          lifetimeSpent: { increment: res.amount },
        },
      })
      const after = await tx.userTokenBalance.findUnique({
        where: { id: res.userTokenBalanceId },
        select: { balance: true },
      })
      const balanceAfter = Number(after?.balance ?? 0)

      const ledger = await tx.tokenLedger.create({
        data: {
          userId: res.userId,
          userTokenBalanceId: res.userTokenBalanceId,
          entryType: TOKEN_ENTRY_TYPES.SPEND,
          tokenDelta: -res.amount,
          balanceBefore: balanceAfter + res.amount,
          balanceAfter,
          spendRuleCode: res.spendRuleCode,
          sourceType: res.sourceType,
          // Collision-resistant domain-separated identity — never a truncated canonical key. The reservation
          // row (idempotency_key) and run (result_key) preserve the full canonical linkage.
          sourceId: intelligenceLedgerIdentity(input.idempotencyKey),
          idempotencyKey: intelligenceLedgerIdentity(input.idempotencyKey),
          description: input.description ?? 'Decision OS intelligence — finalized',
          metadata: { reservationId: res.id, intelligenceRunId: res.intelligenceRunId },
        },
        select: { id: true },
      })

      const updated = await tx.tokenReservation.update({
        where: { id: res.id },
        data: { finalizedLedgerId: ledger.id }, // status already set to 'finalized' by the atomic claim above
      })
      return { ...view(updated, false), ledgerId: ledger.id }
    })
  }

  async release(input: {
    userId: string
    idempotencyKey: string
    reason: string
    userEmail?: string | null
  }): Promise<ReservationView> {
    if (isSubscriptionEntitlementBypassUserId(input.userId, input.userEmail)) {
      return devAdminReservation(input.idempotencyKey, 'released')
    }
    return this.db.$transaction(async (tx) => {
      const res = await tx.tokenReservation.findUnique({ where: { idempotencyKey: input.idempotencyKey } })
      if (!res) return { id: '', status: 'released', amount: 0, idempotencyKey: input.idempotencyKey, ledgerId: null, alreadyExisted: false }
      if (res.status === 'released') return view(res, true) // idempotent
      if (res.status === 'finalized') return view(res, true) // consumed — cannot release; charge stands

      const now = new Date()
      // Atomically CLAIM the release: only ONE concurrent worker wins reserved→released, so the hold is
      // returned exactly once (no double reservedBalance decrement under concurrent reconciliation).
      const claimed = await tx.tokenReservation.updateMany({
        where: { id: res.id, status: 'reserved' },
        data: { status: 'released', releasedAt: now, reason: input.reason.slice(0, 128) },
      })
      if (claimed.count !== 1) {
        const current = await tx.tokenReservation.findUnique({ where: { id: res.id } })
        return view(current ?? { ...res, status: 'released' }, true)
      }
      await tx.userTokenBalance.update({
        where: { id: res.userTokenBalanceId },
        data: { reservedBalance: { decrement: res.amount } },
      })
      return view({ ...res, status: 'released' }, false)
    })
  }

  /** Safety-net sweep for abandoned holds (a crashed worker that never released). Idempotent per row. */
  async recoverExpired(input?: { now?: Date; limit?: number }): Promise<{ released: number }> {
    const now = input?.now ?? new Date()
    const expired = await this.db.tokenReservation.findMany({
      where: { status: 'reserved', expiresAt: { lt: now } },
      select: { id: true, amount: true, userTokenBalanceId: true },
      take: Math.max(1, Math.min(500, input?.limit ?? 100)),
    })
    let released = 0
    for (const r of expired) {
      await this.db.$transaction(async (tx) => {
        const upd = await tx.tokenReservation.updateMany({
          where: { id: r.id, status: 'reserved' },
          data: { status: 'released', releasedAt: now, reason: 'expired_sweep' },
        })
        if (upd.count === 1) {
          await tx.userTokenBalance.update({
            where: { id: r.userTokenBalanceId },
            data: { reservedBalance: { decrement: r.amount } },
          })
          released += 1
        }
      })
    }
    return { released }
  }
}

/** Platform-admin bypass reservation view — never touches the DB or a real balance. */
function devAdminReservation(idempotencyKey: string, status: ReservationView['status']): ReservationView {
  return { id: `devadmin-${status}`, status, amount: 0, idempotencyKey, ledgerId: null, alreadyExisted: false }
}

function view(
  row: {
    id: string
    status: string
    amount: number
    idempotencyKey: string
    finalizedLedgerId?: string | null
  },
  alreadyExisted: boolean,
): ReservationView {
  return {
    id: row.id,
    status: row.status as ReservationView['status'],
    amount: Number(row.amount),
    idempotencyKey: row.idempotencyKey,
    ledgerId: row.finalizedLedgerId ?? null,
    alreadyExisted,
  }
}
