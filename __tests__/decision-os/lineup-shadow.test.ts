import { describe, it, expect, vi, afterEach } from 'vitest'
import { runLineupShadow, runLineupShadowForSummary, shouldRunLineupShadow } from '@/lib/decision-os/lineup/shadow'
import { registerDecisionTelemetrySink } from '@/lib/decision-os/core/telemetry'
import type { RunLineupSetInput } from '@/lib/decision-os/lineup'
import { fakeValidate, payload, action } from './lineupFakes'

const input = (leagueId = 'L1'): RunLineupSetInput => ({
  sport: 'NFL',
  leagueSettings: {},
  leagueWeek: 1,
  editingWeek: 1,
  userId: 'u1',
  leagueId,
  rosterId: 'r1',
  players: [],
})

afterEach(() => registerDecisionTelemetrySink(null))

describe('shouldRunLineupShadow (feature flag)', () => {
  it('true only when DECISION_OS_LINEUP_SHADOW=true', () => {
    expect(shouldRunLineupShadow({ DECISION_OS_LINEUP_SHADOW: 'true' } as never)).toBe(true)
    expect(shouldRunLineupShadow({ DECISION_OS_LINEUP_SHADOW: 'TRUE' } as never)).toBe(true)
    expect(shouldRunLineupShadow({ DECISION_OS_LINEUP_SHADOW: 'false' } as never)).toBe(false)
    expect(shouldRunLineupShadow({} as never)).toBe(false)
  })
})

describe('runLineupShadow — beside legacy, never affecting it', () => {
  it('runs and reports parity PASS (decision fed the same legacy summary = no drift)', async () => {
    const summary = payload('L1', [action('L1')])
    const res = await runLineupShadow(
      { userId: 'u1', leagueId: 'L1', legacySummary: summary },
      { loadInputs: async () => input('L1'), ruleDeps: { validateRedraft: fakeValidate() } },
    )
    expect(res.ran).toBe(true)
    expect(res.parity?.passed).toBe(true)
  })

  it('skips gracefully when inputs are unavailable (non-redraft / missing data)', async () => {
    const res = await runLineupShadow(
      { userId: 'u1', leagueId: 'L1', legacySummary: payload('L1') },
      { loadInputs: async () => null, ruleDeps: { validateRedraft: fakeValidate() } },
    )
    expect(res.ran).toBe(false)
    expect(res.error).toBe('inputs_unavailable')
  })

  it('NEVER throws when the loader throws', async () => {
    const res = await runLineupShadow(
      { userId: 'u1', leagueId: 'L1', legacySummary: payload('L1') },
      { loadInputs: async () => { throw new Error('db down') }, ruleDeps: { validateRedraft: fakeValidate() } },
    )
    expect(res.ran).toBe(false)
    expect(res.error).toBeTruthy()
  })

  it('NEVER throws when the Decision OS path throws (legacy stays safe)', async () => {
    const res = await runLineupShadow(
      { userId: 'u1', leagueId: 'L1', legacySummary: payload('L1') },
      { loadInputs: async () => input('L1'), ruleDeps: { validateRedraft: () => { throw new Error('rule boom') } } },
    )
    expect(res.ran).toBe(false)
  })

  it('emits shadow parity telemetry', async () => {
    const events: unknown[] = []
    registerDecisionTelemetrySink((e) => events.push(e))
    await runLineupShadow(
      { userId: 'u1', leagueId: 'L1', legacySummary: payload('L1', [action('L1')]) },
      { loadInputs: async () => input('L1'), ruleDeps: { validateRedraft: fakeValidate() } },
    )
    expect(events.some((e) => (e as { event: string }).event === 'decision.shadow_parity')).toBe(true)
  })
})

describe('runLineupShadow — input source provenance (redraft_native vs canonical_world)', () => {
  it('tags source redraft_native and does NOT consult the canonical fallback when native resolves', async () => {
    const loadCanonicalInputs = vi.fn(async () => ({ input: null, source: 'canonical_world_unavailable' as const, warnings: [] }))
    const res = await runLineupShadow(
      { userId: 'u1', leagueId: 'L1', legacySummary: payload('L1', [action('L1')]) },
      { loadInputs: async () => input('L1'), loadCanonicalInputs, ruleDeps: { validateRedraft: fakeValidate() } },
    )
    expect(res.ran).toBe(true)
    expect(res.source).toBe('redraft_native')
    expect(loadCanonicalInputs).not.toHaveBeenCalled() // native won — fallback never runs
  })

  it('falls back to canonical_world when native is unavailable (imported league)', async () => {
    const loadCanonicalInputs = vi.fn(async () => ({
      input: input('L1'),
      source: 'canonical_world' as const,
      warnings: ['player_metadata_missing'],
    }))
    const res = await runLineupShadow(
      { userId: 'u1', leagueId: 'L1', legacySummary: payload('L1', [action('L1')]) },
      { loadInputs: async () => null, loadCanonicalInputs, ruleDeps: { validateRedraft: fakeValidate() } },
    )
    expect(res.ran).toBe(true)
    expect(res.source).toBe('canonical_world')
    expect(res.warnings).toContain('player_metadata_missing')
    expect(res.parity?.passed).toBe(true)
  })

  it('reports canonical_world_unavailable + inputs_unavailable when both paths miss', async () => {
    const res = await runLineupShadow(
      { userId: 'u1', leagueId: 'L1', legacySummary: payload('L1') },
      {
        loadInputs: async () => null,
        loadCanonicalInputs: async () => ({ input: null, source: 'canonical_world_unavailable', warnings: ['canonical_world_unavailable'] }),
        ruleDeps: { validateRedraft: fakeValidate() },
      },
    )
    expect(res.ran).toBe(false)
    expect(res.error).toBe('inputs_unavailable')
    expect(res.source).toBe('canonical_world_unavailable')
  })

  it('records the input source in shadow_parity telemetry (provenance/debug only)', async () => {
    const events: unknown[] = []
    registerDecisionTelemetrySink((e) => events.push(e))
    await runLineupShadow(
      { userId: 'u1', leagueId: 'L1', legacySummary: payload('L1', [action('L1')]) },
      {
        loadInputs: async () => null,
        loadCanonicalInputs: async () => ({ input: input('L1'), source: 'canonical_world', warnings: ['player_metadata_missing'] }),
        ruleDeps: { validateRedraft: fakeValidate() },
      },
    )
    const ran = events.find(
      (e) => (e as { event: string; flags?: { ran?: boolean } }).event === 'decision.shadow_parity' && (e as { flags?: { ran?: boolean } }).flags?.ran === true,
    ) as { flags?: { source?: string } } | undefined
    expect(ran?.flags?.source).toBe('canonical_world')
  })
})

describe('runLineupShadowForSummary — cost-bounded, resilient', () => {
  it('caps the number of leagues shadowed and never throws', async () => {
    const loadInputs = vi.fn(async (_u: string, l: string) => input(l))
    const summary = payload('L1', [action('L1')])
    const results = await runLineupShadowForSummary('u1', summary, { maxLeagues: 1 }, { loadInputs, ruleDeps: { validateRedraft: fakeValidate() } })
    expect(results).toHaveLength(1)
    expect(results[0].ran).toBe(true)
  })
})
