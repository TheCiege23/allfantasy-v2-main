/**
 * Decision OS — Phase 7.4 Widget SDK & Embed Specification types.
 *
 * The platform-agnostic runtime contract every future SDK (JS, React, Vue, Angular,
 * Swift, Kotlin, Flutter, raw iframe) implements. Consumes ONLY the Presentation API
 * (Phase 7.2 `?view=presentation`) via the Widget Contract (Phase 7.3).
 *
 * Constraints (from PHASE_7_4_WIDGET_SDK_ADR.md):
 *   - Pure types only — no runtime logic in this file
 *   - No React, CSS, Tailwind, HTML, SVG, or browser APIs
 *   - No imports from Phase 5/6 internal types or Canonical World
 *   - All types are JSON-serializable except SDKCallbacks (function signatures only)
 */

import type { WidgetMode, WidgetSection } from '../presentation/widget-contracts'
import type { ColorToken, IconToken } from '../presentation/types'
import type { IntelligenceApiScope } from '../behavioral/api/contracts'

// ── Version ───────────────────────────────────────────────────────────────────

export const SDK_VERSION = '7.4.0' as const

/**
 * Pins the three independent version axes a runtime must validate before
 * initializing a widget. Prevents silent drift between SDK, Widget Contract,
 * and IPM versions.
 */
export interface SDKVersion {
  sdkVersion: string
  presentationVersion: string   // minimum compatible IPM PRESENTATION_VERSION
  widgetContractVersion: string // minimum compatible WIDGET_CONTRACT_VERSION
  apiVersion: string            // Intelligence API version, e.g. 'v1'
}

// ── Locale ────────────────────────────────────────────────────────────────────

export type SDKSupportedLocale =
  | 'en-US' | 'en-GB' | 'es-ES' | 'es-MX' | 'fr-FR' | 'de-DE' | 'pt-BR'

export interface SDKLocale {
  locale: SDKSupportedLocale
  fallbackLocale: SDKSupportedLocale
  numberFormat: 'western' | 'european'
  dateFormat: 'MDY' | 'DMY' | 'YMD'
}

// ── Theme ─────────────────────────────────────────────────────────────────────

export type SDKThemeMode =
  | 'light'
  | 'dark'
  | 'auto'
  | 'partner_override'
  | 'enterprise_branding'

/** Semantic-only token bundle. No hex codes, no CSS, no Tailwind. */
export interface SDKThemeTokens {
  colorTokenMap: Partial<Record<ColorToken, string>>
  iconTokenMap: Partial<Record<IconToken, string>>
  radiusToken: 'sharp' | 'soft' | 'rounded' | 'pill'
  densityToken: 'compact' | 'comfortable' | 'spacious'
}

export interface SDKTheme {
  mode: SDKThemeMode
  tokens: SDKThemeTokens
  /** Non-null only when mode is 'partner_override' or 'enterprise_branding'. */
  partnerBrandId: string | null
}

// ── Auth ──────────────────────────────────────────────────────────────────────

export type SDKAuthMethod =
  | 'api_key'
  | 'jwt'
  | 'signed_embed_token'
  | 'partner_token'
  | 'anonymous_public'
  | 'enterprise_tenant_token'

export interface SDKAuth {
  method: SDKAuthMethod
  /** Opaque credential string. Null only permitted for 'anonymous_public'. */
  credential: string | null
  /** Null only permitted for 'anonymous_public'. */
  tenantId: string | null
  /** ISO 8601. Null = does not expire (only valid for long-lived server keys). */
  expiresAt: string | null
  scopes: IntelligenceApiScope[]
}

// ── Embed targets ─────────────────────────────────────────────────────────────

export type SDKEmbedTarget =
  | 'iframe'
  | 'js_embed'
  | 'web_component'
  | 'react_wrapper'
  | 'vue_wrapper'
  | 'angular_wrapper'
  | 'native_bridge'
  | 'flutter_bridge'

export interface SDKEmbedCapabilities {
  target: SDKEmbedTarget
  supportsSandboxing: boolean
  supportsPostMessage: boolean
  supportsDirectDOM: boolean
  supportsNativeRendering: boolean
  isolationLevel: 'full' | 'partial' | 'none'
}

// ── Refresh ───────────────────────────────────────────────────────────────────

export type SDKRefreshTrigger =
  | 'manual'
  | 'scheduled'
  | 'visibility_change'
  | 'api_push'
  | 'host_callback'
  | 'offline_retry'

export interface SDKRefreshStrategyConfig {
  trigger: SDKRefreshTrigger
  /** Required (> 0) when trigger === 'scheduled'; otherwise must be null. */
  intervalSeconds: number | null
  maxRetries: number
  backoffSeconds: number
}

// ── Capabilities ──────────────────────────────────────────────────────────────

export interface SDKCapabilities {
  supportsInteractivity: boolean
  supportsRefresh: boolean
  supportsTelemetry: boolean
  supportsThemeOverride: boolean
  supportsOfflineCache: boolean
  maxWidgetsPerHost: number
}

// ── Lifecycle ─────────────────────────────────────────────────────────────────

export type SDKLifecycleState =
  | 'initializing'
  | 'authenticating'
  | 'loading'
  | 'rendering'
  | 'ready'
  | 'refreshing'
  | 'error'
  | 'disposed'
  | 'offline'
  | 'rate_limited'

// ── Config ────────────────────────────────────────────────────────────────────

export interface SDKConfig {
  version: SDKVersion
  auth: SDKAuth
  theme: SDKTheme
  locale: SDKLocale
  embedTarget: SDKEmbedTarget
  widgetMode: WidgetMode
  entityId: string
  entityType: 'manager' | 'league' | 'platform' | 'company'
  hostOrigin: string
  refreshStrategy: SDKRefreshStrategyConfig
  capabilities: SDKCapabilities
}

// ── Widget instance ───────────────────────────────────────────────────────────

export interface SDKWidgetInstance {
  widgetId: string
  sdkVersion: string
  lifecycleState: SDKLifecycleState
  config: SDKConfig
  createdAt: string
  lastUpdatedAt: string
}

// ── Events ────────────────────────────────────────────────────────────────────

export type SDKTelemetryEventType =
  | 'loaded'
  | 'rendered'
  | 'refresh'
  | 'interaction'
  | 'cta_click'
  | 'recommendation_viewed'
  | 'recommendation_accepted'
  | 'error'
  | 'disposed'

export interface SDKEvent {
  eventType: SDKTelemetryEventType
  widgetId: string
  timestamp: string
  /** Deterministic obfuscation of tenantId. Never the raw value. */
  tenantIdHash: string
  payload: Record<string, string | number | boolean | null>
}

export interface SDKTelemetry {
  events: SDKEvent[]
  sessionId: string
  sdkVersion: string
}

// ── Errors ────────────────────────────────────────────────────────────────────

export type SDKErrorCode =
  | 'UNAUTHORIZED'
  | 'RATE_LIMITED'
  | 'PRESENTATION_MISSING'
  | 'INVALID_SCOPE'
  | 'TENANT_MISMATCH'
  | 'UNSUPPORTED_WIDGET'
  | 'NETWORK'
  | 'VERSION_MISMATCH'
  | 'DEGRADED_DATA'
  | 'INCOMPLETE_PRESENTATION'

export interface SDKError {
  code: SDKErrorCode
  message: string
  retryable: boolean
  widgetId: string | null
  timestamp: string
}

// ── Callbacks (contract shape only — no implementations) ──────────────────────

export interface SDKCallbacks {
  onLoaded: ((instance: SDKWidgetInstance) => void) | null
  onRendered: ((instance: SDKWidgetInstance) => void) | null
  onError: ((error: SDKError) => void) | null
  onEvent: ((event: SDKEvent) => void) | null
  onDisposed: ((widgetId: string) => void) | null
}

// ── Enterprise extensions ─────────────────────────────────────────────────────

export type SDKExtensionPoint =
  | 'white_label'
  | 'oem'
  | 'partner_branding'
  | 'marketplace_widget'
  | 'premium_widget'
  | 'commissioner_only_widget'
  | 'manager_only_widget'
  | 'platform_analytics_widget'

export type SDKLicenseTier = 'standard' | 'premium' | 'enterprise'

export interface SDKEnterpriseExtension {
  extensionPoint: SDKExtensionPoint
  enabled: boolean
  licenseTier: SDKLicenseTier
  restrictions: string[]
}

// ── Re-exports for SDK consumers (avoid deep cross-module imports) ────────────

export type { WidgetMode, WidgetSection }
