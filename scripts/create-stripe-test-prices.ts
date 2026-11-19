/**
 * Create the TEST-mode Stripe Prices that local checkout needs — one per catalog SKU.
 *
 * Why: `.env.local` paired a TEST secret key with LIVE price ids, so every local checkout
 * failed with "No such price" (verify-stripe-price-parity.ts reports 0/11 there). Test-mode
 * Prices have to be created in the test account; this does it from the catalog, so the
 * amounts and intervals can never drift from what the pricing page shows.
 *
 * 🛑 TEST MODE ONLY, CHECKED TWICE. The key must start `sk_test_` / `rk_test_`, AND Stripe
 * must answer `livemode: false` before anything is written. A live key is refused before
 * any call is made. There is no flag to override this; live prices are what
 * create-stripe-prices.ts is for, and it is deliberately narrower.
 *
 * Idempotent: each Price carries the lookup key `af_<sku>`. A re-run reuses a matching Price
 * instead of minting a duplicate; if the catalog amount or interval changed, a new Price is
 * created and the lookup key moves to it (Stripe Prices are immutable). One Product per plan
 * ("AF Pro" holds its monthly and yearly Prices); one per token pack.
 *
 * Usage (PowerShell or bash, from the repo root):
 *   npx tsx scripts/create-stripe-test-prices.ts --env=.env.local            # dry run: prints the plan
 *   npx tsx scripts/create-stripe-test-prices.ts --env=.env.local --apply    # creates, prints env lines
 *   npx tsx scripts/create-stripe-test-prices.ts --env=.env.local --apply --write
 *       # …and writes the 11 STRIPE_PRICE_AF_* lines into that env file (other lines untouched)
 *
 * Never prints the secret key.
 */
import * as dotenv from "dotenv"
import { readFileSync, writeFileSync } from "node:fs"
import Stripe from "stripe"
import { getMonetizationCatalog, type MonetizationCatalogItem } from "../lib/monetization/catalog"

export type PlannedPrice = {
  sku: string
  envVar: string
  lookupKey: string
  productKey: string
  productName: string
  unitAmount: number
  interval: "month" | "year" | null
}

/** Only a test key may pass. Returns a refusal message, or null when the key is acceptable. */
export function refuseNonTestKey(key: string | undefined): string | null {
  const k = key?.trim() ?? ""
  if (!k) return "STRIPE_SECRET_KEY is not set in that env file."
  if (k.startsWith("sk_test_") || k.startsWith("rk_test_")) return null
  if (k.startsWith("sk_live_") || k.startsWith("rk_live_")) {
    return "REFUSED: that is a LIVE key. This script only creates test-mode prices. Point --env at a file holding a sk_test_ key."
  }
  return "REFUSED: STRIPE_SECRET_KEY is not a recognisable Stripe test key (sk_test_… / rk_test_…)."
}

/** "AF Pro Monthly" and "AF Pro Yearly" share the Product "AF Pro"; a token pack is its own. */
export function planPrices(items: readonly MonetizationCatalogItem[]): PlannedPrice[] {
  return items.map((item) => {
    const isPlan = item.type === "subscription" && item.planFamily
    return {
      sku: item.sku,
      envVar: item.stripePriceEnvVar,
      lookupKey: `af_${item.sku}`,
      productKey: isPlan ? String(item.planFamily) : item.sku,
      productName: isPlan ? item.title.replace(/\s+(Monthly|Yearly)$/i, "").trim() : item.title,
      unitAmount: Math.round(item.amountUsd * 100),
      interval: item.interval,
    }
  })
}

/** Does an existing Price already charge exactly what this plan says? */
export function priceMatches(price: Pick<Stripe.Price, "unit_amount" | "currency" | "active" | "type" | "recurring">, plan: PlannedPrice): boolean {
  if (!price.active || price.currency !== "usd" || price.unit_amount !== plan.unitAmount) return false
  return plan.interval ? price.type === "recurring" && price.recurring?.interval === plan.interval : price.type === "one_time"
}

/**
 * Set each VAR=value in an env file's text: replace the line if present, append if not. Every
 * other line — and the file's line endings — are left exactly as they were.
 */
export function upsertEnvLines(text: string, values: Record<string, string>): string {
  const eol = text.includes("\r\n") ? "\r\n" : "\n"
  let out = text
  for (const [name, value] of Object.entries(values)) {
    const line = `${name}=${value}`
    // Stops before `\r` as well as `\n`, so a CRLF file keeps its line endings.
    const re = new RegExp(`^${name}=[^\\r\\n]*`, "m")
    if (re.test(out)) out = out.replace(re, line)
    else out = `${out}${out === "" || out.endsWith(eol) ? "" : eol}${line}${eol}`
  }
  return out
}

function arg(name: string): string | null {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`))
  return hit ? hit.slice(name.length + 3) : null
}

async function main() {
  const envFile = arg("env") ?? ".env.local"
  const apply = process.argv.includes("--apply")
  const write = process.argv.includes("--write")
  dotenv.config({ path: envFile })

  const key = process.env.STRIPE_SECRET_KEY
  const refusal = refuseNonTestKey(key)
  if (refusal) {
    console.error(refusal)
    process.exit(2)
  }
  const stripe = new Stripe(key!.trim(), { apiVersion: "2026-02-25.clover" })

  // The second check: Stripe itself must say this is test mode before anything is written.
  const balance = await stripe.balance.retrieve()
  if (balance.livemode) {
    console.error("REFUSED: Stripe reports this key is LIVE mode. Nothing was created.")
    process.exit(2)
  }

  console.log(`Env file: ${envFile}    Stripe mode: TEST    ${apply ? "APPLYING" : "DRY RUN (add --apply to create)"}\n`)

  const plans = planPrices(getMonetizationCatalog().all)
  // Stripe accepts at most 10 lookup keys per list call, and the catalog has more SKUs than that.
  const byLookup = new Map<string | null, Stripe.Price>()
  const lookupKeys = plans.map((p) => p.lookupKey)
  for (let i = 0; i < lookupKeys.length; i += 10) {
    const page = await stripe.prices.list({ lookup_keys: lookupKeys.slice(i, i + 10), limit: 100 })
    for (const price of page.data) byLookup.set(price.lookup_key, price)
  }

  // Products this script made before, found by metadata so a re-run reuses them.
  const productIds = new Map<string, string>()
  for await (const product of stripe.products.list({ active: true, limit: 100 })) {
    const k = product.metadata?.af_test_product
    if (k && !productIds.has(k)) productIds.set(k, product.id)
  }

  const envValues: Record<string, string> = {}
  for (const plan of plans) {
    const label = `${plan.sku.padEnd(26)}$${(plan.unitAmount / 100).toFixed(2).padStart(7)} ${plan.interval ?? "one-time"}`
    const current = byLookup.get(plan.lookupKey)
    if (current && priceMatches(current, plan)) {
      console.log(`${label}  reuse   ${current.id}`)
      envValues[plan.envVar] = current.id
      continue
    }
    if (!apply) {
      console.log(`${label}  ${current ? "REPLACE (amount or interval changed)" : "create"}`)
      continue
    }

    let productId = productIds.get(plan.productKey)
    if (!productId) {
      const product = await stripe.products.create({
        name: plan.productName,
        metadata: { af_test_product: plan.productKey },
      })
      productId = product.id
      productIds.set(plan.productKey, productId)
    }
    const price = await stripe.prices.create({
      product: productId,
      currency: "usd",
      unit_amount: plan.unitAmount,
      ...(plan.interval ? { recurring: { interval: plan.interval } } : {}),
      lookup_key: plan.lookupKey,
      // A changed amount gets a new Price; the lookup key moves to it so the next run finds it.
      transfer_lookup_key: true,
      metadata: { af_sku: plan.sku },
    })
    console.log(`${label}  created ${price.id}`)
    envValues[plan.envVar] = price.id
  }

  if (!apply) {
    const missing = plans.filter((p) => !envValues[p.envVar]).length
    console.log(`\n${missing} to create. Re-run with --apply to create them.`)
    return
  }

  console.log("\nPaste into your env file (or re-run with --write):\n")
  for (const plan of plans) console.log(`${plan.envVar}=${envValues[plan.envVar]}`)

  if (write) {
    const before = readFileSync(envFile, "utf8")
    writeFileSync(envFile, upsertEnvLines(before, envValues))
    console.log(`\nWrote ${Object.keys(envValues).length} STRIPE_PRICE_AF_* lines into ${envFile}.`)
  }
  console.log("\nNext: npx tsx scripts/verify-stripe-price-parity.ts --env=" + envFile)
}

// Run only when executed directly, so the helpers above can be imported by tests.
if (/create-stripe-test-prices\.ts$/.test(process.argv[1] ?? "")) {
  main().catch((e) => {
    // Stripe's message never contains a full secret key, but keep the output to type and message.
    console.error((e as { type?: string })?.type ?? "Error", (e as Error)?.message ?? String(e))
    process.exit(1)
  })
}
