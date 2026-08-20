/**
 * Create the new Stripe Prices staged in PLANNED_PRICE_USD.
 *
 * ⚠ THIS WRITES TO A LIVE PAYMENT ACCOUNT. It is deliberately narrow: it creates
 * new Price objects on the EXISTING Products and does nothing else. It does not
 * archive the old Prices, does not touch env vars, and does not modify a single
 * subscription. Nobody's card is affected by running this — a Price only becomes
 * real to a customer when something points a checkout at it.
 *
 * ⚠ IT DOES NOT MIGRATE EXISTING SUBSCRIBERS, AND THAT IS NOT AN OVERSIGHT. A
 * Stripe subscription bills the Price it was created with. Repointing the env var
 * changes what NEW checkouts charge; current Legacy subscribers keep paying
 * $29.99/mo until someone explicitly updates their subscriptions. That is a
 * money-moving decision about real customers and it does not belong in a script
 * that exists to create configuration.
 *
 * ⚠ IDEMPOTENT BY CONSTRUCTION. Every create carries a deterministic idempotency
 * key derived from the SKU and the amount, so running this twice returns the
 * SAME Price rather than minting a second one. Stripe Prices cannot be deleted,
 * only archived — a duplicate is permanent clutter on a live account, and "I ran
 * it again to be sure" is the most likely way to get one.
 *
 * Usage:
 *   npx tsx scripts/create-stripe-prices.ts            # dry run, prints the plan
 *   npx tsx scripts/create-stripe-prices.ts --apply    # actually creates them
 */
import * as dotenv from 'dotenv'
import Stripe from 'stripe'
import { getMonetizationCatalog, PLANNED_PRICE_USD } from '../lib/monetization/catalog'

const envArg = process.argv.find((a) => a.startsWith('--env='))
const ENV_FILE = envArg ? envArg.slice('--env='.length) : '.env'
dotenv.config({ path: ENV_FILE })

const APPLY = process.argv.includes('--apply')

async function main() {
  const secret = process.env.STRIPE_SECRET_KEY?.trim()
  if (!secret) {
    console.error(`STRIPE_SECRET_KEY is not set in ${ENV_FILE}.`)
    process.exit(2)
  }
  const mode = secret.startsWith('sk_live') ? 'LIVE' : secret.startsWith('sk_test') ? 'TEST' : 'UNKNOWN'
  console.log(`Env file: ${ENV_FILE}    Stripe key mode: ${mode}    ${APPLY ? 'APPLYING' : 'DRY RUN'}\n`)

  const stripe = new Stripe(secret, { apiVersion: '2026-02-25.clover' })
  const results: Array<{ sku: string; envVar: string; priceId: string; amount: number }> = []

  for (const item of getMonetizationCatalog().all) {
    const planned = PLANNED_PRICE_USD[item.sku]
    if (planned == null) continue

    const oldId = process.env[item.stripePriceEnvVar]?.trim()
    if (!oldId) {
      console.log(`${item.sku}: ${item.stripePriceEnvVar} is unset — skipping, nothing to copy config from`)
      continue
    }

    /*
     * Read the CURRENT price to copy product, currency and recurring shape.
     * Deriving these rather than hardcoding them means a yearly plan cannot
     * accidentally be recreated as monthly, which would be invisible in the
     * catalog and very visible on a customer's statement.
     */
    const current = await stripe.prices.retrieve(oldId)
    const productId = typeof current.product === 'string' ? current.product : current.product.id
    const cents = Math.round(planned * 100)

    if (!current.recurring) {
      console.log(`${item.sku}: current price is one-time, not recurring — skipping (unexpected)`)
      continue
    }

    console.log(
      `${item.sku}\n` +
        `   product   ${productId}\n` +
        `   from      $${((current.unit_amount ?? 0) / 100).toFixed(2)} -> $${planned.toFixed(2)}\n` +
        `   recurring every ${current.recurring.interval_count} ${current.recurring.interval}`
    )

    if (!APPLY) {
      console.log(`   (dry run — nothing created)\n`)
      continue
    }

    const price = await stripe.prices.create(
      {
        product: productId,
        currency: current.currency,
        unit_amount: cents,
        recurring: {
          interval: current.recurring.interval,
          interval_count: current.recurring.interval_count,
        },
        nickname: `${item.title} — $${planned.toFixed(2)}`,
        metadata: { af_sku: item.sku, created_by: 'scripts/create-stripe-prices.ts' },
      },
      // Deterministic: same SKU + same amount always resolves to the same Price.
      { idempotencyKey: `af-price-${item.sku}-${cents}` }
    )

    console.log(`   CREATED   ${price.id}\n`)
    results.push({ sku: item.sku, envVar: item.stripePriceEnvVar, priceId: price.id, amount: planned })
  }

  if (!APPLY) {
    console.log('Dry run complete. Re-run with --apply to create these Prices.')
    return
  }

  if (results.length === 0) {
    console.log('Nothing created.')
    return
  }

  console.log('\n' + '='.repeat(72))
  console.log('Set these on Vercel (Production) AND in your local .env:\n')
  for (const r of results) console.log(`${r.envVar}=${r.priceId}`)
  console.log('\nThen move PLANNED_PRICE_USD values into amountUsd and require 11/11 from')
  console.log('  npx tsx scripts/verify-stripe-price-parity.ts')
  console.log('\nExisting subscribers are NOT migrated by this — they keep their current price.')
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
