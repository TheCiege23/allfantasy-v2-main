/**
 * Decision OS — Phase 7.17 JS Embed Adapter types.
 *
 * The weakest-isolation embed target (per PHASE_7_5_WIDGET_RUNTIME_BOUNDARY_ADR.md's
 * capability matrix: `isolationLevel: 'none'`, `supportsDirectDOM: true`,
 * `supportsSandboxing: false`, `supportsPostMessage: false`) — a plain
 * JavaScript factory function a partner calls directly with a DOM
 * container they already own, no custom element registration, no Shadow
 * DOM, no iframe. Trusted/allowlisted partners only (per the F7.5
 * implementation plan's security model for this target).
 *
 * `JsEmbedWidgetConfig`/`JsEmbedTenantConfig` structurally OMIT
 * `apiKey` — the partner's `config` object can never carry a credential.
 * The credential is a separate, required top-level `apiKey` parameter on
 * `CreateWidgetOptions`, injected into a full `WidgetConfig` only at mount
 * time (see config.ts's `buildWidgetConfigWithCredential`). Unlike the web
 * component adapter (Phase 7.16), which needs a WeakMap because attribute
 * mutations are handled by code OUTSIDE the original call site, this
 * adapter's credential lives in a plain JS closure inside
 * `createAllFantasyWidget` — sufficient privacy for a factory-function API
 * with no external attribute-driven lookup requirement, and never
 * attached as a property of the returned instance.
 */

import type { WidgetMode, WidgetFeatureFlags, WidgetConfig } from '../../../lib/decision-os/presentation/widget-contracts'
import type { SDKAuth, SDKError, SDKTheme } from '../../../lib/decision-os/sdk/types'
import type { RuntimeClock, RuntimeFetch, RefreshStrategyOverrides } from '../../core/src/index'
import type { WidgetRenderState } from '../../react/src/index'

export interface JsEmbedTenantConfig {
  tenantId: string
  allowedOrigins: string[]
  rateLimitPerMinute: number
  featureFlags: WidgetFeatureFlags
  whiteLabelPlatform: string | null
}

export interface JsEmbedWidgetConfig {
  mode: WidgetMode
  entityId: string
  entityType: 'manager' | 'league' | 'platform' | 'company'
  tenantConfig: JsEmbedTenantConfig
  presentationVersion: string
}

export interface CreateWidgetLifecycleCallbacks {
  onReady?: (info: { degraded: boolean }) => void
  onDegraded?: () => void
  onError?: (error: SDKError) => void
  onInteraction?: (target: string) => void
}

export interface CreateWidgetOptions extends CreateWidgetLifecycleCallbacks {
  /** Any value is accepted at the type level so a plain-JS (non-TypeScript) caller's mistakes are validated, not just assumed away. */
  container: unknown
  config: JsEmbedWidgetConfig
  auth: SDKAuth
  /** Never read from `config` — see the module doc above. */
  apiKey: string
  baseUrl: string
  /** Injectable for tests; defaults to real `fetch` when unset. */
  fetchImpl?: RuntimeFetch
  /** Injectable for tests; defaults to real timers when unset. */
  clock?: RuntimeClock
  refreshStrategyOverrides?: RefreshStrategyOverrides
  /**
   * White-label theme (Phase 7.4). A one-time constructor input, like
   * `config`/`auth` — this adapter has no live-reconfigure story for any
   * option, theme included. Omit for the default palette (a graceful
   * fallback, never required) — forwarded as-is to `WidgetRenderBoundary`.
   */
  theme?: SDKTheme | null
}

export interface AllFantasyWidgetInstance {
  /** Idempotent. `createAllFantasyWidget` already calls this once before returning; exposed for manual re-mount after `unmount()`. */
  mount(): void
  /** Idempotent safe teardown — unmounts the React tree and releases the container. */
  unmount(): void
  /** Manual refresh — no-op before the first successful render. */
  refresh(): Promise<void>
  /** Collapsed render-facing state (Phase 7.8), or null before the first render / after unmount. */
  readonly renderState: WidgetRenderState | null
  /** Validation errors from container/config/auth checks (empty when everything is valid). */
  readonly configErrors: readonly string[]
}

export type { WidgetConfig }
