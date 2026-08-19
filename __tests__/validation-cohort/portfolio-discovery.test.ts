/**
 * Fantasy OS Suite — Phase V7.2: historical portfolio discovery + manifest tests.
 *
 * Fixture/DI only — no live Sleeper calls. Exercises multi-season enumeration, role resolution,
 * anonymization, season-continuity chain assembly, shared-league detection, and the coverage matrix.
 */
import { describe, expect, it } from 'vitest'
import { normalizeCohort } from '@/lib/validation-cohort/normalizeCohort'
import { discoverAccountPortfolio, runDiscovery } from '@/lib/validation-cohort/portfolioDiscovery'
import { buildPortfolioManifest, buildHistoricalCoverageMatrix } from '@/lib/validation-cohort/portfolioManifest'
import type { SleeperFetch } from '@/lib/validation-cohort/sleeperCohortClient'

/** Alice: a 3-season chain 2022→2023→2024. Bob: shares Alice's 2024 league. Ghost: unresolved. */
function fakeFetch(): SleeperFetch {
  return async <T>(url: string): Promise<T | null> => {
    if (url.endsWith('/user/alice')) return { user_id: 'u1', display_name: 'Alice' } as T
    if (url.endsWith('/user/bob')) return { user_id: 'u2', display_name: 'Bob' } as T
    if (url.endsWith('/user/ghost')) return null as T
    if (url.includes('/user/u1/leagues/nfl/2024')) return [{ league_id: '2024a', season: '2024', sport: 'nfl', previous_league_id: '2023a' }] as T
    if (url.includes('/user/u1/leagues/nfl/2023')) return [{ league_id: '2023a', season: '2023', sport: 'nfl', previous_league_id: '2022a' }] as T
    if (url.includes('/user/u1/leagues/nfl/2022')) return [{ league_id: '2022a', season: '2022', sport: 'nfl', previous_league_id: null }] as T
    if (url.includes('/user/u2/leagues/nfl/2024')) return [{ league_id: '2024a', season: '2024', sport: 'nfl', previous_league_id: '2023a' }] as T
    if (url.includes('/user/u2/leagues/')) return [] as T
    if (url.includes('/league/') && url.endsWith('/users')) return [{ user_id: 'u1', is_owner: true }, { user_id: 'u2', is_owner: false }] as T
    return null
  }
}

const SEASONS = ['2024', '2023', '2022']

describe('discoverAccountPortfolio', () => {
  it('enumerates bounded seasons, resolves role, and anonymizes refs', async () => {
    const p = await discoverAccountPortfolio('u1', fakeFetch(), { seasons: SEASONS })
    expect(p.accountReference).toMatch(/^acct_[0-9a-f]{10}$/)
    expect(p.seasonsDiscovered).toEqual(['2022', '2023', '2024'])
    expect(p.leagues).toHaveLength(3)
    for (const l of p.leagues) {
      expect(l.leagueReference).toMatch(/^lg_[0-9a-f]{10}$/)
      expect(l.role).toBe('commissioner') // u1 is_owner: true
    }
    // no raw ids leak
    expect(JSON.stringify(p)).not.toMatch(/2024a|2023a|2022a|u1/)
  })
})

describe('buildPortfolioManifest', () => {
  it('assembles a 3-season continuity chain and detects shared leagues', async () => {
    const alice = await discoverAccountPortfolio('u1', fakeFetch(), { seasons: SEASONS })
    const bob = await discoverAccountPortfolio('u2', fakeFetch(), { seasons: SEASONS })
    const manifest = buildPortfolioManifest([alice, bob])

    expect(manifest.totals.resolved).toBe(2)
    expect(manifest.totals.seasons).toEqual(['2022', '2023', '2024'])
    expect(manifest.chains).toHaveLength(1)
    expect(manifest.chains[0]!.seasons.map((s) => s.season)).toEqual(['2022', '2023', '2024'])

    // 2024a is surfaced by both u1 and u2 → shared
    expect(manifest.sharedLeagues).toHaveLength(1)
    expect(manifest.sharedLeagues[0]!.accountReferences).toHaveLength(2)
  })
})

describe('buildHistoricalCoverageMatrix', () => {
  it('marks metadata present and previous_league only where a prior exists; honors observed evidence', async () => {
    const alice = await discoverAccountPortfolio('u1', fakeFetch(), { seasons: SEASONS })
    const oldestRef = alice.leagues.find((l) => l.season === '2022')!.leagueReference
    const matrix = buildHistoricalCoverageMatrix([alice], {
      [alice.leagues[0]!.leagueReference]: { trades: true, drafts: true },
    })
    expect(matrix.rows).toHaveLength(3)
    for (const row of matrix.rows) expect(row.coverage.metadata).toBe(true)
    // the 2022 (oldest) league has no previous
    expect(matrix.rows.find((r) => r.leagueReference === oldestRef)!.coverage.previous_league).toBe(false)
    // observed evidence is honored, not assumed
    expect(matrix.categoryTotals.trades).toBe(1)
    expect(matrix.categoryTotals.drafts).toBe(1)
  })

  it('assumes nothing beyond what discovery observed (no standings/matchups without import)', async () => {
    const alice = await discoverAccountPortfolio('u1', fakeFetch(), { seasons: SEASONS })
    const matrix = buildHistoricalCoverageMatrix([alice])
    expect(matrix.categoryTotals.standings).toBeUndefined()
    expect(matrix.categoryTotals.matchups).toBeUndefined()
  })
})

describe('runDiscovery end-to-end (injected fetch)', () => {
  it('resolves accounts, records unresolved without guessing, and builds the manifest', async () => {
    const accounts = normalizeCohort(['alice', 'bob', 'ghost', 'My Team Name'])
    const { accounts: acc, manifest } = await runDiscovery(accounts, fakeFetch(), { seasons: SEASONS, concurrency: 2 })

    // "My Team Name" is ambiguous → never sent to the API. alice/bob resolve; ghost is unresolved.
    expect(acc.find((a) => a.raw === 'My Team Name')!.status).toBe('ambiguous')
    expect(acc.find((a) => a.raw === 'ghost')!.status).toBe('unresolved')
    // one portfolio per resolvable candidate (alice, bob, ghost) = 3; two resolved.
    expect(manifest.totals.accounts).toBe(3)
    expect(manifest.totals.resolved).toBe(2)
    expect(manifest.totals.chains).toBe(1)
  })
})
