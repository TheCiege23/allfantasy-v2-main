/**
 * Decision OS — Phase 7.8 Widget Runtime React Adapter types.
 *
 * The React adapter renders IPM presentation models (Phase 7.0/7.2) fetched
 * through the sdk-runtime core (Phase 7.6/7.7). It computes NOTHING — no
 * scores, no severities, no colors are derived here; every value rendered
 * already arrived pre-resolved on the wire.
 *
 * Import boundary (enforced by __tests__/sdk-runtime/react/import-boundary.test.ts):
 *   allowed  — 'react', local modules, sdk-runtime/core, lib/decision-os/sdk,
 *              lib/decision-os/presentation
 *   forbidden — lib/decision-os/behavioral/*, lib/decision-os/world/*, Prisma
 */

import type { SDKAuth, SDKError, SDKLifecycleState } from '../../../lib/decision-os/sdk/types'
import type { WidgetConfig } from '../../../lib/decision-os/presentation/widget-contracts'
import type {
  LeagueApiPresentation,
  ManagerApiPresentation,
  PlatformApiPresentation,
} from '../../../lib/decision-os/presentation/types'
import type {
  RefreshEngine,
  RefreshStrategyOverrides,
  RuntimeClock,
  RuntimeFetch,
} from '../../core/src/index'

/**
 * The union of wire-safe IPM presentation shapes this adapter can render.
 * `CompanyApiPresentation` is deliberately excluded: Phase 7.3's
 * `MODE_VALID_ENTITY_TYPES` never pairs any of the 8 widget modes with
 * `entityType: 'company'`, so that shape is structurally unreachable through
 * any config that passes `validateWidgetConfig` — including it here would
 * add dead rendering branches for a case the contract layer already forbids.
 */
export type WidgetPresentationData =
  | LeagueApiPresentation
  | ManagerApiPresentation
  | PlatformApiPresentation

/**
 * Collapsed render-facing state — a simplified view of the 10-state
 * SDKLifecycleState (Phase 7.4) for conditional rendering. Produced by the
 * pure `mapLifecycleToRenderState()` function, never derived ad hoc in JSX.
 */
export type WidgetRenderState = 'loading' | 'ready' | 'error' | 'offline' | 'rate_limited' | 'disposed'

export interface UseAllFantasyWidgetOptions {
  /** Widget deployment contract (Phase 7.3) — mode, entity, tenant, scopes. */
  config: WidgetConfig
  /** SDK runtime auth (Phase 7.4) — the credential attached to the HTTP request. */
  auth: SDKAuth
  baseUrl: string
  /** Injected fetch — never a global `fetch`. Required so the hook is testable and host-agnostic. */
  fetchImpl: RuntimeFetch
  /** Injected clock — never a global timer. Required for the same reason. */
  clock: RuntimeClock
  refreshStrategyOverrides?: RefreshStrategyOverrides
}

export interface UseAllFantasyWidgetResult {
  renderState: WidgetRenderState
  lifecycleState: SDKLifecycleState
  data: WidgetPresentationData | null
  /** true when the presentation data arrived with completeness < 100. */
  degraded: boolean
  error: SDKError | null
  /** Manual refresh — wraps RefreshEngine.refreshNow(). */
  refresh: () => Promise<void>
  /** The underlying refresh engine, for hosts that want start()/notifyVisible()/notifyOffline() etc. Null until the effect has run once. */
  engine: RefreshEngine | null
}
