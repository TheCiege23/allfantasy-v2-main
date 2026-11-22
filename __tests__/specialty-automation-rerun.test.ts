/** @vitest-environment node */
/**
 * 🛑 A SECOND PRESS FOR THE SAME WEEK WAS A SERVER ERROR. A run that was skipped ("the week is not ready
 * yet") or had failed kept its unique key, and the next run for that week tried to create a second row
 * under it: P2002, HTTP 500. A commissioner could ask once per week. Found walking a guillotine league
 * locally on 2026-11-20: the first manual chop answered "season not started", the second crashed.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

type Row = { id: string; idempotencyKey: string; status: string; startedAt: Date; summary: string | null; metadata: unknown }
const h = vi.hoisted(() => ({
  rows: new Map<string, Row>(),
  creates: 0,
  updates: [] as Array<Record<string, unknown>>,
  handler: vi.fn(),
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    league: { findUnique: vi.fn(async () => ({ id: 'L', name: 'Chop Shop', sport: 'NFL', season: 2026, leagueType: 'guillotine', leagueVariant: null, settings: {}, guillotineMode: true, survivorMode: false, status: 'in_season' })) },
    specialtyAutomationRun: {
      findUnique: vi.fn(async ({ where }: { where: { idempotencyKey: string } }) => h.rows.get(where.idempotencyKey) ?? null),
      create: vi.fn(async ({ data }: { data: Row }) => {
        h.creates += 1
        // The database's own rule: one row per key.
        if (h.rows.has(data.idempotencyKey)) throw Object.assign(new Error('Unique constraint failed on the fields: (`idempotencyKey`)'), { code: 'P2002' })
        const row = { ...data, id: `run-${h.rows.size + 1}`, startedAt: new Date(), summary: data.summary ?? null }
        h.rows.set(data.idempotencyKey, row)
        return row
      }),
      update: vi.fn(async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
        h.updates.push(data)
        const row = [...h.rows.values()].find((r) => r.id === where.id)!
        Object.assign(row, data)
        return row
      }),
    },
  },
}))
vi.mock('@/lib/specialty-automation/handlers/registry', () => ({ dispatchConceptHandler: (...a: unknown[]) => h.handler(...a) }))
vi.mock('@/lib/specialty-automation/actionExecutors', () => ({ persistAutomationActions: vi.fn(), persistLeagueEvents: vi.fn(), upsertPhaseState: vi.fn() }))
vi.mock('@/lib/specialty-automation/validation', () => ({ validateAutomationContext: () => ({ ok: true }), validateConceptRulesShape: () => ({ ok: true }) }))
vi.mock('@/lib/engine-testing/runtime/invariantRuntime', () => ({ logEngineInvariantOptional: vi.fn() }))

import { runSpecialtyAutomationOrchestrator } from '@/lib/specialty-automation/orchestrator'

const run = () => runSpecialtyAutomationOrchestrator({ leagueId: 'L', season: 2026, week: 3, trigger: 'onManualRun' as never, source: 'commissioner' })
const waiting = { summary: 'Guilly: no chop yet. Week 3 is still being played.', actions: [], events: [], skipped: true, skipReason: 'week_in_progress' }
const chopped = { summary: 'Guilly: 1 chop(s) in week 3.', actions: [], events: [] }

beforeEach(() => {
  h.rows.clear()
  h.creates = 0
  h.updates = []
  h.handler.mockReset()
})

describe('pressing the automation button again for the same week', () => {
  it('🛑 after a "not ready yet" answer, the next press runs again instead of crashing', async () => {
    h.handler.mockResolvedValueOnce(waiting).mockResolvedValueOnce(chopped)
    const first = await run()
    expect(first.result).toMatchObject({ skipped: true, skipReason: 'week_in_progress' })
    const second = await run()
    expect(second.result.summary).toBe('Guilly: 1 chop(s) in week 3.')
    expect(second.duplicate).toBe(false)
    expect(second.runId).toBe(first.runId)
    // One row for the key, reopened: never a second create under it.
    expect(h.creates).toBe(1)
    expect(h.rows.size).toBe(1)
    expect([...h.rows.values()][0].status).toBe('completed')
    expect(h.handler).toHaveBeenCalledTimes(2)
  })

  it('a run that threw can be run again', async () => {
    h.handler.mockRejectedValueOnce(new Error('boom')).mockResolvedValueOnce(chopped)
    await expect(run()).rejects.toThrow('boom')
    expect([...h.rows.values()][0].status).toBe('failed')
    expect((await run()).result.summary).toBe('Guilly: 1 chop(s) in week 3.')
    expect(h.creates).toBe(1)
  })

  it('[control] a completed run is answered from the log and not run a second time', async () => {
    h.handler.mockResolvedValueOnce(chopped)
    await run()
    const again = await run()
    expect(again.duplicate).toBe(true)
    expect(again.result.summary).toBe('Guilly: 1 chop(s) in week 3.')
    expect(h.handler).toHaveBeenCalledTimes(1)
  })

  it('[control] a run still in progress is reported as running, and not started twice', async () => {
    let release!: (v: unknown) => void
    h.handler.mockImplementationOnce(() => new Promise((r) => { release = r }))
    const inFlight = run()
    await vi.waitFor(() => expect(h.handler).toHaveBeenCalledTimes(1))
    const second = await run()
    expect(second).toMatchObject({ duplicate: true, result: { skipped: true, skipReason: 'already_running' } })
    expect(h.handler).toHaveBeenCalledTimes(1)
    release(chopped)
    await inFlight
  })

  it('a run left "running" by a crash long ago is reopened', async () => {
    h.handler.mockResolvedValueOnce(chopped)
    h.rows.set('L:2026:3:onManualRun:guillotine', { id: 'old', idempotencyKey: 'L:2026:3:onManualRun:guillotine', status: 'running', startedAt: new Date(Date.now() - 60 * 60 * 1000), summary: null, metadata: {} })
    const out = await run()
    expect(out).toMatchObject({ runId: 'old', duplicate: false })
    expect(h.creates).toBe(0)
  })
})
