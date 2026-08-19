/**
 * Decision OS — Phase 7.6 Widget Runtime Core types.
 *
 * Wire-level types for the runtime's own HTTP contract with the Presentation
 * API. Deliberately NOT imported from `lib/decision-os/behavioral/api/*` —
 * those are server-internal handler types. The runtime describes the wire
 * shape itself, matching but never depending on the server's internal type
 * definitions (see PHASE_7_5_WIDGET_RUNTIME_BOUNDARY_ADR.md, decision D1).
 *
 * No browser globals: `RuntimeFetch` is an injected function type, never the
 * ambient `fetch`/`Response`/`Headers` globals — this module has zero DOM
 * dependency, enforced by `sdk-runtime/tsconfig.json` (no "dom" lib).
 */

import type { SDKError } from '../../../lib/decision-os/sdk/types'

// ── Injected fetch contract (no browser/DOM globals) ──────────────────────────

export interface RuntimeFetchRequestInit {
  method?: string
  headers?: Record<string, string>
}

export interface RuntimeFetchResponse {
  status: number
  ok: boolean
  json(): Promise<unknown>
}

export type RuntimeFetch = (
  url: string,
  init?: RuntimeFetchRequestInit,
) => Promise<RuntimeFetchResponse>

// ── HTTP client config ─────────────────────────────────────────────────────────

export interface HttpClientConfig {
  baseUrl: string
  fetchImpl: RuntimeFetch
}

// ── Wire response envelope ──────────────────────────────────────────────────────
// Mirrors the shape of PresentationApiResponse<T> (Phase 7.2) on the wire,
// without importing that server-internal type.

export interface PresentationMetaWire {
  requestId: string
  derivedAt: string
  completeness: number
  version: string
  tier: string
  view: 'presentation'
  presentationVersion: string
}

export interface PresentationDataWire {
  entityId: string
  entityType: string
  completeness: number
  [key: string]: unknown
}

export interface PresentationEnvelopeWire {
  data: PresentationDataWire
  meta: PresentationMetaWire
}

// ── HTTP client result ────────────────────────────────────────────────────────

export interface PresentationFetchSuccess {
  ok: true
  data: PresentationDataWire
  meta: PresentationMetaWire
  /** true when meta.completeness < 100 — informational, not a failure. */
  degraded: boolean
}

export interface PresentationFetchFailure {
  ok: false
  error: SDKError
}

export type PresentationFetchResult = PresentationFetchSuccess | PresentationFetchFailure

// ── Expected entity (tenant/entity assertion) ──────────────────────────────────

export interface ExpectedEntity {
  entityId: string
  entityType: string
}

// ── Auth pre-check result ─────────────────────────────────────────────────────

export interface AuthPreCheckSuccess {
  ok: true
}

export interface AuthPreCheckFailure {
  ok: false
  error: SDKError
  /** Shape-validation messages from validateSDKAuth — never the credential value. */
  reasons: string[]
}

export type AuthPreCheckResult = AuthPreCheckSuccess | AuthPreCheckFailure

// ── Injected clock (Phase 7.7 refresh engine) ──────────────────────────────────
// Core never calls global `setTimeout`/`setInterval`/`Date.now` directly — every
// timer and every "current time" read goes through this injected abstraction,
// so refresh behavior is deterministic and testable with a fake clock.

/** Opaque handle returned by RuntimeClock.setTimeout; core never inspects it. */
export type RuntimeTimerHandle = unknown

export interface RuntimeClock {
  /** Current time in epoch milliseconds. */
  now(): number
  setTimeout(callback: () => void, delayMs: number): RuntimeTimerHandle
  clearTimeout(handle: RuntimeTimerHandle): void
}
