/**
 * The Lineup OS loaders must actually REACH `runLineupShadow`.
 *
 * WHY THIS IS SEPARATE FROM lineup-os-wiring.test.ts
 * That file proves the feed behaves. This one proves it is plugged in. They are different failure
 * modes, and the second is the quiet one: `createLineupOsLoaders()` can be constructed, spread into
 * a call that ignores it, and everything still passes — wired in appearance, inert in fact. The
 * whole kernel sat at ZERO production callers before this change precisely because nothing failed
 * when nobody used it.
 *
 * `runLineupShadowForSummary(userId, summary, opts, deps)` takes the loaders as its FOURTH
 * argument, which is the easiest one to drop in a refactor without any type error: `deps` is
 * `Partial<LineupShadowDeps>` and defaults to `{}`, so omitting it silently restores the live
 * defaults and the shadow keeps working. Nothing would go red. Hence an explicit assertion on
 * argument 4.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const { runLineupShadowForSummaryMock } = vi.hoisted(() => ({
  runLineupShadowForSummaryMock: vi.fn(async () => []),
}))

vi.mock('@/lib/decision-os/lineup/shadow', () => ({
  runLineupShadowForSummary: runLineupShadowForSummaryMock,
  shouldRunLineupShadow: vi.fn(() => false),
  shouldRunLineupLive: vi.fn(() => false),
}))
vi.mock('@/lib/lineup-actions/computeLineupActionsForUser', () => ({
  computeLineupActionsForUser: vi.fn(async () => ({ leagues: [] })),
}))
vi.mock('@/lib/prisma', () => ({
  prisma: { league: { groupBy: vi.fn(async () => []) } },
}))

import { productionSweepDeps } from '@/lib/decision-os/lineup/shadowSweep'

beforeEach(() => { vi.clearAllMocks() })

describe('Lineup OS reaches the shadow sweep', () => {
  it('passes the feed loaders as runLineupShadow deps', async () => {
    const deps = productionSweepDeps()
    await deps.runShadow('user-1', { leagues: [] } as never, { maxLeagues: 1 })

    expect(runLineupShadowForSummaryMock).toHaveBeenCalledTimes(1)
    const args = runLineupShadowForSummaryMock.mock.calls[0]! as unknown[]
    const injected = args[3] as { loadWarehouseFacts?: unknown; loadSignalFacts?: unknown } | undefined

    // Argument 4 is the whole point. Dropping it is a silent no-op, not a type error.
    expect(injected).toBeDefined()
    expect(typeof injected!.loadWarehouseFacts).toBe('function')
    expect(typeof injected!.loadSignalFacts).toBe('function')
  })

  it('does not leak drainOutcomes into the shadow dep object', async () => {
    const deps = productionSweepDeps()
    await deps.runShadow('user-1', { leagues: [] } as never, { maxLeagues: 1 })

    const injected = (runLineupShadowForSummaryMock.mock.calls[0]! as unknown[])[3] as Record<string, unknown>
    // `LineupShadowDeps` has its own slots; passing an unrelated key would either fail the type or,
    // worse, shadow a real dependency name if one is ever added called `drainOutcomes`.
    expect(injected).not.toHaveProperty('drainOutcomes')
  })

  it('builds ONE feed per sweep tick, not one per user', async () => {
    const deps = productionSweepDeps()
    await deps.runShadow('user-1', { leagues: [] } as never, { maxLeagues: 1 })
    await deps.runShadow('user-2', { leagues: [] } as never, { maxLeagues: 1 })

    const a = (runLineupShadowForSummaryMock.mock.calls[0]! as unknown[])[3]
    const b = (runLineupShadowForSummaryMock.mock.calls[1]! as unknown[])[3]
    // Users in a sweep share league- and app-level facts. A per-user feed would miss exactly the
    // reuse the store exists to capture, and would make the hit-rate measurement misleading.
    expect(a).toBe(b)
  })
})
