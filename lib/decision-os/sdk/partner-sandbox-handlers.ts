/**
 * Decision OS — Phase 7.20 Partner Sandbox API: pure handlers.
 *
 * Framework-agnostic — takes a duck-typed `PartnerSandboxApiContext`
 * (never `NextRequest`), returns a plain `{ status, body }` result. Mirrors
 * `lib/decision-os/behavioral/api/intelligence-handlers.ts`'s pattern
 * exactly (see PHASE_7_20_PARTNER_SANDBOX_API_ADR.md D1). Every handler
 * checks the environment gate first (D2), never requires a per-request API
 * key (D3), and never lets a malformed request body crash with an
 * unhandled exception (D5) — every response is customer-facing output
 * only (D6).
 */

import { ALL_EMBED_TARGETS } from './embed'
import type { SDKEmbedTarget, SDKLicenseTier } from './types'
import { ALL_LICENSE_TIERS, validatePartnerTenantConfig } from './partner-validation'
import type { PartnerBrandingConfig, PartnerTenantConfig } from './partner-types'
import { normalizePartnerBranding } from './partner-theme'
import {
  WIDGET_MODE_MIN_TIER,
  isWidgetModeAllowedForTier,
  resolveDefaultWidgetCatalog,
} from './partner-permissions'
import { SANDBOX_PARTNER_TENANT_CONFIG } from './partner-fixtures'
import type { WidgetMode } from '../presentation/widget-contracts'

// ── Context / result / error shapes ─────────────────────────────────────────────

export interface PartnerSandboxApiContext {
  headers: { get(key: string): string | null }
  searchParams: URLSearchParams
  /** Parsed JSON body (already `await req.json()`'d by the route file) — `undefined` for GET routes. */
  body: unknown
}

export interface PartnerSandboxHandlerResult {
  status: number
  body: unknown
}

export type PartnerSandboxErrorCode = 'SANDBOX_DISABLED' | 'INVALID_REQUEST'

export interface PartnerSandboxApiError {
  code: PartnerSandboxErrorCode
  message: string
  requestId: string
}

// ── Environment gate (ADR D2) ────────────────────────────────────────────────────

const PARTNER_SANDBOX_API_ENV_VAR = 'PARTNER_SANDBOX_API_ENABLED'

/** Defaults OFF. Matches lib/decision-os/core/shadow/flag.ts's defensive normalize-then-compare idiom, with an injectable env for testability. */
export function isPartnerSandboxApiEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return String(env[PARTNER_SANDBOX_API_ENV_VAR] ?? '').trim().toLowerCase() === 'true'
}

// ── Shared helpers ────────────────────────────────────────────────────────────

/** Deliberately duplicated (not imported) from lib/decision-os/behavioral/api/gate.ts — lib/decision-os/sdk must never depend on lib/decision-os/behavioral (the dependency direction runs the other way). */
function generateRequestId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
}

function disabledResult(): PartnerSandboxHandlerResult {
  const error: PartnerSandboxApiError = {
    code: 'SANDBOX_DISABLED',
    message: 'Partner Sandbox API is not enabled on this environment.',
    requestId: generateRequestId(),
  }
  return { status: 503, body: error }
}

function invalidRequestResult(message: string): PartnerSandboxHandlerResult {
  const error: PartnerSandboxApiError = {
    code: 'INVALID_REQUEST',
    message,
    requestId: generateRequestId(),
  }
  return { status: 400, body: error }
}

const ALL_WIDGET_MODES = Object.keys(WIDGET_MODE_MIN_TIER) as WidgetMode[]

function parseLicenseTier(raw: string | null): SDKLicenseTier | null {
  if (raw && (ALL_LICENSE_TIERS as readonly string[]).includes(raw)) return raw as SDKLicenseTier
  return null
}

function parseWidgetMode(raw: string | null): WidgetMode | null {
  if (raw && ALL_WIDGET_MODES.includes(raw as WidgetMode)) return raw as WidgetMode
  return null
}

function parseEmbedTarget(raw: string | null): SDKEmbedTarget | null {
  if (raw && (ALL_EMBED_TARGETS as readonly string[]).includes(raw)) return raw as SDKEmbedTarget
  return null
}

// ── 1. Validate partner config ─────────────────────────────────────────────────

export function validatePartnerConfigHandler(
  ctx: PartnerSandboxApiContext,
  env: NodeJS.ProcessEnv = process.env,
): PartnerSandboxHandlerResult {
  if (!isPartnerSandboxApiEnabled(env)) return disabledResult()

  if (ctx.body === null || typeof ctx.body !== 'object') {
    return invalidRequestResult('Request body must be a JSON object matching the PartnerTenantConfig shape.')
  }

  try {
    const result = validatePartnerTenantConfig(ctx.body as PartnerTenantConfig)
    return { status: 200, body: result }
  } catch {
    return invalidRequestResult('Request body does not match the expected PartnerTenantConfig shape.')
  }
}

// ── 2. Preview partner theme ────────────────────────────────────────────────────

export function previewPartnerThemeHandler(
  ctx: PartnerSandboxApiContext,
  env: NodeJS.ProcessEnv = process.env,
): PartnerSandboxHandlerResult {
  if (!isPartnerSandboxApiEnabled(env)) return disabledResult()

  if (ctx.body === null || typeof ctx.body !== 'object') {
    return invalidRequestResult('Request body must be a JSON object matching the PartnerBrandingConfig shape.')
  }

  try {
    const result = normalizePartnerBranding(ctx.body as PartnerBrandingConfig)
    return { status: 200, body: result }
  } catch {
    return invalidRequestResult('Request body does not match the expected PartnerBrandingConfig shape.')
  }
}

// ── 3. List allowed widget catalog ──────────────────────────────────────────────

export function widgetCatalogHandler(
  ctx: PartnerSandboxApiContext,
  env: NodeJS.ProcessEnv = process.env,
): PartnerSandboxHandlerResult {
  if (!isPartnerSandboxApiEnabled(env)) return disabledResult()

  const tier = parseLicenseTier(ctx.searchParams.get('licenseTier'))
  if (!tier) {
    return invalidRequestResult(`Query param 'licenseTier' must be one of: ${ALL_LICENSE_TIERS.join(', ')}`)
  }

  return {
    status: 200,
    body: { licenseTier: tier, widgetCatalog: resolveDefaultWidgetCatalog(tier) },
  }
}

// ── 4. Validate widget permission ──────────────────────────────────────────────

export function checkWidgetPermissionHandler(
  ctx: PartnerSandboxApiContext,
  env: NodeJS.ProcessEnv = process.env,
): PartnerSandboxHandlerResult {
  if (!isPartnerSandboxApiEnabled(env)) return disabledResult()

  const tier = parseLicenseTier(ctx.searchParams.get('licenseTier'))
  if (!tier) {
    return invalidRequestResult(`Query param 'licenseTier' must be one of: ${ALL_LICENSE_TIERS.join(', ')}`)
  }
  const mode = parseWidgetMode(ctx.searchParams.get('mode'))
  if (!mode) {
    return invalidRequestResult(`Query param 'mode' must be one of: ${ALL_WIDGET_MODES.join(', ')}`)
  }

  return {
    status: 200,
    body: { licenseTier: tier, widgetMode: mode, allowed: isWidgetModeAllowedForTier(mode, tier) },
  }
}

// ── 5. Return embed instructions ────────────────────────────────────────────────

/**
 * Static, deterministic instructions per embed target (ADR D7) — describes
 * the ACTUAL public APIs already shipped (F7.12 host facade, F7.16 web
 * component, F7.17 js embed, F7.8 React adapter). Never computed from live
 * data, never provider-specific.
 */
const EMBED_TARGET_INSTRUCTIONS: Readonly<Record<SDKEmbedTarget, readonly string[]>> = {
  iframe: [
    'Import createAllFantasyWidgetHost from the iframe facade.',
    'Call createAllFantasyWidgetHost({ sdkConfig, iframeOrigin, allowedOrigins, baseSrc, childOrigin, onReady, onError, ... }).',
    'Call host.mount(containerElement) to insert the sandboxed iframe.',
    'The iframe page itself mounts createAllFantasyWidgetIframeClientFromUrl() and renders via the React child bridge.',
  ],
  web_component: [
    'Import defineAllFantasyWidgetElement and call it once to register <allfantasy-widget>.',
    'Add <allfantasy-widget mode="..." entity-id="..." entity-type="..." tenant-id="..." base-url="..."></allfantasy-widget> to your page.',
    'Call element.setCredentials(auth, apiKey) before or after the element connects.',
  ],
  js_embed: [
    'Import AllFantasy, or call attachAllFantasyGlobal() to expose window.AllFantasy.',
    'Call AllFantasy.createWidget({ container, config, auth, apiKey, baseUrl }).',
    'Call the returned instance\'s unmount() when you remove the widget from the page.',
  ],
  react_wrapper: [
    'Import AllFantasyWidget from the React adapter.',
    'Render <AllFantasyWidget config={...} auth={...} baseUrl={...} fetchImpl={...} clock={...} theme={...} />.',
  ],
  vue_wrapper: ['A Vue-specific wrapper has not been built yet — use the js_embed target in the meantime.'],
  angular_wrapper: ['An Angular-specific wrapper has not been built yet — use the js_embed target in the meantime.'],
  native_bridge: ['A native bridge has not been built yet — use the js_embed target in the meantime.'],
  flutter_bridge: ['A Flutter bridge has not been built yet — use the js_embed target in the meantime.'],
}

export function embedInstructionsHandler(
  ctx: PartnerSandboxApiContext,
  env: NodeJS.ProcessEnv = process.env,
): PartnerSandboxHandlerResult {
  if (!isPartnerSandboxApiEnabled(env)) return disabledResult()

  const tier = parseLicenseTier(ctx.searchParams.get('licenseTier'))
  if (!tier) {
    return invalidRequestResult(`Query param 'licenseTier' must be one of: ${ALL_LICENSE_TIERS.join(', ')}`)
  }
  const mode = parseWidgetMode(ctx.searchParams.get('mode'))
  if (!mode) {
    return invalidRequestResult(`Query param 'mode' must be one of: ${ALL_WIDGET_MODES.join(', ')}`)
  }
  const embedTarget = parseEmbedTarget(ctx.searchParams.get('embedTarget'))
  if (!embedTarget) {
    return invalidRequestResult(`Query param 'embedTarget' must be one of: ${ALL_EMBED_TARGETS.join(', ')}`)
  }

  const allowed = isWidgetModeAllowedForTier(mode, tier)

  return {
    status: 200,
    body: {
      licenseTier: tier,
      widgetMode: mode,
      embedTarget,
      allowed,
      instructions: allowed ? EMBED_TARGET_INSTRUCTIONS[embedTarget] : [],
      reason: allowed
        ? null
        : `widgetMode '${mode}' requires at least '${WIDGET_MODE_MIN_TIER[mode]}' tier; this request is '${tier}'.`,
    },
  }
}

// ── 6. Sandbox test key metadata (shape only, never a real secret) ────────────

export function testKeyMetadataHandler(
  ctx: PartnerSandboxApiContext,
  env: NodeJS.ProcessEnv = process.env,
): PartnerSandboxHandlerResult {
  if (!isPartnerSandboxApiEnabled(env)) return disabledResult()

  const exampleKeyMetadata = SANDBOX_PARTNER_TENANT_CONFIG.apiKeys[0] ?? null

  return {
    status: 200,
    body: {
      exampleKeyMetadata,
      note: 'Example metadata only, from the Phase 7.19 sandbox fixture. No real API key value is ever returned by this endpoint.',
    },
  }
}
