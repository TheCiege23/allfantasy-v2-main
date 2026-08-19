/**
 * Staging env safety check (CLI).
 *
 *   npx tsx scripts/check-staging-env.ts
 *   npx tsx scripts/check-staging-env.ts --allow-prod-db        # override (DANGEROUS)
 *   npx tsx scripts/check-staging-env.ts --allow-live-stripe    # override (DANGEROUS)
 *
 * Exits 1 if any error is found, so it can gate a staging verification run.
 */
import fs from 'node:fs'
import { validateStagingEnv } from '../lib/staging/validateStagingEnv'
import { resolveProdDbHost } from './check-staging-env-helpers'

function loadEnvFile(file: string): { vars: Record<string, string>; hasLiveKey: boolean } {
  const vars: Record<string, string> = {}
  let hasLiveKey = false
  try {
    const text = fs.readFileSync(file, 'utf8')
    if (/=\s*["']?(sk_live|pk_live)/.test(text)) hasLiveKey = true
    for (const line of text.split('\n')) {
      const m = line.match(/^([A-Z0-9_]+)=(.*)$/)
      if (m) vars[m[1]] = m[2]
    }
  } catch {
    /* file may not exist */
  }
  return { vars, hasLiveKey }
}

// Production env — used to learn the PRODUCTION DB host so a staging DATABASE_URL
// on a different host validates as non-production even with no literal "staging"
// marker (Neon branch URLs).
const base = loadEnvFile('.env')
const local = loadEnvFile('.env.local')
const prodDbHost = resolveProdDbHost(base.vars.DATABASE_URL, local.vars.DATABASE_URL)

// Staging env to validate: .env precedence, then .env.staging overlays it, then
// process.env (CI/shell) wins. .env.staging holds the staging DATABASE_URL etc.
const staging = loadEnvFile('.env.staging')
const env = { ...base.vars, ...local.vars, ...staging.vars, ...process.env }
const liveKeyInFiles = base.hasLiveKey || local.hasLiveKey || staging.hasLiveKey

const result = validateStagingEnv(env, {
  allowProdDb: process.argv.includes('--allow-prod-db'),
  allowLiveStripe: process.argv.includes('--allow-live-stripe'),
  prodDbHost,
})

// Safety scan independent of effective precedence: surface live keys present in
// ANY env file, even when .env.local masks them with test keys locally.
if (liveKeyInFiles && !process.argv.includes('--allow-live-stripe')) {
  result.warnings.push('A LIVE Stripe key (sk_live/pk_live) exists in a .env file. The effective key may be test locally, but ensure the STAGING deployment does not ship the live key.')
}

console.log('──── STAGING ENV SAFETY CHECK ────')
for (const i of result.info) console.log(`  ℹ️  ${i}`)
for (const w of result.warnings) console.log(`  ⚠️  ${w}`)
for (const e of result.errors) console.log(`  ❌ ${e}`)
console.log('──────────────────────────────────')
console.log(result.ok ? '✅ Safe to run staging verification.' : '❌ NOT safe — fix the errors above before running staging verification.')

process.exit(result.ok ? 0 : 1)
