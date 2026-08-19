/**
 * Phase 7.21 — Partner Sandbox API SMOKE verification.
 *
 * Verifies all six Phase 7.20 sandbox endpoints end-to-end. Two phases:
 *
 *   Phase A (always runs, no server required) — calls the pure handlers
 *   in-process (lib/decision-os/sdk/partner-sandbox-handlers.ts) with an
 *   explicit `env` override, proving disabled-state, enabled-state,
 *   invalid-config, and no-leak behavior deterministically.
 *
 *   Phase B (best-effort, skips cleanly if no server is reachable) — real
 *   HTTP calls against a running Next.js server, proving the actual
 *   app/api/v1/sandbox/partner/*\/route.ts wiring (request parsing, env
 *   reading at the real HTTP layer) works end-to-end — not just the pure
 *   handler logic Phase A and the Phase 7.20 vitest suite already cover.
 *
 * STRICTLY READ-ONLY: every sandbox endpoint is itself a pure validator/
 * normalizer (Phase 7.19/7.20) — this script performs no writes anywhere,
 * to a database or otherwise.
 *
 * Usage:
 *   npx tsx scripts/partner-sandbox-smoke.ts
 *     Runs Phase A only (Phase B skips: no PARTNER_SANDBOX_SMOKE_BASE_URL).
 *
 *   PARTNER_SANDBOX_SMOKE_BASE_URL=http://localhost:3000 \
 *     npx tsx scripts/partner-sandbox-smoke.ts
 *     Also runs Phase B against a server YOU already started. Start it with:
 *       PARTNER_SANDBOX_API_ENABLED=true npm run dev
 *     to exercise the enabled-state checks over real HTTP; without that
 *     flag on the server process, Phase B logs the live disabled-state
 *     response and skips the enabled-state HTTP checks (informational, not
 *     a failure — the server's flag state is the operator's responsibility,
 *     this script only reports what it actually observes).
 *
 * See PHASE_7_21_PARTNER_SANDBOX_VERIFICATION_CHECKPOINT.md for curl
 * examples and full documented env vars.
 */

import {
  isPartnerSandboxApiEnabled,
  validatePartnerConfigHandler,
  previewPartnerThemeHandler,
  widgetCatalogHandler,
  checkWidgetPermissionHandler,
  embedInstructionsHandler,
  testKeyMetadataHandler,
} from '../lib/decision-os/sdk/partner-sandbox-handlers'
import type { PartnerSandboxApiContext } from '../lib/decision-os/sdk/partner-sandbox-handlers'
import { SANDBOX_PARTNER_TENANT_CONFIG } from '../lib/decision-os/sdk/partner-fixtures'
import type { PartnerTenantConfig, PartnerBrandingConfig } from '../lib/decision-os/sdk/partner-types'

let failures = 0
const check = (name: string, ok: boolean, detail = '') => {
  console.log(`${ok ? '✅' : '❌'} ${name}${detail ? `  — ${detail}` : ''}`)
  if (!ok) failures++
}

const INTERNAL_TERMS = ['Decision OS', 'decision-os', 'Canonical World', 'behavioralIntelligence', 'ARCHITECTURE_FREEZE']
const SECRET_SHAPED_KEYS = ['secret', 'rawKey', 'rawSecret', 'privateKey']

function assertNoLeak(label: string, body: unknown): void {
  const serialized = JSON.stringify(body)
  const leakedTerm = INTERNAL_TERMS.find((t) => serialized.includes(t))
  check(`${label} — no internal Decision OS terminology`, !leakedTerm, leakedTerm ?? '')
  const leakedKey = SECRET_SHAPED_KEYS.find((k) => serialized.toLowerCase().includes(k.toLowerCase()))
  check(`${label} — no secret-shaped field`, !leakedKey, leakedKey ?? '')
}

function makeCtx(opts: { searchParams?: Record<string, string>; body?: unknown } = {}): PartnerSandboxApiContext {
  return {
    headers: { get: () => null },
    searchParams: new URLSearchParams(opts.searchParams ?? {}),
    body: opts.body,
  }
}

const DISABLED_ENV: NodeJS.ProcessEnv = {}
const ENABLED_ENV: NodeJS.ProcessEnv = { PARTNER_SANDBOX_API_ENABLED: 'true' }

// ── Phase A: in-process ──────────────────────────────────────────────────────

function runPhaseA(): void {
  console.log('\n── Phase A: in-process handler verification (no server required) ──\n')

  check('isPartnerSandboxApiEnabled({}) is false', isPartnerSandboxApiEnabled(DISABLED_ENV) === false)
  check("isPartnerSandboxApiEnabled({PARTNER_SANDBOX_API_ENABLED:'true'}) is true", isPartnerSandboxApiEnabled(ENABLED_ENV) === true)

  // ── Disabled state — every handler returns 503 SANDBOX_DISABLED ──
  const handlers: Array<[string, (ctx: PartnerSandboxApiContext, env: NodeJS.ProcessEnv) => { status: number; body: unknown }]> = [
    ['validate-config', validatePartnerConfigHandler],
    ['preview-theme', previewPartnerThemeHandler],
    ['widget-catalog', widgetCatalogHandler],
    ['check-widget-permission', checkWidgetPermissionHandler],
    ['embed-instructions', embedInstructionsHandler],
    ['test-key-metadata', testKeyMetadataHandler],
  ]
  for (const [name, handler] of handlers) {
    const r = handler(makeCtx(), DISABLED_ENV)
    check(`[disabled] ${name} → 503`, r.status === 503)
    check(`[disabled] ${name} body.code === 'SANDBOX_DISABLED'`, (r.body as { code?: string }).code === 'SANDBOX_DISABLED')
    assertNoLeak(`[disabled] ${name}`, r.body)
  }

  // ── Enabled: validate-config — valid ──
  {
    const r = validatePartnerConfigHandler(makeCtx({ body: SANDBOX_PARTNER_TENANT_CONFIG }), ENABLED_ENV)
    check('[enabled] validate-config (valid fixture) → 200', r.status === 200)
    check('[enabled] validate-config (valid fixture) → valid:true', (r.body as { valid?: boolean }).valid === true)
    assertNoLeak('[enabled] validate-config (valid)', r.body)
  }

  // ── Enabled: validate-config — invalid (structured, not an error) ──
  {
    const invalid: PartnerTenantConfig = {
      ...SANDBOX_PARTNER_TENANT_CONFIG,
      allowedOrigins: { origins: ['not-a-valid-origin'] },
    }
    const r = validatePartnerConfigHandler(makeCtx({ body: invalid }), ENABLED_ENV)
    check('[enabled] validate-config (invalid origin) → 200 (structured, not an HTTP error)', r.status === 200)
    const body = r.body as { valid?: boolean; errors?: string[] }
    check('[enabled] validate-config (invalid origin) → valid:false', body.valid === false)
    check('[enabled] validate-config (invalid origin) → errors[] non-empty', (body.errors?.length ?? 0) > 0)
    assertNoLeak('[enabled] validate-config (invalid)', r.body)
  }

  // ── Enabled: validate-config — malformed body never crashes ──
  {
    const r = validatePartnerConfigHandler(makeCtx({ body: { totally: 'broken' } }), ENABLED_ENV)
    check('[enabled] validate-config (malformed shape) → 400, never throws', r.status === 400)
  }

  // ── Enabled: preview-theme ──
  {
    const branding: PartnerBrandingConfig = { partnerBrandId: 'acme', preferredMode: 'partner_override', colorOverrides: { accent: '#0a84ff' } }
    const r = previewPartnerThemeHandler(makeCtx({ body: branding }), ENABLED_ENV)
    check('[enabled] preview-theme → 200', r.status === 200)
    const body = r.body as { valid?: boolean; theme?: { mode?: string } }
    check('[enabled] preview-theme → valid:true', body.valid === true)
    check("[enabled] preview-theme → theme.mode === 'partner_override'", body.theme?.mode === 'partner_override')
    assertNoLeak('[enabled] preview-theme', r.body)
  }

  // ── Enabled: widget-catalog ──
  {
    const r = widgetCatalogHandler(makeCtx({ searchParams: { licenseTier: 'standard' } }), ENABLED_ENV)
    check('[enabled] widget-catalog?licenseTier=standard → 200', r.status === 200)
    const catalog = (r.body as { widgetCatalog?: string[] }).widgetCatalog ?? []
    check('[enabled] widget-catalog (standard) excludes full_dashboard', !catalog.includes('full_dashboard'))
    check('[enabled] widget-catalog (standard) includes compact', catalog.includes('compact'))
    assertNoLeak('[enabled] widget-catalog', r.body)
  }

  // ── Enabled: check-widget-permission — denial ──
  {
    const r = checkWidgetPermissionHandler(makeCtx({ searchParams: { licenseTier: 'standard', mode: 'full_dashboard' } }), ENABLED_ENV)
    check('[enabled] check-widget-permission (standard/full_dashboard) → 200 (informative, not an error)', r.status === 200)
    check('[enabled] check-widget-permission (standard/full_dashboard) → allowed:false', (r.body as { allowed?: boolean }).allowed === false)
  }

  // ── Enabled: check-widget-permission — allow ──
  {
    const r = checkWidgetPermissionHandler(makeCtx({ searchParams: { licenseTier: 'enterprise', mode: 'full_dashboard' } }), ENABLED_ENV)
    check('[enabled] check-widget-permission (enterprise/full_dashboard) → allowed:true', (r.body as { allowed?: boolean }).allowed === true)
  }

  // ── Enabled: embed-instructions ──
  {
    const r = embedInstructionsHandler(makeCtx({ searchParams: { licenseTier: 'standard', mode: 'compact', embedTarget: 'iframe' } }), ENABLED_ENV)
    check('[enabled] embed-instructions (allowed combo) → 200', r.status === 200)
    const body = r.body as { allowed?: boolean; instructions?: string[] }
    check('[enabled] embed-instructions (allowed combo) → allowed:true, non-empty instructions', body.allowed === true && (body.instructions?.length ?? 0) > 0)
    assertNoLeak('[enabled] embed-instructions', r.body)
  }

  // ── Enabled: test-key-metadata — shape only, never a secret ──
  {
    const r = testKeyMetadataHandler(makeCtx(), ENABLED_ENV)
    check('[enabled] test-key-metadata → 200', r.status === 200)
    const meta = (r.body as { exampleKeyMetadata?: Record<string, unknown> }).exampleKeyMetadata ?? {}
    const keys = Object.keys(meta).sort()
    const expectedKeys = ['environment', 'expiresAt', 'issuedAt', 'keyId', 'keyPrefix', 'scopes', 'status'].sort()
    check('[enabled] test-key-metadata → shape matches exactly (no extra/secret fields)', JSON.stringify(keys) === JSON.stringify(expectedKeys))
    assertNoLeak('[enabled] test-key-metadata', r.body)
  }
}

// ── Phase B: real HTTP (best-effort) ──────────────────────────────────────────

async function fetchJson(baseUrl: string, path: string, init?: RequestInit): Promise<{ status: number; body: unknown } | null> {
  try {
    const res = await fetch(`${baseUrl}${path}`, init)
    const body = await res.json().catch(() => null)
    return { status: res.status, body }
  } catch {
    return null
  }
}

async function runPhaseB(): Promise<void> {
  const baseUrl = process.env.PARTNER_SANDBOX_SMOKE_BASE_URL

  if (!baseUrl) {
    console.log('\n── Phase B: SKIPPED (no PARTNER_SANDBOX_SMOKE_BASE_URL) ──')
    console.log('   Set PARTNER_SANDBOX_SMOKE_BASE_URL=http://localhost:3000 (with a server running) to also verify real HTTP transport.\n')
    return
  }

  console.log(`\n── Phase B: real HTTP verification against ${baseUrl} ──\n`)

  const probe = await fetchJson(baseUrl, '/api/v1/sandbox/partner/test-key-metadata')
  if (!probe) {
    check('Phase B server reachable', false, `no response from ${baseUrl}`)
    return
  }

  if (probe.status === 503) {
    console.log("   Live server has PARTNER_SANDBOX_API_ENABLED off — reporting the disabled response and skipping enabled-state HTTP checks.")
    console.log('   Re-run with PARTNER_SANDBOX_API_ENABLED=true set on the SERVER process (not this script) to exercise the enabled path over HTTP.')
    check('[http] disabled-state body.code === SANDBOX_DISABLED', (probe.body as { code?: string }).code === 'SANDBOX_DISABLED')
    assertNoLeak('[http disabled] test-key-metadata', probe.body)
    return
  }

  check('[http] test-key-metadata → 200', probe.status === 200)
  assertNoLeak('[http] test-key-metadata', probe.body)

  const catalog = await fetchJson(baseUrl, '/api/v1/sandbox/partner/widget-catalog?licenseTier=standard')
  if (catalog) {
    check('[http] widget-catalog?licenseTier=standard → 200', catalog.status === 200)
    const list = (catalog.body as { widgetCatalog?: string[] }).widgetCatalog ?? []
    check('[http] widget-catalog (standard) excludes full_dashboard', !list.includes('full_dashboard'))
    assertNoLeak('[http] widget-catalog', catalog.body)
  }

  const permission = await fetchJson(baseUrl, '/api/v1/sandbox/partner/check-widget-permission?licenseTier=standard&mode=full_dashboard')
  if (permission) {
    check('[http] check-widget-permission (standard/full_dashboard) → 200', permission.status === 200)
    check('[http] check-widget-permission (standard/full_dashboard) → allowed:false', (permission.body as { allowed?: boolean }).allowed === false)
  }

  const instructions = await fetchJson(baseUrl, '/api/v1/sandbox/partner/embed-instructions?licenseTier=standard&mode=compact&embedTarget=iframe')
  if (instructions) {
    check('[http] embed-instructions (allowed combo) → 200', instructions.status === 200)
    assertNoLeak('[http] embed-instructions', instructions.body)
  }

  const validate = await fetchJson(baseUrl, '/api/v1/sandbox/partner/validate-config', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(SANDBOX_PARTNER_TENANT_CONFIG),
  })
  if (validate) {
    check('[http] validate-config (valid fixture) → 200', validate.status === 200)
    check('[http] validate-config (valid fixture) → valid:true', (validate.body as { valid?: boolean }).valid === true)
    assertNoLeak('[http] validate-config', validate.body)
  }

  const theme = await fetchJson(baseUrl, '/api/v1/sandbox/partner/preview-theme', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ partnerBrandId: 'acme', preferredMode: 'partner_override', colorOverrides: { accent: '#0a84ff' } }),
  })
  if (theme) {
    check('[http] preview-theme → 200', theme.status === 200)
    assertNoLeak('[http] preview-theme', theme.body)
  }
}

;(async () => {
  console.log('Phase 7.21 Partner Sandbox API smoke verification')
  runPhaseA()
  await runPhaseB()

  console.log(failures === 0 ? '\nPARTNER_SANDBOX_SMOKE_OK' : `\nPARTNER_SANDBOX_SMOKE_FAILED (${failures} checks failed)`)
  process.exit(failures === 0 ? 0 : 1)
})().catch((e) => {
  console.error('FATAL', e instanceof Error ? e.stack : e)
  process.exit(1)
})
