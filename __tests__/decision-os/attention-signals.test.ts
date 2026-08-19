/**
 * Fantasy OS Suite — Phase OS-B2: Decision OS Attention Queue.
 *
 * `deriveLeagueAttentionSignals`/`sortAttentionSignals` are pure, zero-I/O functions — no Prisma or
 * Decision OS resolver mocking needed. Covers every signal type's own real-data gate (never fires on
 * absent data), the severity/ordering contract, and id determinism.
 */
import { describe, expect, it } from 'vitest'
import {
  SEVERITY_RANK,
  deriveLeagueAttentionSignals,
  sortAttentionSignals,
  type LeagueAttentionSignalInputs,
} from '@/lib/decision-os/attentionSignals'

const NOW = new Date('2026-07-09T12:00:00Z')

function baseInput(o: Partial<LeagueAttentionSignalInputs> = {}): LeagueAttentionSignalInputs {
  return {
    leagueId: 'L1',
    now: NOW,
    overallStatus: 'healthy',
    leagueHealthScore: 70,
    recommendedActions: [],
    financialStatus: 'FREE',
    draftDateUtc: null,
    ...o,
  }
}

function daysFromNow(days: number): Date {
  return new Date(NOW.getTime() + days * 24 * 60 * 60 * 1000)
}

describe('deriveLeagueAttentionSignals — draft_approaching', () => {
  it('never fires when there is no draft date', () => {
    const signals = deriveLeagueAttentionSignals(baseInput({ draftDateUtc: null }))
    expect(signals.find((s) => s.type === 'draft_approaching')).toBeUndefined()
  })

  it('never fires for a draft date in the past', () => {
    const signals = deriveLeagueAttentionSignals(baseInput({ draftDateUtc: daysFromNow(-1) }))
    expect(signals.find((s) => s.type === 'draft_approaching')).toBeUndefined()
  })

  it('never fires for a draft more than 14 days out', () => {
    const signals = deriveLeagueAttentionSignals(baseInput({ draftDateUtc: daysFromNow(15) }))
    expect(signals.find((s) => s.type === 'draft_approaching')).toBeUndefined()
  })

  it('fires with high severity within 3 days', () => {
    const signals = deriveLeagueAttentionSignals(baseInput({ draftDateUtc: daysFromNow(2) }))
    const signal = signals.find((s) => s.type === 'draft_approaching')
    expect(signal?.severity).toBe('high')
    expect(signal?.title).toBe('Draft in 2 days')
    expect(signal?.timestamp).toBe(daysFromNow(2).toISOString())
    expect(signal?.source).toBe('league_settings_draft_date')
  })

  it('fires with medium severity between 4 and 7 days', () => {
    const signals = deriveLeagueAttentionSignals(baseInput({ draftDateUtc: daysFromNow(6) }))
    expect(signals.find((s) => s.type === 'draft_approaching')?.severity).toBe('medium')
  })

  it('fires with low severity between 8 and 14 days', () => {
    const signals = deriveLeagueAttentionSignals(baseInput({ draftDateUtc: daysFromNow(10) }))
    expect(signals.find((s) => s.type === 'draft_approaching')?.severity).toBe('low')
  })

  it('uses "today"/"tomorrow" phrasing at the boundary, never a fabricated day count', () => {
    const today = deriveLeagueAttentionSignals(baseInput({ draftDateUtc: NOW })).find(
      (s) => s.type === 'draft_approaching',
    )
    expect(today?.title).toBe('Draft is today')
    const tomorrow = deriveLeagueAttentionSignals(baseInput({ draftDateUtc: daysFromNow(1) })).find(
      (s) => s.type === 'draft_approaching',
    )
    expect(tomorrow?.title).toBe('Draft is tomorrow')
  })

  it('id is stable and deterministic for the same league', () => {
    const signal = deriveLeagueAttentionSignals(baseInput({ leagueId: 'L9', draftDateUtc: daysFromNow(2) })).find(
      (s) => s.type === 'draft_approaching',
    )
    expect(signal?.id).toBe('draft_approaching:L9')
  })
})

describe('deriveLeagueAttentionSignals — league_context_incomplete', () => {
  it('fires only when financial status is UNKNOWN', () => {
    const signals = deriveLeagueAttentionSignals(baseInput({ financialStatus: 'UNKNOWN' }))
    const signal = signals.find((s) => s.type === 'league_context_incomplete')
    expect(signal).toBeDefined()
    expect(signal?.severity).toBe('low')
    expect(signal?.source).toBe('league_context')
  })

  it.each(['FREE', 'PAID', 'VERIFIED_PAID'] as const)('never fires when financial status is %s', (status) => {
    const signals = deriveLeagueAttentionSignals(baseInput({ financialStatus: status }))
    expect(signals.find((s) => s.type === 'league_context_incomplete')).toBeUndefined()
  })
})

describe('deriveLeagueAttentionSignals — low_league_health / high_league_health', () => {
  it('never fires low_league_health for a healthy or excellent league', () => {
    for (const overallStatus of ['excellent', 'healthy']) {
      const signals = deriveLeagueAttentionSignals(baseInput({ overallStatus }))
      expect(signals.find((s) => s.type === 'low_league_health')).toBeUndefined()
    }
  })

  it.each([
    ['watch', 'medium'],
    ['at_risk', 'high'],
    ['critical', 'critical'],
  ] as const)('fires low_league_health with %s -> %s severity', (overallStatus, severity) => {
    const signals = deriveLeagueAttentionSignals(baseInput({ overallStatus, leagueHealthScore: 42 }))
    const signal = signals.find((s) => s.type === 'low_league_health')
    expect(signal?.severity).toBe(severity)
    expect(signal?.explanation).toContain('42')
    // Phase OS-B6: explanation text uses plain-English status (underscores replaced with spaces) —
    // never raw technical enum jargon shown directly to a commissioner.
    expect(signal?.explanation).toContain(overallStatus.replace(/_/g, ' '))
    expect(signal?.explanation).not.toContain('_')
  })

  it('never fires low_league_health when overallStatus is null (league health unavailable)', () => {
    const signals = deriveLeagueAttentionSignals(baseInput({ overallStatus: null, leagueHealthScore: null }))
    expect(signals.find((s) => s.type === 'low_league_health')).toBeUndefined()
  })

  it('fires high_league_health (informational) only for excellent, never for merely healthy', () => {
    const excellent = deriveLeagueAttentionSignals(baseInput({ overallStatus: 'excellent' }))
    const signal = excellent.find((s) => s.type === 'high_league_health')
    expect(signal?.severity).toBe('informational')
    expect(signal?.recommendedAction).toBeNull()

    const healthy = deriveLeagueAttentionSignals(baseInput({ overallStatus: 'healthy' }))
    expect(healthy.find((s) => s.type === 'high_league_health')).toBeUndefined()
  })

  it('omits the health score from the explanation honestly when it is not a real number', () => {
    const signals = deriveLeagueAttentionSignals(
      baseInput({ overallStatus: 'critical', leagueHealthScore: null }),
    )
    const signal = signals.find((s) => s.type === 'low_league_health')
    expect(signal?.explanation).not.toContain('health score')
  })
})

describe('deriveLeagueAttentionSignals — league_requires_review', () => {
  it('produces zero signals for an empty recommendedActions list', () => {
    const signals = deriveLeagueAttentionSignals(baseInput({ recommendedActions: [] }))
    expect(signals.filter((s) => s.type === 'league_requires_review')).toEqual([])
  })

  it('maps urgent -> high severity and standard -> medium severity, one signal per action, unique ids', () => {
    const signals = deriveLeagueAttentionSignals(
      baseInput({
        recommendedActions: [
          { priority: 'urgent', message: 'Urgent one' },
          { priority: 'standard', message: 'Standard one' },
        ],
      }),
    )
    const review = signals.filter((s) => s.type === 'league_requires_review')
    expect(review).toHaveLength(2)
    expect(review[0]).toMatchObject({ severity: 'high', explanation: 'Urgent one', id: 'league_requires_review:L1:0' })
    expect(review[1]).toMatchObject({
      severity: 'medium',
      explanation: 'Standard one',
      id: 'league_requires_review:L1:1',
    })
    expect(new Set(review.map((s) => s.id)).size).toBe(2)
  })
})

describe('deriveLeagueAttentionSignals — no fabrication for a healthy, confirmed, no-draft league', () => {
  it('produces zero signals when nothing actually needs attention', () => {
    const signals = deriveLeagueAttentionSignals(
      baseInput({ overallStatus: 'healthy', financialStatus: 'FREE', draftDateUtc: null, recommendedActions: [] }),
    )
    expect(signals).toEqual([])
  })
})

describe('deriveLeagueAttentionSignals — provider-agnostic, id-only', () => {
  it('never includes a league display name or provider-specific field on any signal', () => {
    const signals = deriveLeagueAttentionSignals(
      baseInput({
        overallStatus: 'critical',
        financialStatus: 'UNKNOWN',
        draftDateUtc: daysFromNow(1),
        recommendedActions: [{ priority: 'urgent', message: 'x' }],
      }),
    )
    expect(signals.length).toBeGreaterThan(0)
    for (const signal of signals) {
      expect(Object.keys(signal)).not.toContain('leagueName')
      expect(Object.keys(signal)).not.toContain('provider')
      expect(signal.leagueId).toBe('L1')
    }
  })
})

describe('sortAttentionSignals', () => {
  it('orders strictly by severity: critical > high > medium > low > informational', () => {
    const input = baseInput()
    const signals = [
      { ...deriveLeagueAttentionSignals(input)[0], id: 'a', severity: 'low' as const, priorityScore: SEVERITY_RANK.low, timestamp: NOW.toISOString() },
      { ...deriveLeagueAttentionSignals(input)[0], id: 'b', severity: 'critical' as const, priorityScore: SEVERITY_RANK.critical, timestamp: NOW.toISOString() },
      { ...deriveLeagueAttentionSignals(input)[0], id: 'c', severity: 'informational' as const, priorityScore: SEVERITY_RANK.informational, timestamp: NOW.toISOString() },
      { ...deriveLeagueAttentionSignals(input)[0], id: 'd', severity: 'medium' as const, priorityScore: SEVERITY_RANK.medium, timestamp: NOW.toISOString() },
      { ...deriveLeagueAttentionSignals(input)[0], id: 'e', severity: 'high' as const, priorityScore: SEVERITY_RANK.high, timestamp: NOW.toISOString() },
    ]
    const sorted = sortAttentionSignals(signals as never)
    expect(sorted.map((s) => s.id)).toEqual(['b', 'e', 'd', 'a', 'c'])
  })

  it('within the same severity, orders newest timestamp first', () => {
    const older = deriveLeagueAttentionSignals(baseInput({ leagueId: 'L1', overallStatus: 'critical' }))[0]
    const newer = { ...older, id: 'newer', timestamp: new Date(NOW.getTime() + 1000).toISOString() }
    const sorted = sortAttentionSignals([older, newer])
    expect(sorted[0].id).toBe('newer')
  })

  it('is stable (never random) for exact ties on severity and timestamp', () => {
    const input = baseInput({ overallStatus: 'critical' })
    const a = { ...deriveLeagueAttentionSignals(input)[0], id: 'first' }
    const b = { ...deriveLeagueAttentionSignals(input)[0], id: 'second' }
    const sorted = sortAttentionSignals([a, b])
    expect(sorted.map((s) => s.id)).toEqual(['first', 'second'])
    // Re-running with the same input never reorders differently.
    const sortedAgain = sortAttentionSignals([a, b])
    expect(sortedAgain.map((s) => s.id)).toEqual(sorted.map((s) => s.id))
  })

  it('does not mutate the input array', () => {
    const signals = [
      { ...deriveLeagueAttentionSignals(baseInput())[0] || ({} as never), id: 'x', severity: 'low' as const, priorityScore: SEVERITY_RANK.low, timestamp: NOW.toISOString() },
    ]
    const original = [...signals]
    sortAttentionSignals(signals as never)
    expect(signals).toEqual(original)
  })
})

describe('deriveLeagueAttentionSignals — multi-signal aggregation for one league', () => {
  it('a league that is critical, financially unconfirmed, and drafting soon produces 3 distinct, correctly-severity-ranked signals', () => {
    const signals = deriveLeagueAttentionSignals(
      baseInput({
        overallStatus: 'critical',
        leagueHealthScore: 12,
        financialStatus: 'UNKNOWN',
        draftDateUtc: daysFromNow(1),
      }),
    )
    const types = signals.map((s) => s.type).sort()
    expect(types).toEqual(['draft_approaching', 'league_context_incomplete', 'low_league_health'])
    expect(new Set(signals.map((s) => s.id)).size).toBe(signals.length)

    const sorted = sortAttentionSignals(signals)
    expect(sorted[0].type).toBe('low_league_health')
    expect(sorted[0].severity).toBe('critical')
  })
})
