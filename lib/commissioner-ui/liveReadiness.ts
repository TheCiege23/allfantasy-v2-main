/**
 * Per-namespace live-readiness flags — the mechanism a future real
 * `live.ts` implementation checks before attempting a real call, so each
 * of the twelve namespaces can be switched on independently once its own
 * integration actually exists, rather than all-or-nothing.
 *
 * Deliberately layered *underneath* the existing global Demo Mode
 * cookie (`lib/commissioner-ui/demo-mode`), not replacing it — that
 * cookie still decides stub vs. demo vs. live for the whole session
 * exactly as it does today; this only governs what a namespace's own
 * `live.ts` does once the global mode is already 'live'. Reuses
 * `lib/feature-toggle`'s existing DB-backed `getBoolean`/`setBoolean`
 * (Prisma's `platformConfig` table) rather than inventing a second
 * config-storage mechanism — the same "one flag per module" pattern
 * `lib/commissioner-ui/featureFlags.ts` already uses for module
 * enable/disable, applied here to a different question (is this
 * namespace's *live* implementation ready, not is the module itself
 * enabled).
 *
 * Every namespace defaults to `false` — today, with zero real `live.ts`
 * implementations written yet, this changes nothing: no code calls
 * `isLiveReady()` yet. It exists as ready-to-use scaffolding for the
 * module-by-module integration work this phase's roadmap hands off to.
 */
import { getBoolean, setBoolean } from '@/lib/feature-toggle'
import type { CommissionerErrorAttributableId } from './contracts'

/**
 * Phase 3.12 — widened from `CommissionerModuleId` to
 * `CommissionerErrorAttributableId` (the same narrow widening
 * `contracts/errors.ts` already applies for exactly this reason: Search
 * is a platform service, not a business module, but still needs its own
 * independent kill switch like every real module does). Every existing
 * caller passes a `CommissionerModuleId`, already a subtype of this wider
 * type, so this is additive and does not change behavior for any of the
 * eleven already-gated namespaces.
 */
function liveReadyKey(moduleId: CommissionerErrorAttributableId): string {
  return `commissioner_os_live_ready_${moduleId}`
}

export async function isLiveReady(moduleId: CommissionerErrorAttributableId): Promise<boolean> {
  return getBoolean(liveReadyKey(moduleId))
}

export async function setLiveReady(moduleId: CommissionerErrorAttributableId, ready: boolean): Promise<void> {
  await setBoolean(liveReadyKey(moduleId), ready)
}
