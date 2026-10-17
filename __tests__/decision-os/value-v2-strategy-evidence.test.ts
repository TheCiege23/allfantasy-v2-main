import { expect, it, vi } from 'vitest'
import { refreshStrategyFromEvidence, strategyObservationFromFacts, type StrategyEvidenceFacts } from '@/lib/decision-os/value-v2/strategyEvidence'
import { confirmStoredStrategy, type StoredStrategy, type StrategyStorePort } from '@/lib/decision-os/value-v2/strategyStore'
import { strategyPrompt } from '@/lib/decision-os/value-v2/strategyPrompt'

const scope = { userId: 'owner', leagueId: 'league', season: 2026 }
const now = new Date('2026-10-15T12:00:00Z')
function facts(week = 3): StrategyEvidenceFacts {
  return { ...scope, sport: 'NFL', isDynasty: true, teamCount: 2, ownerTeamId: 'a', teamIds: ['a', 'b'],
    currentPeriod: week + 1, periodSource: 'sleeper_state_nfl', loadedAt: now.toISOString(), lastSyncedAt: now.toISOString(),
    results: Array.from({ length: week }, (_, i) => ['a', 'b'].map(teamId => ({
      id: `${teamId}:${i + 1}`, teamId, season: 2026, week: i + 1, points: teamId === 'a' ? 80 : 120, result: teamId === 'a' ? 'L' : 'W',
    }))).flat() }
}
function memoryStore() {
  let row: StoredStrategy | null = null
  const commit = vi.fn(async (input: Parameters<StrategyStorePort['commit']>[0]) => {
    if (row?.revision !== input.previous.revision) return false
    row = structuredClone(input.next); return true
  })
  const port: StrategyStorePort = { read: async () => structuredClone(row),
    initialize: async () => row ??= { ...scope, id: 's', active: 'balanced', revision: 0, pending: null, lastObservedWeek: null }, commit }
  return { port, commit }
}
it('requires three separately observed completed weeks, then explicit owner confirmation', async () => {
  const { port, commit } = memoryStore()
  let current = await refreshStrategyFromEvidence(scope, { load: async () => facts(3) }, port, now)
  expect(current.state?.pending?.observations).toBe(1)
  expect(current.canConfirm).toBe(false)
  for (let visit = 0; visit < 4; visit++) await refreshStrategyFromEvidence(scope, { load: async () => facts(3) }, port, now)
  expect(commit).toHaveBeenCalledTimes(1)
  for (const week of [4, 5]) current = await refreshStrategyFromEvidence(scope, { load: async () => facts(week) }, port, now)
  expect(current.state?.active).toBe('balanced')
  expect(current.canConfirm).toBe(true)
  expect(strategyPrompt(current.state)).toContain('owner has NOT confirmed')
  const saved = await confirmStoredStrategy(scope, { expectedRevision: current.state!.revision, strategy: 'rebuild', confirmed: true }, port)
  expect(saved.active).toBe('rebuild')
  expect(strategyPrompt(saved)).toContain('Active preference: rebuild')
  expect(strategyPrompt(saved)).not.toContain('results-v1')
})
it('does not replay historical weeks on first visit and resets continuity after a missed week', async () => {
  const { port } = memoryStore()
  await refreshStrategyFromEvidence(scope, { load: async () => facts(3) }, port, now)
  const next = await refreshStrategyFromEvidence(scope, { load: async () => facts(5) }, port, now)
  expect(next.state?.pending?.observations).toBe(1)
  expect(next.canConfirm).toBe(false)
})
it('withdraws confirmation when a same-week result correction invalidates the evidence', async () => {
  const { port } = memoryStore()
  for (const week of [3, 4, 5]) await refreshStrategyFromEvidence(scope, { load: async () => facts(week) }, port, now)
  const corrected = facts(5); corrected.results[0].points += 1
  const result = await refreshStrategyFromEvidence(scope, { load: async () => corrected }, port, now)
  expect(result.canConfirm).toBe(false)
  expect(result.state?.revision).toBe(3)
  const nextWeek = facts(6); nextWeek.results[0].points += 1
  const restarted = await refreshStrategyFromEvidence(scope, { load: async () => nextWeek }, port, now)
  expect(restarted.state?.pending?.observations).toBe(1)
  expect(restarted.canConfirm).toBe(false)
})
it.each([
  ['wrong owner', (f: StrategyEvidenceFacts) => { f.userId = 'other' }],
  ['wrong season', (f: StrategyEvidenceFacts) => { f.season = 2025 }],
  ['calendar fallback', (f: StrategyEvidenceFacts) => { f.periodSource = 'league_season_default' }],
  ['stale sync', (f: StrategyEvidenceFacts) => { f.lastSyncedAt = '2026-10-01T00:00:00Z' }],
  ['future sync', (f: StrategyEvidenceFacts) => { f.lastSyncedAt = '2027-01-01T00:00:00Z' }],
  ['incomplete league', (f: StrategyEvidenceFacts) => { f.teamCount = 3 }],
  ['unclaimed team', (f: StrategyEvidenceFacts) => { f.ownerTeamId = null }],
  ['missing result', (f: StrategyEvidenceFacts) => { f.results.pop() }],
  ['duplicate result', (f: StrategyEvidenceFacts) => { f.results.push(f.results[0]) }],
  ['unfinished result', (f: StrategyEvidenceFacts) => { f.results[0].result = null }],
  ['current week', (f: StrategyEvidenceFacts) => { f.results[0].week = f.currentPeriod }],
  ['non-finite score', (f: StrategyEvidenceFacts) => { f.results[0].points = Infinity }],
] as const)('refuses %s without writing strategy', async (_name, mutate) => {
  const input = facts(); mutate(input)
  const { port, commit } = memoryStore()
  const result = await refreshStrategyFromEvidence(scope, { load: async () => input }, port, now)
  expect(result.gaps.length).toBeGreaterThan(0)
  expect(result.state).toBeNull()
  expect(commit).not.toHaveBeenCalled()
})
it('does not propose a dynasty rebuild in redraft or break an exact tie arbitrarily', () => {
  const redraft = facts(); redraft.isDynasty = false
  expect(strategyObservationFromFacts(scope, redraft, now).observation?.strategy).toBe('balanced')
  const tied = facts(); tied.results.forEach(r => { r.result = 'T'; r.points = 100 })
  expect(strategyObservationFromFacts(scope, tied, now).observation?.strategy).toBe('balanced')
})
it('keeps evidence stable across database ordering and captures time after the evidence load', async () => {
  const input = facts(), reversed = facts(); reversed.results.reverse()
  expect(strategyObservationFromFacts(scope, input, now)).toEqual(strategyObservationFromFacts(scope, reversed, now))
  const { port } = memoryStore()
  const result = await refreshStrategyFromEvidence(scope, { load: async () => {
    await new Promise(resolve => setTimeout(resolve, 5))
    return { ...facts(), loadedAt: new Date().toISOString(), lastSyncedAt: new Date().toISOString() }
  } }, port)
  expect(result.gaps).toEqual([])
})
