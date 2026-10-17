import { expect, it } from 'vitest'
import { confirmStoredStrategy, readStrategy, recordStrategyObservation, strategyOwnerView, type StoredStrategy, type StrategyScope, type StrategyStorePort } from '@/lib/decision-os/value-v2/strategyStore'

const scope = { userId: 'owner', leagueId: 'league', season: 2026 }
function store() {
  const rows = new Map<string, StoredStrategy>()
  const events: Parameters<StrategyStorePort['commit']>[0][] = []
  const key = (s: StrategyScope) => JSON.stringify(s)
  const port: StrategyStorePort = {
    read: async s => structuredClone(rows.get(key(s)) ?? null),
    initialize: async s => {
      if (!rows.has(key(s))) rows.set(key(s), { ...s, id: key(s), active: 'balanced', revision: 0, pending: null, lastObservedWeek: null })
      return structuredClone(rows.get(key(s)))
    },
    commit: async input => {
      if (rows.get(key(input.scope))?.revision !== input.previous.revision) return false
      rows.set(key(input.scope), structuredClone(input.next))
      events.push(structuredClone(input))
      return true
    },
  }
  return { rows, events, port }
}
const observe = (week: number) => ({ week, evidenceId: `evidence:${week}`, strategy: 'rebuild' as const, materialChange: true })
async function proposed(port: StrategyStorePort) {
  for (const week of [1, 2, 3]) await recordStrategyObservation(scope, observe(week), port)
  return (await readStrategy(scope, port))!
}
it('persists a proposal across calls, leaves the active strategy unchanged and confirms explicitly', async () => {
  const { port, events } = store()
  expect(await readStrategy(scope, port)).toBeNull()
  const state = await proposed(port)
  expect(state.active).toBe('balanced')
  expect(state.revision).toBe(3)
  const result = await confirmStoredStrategy(scope, { expectedRevision: 3, strategy: 'rebuild', confirmed: true }, port)
  expect(result.active).toBe('rebuild')
  expect(result.revision).toBe(4)
  expect(result.pending).toBeNull()
  expect(events.map(e => e.action)).toEqual(['observe', 'observe', 'observe', 'confirm'])
})
it('allows only one simultaneous confirmation of the same revision', async () => {
  const { port, events } = store()
  await proposed(port)
  const input = { expectedRevision: 3, strategy: 'rebuild' as const, confirmed: true as const }
  const results = await Promise.allSettled([confirmStoredStrategy(scope, input, port), confirmStoredStrategy(scope, input, port)])
  expect(results.filter(r => r.status === 'fulfilled')).toHaveLength(1)
  expect(events.filter(e => e.action === 'confirm')).toHaveLength(1)
})
it('does not let old balanced observations clear newer pending evidence', async () => {
  const { port, events } = store()
  const state = await proposed(port)
  expect(await recordStrategyObservation(scope, { ...observe(1), strategy: 'balanced', materialChange: false }, port)).toEqual(state)
  expect(events).toHaveLength(3)
})
it('rejects replayed weeks and duplicate evidence without increasing revision', async () => {
  const { port } = store()
  const state = await proposed(port)
  expect(await recordStrategyObservation(scope, observe(3), port)).toEqual(state)
  expect(await recordStrategyObservation(scope, { ...observe(4), evidenceId: 'evidence:1' }, port)).toEqual(state)
})
it('prevents a stale proposal from being restored after confirmation', async () => {
  const { port } = store()
  await proposed(port)
  const confirmed = await confirmStoredStrategy(scope, { expectedRevision: 3, strategy: 'rebuild', confirmed: true }, port)
  expect(await recordStrategyObservation(scope, { ...observe(2), strategy: 'win-now' }, port)).toEqual(confirmed)
})
it('keeps different users, leagues and seasons separate and rejects a mismatched stored owner', async () => {
  const { port } = store()
  await proposed(port)
  for (const other of [{ ...scope, userId: 'another' }, { ...scope, leagueId: 'another' }, { ...scope, season: 2027 }]) {
    expect(await readStrategy(other, port)).toBeNull()
    await expect(confirmStoredStrategy(other, { expectedRevision: 3, strategy: 'rebuild', confirmed: true }, port)).rejects.toMatchObject({ code: 'NOT_READY' })
  }
  const state = await readStrategy(scope, port)
  await expect(readStrategy({ ...scope, userId: 'another' }, { ...port, read: async () => state })).rejects.toMatchObject({ code: 'INVALID_STATE' })
})
it('rejects missing explicit confirmation and proposals without consecutive weekly evidence', async () => {
  const { port } = store()
  await recordStrategyObservation(scope, observe(1), port)
  await recordStrategyObservation(scope, observe(4), port)
  await expect(confirmStoredStrategy(scope, { expectedRevision: 2, strategy: 'rebuild', confirmed: true }, port)).rejects.toMatchObject({ code: 'NOT_READY' })
  await expect(confirmStoredStrategy(scope, { expectedRevision: 2, strategy: 'rebuild', confirmed: false } as never, port)).rejects.toThrow()
})
it('refuses corrupted stored continuity instead of resetting or activating a fabricated proposal', async () => {
  const { port } = store()
  const state = await proposed(port)
  await expect(readStrategy(scope, { ...port, read: async () => ({ ...state, pending: { ...state.pending, observations: 8 } }) })).rejects.toMatchObject({ code: 'INVALID_STATE' })
})
it('omits raw storage and evidence identifiers from the owner-facing view', async () => {
  const { port } = store()
  const view = strategyOwnerView(await proposed(port))
  expect(view.pending?.readyToConfirm).toBe(true)
  expect(JSON.stringify(view)).not.toContain('evidence:')
  expect(view).not.toHaveProperty('userId')
  expect(view).not.toHaveProperty('id')
})
