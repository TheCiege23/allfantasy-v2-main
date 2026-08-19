/**
 * Decision OS — Phase 7.16 Web Component Adapter: attribute contract.
 *
 * Declarative, non-secret widget configuration lives in HTML attributes.
 * Credentials (SDKAuth, tenantConfig.apiKey) are NEVER attributes — they are
 * set via the element's `setCredentials()` method and stored in a
 * module-private WeakMap (see credentials.ts), matching
 * PHASE_7_5_WIDGET_RUNTIME_BOUNDARY_ADR.md's web_component security model:
 * "closed Shadow DOM + credential in module-private WeakMap".
 *
 * `parseElementAttributes` takes an INJECTED getter rather than a real
 * Element/DOM node, so it is testable without constructing a custom element
 * at all — mirrors the `{ok:true/false}` result style used by
 * `sdk-runtime/iframe/src/urlHandshake.ts`'s `parseIframeWidgetUrlParams`.
 */

import type { WidgetMode } from '../../../lib/decision-os/presentation/widget-contracts'

// ── Attribute names ───────────────────────────────────────────────────────────

export const ELEMENT_ATTRIBUTE_NAMES = {
  mode: 'mode',
  entityId: 'entity-id',
  entityType: 'entity-type',
  tenantId: 'tenant-id',
  baseUrl: 'base-url',
  presentationVersion: 'presentation-version',
  whiteLabelPlatform: 'white-label-platform',
  themeMode: 'theme-mode',
  rateLimitPerMinute: 'rate-limit-per-minute',
  allowedOrigins: 'allowed-origins',
  enableBenchmarkComparison: 'enable-benchmark-comparison',
  enableArchetypeLabel: 'enable-archetype-label',
  enableBehavioralPatterns: 'enable-behavioral-patterns',
  enableCompanyIntelligence: 'enable-company-intelligence',
} as const

/**
 * The custom element's `observedAttributes` list. Structurally cannot
 * include a credential-shaped name — this array is derived from the same
 * map every parser field below reads, and that map has no `api-key` /
 * `credential` entry (see the import-boundary test's positive control and
 * the "no credential leakage" element tests).
 */
export const OBSERVED_ATTRIBUTES: readonly string[] = Object.values(ELEMENT_ATTRIBUTE_NAMES)

// ── Parsed shape ──────────────────────────────────────────────────────────────

export interface ParsedElementAttributes {
  mode: WidgetMode
  entityId: string
  entityType: 'manager' | 'league' | 'platform' | 'company'
  tenantId: string
  baseUrl: string
  presentationVersion: string
  whiteLabelPlatform: string | null
  themeMode: string
  rateLimitPerMinute: number
  allowedOrigins: string[]
  featureFlags: {
    enableBenchmarkComparison: boolean
    enableArchetypeLabel: boolean
    enableBehavioralPatterns: boolean
    enableCompanyIntelligence: boolean
  }
}

export type ParseElementAttributesResult =
  | { ok: true; parsed: ParsedElementAttributes }
  | { ok: false; errors: string[] }

/** Injected in place of a real Element so parsing is testable without any DOM. */
export type AttributeGetter = (name: string) => string | null

const DEFAULT_PRESENTATION_VERSION = '7.0.0'
const DEFAULT_THEME_MODE = 'light'
const DEFAULT_RATE_LIMIT_PER_MINUTE = 60

const VALID_ENTITY_TYPES = ['manager', 'league', 'platform', 'company'] as const

/**
 * Parses and validates the element's observed attributes. Deterministic —
 * same attribute values always produce the same result. Never throws on
 * malformed input; every problem is reported via `errors`.
 *
 * Only checks ATTRIBUTE-layer completeness/format (required fields present,
 * numeric fields numeric, entityType is one of the four known values). Mode
 * enum validity and mode/entityType compatibility are deliberately NOT
 * re-checked here — that is `validateWidgetConfig`'s job (Phase 7.3, the
 * single source of truth), applied downstream by `config.ts`.
 */
export function parseElementAttributes(getAttribute: AttributeGetter): ParseElementAttributesResult {
  const errors: string[] = []

  const mode = getAttribute(ELEMENT_ATTRIBUTE_NAMES.mode)
  if (!mode || mode.trim() === '') {
    errors.push(`missing required attribute '${ELEMENT_ATTRIBUTE_NAMES.mode}'`)
  }

  const entityId = getAttribute(ELEMENT_ATTRIBUTE_NAMES.entityId)
  if (!entityId || entityId.trim() === '') {
    errors.push(`missing required attribute '${ELEMENT_ATTRIBUTE_NAMES.entityId}'`)
  }

  const entityType = getAttribute(ELEMENT_ATTRIBUTE_NAMES.entityType)
  if (!entityType || entityType.trim() === '') {
    errors.push(`missing required attribute '${ELEMENT_ATTRIBUTE_NAMES.entityType}'`)
  } else if (!VALID_ENTITY_TYPES.includes(entityType as (typeof VALID_ENTITY_TYPES)[number])) {
    errors.push(`attribute '${ELEMENT_ATTRIBUTE_NAMES.entityType}' has an invalid value '${entityType}'`)
  }

  const tenantId = getAttribute(ELEMENT_ATTRIBUTE_NAMES.tenantId)
  if (!tenantId || tenantId.trim() === '') {
    errors.push(`missing required attribute '${ELEMENT_ATTRIBUTE_NAMES.tenantId}'`)
  }

  const baseUrl = getAttribute(ELEMENT_ATTRIBUTE_NAMES.baseUrl)
  if (!baseUrl || baseUrl.trim() === '') {
    errors.push(`missing required attribute '${ELEMENT_ATTRIBUTE_NAMES.baseUrl}'`)
  }

  const rawRateLimit = getAttribute(ELEMENT_ATTRIBUTE_NAMES.rateLimitPerMinute)
  let rateLimitPerMinute = DEFAULT_RATE_LIMIT_PER_MINUTE
  if (rawRateLimit !== null) {
    const parsedRate = Number(rawRateLimit)
    if (!Number.isFinite(parsedRate) || parsedRate < 1) {
      errors.push(`attribute '${ELEMENT_ATTRIBUTE_NAMES.rateLimitPerMinute}' must be a number >= 1`)
    } else {
      rateLimitPerMinute = parsedRate
    }
  }

  const rawAllowedOrigins = getAttribute(ELEMENT_ATTRIBUTE_NAMES.allowedOrigins)
  const allowedOrigins = rawAllowedOrigins
    ? rawAllowedOrigins.split(',').map((s) => s.trim()).filter((s) => s.length > 0)
    : []

  if (errors.length > 0) {
    return { ok: false, errors }
  }

  return {
    ok: true,
    parsed: {
      mode: mode as WidgetMode,
      entityId: entityId as string,
      entityType: entityType as ParsedElementAttributes['entityType'],
      tenantId: tenantId as string,
      baseUrl: baseUrl as string,
      presentationVersion: getAttribute(ELEMENT_ATTRIBUTE_NAMES.presentationVersion) ?? DEFAULT_PRESENTATION_VERSION,
      whiteLabelPlatform: getAttribute(ELEMENT_ATTRIBUTE_NAMES.whiteLabelPlatform),
      themeMode: getAttribute(ELEMENT_ATTRIBUTE_NAMES.themeMode) ?? DEFAULT_THEME_MODE,
      rateLimitPerMinute,
      allowedOrigins,
      featureFlags: {
        // Boolean attributes are presence-based (standard HTML idiom): any
        // value (including "") means true, absence means false.
        enableBenchmarkComparison: getAttribute(ELEMENT_ATTRIBUTE_NAMES.enableBenchmarkComparison) !== null,
        enableArchetypeLabel: getAttribute(ELEMENT_ATTRIBUTE_NAMES.enableArchetypeLabel) !== null,
        enableBehavioralPatterns: getAttribute(ELEMENT_ATTRIBUTE_NAMES.enableBehavioralPatterns) !== null,
        enableCompanyIntelligence: getAttribute(ELEMENT_ATTRIBUTE_NAMES.enableCompanyIntelligence) !== null,
      },
    },
  }
}
