import { describe, expect, it } from 'vitest'
import { buildSleeperImportStatusReport } from '@/lib/league-import/sleeper/SleeperImportStatusReport'
import type { NormalizedImportResult } from '@/lib/league-import/types'

function baseNormalized(overrides: Partial<NormalizedImportResult> = {}): NormalizedImportResult {
  return {
    source: {
      source_provider: 'sleeper',
      source_league_id: 'league-1',
      import_batch_id: 'batch-1',
      imported_at: '2026-07-01T00:00:00.000Z',
    },
    league: {
      name: 'Test League',
      sport: 'NFL',
      season: 2026,
      leagueSize: 10,
      rosterSize: null,
      scoring: null,
      isDynasty: false,
    } as NormalizedImportResult['league'],
    rosters: [],
    scoring: null,
    schedule: [],
    draft_picks: [],
    transactions: [],
    standings: [],
    player_map: {},
    coverage: {
      leagueSettings: { state: 'full' },
      currentRosters: { state: 'full' },
      historicalRosterSnapshots: { state: 'missing' },
      scoringSettings: { state: 'full' },
      playoffSettings: { state: 'full' },
      currentStandings: { state: 'full' },
      currentSchedule: { state: 'full' },
      draftHistory: { state: 'full' },
      tradeHistory: { state: 'full' },
      previousSeasons: { state: 'missing' },
      playerIdentityMap: { state: 'full' },
    },
    ...overrides,
  }
}

describe('buildSleeperImportStatusReport', () => {
  it('reports imported for every fully-covered field with no failures', () => {
    const report = buildSleeperImportStatusReport(baseNormalized(), { now: new Date('2026-07-01T01:00:00.000Z') })

    expect(report.hasFailures).toBe(false)
    expect(report.isStale).toBe(false)
    const rosters = report.fields.find((f) => f.field === 'currentRosters')
    expect(rosters?.status).toBe('imported')
  })

  it('reports skipped for coverage deferred to post-import backfill', () => {
    const report = buildSleeperImportStatusReport(baseNormalized())
    const historical = report.fields.find((f) => f.field === 'historicalRosterSnapshots')
    expect(historical?.status).toBe('skipped')
  })

  it('reports failed for a field with a matching fetch warning, overriding coverage state', () => {
    const normalized = baseNormalized({
      fetch_warnings: [
        { code: 'sleeper_fetch_incomplete_transactions', message: 'boom', severity: 'warn', metadata: { field: 'transactions' } },
      ],
    })

    const report = buildSleeperImportStatusReport(normalized)

    expect(report.hasFailures).toBe(true)
    const trades = report.fields.find((f) => f.field === 'tradeHistory')
    expect(trades?.status).toBe('failed')
  })

  it('always reports playoffBracketResults as unsupported', () => {
    const report = buildSleeperImportStatusReport(baseNormalized())
    const playoffResults = report.fields.find((f) => f.field === 'playoffBracketResults')
    expect(playoffResults?.status).toBe('unsupported')
  })

  it('upgrades imported/partial fields to stale once past the freshness threshold', () => {
    const normalized = baseNormalized({
      source: {
        source_provider: 'sleeper',
        source_league_id: 'league-1',
        import_batch_id: 'batch-1',
        imported_at: '2026-07-01T00:00:00.000Z',
      },
    })

    const report = buildSleeperImportStatusReport(normalized, {
      now: new Date('2026-07-03T00:00:00.000Z'), // 2 days later, past the 24h default
    })

    expect(report.isStale).toBe(true)
    const rosters = report.fields.find((f) => f.field === 'currentRosters')
    expect(rosters?.status).toBe('stale')
    // A field that was already 'skipped' should not be reported as stale — it was never imported.
    const historical = report.fields.find((f) => f.field === 'historicalRosterSnapshots')
    expect(historical?.status).toBe('skipped')
  })
})
