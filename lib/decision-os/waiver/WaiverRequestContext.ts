/**
 * Decision OS — waiver request-scoped Decision Context (Phase 15).
 *
 * Restored from its own test suite (`__tests__/decision-os/waiver-request-context.test.ts`),
 * which shipped in the Phase 17 rescue commit without this source file. The tests are the
 * spec; this implements them exactly.
 *
 * Extracts the THREE request-scoped decision-context fields (currentWeek / goal /
 * maxResults) from a `WaiverAIServiceInput` so both the authoritative engine and the
 * shared-service shadow evaluate the SAME decision context. Deliberately never reads
 * identity or authorization fields — leagueId/rosterId stay server-resolved via
 * `loadWaiverWorldFacts`, never client-supplied. Pure: no IO, no prisma, no throwing.
 */
import type { WaiverAIServiceInput } from '@/lib/waiver-ai-engine'

export interface WaiverRequestContext {
  /** Defaults to 1 when absent/non-finite — the authoritative engine's own default. */
  currentWeek: number
  /** Defaults to 'balanced' — the authoritative engine's own default. */
  goal: 'win-now' | 'balanced' | 'rebuild'
  /** Clamped to the route's real bound (1–25); defaults to the previously-hardcoded 10. */
  maxResults: number
}

const MAX_RESULTS_DEFAULT = 10
const MAX_RESULTS_MIN = 1
const MAX_RESULTS_MAX = 25

export function extractWaiverRequestContext(input: WaiverAIServiceInput): WaiverRequestContext {
  const currentWeek =
    typeof input.currentWeek === 'number' && Number.isFinite(input.currentWeek) ? input.currentWeek : 1

  const goal =
    input.goal === 'win-now' || input.goal === 'rebuild' || input.goal === 'balanced' ? input.goal : 'balanced'

  const rawMax =
    typeof input.maxResults === 'number' && Number.isFinite(input.maxResults)
      ? Math.trunc(input.maxResults)
      : MAX_RESULTS_DEFAULT
  const maxResults = Math.min(MAX_RESULTS_MAX, Math.max(MAX_RESULTS_MIN, rawMax))

  return { currentWeek, goal, maxResults }
}
