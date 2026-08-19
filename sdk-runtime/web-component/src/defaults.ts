/**
 * Decision OS — Phase 7.16 Web Component Adapter: default runtime deps.
 *
 * Unlike `sdk-runtime/core` (no browser globals at all, by tsconfig
 * enforcement) and the iframe React child bridge (Phase 7.15, where the
 * caller ALWAYS supplies `fetchImpl`/`clock` explicitly — see
 * `sdk-runtime/iframe/src/reactChild/types.ts`), this adapter's whole
 * purpose is drop-in simplicity for a partner site that just writes
 * `<allfantasy-widget>` markup — so it DOES default to the real global
 * `fetch`/`setTimeout` when the host hasn't injected its own
 * `fetchImpl`/`clock` properties. Both remain overridable per-instance
 * (`element.fetchImpl = ...` / `element.clock = ...`) for tests and for
 * hosts with special networking/timer needs — see
 * AllFantasyWidgetElement.tsx.
 */

import type { RuntimeClock, RuntimeFetch } from '../../core/src/index'

export const defaultFetchImpl: RuntimeFetch = (url, init) => fetch(url, init)

export const defaultClock: RuntimeClock = {
  now: () => Date.now(),
  setTimeout: (callback, delayMs) => setTimeout(callback, delayMs),
  clearTimeout: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
}
