/**
 * Fantasy OS Suite — Phase V7.2: portfolio manifest + historical coverage matrix (pure builders).
 *
 * Deterministic assembly of discovered account portfolios into the two engineering artifacts:
 *  - Portfolio Manifest: accounts, shared leagues (multi-account), and season-continuity chains.
 *  - Historical Coverage Matrix: which evidence categories are actually present per league/season.
 * Only OBSERVED truth is recorded — coverage flags that no import has verified stay absent, never assumed.
 */
import type {
  AccountPortfolio,
  DiscoveredLeague,
  LeagueChain,
  PortfolioManifest,
  HistoricalCoverageMatrix,
  EvidenceCategory,
} from './types'

/** Assemble maximal season-continuity chains (length ≥ 2) from previous-league links. */
function buildChains(allLeagues: DiscoveredLeague[]): LeagueChain[] {
  const byRef = new Map<string, DiscoveredLeague>()
  for (const l of allLeagues) if (!byRef.has(l.leagueReference)) byRef.set(l.leagueReference, l)

  const pointedTo = new Set<string>()
  for (const l of byRef.values()) if (l.previousLeagueRef && byRef.has(l.previousLeagueRef)) pointedTo.add(l.previousLeagueRef)

  const chains: LeagueChain[] = []
  for (const head of byRef.values()) {
    if (pointedTo.has(head.leagueReference)) continue // not a chain head
    const nodes: DiscoveredLeague[] = [head]
    let cur = head
    const guard = new Set<string>([head.leagueReference]) // cycle guard
    while (cur.previousLeagueRef && byRef.has(cur.previousLeagueRef) && !guard.has(cur.previousLeagueRef)) {
      const prev = byRef.get(cur.previousLeagueRef)!
      nodes.push(prev)
      guard.add(prev.leagueReference)
      cur = prev
    }
    if (nodes.length >= 2) {
      const seasons = nodes
        .map((n) => ({ season: n.season, leagueReference: n.leagueReference }))
        .sort((a, b) => a.season.localeCompare(b.season))
      chains.push({ chainId: seasons[0]!.leagueReference, seasons })
    }
  }
  return chains.sort((a, b) => a.chainId.localeCompare(b.chainId))
}

export function buildPortfolioManifest(
  accounts: AccountPortfolio[],
  generatedAt = new Date().toISOString(),
): PortfolioManifest {
  const resolved = accounts.filter((a) => a.status === 'resolved')
  const allLeagues = resolved.flatMap((a) => a.leagues)

  // Shared leagues: leagueRef → accounts that surfaced it (>1).
  const leagueToAccounts = new Map<string, Set<string>>()
  for (const a of resolved) {
    for (const l of a.leagues) {
      if (!leagueToAccounts.has(l.leagueReference)) leagueToAccounts.set(l.leagueReference, new Set())
      leagueToAccounts.get(l.leagueReference)!.add(a.accountReference)
    }
  }
  const sharedLeagues = [...leagueToAccounts.entries()]
    .filter(([, accts]) => accts.size > 1)
    .map(([leagueReference, accts]) => ({ leagueReference, accountReferences: [...accts].sort() }))
    .sort((a, b) => a.leagueReference.localeCompare(b.leagueReference))

  const chains = buildChains(allLeagues)
  const uniqueLeagues = new Set(allLeagues.map((l) => l.leagueReference)).size
  const seasons = [...new Set(allLeagues.map((l) => l.season))].sort()

  return {
    generatedAt,
    accounts,
    sharedLeagues,
    chains,
    totals: {
      accounts: accounts.length,
      resolved: resolved.length,
      uniqueLeagues,
      seasons,
      chains: chains.length,
    },
  }
}

/**
 * Build the coverage matrix. `evidenceByLeague` maps a league reference to the categories a live import
 * actually observed. Without it (discovery-only), only `metadata` and `previous_league` are known — every
 * other category is left absent (unknown), never assumed present.
 */
export function buildHistoricalCoverageMatrix(
  accounts: AccountPortfolio[],
  evidenceByLeague: Record<string, Partial<Record<EvidenceCategory, boolean>>> = {},
  generatedAt = new Date().toISOString(),
): HistoricalCoverageMatrix {
  const seen = new Map<string, DiscoveredLeague>()
  for (const a of accounts) for (const l of a.leagues) if (!seen.has(l.leagueReference)) seen.set(l.leagueReference, l)

  const rows = [...seen.values()]
    .sort((a, b) => a.leagueReference.localeCompare(b.leagueReference))
    .map((l) => {
      const coverage: Partial<Record<EvidenceCategory, boolean>> = {
        metadata: true, // discovery observed the league object itself
        previous_league: l.previousLeagueRef !== null,
        ...evidenceByLeague[l.leagueReference],
      }
      return { leagueReference: l.leagueReference, season: l.season, coverage }
    })

  const categoryTotals: Record<string, number> = {}
  for (const row of rows) {
    for (const [cat, present] of Object.entries(row.coverage)) {
      if (present) categoryTotals[cat] = (categoryTotals[cat] ?? 0) + 1
    }
  }

  return { generatedAt, rows, categoryTotals }
}
