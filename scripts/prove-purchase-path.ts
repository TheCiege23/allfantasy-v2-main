/**
 * PROVE THE PURCHASE PATH — end to end, with real Stripe objects, spending nothing.
 *
 *   node --require ./scripts/_audit-preload.cjs --import tsx scripts/prove-purchase-path.ts
 *     [--db-env .env.test] [--stripe-env .env.local] [--keep]
 *
 * What it proves, each as a PASS/FAIL line (exit 1 on any FAIL):
 *   1. The catalog's AF Pro price, as a Stripe price, charges what the catalog displays.
 *   2. A first-time buyer's Checkout Session is built by OUR code with that price, the buyer's id
 *      and the plan — and a returning buyer's reuses their Stripe customer.
 *   3. Paying it (Stripe's `pm_card_visa` test token — no card number is typed anywhere) and the
 *      resulting `checkout.session.completed`, run through OUR webhook route, grants AF Pro — and
 *      the /core depth paywall then OPENS Player Finder, Trade Center and Competitive Edge depth
 *      while the Commissioner depth stays locked. Delivered twice, it grants once.
 *   4. The first invoice and a RENEWAL a month later (a Stripe test clock) keep the plan active and
 *      move its period forward — the renewal bug fixed in #1219.
 *   5. Cancelling locks the depth again.
 *
 * Every Stripe object handed to the webhook is the REAL object from the sandbox, re-read at API
 * version 2025-05-28.basil — the version the live endpoint is on, whose field moves #1219 fixed.
 * Only the checkout session's completion fields are set here, because completing Checkout needs
 * its hosted page.
 *
 * NOT proven here, and the live dry run before launch has to: Stripe's hosted page taking a real
 * card, and the live endpoint delivering over HTTP (its event list was verified on 2026-09-24).
 *
 * 🛑 SAFETY — it refuses to run unless the Stripe key is a SANDBOX key (sk_test_) and the database
 * is not production (./prove-purchase-path.guards.ts). The database comes from .env.test ALONE:
 * .env.local pairs its test Stripe key with the PRODUCTION database. Meta, email, SMS and AI tokens
 * are pinned empty before any import — `@prisma/client` loads the production .env on import, and
 * the checkout webhook fires a Meta "Purchase" conversion that cannot be taken back — and anything
 * that import adds anyway is deleted before app code loads. The test user, its rows and the test
 * clock (with its customer and subscription) are deleted at the end unless --keep.
 */
import { readFileSync } from 'node:fs'
import type Stripe from 'stripe'
import { randomBytes, randomUUID } from 'node:crypto'

import { OUTBOUND_ENV_KEYS, dbHost, pickEnv, refuseUnlessSafe } from './prove-purchase-path.guards'

const BASIL = '2025-05-28.basil'
const LAUNCH = new Date('2026-10-15T04:00:00.000Z')
const DAY = 24 * 60 * 60 * 1000

function argValue(name: string, fallback: string): string {
  const i = process.argv.indexOf(name)
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1]! : fallback
}

// ── 1. Environment: explicit picks only, then the refusals ─────────────────────────────────────
const dbEnv = pickEnv(readFileSync(argValue('--db-env', '.env.test'), 'utf8'), ['DATABASE_URL', 'DIRECT_URL'])
const stripeEnv = pickEnv(readFileSync(argValue('--stripe-env', '.env.local'), 'utf8'), ['STRIPE_SECRET_KEY'])
const keep = process.argv.includes('--keep')

for (const url of [dbEnv.DATABASE_URL, dbEnv.DIRECT_URL].filter(Boolean)) {
  const refusal = refuseUnlessSafe({ stripeSecretKey: stripeEnv.STRIPE_SECRET_KEY, databaseUrl: url })
  if (refusal) {
    console.error(refusal)
    process.exit(2)
  }
}

process.env.DATABASE_URL = dbEnv.DATABASE_URL!
process.env.DIRECT_URL = dbEnv.DIRECT_URL || dbEnv.DATABASE_URL!
process.env.STRIPE_SECRET_KEY = stripeEnv.STRIPE_SECRET_KEY!
process.env.STRIPE_WEBHOOK_SECRET = `whsec_proof_${randomBytes(16).toString('hex')}`
process.env.NEXTAUTH_URL = 'http://localhost:3000'
process.env.NEXT_PUBLIC_APP_URL = 'http://localhost:3000'
process.env.APP_URL = 'http://localhost:3000'
process.env.AF_PAYWALL_STARTS_AT = ''
// Required at import by the auth module the webhook route pulls in; nothing here signs a session.
process.env.NEXTAUTH_SECRET = randomBytes(32).toString('hex')
for (const key of OUTBOUND_ENV_KEYS) process.env[key] = ''

const envBaseline = new Set(Object.keys(process.env))
function stripInjectedEnv(): number {
  const injected = Object.keys(process.env).filter((k) => !envBaseline.has(k))
  for (const k of injected) delete process.env[k]
  return injected.length
}
function assertNoOutbound(): void {
  const set = OUTBOUND_ENV_KEYS.filter((k) => (process.env[k] ?? '') !== '')
  if (set.length > 0) throw new Error(`REFUSING to deliver: outbound tokens became set (${set.join(', ')})`)
  if (dbHost(process.env.DATABASE_URL) !== dbHost(dbEnv.DATABASE_URL)) throw new Error('REFUSING: DATABASE_URL changed')
}

type Result = { step: string; ok: boolean; detail: string }
const results: Result[] = []
function check(step: string, ok: boolean, detail = ''): boolean {
  results.push({ step, ok, detail })
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${step}${detail ? `  — ${detail}` : ''}`)
  return ok
}

async function main() {
  // ── 2. Prisma first, then remove whatever its .env load added, then the app ─────────────────
  await import('@prisma/client')
  const { prisma } = await import('@/lib/prisma')
  await prisma.$queryRaw`SELECT 1`
  const removed = stripInjectedEnv()
  console.log(`env: database ${dbHost(process.env.DATABASE_URL)}; removed ${removed} variable(s) a .env load added`)
  assertNoOutbound()

  const StripeSdk = (await import('stripe')).default
  const { NextRequest } = await import('next/server')
  const { buildStripeCheckoutSessionForSku } = await import('@/lib/monetization/StripeCheckoutSession')
  const { getMonetizationCatalogItemBySku } = await import('@/lib/monetization/catalog')
  const { parseStripeCheckoutClientReferenceId } = await import('@/lib/monetization/StripeCheckoutLinkRegistry')
  const { POST: webhookPOST } = await import('@/app/api/stripe/webhook/route')
  const { EntitlementResolver } = await import('@/lib/subscription/EntitlementResolver')
  const { resolveCorePaywall } = await import('@/lib/core-app/corePaywall')
  const { resolveSubscriptionStatus } = await import('@/lib/subscription/SubscriptionStatusResolver')
  stripInjectedEnv()
  assertNoOutbound()

  const stripe = new StripeSdk(process.env.STRIPE_SECRET_KEY!, { apiVersion: '2026-02-25.clover' })
  const basil = { apiVersion: BASIL } as { apiVersion: string }

  const eventIds: string[] = []
  const clockIds: string[] = []
  const userIds: string[] = []

  async function deliver(type: string, object: unknown, reuseId?: string) {
    assertNoOutbound()
    const id = reuseId ?? `evt_proof_${randomUUID().replace(/-/g, '')}`
    if (!reuseId) eventIds.push(id)
    const payload = JSON.stringify({
      id,
      object: 'event',
      api_version: BASIL,
      created: Math.floor(Date.now() / 1000),
      data: { object },
      livemode: false,
      pending_webhooks: 0,
      request: { id: null, idempotency_key: null },
      type,
    })
    const header = stripe.webhooks.generateTestHeaderString({ payload, secret: process.env.STRIPE_WEBHOOK_SECRET! })
    const res = await webhookPOST(
      new NextRequest('http://localhost:3000/api/stripe/webhook', {
        method: 'POST',
        body: payload,
        headers: { 'stripe-signature': header, 'content-type': 'application/json' },
      }),
    )
    return { status: res.status, body: (await res.json()) as Record<string, unknown>, id }
  }

  async function row(subscriptionId: string) {
    return prisma.userSubscription.findUnique({
      where: { stripeSubscriptionId: subscriptionId },
      select: { status: true, sku: true, stripeCustomerId: true, currentPeriodEnd: true },
    })
  }

  async function depths(uid: string, email: string, now: Date) {
    const p = await resolveCorePaywall(uid, { email, now })
    return {
      player: p.player_depth.unlocked,
      trade: p.trade_depth.unlocked,
      edge: p.competitive_edge.unlocked,
      commissioner: p.commissioner_depth.unlocked,
    }
  }

  async function waitForClock(id: string) {
    for (let i = 0; i < 60; i++) {
      const clock = await stripe.testHelpers.testClocks.retrieve(id)
      if (clock.status === 'ready') return clock
      await new Promise((r) => setTimeout(r, 2000))
    }
    throw new Error('test clock did not finish advancing in 120s')
  }

  try {
    // ── 1. The catalog price, as a sandbox Stripe price ─────────────────────────────────────
    const item = getMonetizationCatalogItemBySku('af_pro_monthly')!
    const cents = Math.round(item.amountUsd * 100)
    const lookupKey = 'af_paywall_proof_af_pro_monthly'
    let price = (await stripe.prices.list({ lookup_keys: [lookupKey], active: true, limit: 1 })).data[0]
    if (!price) {
      const product = await stripe.products.create({ name: 'AF Pro Monthly (paywall proof)', metadata: { af_paywall_proof: '1' } })
      price = await stripe.prices.create({
        product: product.id,
        unit_amount: cents,
        currency: item.currency,
        recurring: { interval: 'month' },
        lookup_key: lookupKey,
        metadata: { af_paywall_proof: '1' },
      })
    }
    check(
      'sandbox price charges what the catalog displays',
      price.livemode === false && price.unit_amount === cents && price.recurring?.interval === item.interval,
      `${price.id}: ${price.unit_amount} ${price.currency}/${price.recurring?.interval} vs catalog $${item.amountUsd}/${item.interval}`,
    )
    const env = { ...process.env, STRIPE_PRICE_AF_PRO_MONTHLY: price.id }

    // ── 2. A test user, locked before they pay ──────────────────────────────────────────────
    const stamp = `${Date.now()}${randomBytes(2).toString('hex')}`
    const email = `paywall-proof+${stamp}@allfantasy.test`
    const user = await prisma.appUser.create({ data: { email, username: `paywall_proof_${stamp}` }, select: { id: true } })
    const userId = user.id
    userIds.push(userId)
    const afterLaunch = new Date(LAUNCH.getTime() + DAY)
    const before = await depths(userId, email, afterLaunch)
    check(
      'before paying, after launch: every depth is locked',
      !before.player && !before.trade && !before.edge && !before.commissioner,
      JSON.stringify(before),
    )

    // ── 3. Checkout Sessions built by our code ──────────────────────────────────────────────
    const first = await buildStripeCheckoutSessionForSku({ sku: 'af_pro_monthly', userId, userEmail: email, returnPath: '/core/trades', env })
    const firstSession = first ? await stripe.checkout.sessions.retrieve(first.sessionId, { expand: ['line_items'] }) : null
    const ref = parseStripeCheckoutClientReferenceId(firstSession?.client_reference_id ?? null)
    check(
      'first-time checkout: subscription mode, the catalog price, the buyer and the plan',
      Boolean(
        firstSession &&
          firstSession.mode === 'subscription' &&
          firstSession.line_items?.data[0]?.price?.id === price.id &&
          firstSession.metadata?.userId === userId &&
          firstSession.metadata?.sku === 'af_pro_monthly' &&
          firstSession.metadata?.purchaseType === 'subscription' &&
          firstSession.customer_email === email &&
          ref?.userId === userId &&
          ref?.sku === 'af_pro_monthly',
      ),
      first ? `${first.sessionId} → ${first.url.slice(0, 40)}…` : 'no session built',
    )

    const clock = await stripe.testHelpers.testClocks.create({ frozen_time: Math.floor(Date.now() / 1000), name: `paywall proof ${stamp}` })
    clockIds.push(clock.id)
    const customer = await stripe.customers.create({
      email,
      test_clock: clock.id,
      payment_method: 'pm_card_visa',
      invoice_settings: { default_payment_method: 'pm_card_visa' },
      metadata: { af_paywall_proof: '1' },
    })
    const returning = await buildStripeCheckoutSessionForSku({
      sku: 'af_pro_monthly',
      userId,
      userEmail: email,
      stripeCustomerId: customer.id,
      returnPath: '/core/trades',
      env,
    })
    const session = returning ? await stripe.checkout.sessions.retrieve(returning.sessionId, {}, basil) : null
    check('returning-buyer checkout reuses their Stripe customer', session?.customer === customer.id, `${session?.id ?? 'none'} → ${String(session?.customer)}`)
    if (!session) throw new Error('no checkout session — cannot continue')

    // ── 4. Pay, and deliver checkout.session.completed ─────────────────────────────────────
    const sub = await stripe.subscriptions.create({
      customer: customer.id,
      items: [{ price: price.id }],
      metadata: session.metadata ?? {},
      expand: ['latest_invoice'],
    })
    check('the test payment succeeds and the subscription is active', sub.status === 'active', `${sub.id} ${sub.status}`)

    const completed = {
      ...session,
      status: 'complete',
      payment_status: 'paid',
      subscription: sub.id,
      customer: customer.id,
      customer_details: { email },
    }
    const granted = await deliver('checkout.session.completed', completed)
    check('the webhook accepts checkout.session.completed', granted.status === 200 && granted.body.purchaseType === 'subscription', JSON.stringify(granted.body))
    const afterGrant = await row(sub.id)
    check(
      'AF Pro is granted on the right subscription',
      afterGrant?.status === 'active' && afterGrant?.sku === 'af_pro_monthly' && afterGrant?.stripeCustomerId === customer.id,
      JSON.stringify(afterGrant),
    )
    const snapshot = await new EntitlementResolver().resolveSnapshot(userId, email)
    check('the entitlement check sees the plan', snapshot.plans.includes('pro' as never), `plans=${JSON.stringify(snapshot.plans)} status=${snapshot.status}`)
    const paid = await depths(userId, email, afterLaunch)
    check(
      'after launch, paid: Player Finder, Trade Center and Competitive Edge depth open; Commissioner stays locked',
      paid.player && paid.trade && paid.edge && !paid.commissioner,
      JSON.stringify(paid),
    )

    const again = await deliver('checkout.session.completed', completed, granted.id)
    const rows = await prisma.userSubscription.count({ where: { userId } })
    check('delivered twice, it grants once', again.status === 200 && again.body.duplicate === true && rows === 1, `${JSON.stringify(again.body)}, rows=${rows}`)

    // ── 5. The first invoice, then a renewal a month later ─────────────────────────────────
    const firstInvoiceId = typeof sub.latest_invoice === 'string' ? sub.latest_invoice : sub.latest_invoice?.id
    const firstInvoice = await stripe.invoices.retrieve(firstInvoiceId!, {}, basil)
    const firstPaid = await deliver('invoice.payment_succeeded', firstInvoice)
    const periodEnd1 = (await row(sub.id))?.currentPeriodEnd ?? null
    const itemEnd1 = (await stripe.subscriptions.retrieve(sub.id, {}, basil)).items.data[0]?.current_period_end ?? 0
    check(
      'the first invoice sets the period the subscription actually has',
      firstPaid.status === 200 && periodEnd1?.getTime() === itemEnd1 * 1000,
      `row ${periodEnd1?.toISOString()} vs Stripe ${new Date(itemEnd1 * 1000).toISOString()}`,
    )

    await stripe.testHelpers.testClocks.advance(clock.id, { frozen_time: itemEnd1 + 3 * 60 * 60 })
    const advanced = await waitForClock(clock.id)
    let renewal: Stripe.Invoice | null = null
    for (let i = 0; i < 10 && !renewal; i++) {
      const list = await stripe.invoices.list({ subscription: sub.id, limit: 5 }, basil)
      renewal = list.data.find((inv) => inv.billing_reason === 'subscription_cycle' && inv.status === 'paid') ?? null
      if (!renewal) await new Promise((r) => setTimeout(r, 3000))
    }
    check('a month later the renewal invoice is paid', Boolean(renewal), renewal ? `${renewal.id} ${renewal.status}` : 'no paid renewal invoice')
    if (renewal) {
      const renewed = await deliver('invoice.payment_succeeded', renewal)
      const periodEnd2 = (await row(sub.id))?.currentPeriodEnd ?? null
      const gained = periodEnd2 && periodEnd1 ? (periodEnd2.getTime() - periodEnd1.getTime()) / DAY : 0
      check(
        'the renewal moves the period FORWARD — a renewing payer is not locked out',
        renewed.status === 200 && gained >= 27 && (await row(sub.id))?.status === 'active',
        `period end ${periodEnd1?.toISOString()} → ${periodEnd2?.toISOString()} (+${gained.toFixed(1)} days)`,
      )
      const updatedSub = await stripe.subscriptions.retrieve(sub.id, {}, basil)
      const updated = await deliver('customer.subscription.updated', updatedSub)
      const afterUpdate = await row(sub.id)
      check(
        'a subscription update at renewal keeps it active with the same period',
        updated.status === 200 && afterUpdate?.status === 'active' && afterUpdate?.currentPeriodEnd?.getTime() === periodEnd2?.getTime(),
        JSON.stringify(afterUpdate),
      )
      const renewedDepths = await depths(userId, email, new Date(advanced.frozen_time * 1000))
      check('after renewal the depth is still open', renewedDepths.player && renewedDepths.trade && renewedDepths.edge, JSON.stringify(renewedDepths))
    }

    // ── 6. Cancel ───────────────────────────────────────────────────────────────────────────
    /*
     * ⚠ TWO CLOCKS. After the renewal this subscription lives a month AHEAD on its test clock, while
     * the entitlement check reads real time — so its cancellation "ends in the future" and would read
     * as still open. That is the proof's skew, not the product's (in production `ended_at` is now).
     * So the renewed subscription is judged at ITS clock's time, and a second buyer proves the lock
     * end to end in real time.
     */
    await stripe.subscriptions.cancel(sub.id)
    const canceledSub = await stripe.subscriptions.retrieve(sub.id, {}, basil)
    const canceled = await deliver('customer.subscription.deleted', canceledSub)
    const endedAtMs = (canceledSub.ended_at ?? 0) * 1000
    const afterCancel = await prisma.userSubscription.findUnique({
      where: { stripeSubscriptionId: sub.id },
      select: { status: true, currentPeriodEnd: true, gracePeriodEnd: true, expiresAt: true },
    })
    check(
      'a cancellation is recorded as ending when Stripe ended it',
      canceled.status === 200 && afterCancel?.status === 'canceled' && afterCancel?.expiresAt?.getTime() === endedAtMs,
      `status ${afterCancel?.status}; ends ${afterCancel?.expiresAt?.toISOString()} vs Stripe ${new Date(endedAtMs).toISOString()}`,
    )
    const lapse = afterCancel ? resolveSubscriptionStatus(afterCancel, new Date(endedAtMs + 1000)) : 'no row'
    check('and the plan lapses the moment after', lapse === 'expired', `status one second after the end: ${lapse}`)

    // A second buyer, in real time: buy, get the depth, cancel at once, lose it.
    const emailB = `paywall-proof-b+${stamp}@allfantasy.test`
    const userB = await prisma.appUser.create({ data: { email: emailB, username: `paywall_proof_b_${stamp}` }, select: { id: true } })
    userIds.push(userB.id)
    const clockB = await stripe.testHelpers.testClocks.create({ frozen_time: Math.floor(Date.now() / 1000), name: `paywall proof B ${stamp}` })
    clockIds.push(clockB.id)
    const customerB = await stripe.customers.create({
      email: emailB,
      test_clock: clockB.id,
      payment_method: 'pm_card_visa',
      invoice_settings: { default_payment_method: 'pm_card_visa' },
      metadata: { af_paywall_proof: '1' },
    })
    const checkoutB = await buildStripeCheckoutSessionForSku({ sku: 'af_pro_monthly', userId: userB.id, userEmail: emailB, stripeCustomerId: customerB.id, env })
    const sessionB = checkoutB ? await stripe.checkout.sessions.retrieve(checkoutB.sessionId, {}, basil) : null
    if (!sessionB) throw new Error('no checkout session for the second buyer')
    const subB = await stripe.subscriptions.create({ customer: customerB.id, items: [{ price: price.id }], metadata: sessionB.metadata ?? {} })
    await deliver('checkout.session.completed', {
      ...sessionB,
      status: 'complete',
      payment_status: 'paid',
      subscription: subB.id,
      customer: customerB.id,
      customer_details: { email: emailB },
    })
    const openB = await depths(userB.id, emailB, afterLaunch)
    await stripe.subscriptions.cancel(subB.id)
    const canceledB = await deliver('customer.subscription.deleted', await stripe.subscriptions.retrieve(subB.id, {}, basil))
    const lockedB = await depths(userB.id, emailB, afterLaunch)
    check(
      'end to end in real time: bought, open; cancelled, locked again',
      openB.player && openB.trade && openB.edge && canceledB.status === 200 && !lockedB.player && !lockedB.trade && !lockedB.edge,
      `bought ${JSON.stringify(openB)}, cancelled ${JSON.stringify(lockedB)}`,
    )

    assertNoOutbound()
    check('no Meta, email, SMS or AI token was set at any point', true)
  } catch (error) {
    check('the run completed', false, error instanceof Error ? error.message : String(error))
  } finally {
    if (!keep) {
      for (const id of clockIds) await stripe.testHelpers.testClocks.del(id).catch((e: unknown) => console.warn('cleanup: test clock', e))
      if (eventIds.length) await prisma.stripeWebhookEvent.deleteMany({ where: { eventId: { in: eventIds } } }).catch(() => null)
      for (const userId of userIds) {
        await prisma.userSubscription.deleteMany({ where: { userId } }).catch(() => null)
        await (prisma as unknown as { userProfile?: { deleteMany: (a: unknown) => Promise<unknown> } }).userProfile
          ?.deleteMany({ where: { userId } })
          .catch(() => null)
        await prisma.appUser.delete({ where: { id: userId } }).catch((e: unknown) => console.warn('cleanup: user', e))
      }
      console.log(
        `cleanup: ${clockIds.length} test clock(s) with their customers and subscriptions, ${eventIds.length} webhook events, and ${userIds.length} test user(s) with their rows removed`,
      )
    } else {
      console.log(`--keep: left users ${userIds.join(', ')}, clocks ${clockIds.join(', ')}`)
    }
    await prisma.$disconnect()
  }

  const failed = results.filter((r) => !r.ok)
  console.log(`\n${results.length - failed.length} of ${results.length} checks passed`)
  process.exit(failed.length > 0 ? 1 : 0)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
