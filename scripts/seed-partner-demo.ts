/**
 * Commissioner Partner Codes demo data, so the program can be shown before real users join.
 *
 *   npx tsx scripts/seed-partner-demo.ts           # create / refresh
 *   npx tsx scripts/seed-partner-demo.ts --reset   # remove the demo rows only
 *
 * Creates commissioner `DEMOCOMMISH` with 1,330 referrals across plans and intervals (1,087 paying,
 * 163 in their first 30 days, 79 churned, one flagged), 6 months of ledger, 4 paid statements and one
 * in review. Every row carries `isDemo = true` and the daily/monthly jobs skip demo codes.
 * View it at /partner-code?demo=1 with PARTNER_CODES_ENABLED=1 and PARTNER_DEMO=1.
 *
 * 🛑 Refuses any database not positively identified as safe (scripts/_assert-safe-seed-target.ts).
 */
import { randomUUID } from 'node:crypto'

const DEMO_USERNAME = 'democommish'
const DEMO_CODE = 'DEMOCOMMISH'

type Plan = 'af_pro' | 'af_commissioner' | 'af_supreme'
const PRICE: Record<Plan, { month: number; year: number }> = {
  af_pro: { month: 999, year: 7999 },
  af_commissioner: { month: 1499, year: 12999 },
  af_supreme: { month: 1999, year: 15999 },
}

/** Deterministic, so a re-run produces the same demo. */
function rng(seed: number) {
  let x = seed
  return () => ((x = (x * 1664525 + 1013904223) >>> 0) / 2 ** 32)
}

function monthKey(d: Date) {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`
}

async function main() {
  const { assertSafeSeedTarget } = await import('./_assert-safe-seed-target')
  assertSafeSeedTarget('seed-partner-demo')
  const { prisma } = await import('../lib/prisma')

  // Scoped teardown: only rows marked isDemo.
  await prisma.partnerCommissionEntry.deleteMany({ where: { isDemo: true } })
  await prisma.partnerPayout.deleteMany({ where: { isDemo: true } })
  await prisma.partnerReferral.deleteMany({ where: { isDemo: true } })
  await prisma.partnerCode.deleteMany({ where: { isDemo: true } })
  if (process.argv.includes('--reset')) {
    console.log('[seed-partner-demo] demo rows removed. Nothing else was touched.')
    await prisma.$disconnect()
    return
  }

  const owner =
    (await prisma.appUser.findUnique({ where: { username: DEMO_USERNAME } })) ??
    (await prisma.appUser.create({ data: { username: DEMO_USERNAME, displayName: 'Demo Commissioner' } }))

  const now = new Date()
  const cashUnlockedAt = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 6, 14))
  const code = await prisma.partnerCode.create({
    data: {
      ownerUserId: owner.id,
      code: DEMO_CODE,
      codeNormalized: DEMO_CODE,
      isDemo: true,
      cashUnlockedAt,
      freePlan: 'supreme',
      paidSubsCount: 1087,
      activeUsersCount: 1180,
      pendingPaidCount: 163,
      metersUpdatedAt: now,
    },
  })
  await prisma.partnerTaxProfile.upsert({
    where: { ownerUserId: owner.id },
    create: { ownerUserId: owner.id, w9Status: 'verified', payoutMethod: 'manual', legalName: 'Demo Commissioner' },
    update: { w9Status: 'verified' },
  })

  const rand = rng(42)
  const pickPlan = (): Plan => {
    const r = rand()
    return r < 0.53 ? 'af_pro' : r < 0.85 ? 'af_commissioner' : 'af_supreme'
  }
  type Row = { id: string; plan: Plan; interval: 'month' | 'year'; status: string; paying: boolean; firstPaidAt: Date | null; flags: string[] }
  const rows: Row[] = []
  const DAY = 86_400_000
  // 163 in their first 30 days, 1,087 qualified and paying, 79 churned, 1 flagged = 1,330 signups.
  for (let i = 0; i < 1330; i++) {
    const plan = pickPlan()
    const interval: 'month' | 'year' = rand() < 0.11 ? 'year' : 'month'
    const firstPaidAt = new Date(now.getTime() - (40 + Math.floor(rand() * 200)) * DAY)
    if (i < 163) rows.push({ id: randomUUID(), plan, interval, status: 'pending', paying: true, firstPaidAt: new Date(now.getTime() - Math.floor(rand() * 29) * DAY), flags: [] })
    else if (i < 1250) rows.push({ id: randomUUID(), plan, interval, status: 'qualified', paying: true, firstPaidAt, flags: [] })
    else if (i < 1329) rows.push({ id: randomUUID(), plan, interval, status: 'churned', paying: false, firstPaidAt, flags: [] })
    else rows.push({ id: randomUUID(), plan, interval, status: 'flagged', paying: true, firstPaidAt, flags: ['shared_card'] })
  }

  for (let i = 0; i < rows.length; i += 500) {
    await prisma.partnerReferral.createMany({
      data: rows.slice(i, i + 500).map((r) => ({
        id: r.id,
        partnerCodeId: code.id,
        userId: `demo-ref-${r.id}`,
        platform: 'web',
        plan: r.plan,
        interval: r.interval,
        status: r.status,
        flagReasons: r.flags,
        currentlyPaying: r.paying,
        firstPaidAt: r.firstPaidAt,
        qualifiedAt: r.status === 'qualified' ? r.firstPaidAt : null,
        paidInvoiceCount: 3,
        activeDaysInWindow: 6,
        isDemo: true,
      })),
    })
  }

  // Six months of ledger: one monthly-equivalent slice per paying, qualified subscriber per month,
  // ramping up as the code grew. 10% of the price after a 2.9% + 30¢ card fee.
  const payouts: Array<{ month: string; millicents: number; ids: string[] }> = []
  for (let m = 6; m >= 1; m--) {
    const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - m + 1, 1))
    const mk = monthKey(monthStart)
    const share = [0.42, 0.6, 0.74, 0.86, 0.95, 1][6 - m]
    const eligible = rows.filter((r) => r.status === 'qualified').slice(0, Math.round(1087 * share))
    const entries = eligible.map((r) => {
      const gross = r.interval === 'year' ? 0 : PRICE[r.plan].month
      const yearlySlice = r.interval === 'year' ? Math.round((PRICE[r.plan].year - (Math.round(PRICE[r.plan].year * 0.029) + 30)) * 100 / 12) : 0
      const fee = gross ? Math.round(gross * 0.029) + 30 : 0
      const basis = gross - fee
      return {
        id: randomUUID(),
        partnerCodeId: code.id,
        referralId: r.id,
        source: 'stripe',
        sourceRef: `demo_in_${r.id}_${mk}`,
        installment: 0,
        periodMonth: mk,
        earnedAt: new Date(monthStart.getTime() + 10 * DAY),
        grossCents: gross,
        feeCents: fee,
        basisCents: basis,
        commissionMillicents: r.interval === 'year' ? yearlySlice : basis * 100,
        status: m === 1 ? 'accrued' : 'paid',
        isDemo: true,
      }
    })
    for (let i = 0; i < entries.length; i += 1000) await prisma.partnerCommissionEntry.createMany({ data: entries.slice(i, i + 1000) })
    if (m > 1) payouts.push({ month: mk, millicents: entries.reduce((a, e) => a + e.commissionMillicents, 0), ids: entries.map((e) => e.id) })
  }
  for (const [i, p] of payouts.entries()) {
    const last = i === payouts.length - 1
    const payout = await prisma.partnerPayout.create({
      data: {
        partnerCodeId: code.id,
        ownerUserId: owner.id,
        periodMonth: p.month,
        totalCents: Math.round(p.millicents / 1000),
        status: last ? 'pending_review' : 'paid',
        method: last ? null : 'manual',
        paidAt: last ? null : new Date(),
        isDemo: true,
      },
    })
    for (let j = 0; j < p.ids.length; j += 1000) {
      await prisma.partnerCommissionEntry.updateMany({ where: { id: { in: p.ids.slice(j, j + 1000) } }, data: { payoutId: payout.id, status: last ? 'accrued' : 'paid' } })
    }
  }

  const counts = await prisma.partnerReferral.groupBy({ by: ['status'], where: { partnerCodeId: code.id }, _count: { _all: true } })
  console.log('[seed-partner-demo] DEMOCOMMISH ready:', Object.fromEntries(counts.map((c) => [c.status, c._count._all])), `${payouts.length} statements`)
  await prisma.$disconnect()
}

main().catch((error) => {
  console.error('[seed-partner-demo] failed:', error)
  process.exit(1)
})
