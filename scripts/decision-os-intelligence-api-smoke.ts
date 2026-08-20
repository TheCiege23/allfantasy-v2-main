/**
 * Decision OS — Phase 5.10 Intelligence API In-Process Smoke Verification.
 *
 * Verifies the Intelligence API end-to-end against the real behavioral pipeline
 * and staging DB. Calls handler functions directly (no HTTP server required).
 *
 * Checks:
 *   - Feature-gate enforcement (503 when disabled)
 *   - Auth enforcement (401 no key, 401 bad format)
 *   - Tier scope enforcement (403 when tier lacks required scope)
 *   - Real provider returns non-null intelligence for known leagues
 *   - Degraded path: sparse/unknown league returns valid low-completeness intelligence
 *   - Missing param validation (400)
 *   - External response shape: no internal field leakage
 *   - All 3 endpoints succeed at 'platform' tier
 *
 * Run:
 *   DATABASE_URL=<staging> npx tsx scripts/decision-os-intelligence-api-smoke.ts
 *
 * The DATABASE_URL must point to the staging (non-prod) Neon branch. The script hard-refuses
 * production, and any target not positively recognised as safe, via `assertNonProductionDbTarget`.
 * It used to test for `ep-spring-tooth` — the dev fork, not production — so the refusal never fired.
 */

// ── Safety check — must happen before any imports that open Prisma ─────────────

import { assertNonProductionDbTarget } from './_db-target-identity'

const DB_URL = process.env.DATABASE_URL ?? ''

if (!DB_URL) {
  console.log('SKIPPED (no DATABASE_URL) — set DATABASE_URL=<staging-neon-url> to run.')
  process.exit(0)
}

assertNonProductionDbTarget({
  script: 'decision-os-intelligence-api-smoke',
  url: DB_URL,
  action: 'exercises the Intelligence API against a live database',
})

// ── Set Intelligence API env vars for this run ────────────────────────────────

// Test key map: key → tier
const TEST_KEYS = {
  'afk_test_commissionersmoke01':  'commissioner',
  'afk_test_managersmokekeyv001':  'manager',
  'afk_test_platformsmokekeyv01':  'platform',
} as const

process.env.DECISION_OS_INTELLIGENCE_API_ENABLED  = 'true'
process.env.DECISION_OS_INTELLIGENCE_API_PROVIDER  = 'real'
process.env.INTELLIGENCE_API_TEST_KEYS             = JSON.stringify(TEST_KEYS)
// Use a short lookback to avoid overwhelming sparse staging data
process.env.INTELLIGENCE_LOOKBACK_DAYS             = '365'
// Cap platform at 5 leagues on staging
process.env.INTELLIGENCE_PLATFORM_MAX_LEAGUES      = '5'

// ── Imports (after env setup) ─────────────────────────────────────────────────

import {
  platformIntelligenceHandler,
  leagueIntelligenceHandler,
  managerIntelligenceHandler,
} from '../lib/decision-os/behavioral/api/intelligence-handlers'
import { createRealDataProvider } from '../lib/decision-os/behavioral/api/real-data-provider'

// ── Known staging league / manager IDs ───────────────────────────────────────

// League with 3 waiver claims (seeded — has real behavioral events)
const LEAGUE_WITH_EVENTS  = 's3b-nfl-faab'
const MANAGER_WITH_EVENTS = 's3b-member-user'

// League with a draft session (events = picks only, recent-ish)
const LEAGUE_WITH_DRAFT   = '9d0a700c-0e53-4a02-bb52-79cc12a80427'

// Imported Sleeper league (KBI Smoke Black — 0 native events, sparse)
const LEAGUE_SLEEPER      = '50d5c56d-86e8-466d-ad3d-5f8a54ce1457'

// An unknown league ID (should return degraded but non-null intelligence)
const LEAGUE_UNKNOWN      = 'intel-smoke-nonexistent-league-id'

// ── Check infrastructure ──────────────────────────────────────────────────────

let failures = 0
let checks   = 0

function check(name: string, ok: boolean, detail = '') {
  checks++
  const icon = ok ? '✅' : '❌'
  console.log(`  ${icon} ${name}${detail ? `  — ${detail}` : ''}`)
  if (!ok) failures++
}

// ── Context factory ───────────────────────────────────────────────────────────

type HeaderMap = Record<string, string | undefined>
type ParamMap  = Record<string, string | undefined>

function makeCtx(headers: HeaderMap = {}, params: ParamMap = {}) {
  const sp = new URLSearchParams()
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined) sp.set(k, v)
  }
  return {
    headers:      { get: (key: string) => headers[key.toLowerCase()] ?? null },
    searchParams: sp,
  }
}

function apiKey(key: string): HeaderMap {
  return { 'x-allfantasy-api-key': key }
}

function noKey(): HeaderMap {
  return {}
}

// Unregistered test-env key → gate defaults to 'basic' tier (dev mode)
const UNREGISTERED_KEY = 'afk_test_smokestaging00001'

// Specific-tier keys (registered in TEST_KEYS above)
const COMMISSIONER_KEY = 'afk_test_commissionersmoke01'
const MANAGER_KEY      = 'afk_test_managersmokekeyv001'
const PLATFORM_KEY     = 'afk_test_platformsmokekeyv01'

// ── Build real provider ───────────────────────────────────────────────────────

const realProvider = createRealDataProvider()

// ── Test sections ─────────────────────────────────────────────────────────────

async function runGateChecks() {
  console.log('\n── 1. Gate enforcement ──────────────────────────────────────────────')

  // 1a. Feature flag disabled
  const savedFlag = process.env.DECISION_OS_INTELLIGENCE_API_ENABLED
  delete process.env.DECISION_OS_INTELLIGENCE_API_ENABLED

  const disabledResult = await platformIntelligenceHandler(makeCtx(apiKey(PLATFORM_KEY)), realProvider)
  check('503 when feature flag not set',
    disabledResult.status === 503,
    `status=${disabledResult.status}`)
  const disabledBody = disabledResult.body as { code?: string }
  check('503 body.code = INTELLIGENCE_UNAVAILABLE',
    disabledBody?.code === 'INTELLIGENCE_UNAVAILABLE',
    `code=${disabledBody?.code}`)

  process.env.DECISION_OS_INTELLIGENCE_API_ENABLED = savedFlag!

  // 1b. No API key
  const noKeyResult = await platformIntelligenceHandler(makeCtx(noKey()), realProvider)
  check('401 when no API key',
    noKeyResult.status === 401,
    `status=${noKeyResult.status}`)
  const noKeyBody = noKeyResult.body as { code?: string }
  check('401 body.code = UNAUTHORIZED',
    noKeyBody?.code === 'UNAUTHORIZED',
    `code=${noKeyBody?.code}`)

  // 1c. Malformed key
  const badKeyResult = await platformIntelligenceHandler(
    makeCtx(apiKey('not-a-valid-key')), realProvider)
  check('401 for invalid key format',
    badKeyResult.status === 401,
    `status=${badKeyResult.status}`)
}

async function runScopeChecks() {
  console.log('\n── 2. Tier scope enforcement ────────────────────────────────────────')

  // basic tier (unregistered test key) has intelligence:platform:basic only
  const basicPlatformResult = await platformIntelligenceHandler(
    makeCtx(apiKey(UNREGISTERED_KEY)), realProvider)
  check('basic tier: /platform returns 200',
    basicPlatformResult.status === 200,
    `status=${basicPlatformResult.status}`)

  const basicLeagueResult = await leagueIntelligenceHandler(
    makeCtx(apiKey(UNREGISTERED_KEY), { leagueId: LEAGUE_WITH_EVENTS }), realProvider)
  check('basic tier: /league returns 403 FORBIDDEN',
    basicLeagueResult.status === 403,
    `status=${basicLeagueResult.status}`)

  const basicManagerResult = await managerIntelligenceHandler(
    makeCtx(apiKey(UNREGISTERED_KEY), { leagueId: LEAGUE_WITH_EVENTS, managerId: MANAGER_WITH_EVENTS }), realProvider)
  check('basic tier: /manager returns 403 FORBIDDEN',
    basicManagerResult.status === 403,
    `status=${basicManagerResult.status}`)

  // commissioner tier has platform:basic + league:read (no manager:read)
  const commLeagueResult = await leagueIntelligenceHandler(
    makeCtx(apiKey(COMMISSIONER_KEY), { leagueId: LEAGUE_WITH_EVENTS }), realProvider)
  check('commissioner tier: /league returns 200',
    commLeagueResult.status === 200,
    `status=${commLeagueResult.status}`)

  const commManagerResult = await managerIntelligenceHandler(
    makeCtx(apiKey(COMMISSIONER_KEY), { leagueId: LEAGUE_WITH_EVENTS, managerId: MANAGER_WITH_EVENTS }), realProvider)
  check('commissioner tier: /manager returns 403 FORBIDDEN',
    commManagerResult.status === 403,
    `status=${commManagerResult.status}`)

  // manager tier has platform:basic + manager:read (no league:read)
  const mgLeagueResult = await leagueIntelligenceHandler(
    makeCtx(apiKey(MANAGER_KEY), { leagueId: LEAGUE_WITH_EVENTS }), realProvider)
  check('manager tier: /league returns 403 FORBIDDEN',
    mgLeagueResult.status === 403,
    `status=${mgLeagueResult.status}`)

  const mgManagerResult = await managerIntelligenceHandler(
    makeCtx(apiKey(MANAGER_KEY), { leagueId: LEAGUE_WITH_EVENTS, managerId: MANAGER_WITH_EVENTS }), realProvider)
  check('manager tier: /manager returns 200',
    mgManagerResult.status === 200,
    `status=${mgManagerResult.status}`)
}

async function runParamValidation() {
  console.log('\n── 3. Parameter validation ──────────────────────────────────────────')

  const missingLeagueId = await leagueIntelligenceHandler(
    makeCtx(apiKey(COMMISSIONER_KEY)), realProvider)
  check('/league: missing leagueId → 400 INVALID_REQUEST',
    missingLeagueId.status === 400,
    `status=${missingLeagueId.status}`)

  const missingManagerId = await managerIntelligenceHandler(
    makeCtx(apiKey(PLATFORM_KEY), { leagueId: LEAGUE_WITH_EVENTS }), realProvider)
  check('/manager: missing managerId → 400 INVALID_REQUEST',
    missingManagerId.status === 400,
    `status=${missingManagerId.status}`)

  const missingBoth = await managerIntelligenceHandler(
    makeCtx(apiKey(PLATFORM_KEY)), realProvider)
  check('/manager: missing both params → 400 INVALID_REQUEST',
    missingBoth.status === 400,
    `status=${missingBoth.status}`)
}

async function runRealDataChecks() {
  console.log('\n── 4. Real provider — known staging data ────────────────────────────')

  // League with waiver claims (s3b-nfl-faab)
  const r1 = await leagueIntelligenceHandler(
    makeCtx(apiKey(PLATFORM_KEY), { leagueId: LEAGUE_WITH_EVENTS }), realProvider)
  check(`/league: league with events → 200 (${LEAGUE_WITH_EVENTS})`,
    r1.status === 200, `status=${r1.status}`)

  if (r1.status === 200) {
    const body = r1.body as { data?: { leagueId?: string; completeness?: number; leagueEngagementScore?: number } }
    check('/league: data.leagueId matches requested ID',
      body?.data?.leagueId === LEAGUE_WITH_EVENTS, `got=${body?.data?.leagueId}`)
    check('/league: data.completeness ∈ [0, 100]',
      typeof body?.data?.completeness === 'number' &&
      body.data.completeness >= 0 && body.data.completeness <= 100,
      `completeness=${body?.data?.completeness}`)
    check('/league: data.leagueEngagementScore ∈ [0, 100]',
      typeof body?.data?.leagueEngagementScore === 'number' &&
      body.data.leagueEngagementScore >= 0 && body.data.leagueEngagementScore <= 100,
      `score=${body?.data?.leagueEngagementScore}`)
  }

  // Manager with waiver events
  const r2 = await managerIntelligenceHandler(
    makeCtx(apiKey(PLATFORM_KEY), { leagueId: LEAGUE_WITH_EVENTS, managerId: MANAGER_WITH_EVENTS }), realProvider)
  check(`/manager: manager with events → 200 (${MANAGER_WITH_EVENTS})`,
    r2.status === 200, `status=${r2.status}`)

  if (r2.status === 200) {
    const body = r2.body as { data?: { managerId?: string; leagueId?: string; overallEngagementScore?: number } }
    check('/manager: data.managerId matches requested ID',
      body?.data?.managerId === MANAGER_WITH_EVENTS, `got=${body?.data?.managerId}`)
    check('/manager: data.leagueId matches requested ID',
      body?.data?.leagueId === LEAGUE_WITH_EVENTS, `got=${body?.data?.leagueId}`)
    check('/manager: data.overallEngagementScore ∈ [0, 100]',
      typeof body?.data?.overallEngagementScore === 'number' &&
      body.data.overallEngagementScore >= 0 && body.data.overallEngagementScore <= 100,
      `score=${body?.data?.overallEngagementScore}`)
  }

  // Platform (all leagues, capped at 5)
  const r3 = await platformIntelligenceHandler(
    makeCtx(apiKey(PLATFORM_KEY)), realProvider)
  check('/platform: platform tier → 200',
    r3.status === 200, `status=${r3.status}`)

  if (r3.status === 200) {
    const body = r3.body as { data?: { platformEngagementScore?: number; tier?: string }; meta?: { tier?: string } }
    check('/platform: meta.tier = "platform" for platform key',
      body?.meta?.tier === 'platform', `tier=${body?.meta?.tier}`)
    check('/platform: data.platformEngagementScore ∈ [0, 100]',
      typeof body?.data?.platformEngagementScore === 'number' &&
      body.data.platformEngagementScore >= 0 && body.data.platformEngagementScore <= 100,
      `score=${body?.data?.platformEngagementScore}`)
  }

  // League with draft only
  const r4 = await leagueIntelligenceHandler(
    makeCtx(apiKey(PLATFORM_KEY), { leagueId: LEAGUE_WITH_DRAFT }), realProvider)
  check(`/league: league with draft session → 200 (draft only)`,
    r4.status === 200, `status=${r4.status}`)

  // Imported Sleeper league (sparse — 0 native events)
  const r5 = await leagueIntelligenceHandler(
    makeCtx(apiKey(PLATFORM_KEY), { leagueId: LEAGUE_SLEEPER }), realProvider)
  check('/league: imported Sleeper league → 200 (degraded, sparse)',
    r5.status === 200, `status=${r5.status}`)
}

async function runDegradedPathChecks() {
  console.log('\n── 5. Degraded / sparse data paths ─────────────────────────────────')

  // Unknown leagueId — no events → returns degraded intelligence (not null)
  const r1 = await leagueIntelligenceHandler(
    makeCtx(apiKey(PLATFORM_KEY), { leagueId: LEAGUE_UNKNOWN }), realProvider)
  check('/league: unknown leagueId → 200 degraded (not 503)',
    r1.status === 200, `status=${r1.status}`)
  if (r1.status === 200) {
    const body = r1.body as { data?: { completeness?: number } }
    check('/league: unknown leagueId → completeness = 0 (no events)',
      body?.data?.completeness === 0, `completeness=${body?.data?.completeness}`)
  }

  // Unknown managerId — no events → degraded intelligence
  const r2 = await managerIntelligenceHandler(
    makeCtx(apiKey(PLATFORM_KEY), { leagueId: LEAGUE_UNKNOWN, managerId: 'nonexistent-manager' }), realProvider)
  check('/manager: unknown managerId → 200 degraded (not 503)',
    r2.status === 200, `status=${r2.status}`)
}

async function runLeakageChecks() {
  console.log('\n── 6. No internal field leakage ─────────────────────────────────────')

  const INTERNAL_FIELDS = [
    'warnings', 'derivedFrom', 'lookbackDays', 'provenance',
    'activeManagerIds', 'inactivityWarning', 'healthNarrativeInputs',
    'commissionerWorkloadItems', 'retentionRiskReasons',
  ]

  // Check /league response
  const leagueResult = await leagueIntelligenceHandler(
    makeCtx(apiKey(PLATFORM_KEY), { leagueId: LEAGUE_WITH_EVENTS }), realProvider)

  if (leagueResult.status === 200) {
    const bodyStr = JSON.stringify(leagueResult.body)
    for (const field of INTERNAL_FIELDS) {
      // Only flag top-level field presence with key pattern (not substring in values)
      const keyPattern = new RegExp(`"${field}"\\s*:`)
      check(`/league: no "${field}" in response`, !keyPattern.test(bodyStr))
    }
  } else {
    check('/league: got 200 for leakage check', false, `status=${leagueResult.status}`)
  }

  // Check /manager response
  const managerResult = await managerIntelligenceHandler(
    makeCtx(apiKey(PLATFORM_KEY), { leagueId: LEAGUE_WITH_EVENTS, managerId: MANAGER_WITH_EVENTS }), realProvider)

  if (managerResult.status === 200) {
    const bodyStr = JSON.stringify(managerResult.body)
    // Only check a subset for /manager (retentionRiskReasons is intentionally exposed)
    const managerInternalFields = ['warnings', 'derivedFrom', 'lookbackDays', 'provenance', 'inactivityWarning', 'healthNarrativeInputs']
    for (const field of managerInternalFields) {
      const keyPattern = new RegExp(`"${field}"\\s*:`)
      check(`/manager: no "${field}" in response`, !keyPattern.test(bodyStr))
    }
  }

  // Check /platform full response
  const platformResult = await platformIntelligenceHandler(
    makeCtx(apiKey(PLATFORM_KEY)), realProvider)

  if (platformResult.status === 200) {
    const bodyStr = JSON.stringify(platformResult.body)
    const platformInternalFields = ['warnings', 'derivedFrom', 'lookbackDays', 'leagueIntelligenceCount', 'managerIntelligenceCount']
    for (const field of platformInternalFields) {
      const keyPattern = new RegExp(`"${field}"\\s*:`)
      check(`/platform: no "${field}" in response`, !keyPattern.test(bodyStr))
    }
  }
}

async function runResponseShapeChecks() {
  console.log('\n── 7. Response envelope shape ───────────────────────────────────────')

  const r = await leagueIntelligenceHandler(
    makeCtx(apiKey(PLATFORM_KEY), { leagueId: LEAGUE_WITH_EVENTS }), realProvider)

  if (r.status === 200) {
    const body = r.body as Record<string, unknown>
    check('Response has top-level "data" key',    'data' in body)
    check('Response has top-level "meta" key',    'meta' in body)

    const meta = body.meta as Record<string, unknown> | undefined
    if (meta) {
      check('meta.requestId is a non-empty string', typeof meta.requestId === 'string' && !!meta.requestId)
      check('meta.version = "v1"',                  meta.version === 'v1')
      check('meta.tier = "platform"',               meta.tier === 'platform')
      check('meta.completeness ∈ [0, 100]',
        typeof meta.completeness === 'number' &&
        (meta.completeness as number) >= 0 && (meta.completeness as number) <= 100)
      check('meta.derivedAt is ISO 8601',
        typeof meta.derivedAt === 'string' && !isNaN(Date.parse(meta.derivedAt as string)))
    } else {
      check('meta block present', false, 'meta is missing')
    }
  } else {
    check('/league 200 for envelope check', false, `status=${r.status}`)
  }
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  // Print DB host (confirm staging)
  const dbHost = (() => {
    try { return new URL(DB_URL.replace(/^postgres(ql)?:\/\//, 'http://')).host } catch { return DB_URL }
  })()

  console.log('══ Decision OS — Intelligence API Smoke Verification ══════════════════')
  console.log(`  DB host  : ${dbHost}`)
  console.log(`  Lookback : ${process.env.INTELLIGENCE_LOOKBACK_DAYS}d`)
  console.log(`  PlatCap  : ${process.env.INTELLIGENCE_PLATFORM_MAX_LEAGUES} leagues`)
  console.log(`  Date     : ${new Date().toISOString()}`)
  console.log('═══════════════════════════════════════════════════════════════════════')

  await runGateChecks()
  await runScopeChecks()
  await runParamValidation()
  await runRealDataChecks()
  await runDegradedPathChecks()
  await runLeakageChecks()
  await runResponseShapeChecks()

  console.log('\n══ Result ═════════════════════════════════════════════════════════════')
  console.log(`  Checks : ${checks}`)
  console.log(`  Passed : ${checks - failures}`)
  console.log(`  Failed : ${failures}`)

  if (failures === 0) {
    console.log('\n  INTELLIGENCE_API_SMOKE_OK ✅')
    console.log('\n  Next: set env vars on deployed staging + run HTTP smoke against BASE_URL.')
  } else {
    console.log('\n  INTELLIGENCE_API_SMOKE_FAILED ❌')
  }

  process.exit(failures > 0 ? 1 : 0)
}

main().catch((err) => {
  console.error('Smoke script threw unexpectedly:', err)
  process.exit(1)
})
