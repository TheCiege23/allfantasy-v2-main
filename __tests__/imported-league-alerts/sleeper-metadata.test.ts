// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest'
import sleeperApiFixture from './fixtures/sleeper-api.json'
vi.mock('@/lib/sleeper-client', () => ({ getAllPlayers: vi.fn(async () => ({})) }))
vi.mock('@/lib/providers/provider-circuit', () => ({
  isProviderCircuitOpen: () => false, isCircuitFailureStatus: () => true,
  recordProviderSuccess: vi.fn(), recordProviderFailure: vi.fn(),
}))
import { fetchSleeperLeagueForImport } from '@/lib/league-import/sleeper/SleeperLeagueFetchService'
import { SleeperAdapter } from '@/lib/league-import/adapters/sleeper/SleeperAdapter'
const base = sleeperApiFixture.baseUrl
function responses(failDraftPicks = false) {
  return vi.fn(async (input: unknown) => {
    const url = String(input)
    let data: unknown = []
    let status = 200
    if (url === `${base}/league/111`) data = { league_id: '111', season: '2026', sport: 'nfl', name: 'Test', total_rosters: 2, settings: { leg: 1 }, status: 'drafting' }
    if (url === `${base}/league/111/drafts`) data = [{ draft_id: 'd1', status: 'drafting', start_time: 1794938400000 }]
    if (url === `${base}/draft/d1/picks`) { data = [{ pick_no: 1, round: 1, roster_id: 1, player_id: 'p1' }]; if (failDraftPicks) status = 503 }
    if (url.includes('/transactions/')) data = [{ transaction_id: 't1', type: 'trade', status: 'complete', created: 1794938000000, status_updated: 1794938500000, roster_ids: [1, 2] }]
    return { ok: status === 200, status, json: async () => data } as Response
  })
}
afterEach(() => vi.unstubAllGlobals())
describe('Sleeper fresh draft and transaction metadata', () => {
  it('carries lifecycle and completion time through the actual fetch and adapter without extra reads', async () => {
    const fetch = responses()
    vi.stubGlobal('fetch', fetch)
    const raw = await fetchSleeperLeagueForImport('111', { maxMatchupWeeks: 1, maxTransactionWeeks: 1, maxPreviousSeasons: 0 })
    const normalized = await SleeperAdapter.normalize(raw!)
    expect(normalized.drafts).toEqual([{ source_draft_id: 'd1', status: 'drafting', start_time: 1794938400000 }])
    expect(normalized.transactions[0].status_updated_at).toBe(new Date(1794938500000).toISOString())
    expect(normalized.draft_picks[0].source_draft_id).toBe('d1')
    expect(fetch.mock.calls.filter(([url]) => url === `${base}/league/111/drafts`)).toHaveLength(1)
    expect(fetch.mock.calls.filter(([url]) => url === `${base}/draft/d1/picks`)).toHaveLength(1)
  })
  it('surfaces a failed draft pick read so alert baselines cannot advance on an incomplete observation', async () => {
    vi.stubGlobal('fetch', responses(true))
    const raw = await fetchSleeperLeagueForImport('111', { maxMatchupWeeks: 1, maxTransactionWeeks: 1, maxPreviousSeasons: 0 })
    const normalized = await SleeperAdapter.normalize(raw!)
    expect(normalized.fetchWarnings?.some((w) => w.includes('drafts'))).toBe(true)
  })
})
