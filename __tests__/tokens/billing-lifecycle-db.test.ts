// @vitest-environment node
import { afterAll, afterEach, describe, expect, it } from 'vitest'
import { createHash, randomUUID } from 'node:crypto'
import { prisma } from '@/lib/prisma'
import { TokenSpendService, TokenSpendIdempotencyConflictError } from '@/lib/tokens/TokenSpendService'
import { TokenReservationService } from '@/lib/tokens/TokenReservationService'
import { EntitlementResolver } from '@/lib/subscription/EntitlementResolver'
import { isSubscriptionEntitlementBypassUserId } from '@/lib/dev-admin/access'
import { readChimmyAnswerAllowance, takeChimmyPlanAllowance, releaseChimmyPlanAllowance } from '@/lib/chimmy/planAllowance'

const enabled = process.env.RUN_BILLING_LIFECYCLE_DB === '1'
if (enabled) {
  for (const url of [process.env.DATABASE_URL, process.env.DIRECT_URL]) {
    const target = new URL(url ?? 'http://invalid')
    if (!['127.0.0.1', 'localhost'].includes(target.hostname) || target.pathname !== '/billing_lifecycle_20261026') {
      throw new Error('Billing tests require the disposable local billing_lifecycle_20261026 database')
    }
  }
}
const users: string[] = [], rules: string[] = []
const service = new TokenSpendService()
const reservations = new TokenReservationService()
async function user() {
  const id = randomUUID()
  const row = await prisma.appUser.create({ data: { id, email: `${id}@billing.invalid`, username: `billing-${id}` } })
  users.push(id)
  return row
}
const wallet = (userId: string) => prisma.userTokenBalance.findUniqueOrThrow({ where: { userId } })
function purchase(userId: string) {
  const id = randomUUID()
  return { userId, packageSku: 'af_tokens_5', sourceType: 'stripe_checkout', sourceId: id, idempotencyKey: `billing-test:${id}` }
}
const reverse = (p: ReturnType<typeof purchase>) => service.reversePackagePurchase({
  purchaseKey: p.idempotencyKey, userId: p.userId, packageSku: p.packageSku,
  sourceType: p.sourceType, sourceId: `refund-${p.sourceId}`, reason: 'refund',
})

describe.runIf(enabled)('normal accounts and billing against real isolated PostgreSQL', () => {
  afterEach(async () => {
    for (const id of users.splice(0)) {
      const endpoint = `chimmy_free:${createHash('sha256').update(id).digest('hex').slice(0, 20)}`
      await prisma.apiRateLimitRecord.deleteMany({ where: { provider: 'ai_daily', endpoint } })
      await prisma.appUser.delete({ where: { id } })
    }
    for (const code of rules.splice(0)) await prisma.tokenSpendRule.delete({ where: { code } })
  })
  afterAll(async () => { await prisma.$disconnect() })

  it('an ordinary account has no billing bypass, no paid plans and two included Chimmy answers', async () => {
    const u = await user()
    expect(isSubscriptionEntitlementBypassUserId(u.id, u.email)).toBe(false)
    expect(await new EntitlementResolver().resolveSnapshot(u.id, u.email, { strictReads: true })).toMatchObject({ plans: [], status: 'none' })
    expect(await readChimmyAnswerAllowance({ userId: u.id, email: u.email })).toMatchObject({ kind: 'free', limit: 2, remaining: 2 })
  })

  it('only two concurrent free answers are included, and a failed answer restores its slot once', async () => {
    const u = await user()
    const state = await readChimmyAnswerAllowance({ userId: u.id, email: u.email })
    const taken = (await Promise.all(Array.from({ length: 6 }, () => takeChimmyPlanAllowance({ userId: u.id, state })))).filter(r => r !== null)
    expect(taken).toHaveLength(2)
    expect(await readChimmyAnswerAllowance({ userId: u.id, email: u.email })).toMatchObject({ remaining: 0 })
    await Promise.all(Array.from({ length: 4 }, () => releaseChimmyPlanAllowance({ userId: u.id, state: taken[0]! })))
    expect(await readChimmyAnswerAllowance({ userId: u.id, email: u.email })).toMatchObject({ used: 1, remaining: 1 })
    expect(await prisma.userTokenBalance.findUnique({ where: { userId: u.id } })).toBeNull()
  })

  it('concurrent purchase deliveries all return one receipt and credit one pack', async () => {
    const p = purchase((await user()).id)
    const receipts = await Promise.all(Array.from({ length: 8 }, () => service.grantTokensFromPackagePurchase(p)))
    expect(new Set(receipts.map(r => r.id)).size).toBe(1)
    expect(await wallet(p.userId)).toMatchObject({ balance: 250, lifetimePurchased: 250 })
    expect(await prisma.tokenLedger.count({ where: { userId: p.userId } })).toBe(1)
  })

  it('purchase replay cannot change the account, product or source', async () => {
    const p = purchase((await user()).id), other = await user()
    await service.grantTokensFromPackagePurchase(p)
    for (const change of [{ userId: other.id }, { packageSku: 'af_tokens_10' }, { sourceType: 'apple_iap' }, { sourceId: 'different' }]) {
      await expect(service.grantTokensFromPackagePurchase({ ...p, ...change })).rejects.toBeInstanceOf(TokenSpendIdempotencyConflictError)
    }
    expect(await wallet(p.userId)).toMatchObject({ balance: 250 })
    expect(await prisma.userTokenBalance.findUnique({ where: { userId: other.id } })).toBeNull()
  })

  it('a three-token action debits and refunds exactly three once across concurrent retries', async () => {
    const u = await user(), p = purchase(u.id)
    await service.grantTokensFromPackagePurchase(p)
    const code = `billing-${randomUUID()}`; rules.push(code)
    await prisma.tokenSpendRule.create({ data: { code, category: 'ai_feature', featureLabel: 'Isolated three-token action', tokenCost: 3, requiresConfirmation: true } })
    const spend = { userId: u.id, ruleCode: code, expectedTokenCost: 3, confirmed: true, sourceType: 'billing_test', idempotencyKey: randomUUID() }
    const charges = await Promise.all(Array.from({ length: 8 }, () => service.spendTokensForRule(spend)))
    expect(new Set(charges.map(r => r.id)).size).toBe(1)
    expect(charges[0]).toMatchObject({ tokenDelta: -3, balanceBefore: 250, balanceAfter: 247 })
    expect(await wallet(u.id)).toMatchObject({ balance: 247, lifetimeSpent: 3 })
    const refunds = await Promise.all(Array.from({ length: 8 }, (_, i) => service.refundSpendByLedger({ userId: u.id,
      spendLedgerId: charges[0].id, refundRuleCode: 'feature_execution_failed', idempotencyKey: `caller-${i}` })))
    expect(new Set(refunds.map(r => r.id)).size).toBe(1)
    expect(refunds[0].tokenDelta).toBe(3)
    expect(await wallet(u.id)).toMatchObject({ balance: 250, lifetimeSpent: 3, lifetimeRefunded: 3 })
  })

  it('a cash refund before fulfillment prevents later credit and restore', async () => {
    const p = purchase((await user()).id)
    await reverse(p)
    const results = await Promise.all(Array.from({ length: 4 }, () => service.grantTokensFromPackagePurchase(p)))
    expect(results.every(r => r.entryType === 'adjustment' && r.tokenDelta === 0)).toBe(true)
    expect(await wallet(p.userId)).toMatchObject({ balance: 0, lifetimePurchased: 0 })
    expect(await prisma.tokenLedger.count({ where: { userId: p.userId } })).toBe(1)
  })

  it('concurrent fulfillment and cash-refund deliveries settle at zero with one reversal', async () => {
    const p = purchase((await user()).id)
    await Promise.all(Array.from({ length: 6 }, () => [service.grantTokensFromPackagePurchase(p), reverse(p)]).flat())
    expect(await wallet(p.userId)).toMatchObject({ balance: 0, reservedBalance: 0 })
    expect(await prisma.tokenLedger.count({ where: { userId: p.userId, entryType: 'adjustment' } })).toBe(1)
    await service.grantTokensFromPackagePurchase(p)
    expect((await wallet(p.userId)).balance).toBe(0)
  })

  it('a refund releases unbacked holds and a released hold cannot debit the wallet', async () => {
    const p = purchase((await user()).id), key = randomUUID()
    await service.grantTokensFromPackagePurchase(p)
    await reservations.reserve({ userId: p.userId, amount: 200, idempotencyKey: key })
    await reverse(p)
    expect(await wallet(p.userId)).toMatchObject({ balance: 0, reservedBalance: 0 })
    expect(await reservations.finalize({ userId: p.userId, idempotencyKey: key })).toMatchObject({ status: 'released' })
    expect(await prisma.tokenLedger.count({ where: { userId: p.userId, entryType: 'spend' } })).toBe(0)
  })

  it.each(['finalize', 'release'] as const)('cash refunds racing hold %s preserve wallet and ledger invariants', async action => {
    const p = purchase((await user()).id), key = randomUUID()
    await service.grantTokensFromPackagePurchase(p)
    await reservations.reserve({ userId: p.userId, amount: 200, idempotencyKey: key })
    await Promise.all([reverse(p), action === 'finalize'
      ? reservations.finalize({ userId: p.userId, idempotencyKey: key })
      : reservations.release({ userId: p.userId, idempotencyKey: key, reason: 'test_failure' })])
    expect(await wallet(p.userId)).toMatchObject({ balance: 0, reservedBalance: 0 })
    const entries = await prisma.tokenLedger.findMany({ where: { userId: p.userId } })
    expect(entries.reduce((sum, row) => sum + row.tokenDelta, 0)).toBe(0)
    await reverse(p)
    expect((await wallet(p.userId)).balance).toBe(0)
  })

  it('holds cannot be replayed, finalized or released by another account', async () => {
    const p = purchase((await user()).id), other = await user(), key = randomUUID()
    await service.grantTokensFromPackagePurchase(p)
    await reservations.reserve({ userId: p.userId, amount: 3, idempotencyKey: key })
    for (const attempt of [() => reservations.reserve({ userId: other.id, amount: 3, idempotencyKey: key }),
      () => reservations.finalize({ userId: other.id, idempotencyKey: key }),
      () => reservations.release({ userId: other.id, idempotencyKey: key, reason: 'foreign' })]) {
      await expect(attempt()).rejects.toBeInstanceOf(TokenSpendIdempotencyConflictError)
    }
    expect(await wallet(p.userId)).toMatchObject({ balance: 250, reservedBalance: 3 })
  })

  it('historical Apple refund identities prevent a second clawback', async () => {
    const u = await user(), id = randomUUID()
    const p = { userId: u.id, packageSku: 'af_tokens_5', sourceType: 'apple_iap', sourceId: id, idempotencyKey: `apple_iap:${id}` }
    await service.grantTokensFromPackagePurchase(p)
    await service.reverseApplePackagePurchase(id)
    const next = purchase(u.id); await service.grantTokensFromPackagePurchase(next)
    await service.reverseApplePackagePurchase(id)
    await service.grantTokensFromPackagePurchase(p)
    expect(await wallet(u.id)).toMatchObject({ balance: 250, lifetimePurchased: 500 })
    expect(await prisma.tokenLedger.count({ where: { idempotencyKey: `apple_iap_refund:${id}` } })).toBe(1)
  })
})
