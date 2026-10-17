import 'server-only'
import { createHash, randomUUID } from 'node:crypto'
import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { TokenSpendService } from '@/lib/tokens/TokenSpendService'

export type ReceiptContext = { id: string; userId: string; ownerToken: string }
export type RequestReceipt = {
  id: string; user_id: string; fingerprint: string; owner_token: string
  status: string; expires_at: Date; response: unknown; http_status: number | null
  bill_kind: string | null; bill_state: string | null; allowance_endpoint: string | null
  window_start: Date | null; window_end: Date | null
}
const LEASE_MS = 15 * 60_000
export const receiptSpendKey = (id: string) => `chimmy_request:${id}`
export const validChimmyRequestId = (id: string) => /^[A-Za-z0-9_-]{8,128}$/.test(id)
export const receiptId = (userId: string, requestId: string) =>
  createHash('sha256').update(JSON.stringify([userId, requestId])).digest('hex')

/** Consent changes the authorization to spend, not the identity of the question. */
export async function fingerprintChimmyRequest(form: FormData): Promise<string> {
  const hash = createHash('sha256')
  const entries = [...form.entries()].filter(([key]) => !['requestId', 'confirmTokenSpend'].includes(key))
  if (entries.length > 100) throw new Error('Too many request fields')
  entries.sort(([a], [b]) => a.localeCompare(b))
  let totalBytes = 0
  for (const [key, value] of entries) {
    totalBytes += typeof value === 'string' ? Buffer.byteLength(value) : value.size
    if (totalBytes > 6 * 1024 * 1024) throw new Error('Request too large')
    hash.update(JSON.stringify([key, typeof value === 'string' ? value : [value.name, value.type, value.size]]))
    if (typeof value !== 'string') {
      if (value.size > 5 * 1024 * 1024) throw new Error('Attachment too large')
      hash.update(new Uint8Array(await value.arrayBuffer()))
    }
  }
  return hash.digest('hex')
}

export async function readRequestReceipt(userId: string, requestId: string): Promise<RequestReceipt | null> {
  const rows = await prisma.$queryRaw<RequestReceipt[]>`
    SELECT * FROM "chimmy_request_receipts" WHERE "id" = ${receiptId(userId, requestId)} AND "user_id" = ${userId}`
  return rows[0] ?? null
}

export async function claimRequestReceipt(args: {userId: string; requestId: string; fingerprint: string; confirmed: boolean}): Promise<
  {kind:'execute'; context:ReceiptContext} | {kind:'existing'; receipt:RequestReceipt} | {kind:'conflict'}
> {
  const id = receiptId(args.userId, args.requestId)
  const ownerToken = randomUUID()
  const expires = new Date(Date.now() + LEASE_MS)
  const inserted = await prisma.$queryRaw<RequestReceipt[]>`
    INSERT INTO "chimmy_request_receipts" ("id", "user_id", "fingerprint", "owner_token", "expires_at")
    VALUES (${id}, ${args.userId}, ${args.fingerprint}, ${ownerToken}, ${expires})
    ON CONFLICT ("id") DO NOTHING RETURNING *`
  if (inserted.length) return {kind:'execute', context:{id, userId:args.userId, ownerToken}}
  const receipt = await readRequestReceipt(args.userId, args.requestId)
  if (!receipt || receipt.fingerprint !== args.fingerprint) return {kind:'conflict'}
  if (receipt.status === 'awaiting_confirmation' && args.confirmed) {
    const updated = await prisma.$queryRaw<RequestReceipt[]>`
      UPDATE "chimmy_request_receipts" SET "status"='processing', "owner_token"=${ownerToken},
        "expires_at"=${expires}, "response"=NULL, "http_status"=NULL,
        "bill_kind"=NULL, "bill_state"=NULL, "updated_at"=NOW()
      WHERE "id"=${id} AND "user_id"=${args.userId} AND "status"='awaiting_confirmation'
      AND "fingerprint"=${args.fingerprint} AND ("bill_kind" IS NULL OR "bill_state"='released') RETURNING *`
    if (updated.length) return {kind:'execute', context:{id, userId:args.userId, ownerToken}}
    const latest = await readRequestReceipt(args.userId, args.requestId)
    if (latest) return {kind:'existing',receipt:latest}
    return {kind:'conflict'}
  }
  return {kind:'existing',receipt}
}

async function lockReceipt(tx: Prisma.TransactionClient, context: ReceiptContext): Promise<RequestReceipt> {
  const rows = await tx.$queryRaw<RequestReceipt[]>`
    SELECT * FROM "chimmy_request_receipts" WHERE "id"=${context.id} AND "user_id"=${context.userId} FOR UPDATE`
  const row = rows[0]
  if (!row || row.owner_token !== context.ownerToken || row.status !== 'processing' || row.expires_at.getTime() <= Date.now()) {
    throw new Error('Request receipt lease lost')
  }
  return row
}

/** Fence the debit in its own transaction against expired-request recovery. */
export async function assertReceiptTokenSpend(tx: Prisma.TransactionClient, context: ReceiptContext): Promise<void> {
  const row = await lockReceipt(tx, context)
  if (row.bill_kind !== 'token' || row.bill_state !== 'reserved') throw new Error('Request billing lease lost')
}

/** Counter and receipt commit together: a crash cannot lose the reservation identity. */
export async function takeReceiptAllowance(context: ReceiptContext, endpoint: string,
  window: {windowStart:Date; windowEnd:Date}, limit: number): Promise<number | null> {
  return prisma.$transaction(async tx => {
    const receipt = await lockReceipt(tx, context)
    if (receipt.bill_kind) throw new Error('Request already billed')
    const key = {provider:'ai_daily', endpoint, ...window}
    await tx.apiRateLimitRecord.upsert({where:{uniq_api_rate_limits_window:key},
      create:{...key,callsMade:0,callsLimit:limit},update:{}})
    const taken = await tx.apiRateLimitRecord.updateMany({where:{...key,callsMade:{lt:limit}},
      data:{callsMade:{increment:1},callsLimit:limit}})
    if (!taken.count) return null
    const counter = await tx.apiRateLimitRecord.findUniqueOrThrow({where:{uniq_api_rate_limits_window:key}})
    await tx.$executeRaw`UPDATE "chimmy_request_receipts" SET "bill_kind"='allowance', "bill_state"='reserved',
      "allowance_endpoint"=${endpoint}, "window_start"=${window.windowStart}, "window_end"=${window.windowEnd},
      "updated_at"=NOW() WHERE "id"=${context.id}`
    return counter.callsMade
  })
}

/** Idempotent across processes, using the recorded day even after midnight. */
export async function releaseReceiptAllowance(context: ReceiptContext): Promise<boolean> {
  return prisma.$transaction(async tx => {
    const rows = await tx.$queryRaw<RequestReceipt[]>`
      SELECT * FROM "chimmy_request_receipts" WHERE "id"=${context.id} AND "user_id"=${context.userId} FOR UPDATE`
    const row = rows[0]
    if (!row || row.owner_token !== context.ownerToken || row.bill_kind !== 'allowance') return false
    if (row.bill_state === 'released') return true
    if (row.bill_state !== 'reserved' || !row.allowance_endpoint || !row.window_start || !row.window_end) return false
    const returned = await tx.apiRateLimitRecord.updateMany({where:{provider:'ai_daily', endpoint:row.allowance_endpoint,
      windowStart:row.window_start, windowEnd:row.window_end, callsMade:{gt:0}},data:{callsMade:{decrement:1}}})
    if (!returned.count) throw new Error('Allowance counter missing for recovery')
    await tx.$executeRaw`UPDATE "chimmy_request_receipts" SET "bill_state"='released', "updated_at"=NOW() WHERE "id"=${context.id}`
    return true
  })
}

/** Record intent before spending; recovery finds the immutable ledger by this same key. */
export async function recordReceiptTokenIntent(context: ReceiptContext): Promise<void> {
  await prisma.$transaction(async tx => {
    const row = await lockReceipt(tx, context)
    if (row.bill_kind) throw new Error('Request already billed')
    await tx.$executeRaw`UPDATE "chimmy_request_receipts" SET "bill_kind"='token', "bill_state"='reserved',
      "updated_at"=NOW() WHERE "id"=${context.id}`
  })
}

export async function reconcileRequestCharge(context: ReceiptContext): Promise<void> {
  const row = await prisma.$transaction(async tx => {
    const rows = await tx.$queryRaw<RequestReceipt[]>`
      SELECT * FROM "chimmy_request_receipts" WHERE "id"=${context.id} AND "user_id"=${context.userId} FOR UPDATE`
    const current = rows[0]
    if (!current || current.owner_token !== context.ownerToken || current.bill_state !== 'reserved') return null
    await tx.$executeRaw`UPDATE "chimmy_request_receipts" SET "status"='recovering', "updated_at"=NOW() WHERE "id"=${context.id}`
    return current
  })
  if (!row || row.owner_token !== context.ownerToken || row.bill_state !== 'reserved') return
  if (row.bill_kind === 'allowance') { await releaseReceiptAllowance(context); return }
  if (row.bill_kind !== 'token') return
  const ledger = await prisma.tokenLedger.findFirst({where:{userId:context.userId,idempotencyKey:receiptSpendKey(context.id)}})
  if (ledger) {
    await new TokenSpendService().refundSpendByLedger({userId:context.userId, spendLedgerId:ledger.id,
      refundRuleCode:'feature_execution_failed', idempotencyKey:`refund:chimmy_chat:${ledger.id}`,
      recoveryReceiptId:context.id,
      sourceType:'chimmy_chat_refund', sourceId:ledger.id, description:'Recover undelivered Chimmy answer'})
  }
  await prisma.$executeRaw`UPDATE "chimmy_request_receipts" SET "bill_state"='released', "updated_at"=NOW()
    WHERE "id"=${context.id} AND "user_id"=${context.userId} AND "owner_token"=${context.ownerToken}`
}

/** A timed-out debit must not remain charged when the response reports a free answer. */
export async function reconcileUnreportedTokenCharge(context: ReceiptContext): Promise<void> {
  const rows = await prisma.$queryRaw<RequestReceipt[]>`SELECT * FROM "chimmy_request_receipts"
    WHERE "id"=${context.id} AND "user_id"=${context.userId} AND "owner_token"=${context.ownerToken}`
  if (rows[0]?.bill_kind === 'token') await reconcileRequestCharge(context)
}

export async function finishRequestReceipt(context: ReceiptContext, response: unknown, httpStatus: number,
  awaitingConfirmation = false): Promise<void> {
  const status = awaitingConfirmation ? 'awaiting_confirmation' : 'completed'
  const changed = await prisma.$executeRaw`UPDATE "chimmy_request_receipts" SET "status"=${status},
    "response"=${JSON.stringify(response)}::jsonb, "http_status"=${httpStatus}, "updated_at"=NOW()
    WHERE "id"=${context.id} AND "user_id"=${context.userId} AND "owner_token"=${context.ownerToken}
      AND "status" IN ('processing', 'recovering') AND "expires_at">NOW()`
  if (changed !== 1) throw new Error('Request response could not be saved')
}

/** Expired work is refunded and sealed, never executed again under the old request key. */
export async function recoverExpiredReceipt(receipt: RequestReceipt): Promise<RequestReceipt> {
  if (!['processing', 'recovering'].includes(receipt.status) || receipt.expires_at.getTime() > Date.now()) return receipt
  const context = {id:receipt.id,userId:receipt.user_id,ownerToken:receipt.owner_token}
  await reconcileRequestCharge(context)
  const response = {error:'This answer did not finish. Its charge has been released. Please ask again.',code:'chimmy_request_expired'}
  const rows = await prisma.$queryRaw<RequestReceipt[]>`UPDATE "chimmy_request_receipts"
    SET "status"='completed', "response"=${JSON.stringify(response)}::jsonb, "http_status"=503, "updated_at"=NOW()
    WHERE "id"=${receipt.id} AND "user_id"=${receipt.user_id} AND "status" IN ('processing', 'recovering')
      AND "expires_at"<=NOW() RETURNING *`
  return rows[0] ?? receipt
}

export async function reconcileExpiredRequests(limit = 20): Promise<number> {
  const rows = await prisma.$queryRaw<RequestReceipt[]>`SELECT * FROM "chimmy_request_receipts"
    WHERE "status" IN ('processing','recovering') AND "expires_at"<=NOW()
    ORDER BY "expires_at" LIMIT ${Math.min(100, Math.max(1, limit))}`
  let recovered = 0
  for (const row of rows) {
    try { if ((await recoverExpiredReceipt(row)).status === 'completed') recovered++ }
    catch { console.warn('[chimmy] request recovery pending', { id: row.id }) }
  }
  return recovered
}
