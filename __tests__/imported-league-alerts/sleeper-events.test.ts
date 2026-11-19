// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { deriveSleeperAlerts } from '@/lib/imported-league-alerts/sleeperEvents'
import { makeSleeperNormalized } from '../fantasy-os/fixtures/sleeperNormalizedFixture'

const before = new Date('2026-11-17T18:00:00Z')
const after = new Date('2026-11-17T18:10:00Z')
function fixture() {
  const n = makeSleeperNormalized({ season: 2026 })
  n.league.current_week = 1
  n.league.roster_positions = ['QB', 'RB', 'BN']
  n.drafts = [{ source_draft_id: 'd1', status: 'pre_draft' }]
  n.draft_picks = []
  n.transactions = []
  n.player_map = { p3: { name: 'New Starter', position: 'WR', team: 'BUF' } }
  return n
}

function baseline() { return deriveSleeperAlerts(fixture(), null, '1', before).snapshot }

describe('Sleeper imported event detection', () => {
  it('baselines the first import without replaying scores, trades or picks', () => {
    const n = fixture()
    n.transactions = [{ source_transaction_id: 'old', type: 'trade', status: 'complete', created_at: before.toISOString(), roster_ids: ['1', '2'] }]
    expect(deriveSleeperAlerts(n, null, '1', before).events).toEqual([])
  })
  it('detects four categories from one fresh observation', () => {
    const n = fixture()
    n.schedule[0].matchups[0].points_1 = 106
    n.rosters[0].starter_ids = ['p1', 'p3']
    n.transactions = [{ source_transaction_id: 'new', type: 'trade', status: 'complete', created_at: '2026-11-10T00:00:00Z', status_updated_at: '2026-11-17T18:05:00Z', roster_ids: ['1', '2'] }]
    n.drafts![0].status = 'drafting'
    const result = deriveSleeperAlerts(n, baseline(), '1', after)
    expect(result.events.map((e) => e.category)).toEqual(['imported_scoring', 'imported_lineup', 'imported_trade', 'imported_draft'])
    expect(result.events[0].body).toContain('106.00')
    expect(result.events[1].body).toContain('New Starter')
    expect(result.events[2].body).toContain('Alpha / Bravo')
    expect(result.events[3].body).toContain('started')
    expect(deriveSleeperAlerts(n, result.snapshot, '1', new Date('2026-11-17T18:20:00Z')).events).toEqual([])
  })
  it('reports opponent scoring changes and stat corrections', () => {
    const n = fixture()
    n.schedule[0].matchups[0].points_2 = 88.5
    expect(deriveSleeperAlerts(n, baseline(), '1', after).events[0].body).toContain('Bravo 88.50')
  })
  it('does not invent a team when a Sleeper identity cannot be matched', () => {
    const n = fixture()
    n.schedule[0].matchups[0].points_1 = 200
    n.rosters[0].starter_ids = []
    expect(deriveSleeperAlerts(n, baseline(), null, after).events).toEqual([])
  })
  it('does not treat a scoring-period rollover as a score update', () => {
    const n = fixture()
    n.league.current_week = 2
    n.schedule[0].week = 2
    n.schedule[0].matchups[0].points_1 = 0
    n.schedule[0].matchups[0].points_2 = 0
    expect(deriveSleeperAlerts(n, baseline(), '1', after).events).toEqual([])
  })
  it('preserves missing matchup data and detects an empty starting slot', () => {
    const n = fixture()
    n.schedule = []
    n.rosters[0].starter_ids = ['p1', '0']
    const result = deriveSleeperAlerts(n, baseline(), '1', after)
    expect(result.snapshot.score).toEqual(baseline().score)
    expect(result.events).toHaveLength(1)
    expect(result.events[0].body).toContain('1 empty starting slot')
  })
  it('ignores historical backfill and retains trade IDs when the fetch window moves', () => {
    const n = fixture()
    n.transactions = [{ source_transaction_id: 'old', type: 'trade', status: 'complete', created_at: '2026-01-01T00:00:00Z', roster_ids: ['1', '2'] }]
    const result = deriveSleeperAlerts(n, baseline(), '1', after)
    expect(result.events).toEqual([])
    n.transactions = []
    expect(deriveSleeperAlerts(n, result.snapshot, '1', new Date('2026-11-17T18:20:00Z')).snapshot.completedTrades).toContain('old')
  })
  it('reports draft picks and completion, including a draft that finished between syncs', () => {
    const n = fixture()
    n.drafts![0].status = 'drafting'
    const prior = deriveSleeperAlerts(n, null, '1', before).snapshot
    n.draft_picks = [{ source_draft_id: 'd1', round: 1, pick_no: 1, source_roster_id: '1', source_player_id: 'p3' }]
    expect(deriveSleeperAlerts(n, prior, '1', after).events[0].body).toContain('1 new draft pick')
    n.drafts![0].status = 'complete'
    expect(deriveSleeperAlerts(n, prior, '1', after).events[0].body).toContain('complete')
    expect(deriveSleeperAlerts(n, baseline(), '1', after).events[0].body).toContain('complete')
  })
  it('baselines newly discovered historical drafts and long-disconnected leagues', () => {
    const n = fixture()
    n.drafts!.push({ source_draft_id: 'old-draft', status: 'complete' })
    expect(deriveSleeperAlerts(n, baseline(), '1', after).events).toEqual([])
    n.schedule[0].matchups[0].points_1 = 200
    expect(deriveSleeperAlerts(n, baseline(), '1', new Date('2026-11-20T00:00:00Z')).events).toEqual([])
  })
})
