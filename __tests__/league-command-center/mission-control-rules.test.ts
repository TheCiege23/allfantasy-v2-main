/**
 * Covers the League Mission Control rules — above all, the withheld-score gate.
 *
 * The failure mode these guard against is specific and was found by auditing the
 * engines behind the design, not invented:
 *
 * `resolveDecisionOsLeagueHealth` scores 22 inputs, of which only a handful are
 * ever derived from real behavioral data; the rest fall back to Zod schema
 * defaults. Those defaults are *flattering* — `lineupSubmissionRate: 1.0`,
 * `abandonedTeams: 0`, `disputeCount: 0` — so they alone push fairness toward
 * 100/100. Separately, the only writer for `DecisionOsImportedActivity` is a
 * manual non-prod script with no cron behind it, so in production an **imported**
 * league has no behavioral rows at all and every activity count arrives as zero.
 *
 * Composed, those two facts mean the most prominent tile on the page would
 * render a confident green "Healthy" for a league the product knows nothing
 * about — on precisely the kind of league (an imported Sleeper league) shown in
 * the design. These tests exist so that can never ship.
 */
import { describe, expect, it } from 'vitest'
import {
  buildAttentionTile,
  buildStatusTile,
  formatDuration,
  isSignalTrustworthy,
} from '@/lib/league-command-center/missionControlRules'
import type { MissionControlSnapshot } from '@/lib/decision-os/missionControl'

/**
 * `buildStatusTile` reads only `engine.overallStatus`, `engine.summary`,
 * `decisionOs.activityEventCount` and `fieldProvenance`. The fixture supplies
 * those and casts, rather than restating ~24 unrelated `LeagueHealthResult`
 * fields that no branch under test inspects.
 */
function snapshotWith(args: {
  activityEventCount: number
  overallStatus?: string
  summary?: string
  realFields?: number
  totalFields?: number
  recommendedActions?: number
}): MissionControlSnapshot {
  const total = args.totalFields ?? 22
  const real = args.realFields ?? 5
  const provenance: Record<string, 'decision_os' | 'schema_default'> = {}
  for (let i = 0; i < total; i += 1) {
    provenance[`field_${i}`] = i < real ? 'decision_os' : 'schema_default'
  }

  return {
    leagueId: 'league-1',
    generatedAt: '2026-07-19T00:00:00.000Z',
    leagueHealth: {
      available: true,
      result: {
        engine: {
          overallStatus: args.overallStatus ?? 'healthy',
          summary: args.summary ?? 'Good overall activity.',
        },
        decisionOs: { activityEventCount: args.activityEventCount },
        fieldProvenance: provenance,
      },
    },
    trend: { available: false, reason: 'no_snapshots' },
    managerCounts: { activeManagers: 0, inactiveManagers: 0 },
    activity: { tradeCount: 0, waiverClaimCount: 0, draftPickCount: 0, rosterActivityCount: 0 },
    managersAtRetentionRisk: [],
    recommendedActions: Array.from({ length: args.recommendedActions ?? 0 }, (_, i) => ({
      priority: 'standard' as const,
      message: `action ${i}`,
    })),
    fieldProvenance: provenance,
  } as unknown as MissionControlSnapshot
}

const IMPORTED = { isNative: false, label: 'Sleeper' }
const NATIVE = { isNative: true, label: 'AllFantasy' }

describe('isSignalTrustworthy', () => {
  it('trusts native leagues even at zero activity — the app writes those rows itself', () => {
    expect(isSignalTrustworthy(true, 0)).toBe(true)
  })

  it('does not trust an imported league with no recorded events', () => {
    expect(isSignalTrustworthy(false, 0)).toBe(false)
  })

  it('trusts an imported league once even one real event has been recorded', () => {
    expect(isSignalTrustworthy(false, 1)).toBe(true)
  })
})

describe('buildStatusTile — the withheld-score gate', () => {
  it('WITHHOLDS a score for an imported league with no recorded activity', () => {
    const tile = buildStatusTile({
      leagueId: 'league-1',
      source: IMPORTED,
      snapshot: snapshotWith({ activityEventCount: 0, overallStatus: 'healthy' }),
      entitledToHealth: true,
    })

    expect(tile.withheldReason).toBe('no_recorded_activity')
    expect(tile.value).toBe('Not enough signal')
    // The engine said "healthy". The tile must not repeat it, in any casing.
    expect(tile.value.toLowerCase()).not.toContain('healthy')
    expect(tile.tone).toBe('unknown')
    // No coverage badge, because there is no score to qualify.
    expect(tile.coverage).toBeNull()
    expect(tile.detail).toContain('Sleeper')
  })

  it('never renders a green tone for a withheld score', () => {
    for (const status of ['excellent', 'healthy', 'watch', 'at_risk', 'critical']) {
      const tile = buildStatusTile({
        leagueId: 'league-1',
        source: IMPORTED,
        snapshot: snapshotWith({ activityEventCount: 0, overallStatus: status }),
        entitledToHealth: true,
      })
      expect(tile.tone, `status ${status}`).toBe('unknown')
      expect(tile.withheldReason, `status ${status}`).toBe('no_recorded_activity')
    }
  })

  it('SHOWS the score for an imported league once activity has been recorded', () => {
    const tile = buildStatusTile({
      leagueId: 'league-1',
      source: IMPORTED,
      snapshot: snapshotWith({ activityEventCount: 12, overallStatus: 'healthy' }),
      entitledToHealth: true,
    })

    expect(tile.withheldReason).toBeNull()
    expect(tile.value).toBe('Healthy')
    expect(tile.tone).toBe('good')
  })

  it('SHOWS the score for a native league at zero activity', () => {
    const tile = buildStatusTile({
      leagueId: 'league-1',
      source: NATIVE,
      snapshot: snapshotWith({ activityEventCount: 0, overallStatus: 'watch' }),
      entitledToHealth: true,
    })

    expect(tile.withheldReason).toBeNull()
    expect(tile.value).toBe('Needs attention')
    expect(tile.tone).toBe('warn')
  })
})

describe('buildStatusTile — coverage always travels with a score', () => {
  it('reports how many scoring inputs were really measured', () => {
    const tile = buildStatusTile({
      leagueId: 'league-1',
      source: NATIVE,
      snapshot: snapshotWith({ activityEventCount: 3, realFields: 5, totalFields: 22 }),
      entitledToHealth: true,
    })

    expect(tile.coverage).toEqual({ real: 5, total: 22 })
  })

  it('attaches coverage to every displayed score, never omitting it', () => {
    for (const status of ['excellent', 'healthy', 'watch', 'at_risk', 'critical']) {
      const tile = buildStatusTile({
        leagueId: 'league-1',
        source: NATIVE,
        snapshot: snapshotWith({ activityEventCount: 4, overallStatus: status }),
        entitledToHealth: true,
      })
      expect(tile.coverage, `status ${status}`).not.toBeNull()
    }
  })
})

describe('buildStatusTile — entitlement and failure states', () => {
  it('locks the tile without leaking the health summary to an unentitled viewer', () => {
    const secret = 'CONFIDENTIAL-LEAGUE-SUMMARY'
    const tile = buildStatusTile({
      leagueId: 'league-1',
      source: NATIVE,
      snapshot: snapshotWith({ activityEventCount: 9, summary: secret }),
      entitledToHealth: false,
    })

    expect(tile.withheldReason).toBe('not_entitled')
    expect(tile.value).toBe('Locked')
    expect(tile.detail).not.toContain(secret)
    expect(tile.coverage).toBeNull()
  })

  it('renders an em dash — not a zero — when health could not be calculated', () => {
    const tile = buildStatusTile({
      leagueId: 'league-1',
      source: NATIVE,
      snapshot: null,
      entitledToHealth: true,
    })

    expect(tile.value).toBe('—')
    expect(tile.value).not.toBe('0')
    expect(tile.withheldReason).toBe('health_unavailable')
  })
})

describe('buildAttentionTile — unresolved is not the same as all clear', () => {
  it('withholds rather than claiming "All clear" when the resolve failed', () => {
    const tile = buildAttentionTile({
      leagueId: 'league-1',
      managerActionCount: null,
      commissionerActionCount: 0,
    })

    expect(tile.withheldReason).toBe('attention_unavailable')
    expect(tile.value).toBe('—')
    expect(tile.value).not.toBe('All clear')
    expect(tile.tone).toBe('unknown')
  })

  it('says "All clear" only when a real zero was actually observed', () => {
    const tile = buildAttentionTile({
      leagueId: 'league-1',
      managerActionCount: 0,
      commissionerActionCount: 0,
    })

    expect(tile.value).toBe('All clear')
    expect(tile.withheldReason).toBeNull()
    expect(tile.tone).toBe('good')
  })

  it('adds commissioner actions to manager actions rather than replacing them', () => {
    const tile = buildAttentionTile({
      leagueId: 'league-1',
      managerActionCount: 3,
      commissionerActionCount: 1,
    })

    expect(tile.value).toBe('4')
    expect(tile.detail).toContain('3 manager actions')
    expect(tile.detail).toContain('1 commissioner action')
  })

  it('singularizes a single action', () => {
    const tile = buildAttentionTile({
      leagueId: 'league-1',
      managerActionCount: 1,
      commissionerActionCount: 0,
    })
    expect(tile.detail).toBe('1 manager action')
  })
})

describe('mission control tiles — commissioner deep-links', () => {
  it('routes the Attention Required tile to the dedicated Attention Queue for commissioners', () => {
    const tile = buildAttentionTile({
      leagueId: 'league-1',
      managerActionCount: 2,
      commissionerActionCount: 1,
      isCommissioner: true,
    })
    expect(tile.href).toBe('/league/league-1/command-center?section=attention')
  })

  it('routes the Attention Required tile to Overview for a plain manager', () => {
    const tile = buildAttentionTile({
      leagueId: 'league-1',
      managerActionCount: 2,
      commissionerActionCount: 0,
      isCommissioner: false,
    })
    expect(tile.href).toBe('/league/league-1/command-center?section=overview')
  })

  it('routes the League Status tile to League Health for commissioners', () => {
    const tile = buildStatusTile({
      leagueId: 'league-1',
      source: NATIVE,
      snapshot: snapshotWith({ activityEventCount: 5 }),
      entitledToHealth: true,
      isCommissioner: true,
    })
    expect(tile.href).toBe('/league/league-1/command-center?section=health')
  })
})

describe('formatDuration', () => {
  it('never rounds up into a unit that hides urgency', () => {
    // 59 minutes must not present as "1h".
    expect(formatDuration(59 * 60_000)).toBe('59m')
    // 23h59m must not present as "1d".
    expect(formatDuration((23 * 60 + 59) * 60_000)).toBe('23h 59m')
  })

  it('formats the shapes the strip actually renders', () => {
    expect(formatDuration(6 * 3_600_000 + 42 * 60_000)).toBe('6h 42m')
    expect(formatDuration(2 * 86_400_000 + 4 * 3_600_000)).toBe('2d 4h')
    expect(formatDuration(12 * 60_000)).toBe('12m')
  })

  it('clamps a past timestamp to zero rather than emitting a negative duration', () => {
    expect(formatDuration(-5_000)).toBe('0m')
  })
})
