import { render, screen, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { PlayerNews, newsSource, newsWhen } from '@/components/core-app/player-finder/PlayerNews'
import { PlayerNextGames, marketLine } from '@/components/core-app/player-finder/PlayerNextGames'
import { PlayerSeasonCard } from '@/components/core-app/player-finder/PlayerSeasonCard'
import { summarizeSeason, type SeasonWeek } from '@/lib/core-app/playerSeason'

const NOW = '2026-09-27T16:10:00.000Z' // Sun 12:10p ET
const WEEKS: SeasonWeek[] = [
  { week: 1, opponent: 'PIT', projected: 21.5, actual: 31.3, played: true },
  { week: 2, opponent: 'CAR', projected: 22, actual: 11.1, played: true },
  { week: 3, opponent: 'GB', projected: 20.1, actual: null, played: false },
]

describe('PlayerSeasonCard', () => {
  it('names the scoring, totals the season and marks each week against its projection', () => {
    const { container } = render(
      <PlayerSeasonCard name="Jayden Daniels" state={{ available: true, data: { season: 2026, scoring: { kind: 'ppr' }, weeks: WEEKS, summary: summarizeSeason(WEEKS) } }} />,
    )
    expect(screen.getByText('PPR')).toBeInTheDocument()
    expect(screen.getByText('42.4')).toBeInTheDocument() // 31.3 + 11.1
    expect(screen.getByText(/Met or beat his projection in 1 of 2 weeks/)).toBeInTheDocument()
    const rows = container.querySelectorAll('.af-pf-season-table tbody tr')
    expect(rows[0]).toHaveAttribute('data-beat', 'true')
    expect(rows[1]).toHaveAttribute('data-beat', 'false')
    // Week 3: no stat line — "no stats", never a zero bar.
    expect(within(rows[2] as HTMLElement).getByText('no stats')).toBeInTheDocument()
    expect(container.querySelectorAll('.af-pf-season-bar')).toHaveLength(2)
    expect(screen.getByRole('img').getAttribute('aria-label')).toContain('week 3 scored nothing on file, projected 20.1')
  })

  it("says the league's scoring when the card is in league mode", () => {
    render(<PlayerSeasonCard name="X" state={{ available: true, data: { season: 2026, scoring: { kind: 'league', leagueName: 'KBFL' }, weeks: WEEKS, summary: summarizeSeason(WEEKS) } }} />)
    expect(screen.getByText('KBFL scoring')).toBeInTheDocument()
  })
})

describe('PlayerNextGames', () => {
  it("states the market's read of HIS TEAM, not him, and calls out a bye", () => {
    expect(marketLine({ impliedTeamTotal: 24.5, spread: -3.5, gameTotal: 47.5, winProbability: 0.62, isStale: false })).toBe(
      'his team implied for 24.5 pts · favored by 3.5 · 62% to win · game total 47.5',
    )
    expect(marketLine({ impliedTeamTotal: null, spread: 2.5, gameTotal: null, winProbability: null, isStale: true })).toBe('underdog by 2.5 · line may be out of date')
    expect(marketLine(null)).toBeNull()
    render(
      <PlayerNextGames
        next={{ available: true, data: { opponent: 'GB', home: true, kickoff: '2026-09-27T17:00:00.000Z', market: null } }}
        upcoming={{ available: true, data: { season: 2026, weeks: [{ week: 3, opponent: 'GB', home: true, bye: false, projection: null }, { week: 4, opponent: null, home: false, bye: true, projection: null }] } }}
      />,
    )
    expect(screen.getByText('vs GB', { selector: 'strong' })).toBeInTheDocument()
    expect(screen.getByText('BYE').closest('li')).toHaveAttribute('data-bye', 'true')
  })
})

describe('newsSource', () => {
  it('names known feeds and title-cases an unknown one word by word', () => {
    expect(newsSource('espn')).toBe('ESPN')
    expect(newsSource('newsapi_everything')).toBe('News')
    // Word starts only — a regex that lost its \b (a shell heredoc turned it into a BACKSPACE once) upper-cases every letter.
    expect(newsSource('some_feed')).toBe('Some Feed')
    expect(newsSource(null)).toBeNull()
  })
})

describe('PlayerNews', () => {
  it('dates every item — minutes on game day, a date once it is old', () => {
    expect(newsWhen('2026-09-27T15:32:00.000Z', NOW)).toBe('38 min ago')
    expect(newsWhen('2026-09-27T12:10:00.000Z', NOW)).toBe('4h ago')
    expect(newsWhen('2026-09-20T12:10:00.000Z', NOW)).toBe('Sun, 9/20')
    render(
      <PlayerNews
        nowIso={NOW}
        state={{ available: true, data: [{ title: 'Daniels ruled out', source: 'espn', url: 'https://x/1', publishedAt: '2026-09-27T15:32:00.000Z' }, { title: 'Knee sprain', source: 'rolling_insights', url: null, publishedAt: null }] }}
      />,
    )
    expect(screen.getByRole('link', { name: 'Daniels ruled out' })).toHaveAttribute('target', '_blank')
    expect(screen.getByText('ESPN · 38 min ago')).toBeInTheDocument()
    expect(screen.getByText('Rolling Insights')).toBeInTheDocument()
    expect(screen.getByText('Knee sprain').tagName).toBe('SPAN')
  })
})
