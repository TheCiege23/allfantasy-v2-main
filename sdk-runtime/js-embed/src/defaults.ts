/**
 * Decision OS — Phase 7.17 JS Embed Adapter: default runtime deps.
 *
 * Same rationale as the web component adapter's defaults.ts (Phase 7.16):
 * this adapter's whole purpose is a partner calling `AllFantasy.createWidget`
 * with a container and nothing else configured — so it defaults to real
 * `fetch`/`setTimeout` when the caller hasn't supplied `fetchImpl`/`clock`.
 * Both remain overridable per-call for tests.
 */

import type { RuntimeClock, RuntimeFetch } from '../../core/src/index'

export const defaultFetchImpl: RuntimeFetch = (url, init) => fetch(url, init)

export const defaultClock: RuntimeClock = {
  now: () => Date.now(),
  setTimeout: (callback, delayMs) => setTimeout(callback, delayMs),
  clearTimeout: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
}
