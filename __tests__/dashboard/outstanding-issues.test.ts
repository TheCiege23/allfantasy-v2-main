/**
 * buildOutstandingIssues — the live dashboard's per-league alert list builder. Proves it (a) preserves the
 * canonical leagueId + normalized kind on every row, (b) reuses the route's SERVER-RESOLVED source action
 * without reconstructing a URL, (c) fails safe for native / link-less leagues, and (d) keeps each league's
 * link scoped to that league (no cross-league leakage).
 */
import { describe, it, expect } from 'vitest'
import { buildOutstandingIssues } from '@/lib/dashboard/outstanding-issues'
import type { LineupActionItem, DecisionOsActionLinks } from '@/lib/lineup-actions/types'
import type { PendingTradeLeague } from '@/app/dashboard/dashboardStripApiTypes'
import type { SourceLink } from '@/lib/league-links/sourceLinkResolver'

function sleeperLink(id: string): SourceLink {
  return {
    href: `https://sleeper.com/leagues/${id}/league`,
    destinationType: 'league', provider: 'sleeper', providerLabel: 'Sleeper',
    label: 'Sleeper', isFallback: false, opensExternally: true,
  }
}
function importedLinks(id: string, label: string): DecisionOsActionLinks {
  return {
    actionable: true, imported: true, dataAsOf: null,
    internal: { href: `/league/${id}?tab=team`, label: 'Review Lineup in AF' },
    external: { link: sleeperLink(id), label },
  }
}
function nativeLinks(): DecisionOsActionLinks {
  return {
    actionable: true, imported: false, dataAsOf: null,
    internal: { href: '/league/N1?tab=team', label: 'Review Lineup in AF' }, external: null,
  }
}
function action(over: Partial<LineupActionItem>): LineupActionItem {
  return {
    leagueId: 'L1', leagueName: 'HailShiva', sport: 'NFL' as never, platform: 'sleeper',
    teamId: null, slotIndex: null, slotId: 's1', slotLabel: null, playerId: null, playerName: null,
    reasonType: 'empty_starter', urgency: 'urgent', lockTime: null, recommendedAction: null,
    suggestedReplacementPlayerId: null, confidence: null, expectedGain: null, sourceModule: 'lineup_scan',
    message: 'Empty FLEX slot', severity: 'critical', ...over,
  }
}
function tradeLeague(over: Partial<PendingTradeLeague>): PendingTradeLeague {
  return {
    leagueId: 'L2', leagueName: 'Gridiron', leagueAvatar: null, sport: 'NFL',
    trades: [{ transactionId: 't1', proposedBy: 'x', proposedAt: null, assetsGiven: [], assetsReceived: [], chimmyVerdict: 'negotiate', chimmyReason: 'x' }],
    ...over,
  }
}
const ALL = () => true
const nameOf = (id: string) => (({ L1: 'HailShiva', L2: 'Gridiron', N1: 'AF Home' }) as Record<string, string>)[id] ?? 'League'

describe('buildOutstandingIssues', () => {
  it('lineup row preserves leagueId + kind + reuses the route-resolved external link', () => {
    const rows = buildOutstandingIssues({
      lineupActions: [action({ actionLinks: importedLinks('L1', 'Set Lineup in HailShiva') })],
      tradeLeagues: [],
      leagueName: nameOf,
      inScope: ALL,
    })
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ kind: 'lineup', leagueId: 'L1', imported: true })
    // The exact link object the route resolved — not rebuilt here.
    expect(rows[0].external?.link.href).toBe('https://sleeper.com/leagues/L1/league')
    expect(rows[0].external?.label).toBe('Set Lineup in HailShiva')
  })

  it('collapses identical (league, message) actions into one counted row, keeping the most severe', () => {
    const rows = buildOutstandingIssues({
      lineupActions: [
        action({ severity: 'warning', actionLinks: importedLinks('L1', 'Set Lineup in HailShiva') }),
        action({ severity: 'critical', slotId: 's2' }),
        action({ severity: 'info', slotId: 's3' }),
      ],
      tradeLeagues: [],
      leagueName: nameOf,
      inScope: ALL,
    })
    expect(rows).toHaveLength(1)
    expect(rows[0].count).toBe(3)
    expect(rows[0].severity).toBe('critical')
  })

  it('native league fails safe → imported:false, no external link', () => {
    const rows = buildOutstandingIssues({
      lineupActions: [action({ leagueId: 'N1', platform: 'allfantasy', actionLinks: nativeLinks() })],
      tradeLeagues: [],
      leagueName: nameOf,
      inScope: ALL,
    })
    expect(rows[0]).toMatchObject({ leagueId: 'N1', imported: false, external: null })
  })

  it('missing actionLinks fails safe → imported:false, external:null', () => {
    const rows = buildOutstandingIssues({
      lineupActions: [action({ actionLinks: undefined })],
      tradeLeagues: [],
      leagueName: nameOf,
      inScope: ALL,
    })
    expect(rows[0]).toMatchObject({ imported: false, external: null })
  })

  it('trade league → kind:trade with its own resolved external action', () => {
    const rows = buildOutstandingIssues({
      lineupActions: [],
      tradeLeagues: [tradeLeague({ actionLinks: { ...importedLinks('L2', 'Review Trade in Gridiron'), internal: { href: '/league/L2?tab=trades', label: 'Analyze Trade in AF' } } })],
      leagueName: nameOf,
      inScope: ALL,
    })
    expect(rows[0]).toMatchObject({ kind: 'trade', leagueId: 'L2', imported: true })
    expect(rows[0].external?.link.href).toBe('https://sleeper.com/leagues/L2/league')
    expect(rows[0].external?.label).toBe('Review Trade in Gridiron')
  })

  it('respects the inScope filter', () => {
    const rows = buildOutstandingIssues({
      lineupActions: [action({ leagueId: 'L1' }), action({ leagueId: 'L2', message: 'Other' })],
      tradeLeagues: [],
      leagueName: nameOf,
      inScope: (id) => id === 'L1',
    })
    expect(rows).toHaveLength(1)
    expect(rows[0].leagueId).toBe('L1')
  })

  it('cross-league isolation — each row carries ONLY its own league link', () => {
    const rows = buildOutstandingIssues({
      lineupActions: [
        action({ leagueId: 'L1', message: 'A', actionLinks: importedLinks('L1', 'Set Lineup in HailShiva') }),
        action({ leagueId: 'L2', message: 'B', actionLinks: importedLinks('L2', 'Set Lineup in Gridiron') }),
      ],
      tradeLeagues: [],
      leagueName: nameOf,
      inScope: ALL,
    })
    const byLeague = Object.fromEntries(rows.map((r) => [r.leagueId, r.external?.link.href]))
    expect(byLeague.L1).toBe('https://sleeper.com/leagues/L1/league')
    expect(byLeague.L2).toBe('https://sleeper.com/leagues/L2/league')
  })

  it('caps the list at 10 rows, most severe/urgent first', () => {
    const many = Array.from({ length: 15 }, (_, i) =>
      action({ leagueId: `L${i}`, message: `msg-${i}`, severity: i === 14 ? 'critical' : 'info' }),
    )
    const rows = buildOutstandingIssues({ lineupActions: many, tradeLeagues: [], leagueName: nameOf, inScope: ALL })
    expect(rows).toHaveLength(10)
    expect(rows[0].severity).toBe('critical') // the one critical sorts to the top
  })
})
