'use client'

import AfCoreShell from '@/components/core-app/AfCoreShell'
import { PortfolioBoard } from '@/components/core-app/portfolio/PortfolioBoard'
import type { PortfolioInsights, PortfolioLeagueFacts } from '@/lib/core-app/portfolioInsightsTypes'
import { EMPTY_FILTER } from '@/lib/core-app/portfolioView'
/* The board's styles are imported by the Portfolio screen, not the board, so the harness brings them. */
import '@/components/core-app/af-portfolio.css'
import '@/components/core-app/af-core-boards.css'
import '@/components/core-app/af-portfolio-redesign.css'

/**
 * DB-free render of the Portfolio board's Overview inside the real AfCoreShell (2026-11-20), for the
 * "More detail" fold. Every league is SAMPLE data. Production is refused by app/e2e/layout.tsx.
 */
const league = (i: number, over: Partial<PortfolioLeagueFacts>): PortfolioLeagueFacts => ({
  id: `L${i}`,
  name: `Sample League ${i}`,
  platform: 'sleeper',
  sport: 'NFL',
  season: '2026',
  concept: 'redraft',
  family: 'redraft',
  bestBall: false,
  idp: false,
  superflex: false,
  scoring: 'ppr',
  tePremium: false,
  stage: 'in_season',
  commissioner: false,
  teamCount: 12,
  record: { wins: 6, losses: 4, ties: 0 },
  rank: 4,
  status: 'middle',
  statusSource: 'standings',
  rosterValue: 42000,
  rosterValueRank: 5,
  valuedTeams: 12,
  valueBook: 'redraft',
  hasRoster: true,
  slotsKnown: true,
  ...over,
})

const LEAGUES: PortfolioLeagueFacts[] = [
  league(1, { status: 'contender', rank: 1, record: { wins: 9, losses: 1, ties: 0 } }),
  league(2, { family: 'dynasty', concept: 'dynasty', superflex: true, status: 'rebuild', rank: 10, record: { wins: 2, losses: 8, ties: 0 } }),
  league(3, { platform: 'espn', scoring: 'half_ppr' }),
  league(4, { family: 'keeper', concept: 'keeper', scoring: 'standard', status: 'contender', rank: 2 }),
  league(5, { platform: 'fantrax', family: 'dynasty', concept: 'dynasty', stage: 'pre_draft', record: null, rank: null, status: 'unknown', statusSource: null }),
]

const INSIGHTS: PortfolioInsights = {
  version: 1,
  builtAt: '2026-11-20T18:00:00.000Z',
  leagues: LEAGUES,
  players: [],
  risk: [],
  nflWeek: { season: 2026, week: 12, preseason: false },
  byeWeeks: [],
  injuryGaps: [],
  injuryFeedStale: false,
  valueDates: [],
  valueSeries: [],
  movers: [],
  playerValueBook: 'redraft',
  notes: {},
}

export default function PortfolioGuideHarnessPage() {
  return (
    <AfCoreShell
      active="portfolio"
      leagues={[]}
      selectedLeagueId={null}
      syncAge={{ label: 'just now', stale: false }}
      syncEligibleCount={0}
      comms={{ leagues: [], chimmyTokenCost: null, dockable: false, supportEmail: null }}
    >
      <div className="af-pf" data-testid="portfolio-guide-harness">
        <PortfolioBoard
          insights={INSIGHTS}
          recorded={[]}
          lineup={null}
          extras={{ favoriteIds: [], paidIds: [] }}
          initialFilter={EMPTY_FILTER}
          initialView="overview"
          builtAt={INSIGHTS.builtAt}
          servedStale={false}
          renderLeagues={() => null}
        />
      </div>
    </AfCoreShell>
  )
}
