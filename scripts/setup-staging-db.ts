/**
 * Prepare a STAGING database for NFL verification.
 *
 * Given a staging DATABASE_URL, this applies all Prisma migrations and verifies
 * the result. It REFUSES to run against the production database (compares host
 * to the current .env DATABASE_URL) unless --allow-prod-db is passed.
 *
 *   # provide the staging URL one of these ways:
 *   npx tsx scripts/setup-staging-db.ts --url "postgres://…staging…"
 *   STAGING_DATABASE_URL="postgres://…" npx tsx scripts/setup-staging-db.ts
 *   # or put DATABASE_URL in .env.staging and:
 *   npx tsx scripts/setup-staging-db.ts --env-file .env.staging
 *
 * Steps: connection check → prisma migrate deploy → drift check → table smoke test.
 */
import fs from 'node:fs'
import { execFileSync } from 'node:child_process'

function readEnvFileVar(file: string, key: string): string | undefined {
  try {
    for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
      const m = line.match(new RegExp(`^${key}=(.*)$`))
      if (m) {
        let v = m[1].trim()
        if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1)
        return v
      }
    }
  } catch {
    /* missing file */
  }
  return undefined
}

function hostOf(url: string): string {
  try {
    return new URL(url).host
  } catch {
    return ''
  }
}

const argv = process.argv.slice(2)
const ALLOW_PROD = argv.includes('--allow-prod-db')
const urlArgIdx = argv.indexOf('--url')
const envFileIdx = argv.indexOf('--env-file')
const envFile = envFileIdx >= 0 ? argv[envFileIdx + 1] : '.env.staging'

const stagingUrl =
  (urlArgIdx >= 0 ? argv[urlArgIdx + 1] : undefined) ||
  process.env.STAGING_DATABASE_URL ||
  readEnvFileVar(envFile, 'DATABASE_URL')

if (!stagingUrl) {
  console.error('No staging DATABASE_URL. Pass --url, set STAGING_DATABASE_URL, or add it to .env.staging.')
  process.exit(2)
}

// Safety: never target production.
const prodUrl = readEnvFileVar('.env', 'DATABASE_URL') || readEnvFileVar('.env.local', 'DATABASE_URL')
const stagingHost = hostOf(stagingUrl)
const prodHost = prodUrl ? hostOf(prodUrl) : ''
const looksStaging = /staging|dev|test|preview|sandbox/i.test(stagingUrl.replace(/^\w+:\/\/[^@]*@?/, ''))

if (!ALLOW_PROD) {
  if (prodHost && stagingHost === prodHost) {
    console.error(`REFUSING: target host (${stagingHost}) matches the production DATABASE_URL host. This is the production DB. Use a separate staging database (or --allow-prod-db only if truly intentional).`)
    process.exit(2)
  } else if (prodHost && stagingHost && stagingHost !== prodHost) {
    // Authoritative non-production signal: a different host than production.
    // Neon branch URLs carry no literal "staging" marker, so this is how they pass.
    console.log(`[setup-staging-db] target host (${stagingHost}) differs from production host (${prodHost}) — confirmed a separate database.`)
  } else if (!looksStaging) {
    console.error(`REFUSING: production host unknown and target URL has no staging/dev/test marker — can't confirm it is non-production. Use a staging DB or pass --allow-prod-db.`)
    process.exit(2)
  }
}

console.log(`[setup-staging-db] target host: ${stagingHost}`)
// Prisma migrate uses `directUrl` (DIRECT_URL) when the schema defines it, and
// the runtime uses DATABASE_URL — point BOTH at staging so neither falls back to
// the prod URL baked into the env files.
const childEnv = { ...process.env, DATABASE_URL: stagingUrl, DIRECT_URL: stagingUrl }

// ── Prisma `.env` override guard ─────────────────────────────────────────────
// The Prisma CLI loads the project `.env` and its DATABASE_URL OVERRIDES the one
// we pass via the child env — so without this, `migrate deploy`/`migrate diff`
// would silently run against the production DB in `.env`. We temporarily comment
// out the DATABASE_URL line(s) in `.env` so the staging value (childEnv) wins,
// and restore the original on exit (including on Ctrl-C / crash).
// Prisma loads DATABASE_URL from BOTH `.env` and `.env.local`, so neutralize the
// line in every prod env file for the duration. (prisma/.env too, if present.)
const ENV_PATHS = ['.env', '.env.local', 'prisma/.env']
const envBackups = new Map<string, string>()

function swapEnv() {
  for (const p of ENV_PATHS) {
    if (!fs.existsSync(p)) continue
    const text = fs.readFileSync(p, 'utf8')
    if (!/^(DATABASE_URL|DIRECT_URL)=/m.test(text)) continue
    envBackups.set(p, text)
    fs.writeFileSync(p, text.replace(/^((DATABASE_URL|DIRECT_URL)=.*)$/gm, '#__SETUP_STAGING_SWAP__ $1'))
  }
  if (envBackups.size) console.log(`[setup-staging-db] temporarily neutralized prod DATABASE_URL in: ${[...envBackups.keys()].join(', ')} (will restore).`)
}

function restoreEnv() {
  for (const [p, text] of envBackups) fs.writeFileSync(p, text)
  if (envBackups.size) {
    console.log(`[setup-staging-db] restored: ${[...envBackups.keys()].join(', ')}.`)
    envBackups.clear()
  }
}

for (const sig of ['SIGINT', 'SIGTERM', 'uncaughtException'] as const) {
  process.on(sig, () => {
    restoreEnv()
    process.exit(1)
  })
}
process.on('exit', restoreEnv)

function run(label: string, file: string, args: string[]) {
  console.log(`\n── ${label} ──`)
  try {
    const out = execFileSync(file, args, { encoding: 'utf8', env: childEnv, stdio: ['ignore', 'pipe', 'pipe'], shell: process.platform === 'win32' })
    console.log(out.trim().split('\n').slice(-12).join('\n'))
    return true
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    console.error(`FAILED: ${msg.slice(0, 400)}`)
    return false
  }
}

swapEnv()
const okStatus = run('prisma migrate status', 'npx', ['prisma', 'migrate', 'status'])
const okDeploy = run('prisma migrate deploy (apply migrations)', 'npx', ['prisma', 'migrate', 'deploy'])
const okDrift = run('schema drift check', 'npx', ['tsx', 'scripts/check-schema-drift.ts'])
restoreEnv()

console.log('\n──── SETUP SUMMARY ────')
console.log(`migrate status read: ${okStatus ? 'ok' : 'FAILED'}`)
console.log(`migrate deploy:      ${okDeploy ? 'ok' : 'FAILED'}`)
console.log(`drift check ran:     ${okDrift ? 'ok' : 'FAILED'}`)
console.log(okDeploy ? '✅ Staging DB migrations applied. Run `npm run check:staging-env`, then boot with `npm run dev:staging-lite`.' : '❌ Migration deploy failed — see output above.')
process.exit(okDeploy ? 0 : 1)
