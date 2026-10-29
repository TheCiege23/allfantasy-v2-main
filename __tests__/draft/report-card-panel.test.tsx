import React from 'react'
import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'

vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}))

import { DraftReportCardPanel } from '@/components/app/draft-room/DraftReportCardPanel'
import type { DraftResultsPayload, PickScoreEntry } from '@/lib/post-draft-manager-ranking/types'

const pk = (overall: number, playerName: string, position: string, adp: number): PickScoreEntry => ({
  id: `p${overall}`, overall, round: overall, slot: 1, rosterId: 'r1', displayName: 'Alpha', playerName,
  position, team: null, byeWeek: null, adp, adpSource: 'current', valueScore: adp - overall,
})

const results: DraftResultsPayload = {
  leagueId: 'L1', leagueName: 'Den', sport: 'NFL', draftType: 'snake', season: '2026', status: 'completed',
  rounds: 2, teamCount: 1, totalPicks: 2, pickLog: [],
  managerRankings: [{
    rank: 1, rosterId: 'r1', displayName: 'Alpha', slot: 1, grade: 'A-', score: 80, totalValueScore: 0,
    positionalScore: 0, positionalDepthScore: 0, benchScore: 0, balanceScore: 0, upsideScore: 0,
    reachPenaltyScore: 0, injuryRiskScore: 0, byeWeekScore: 0, pickCount: 2,
    picks: [pk(1, 'Value Back', 'RB', 9), pk(2, 'Reach End', 'TE', 1)], bestPick: null, worstReach: null,
  }],
  bestPickOfDraft: null, worstReachOfDraft: null, stealOfDraft: null,
}

describe('DraftReportCardPanel', () => {
  it('shows grade, rank, steal, reach, roster build and the ADP basis', () => {
    render(<DraftReportCardPanel leagueId="L1" rosterId="r1" initialResults={results} />)
    expect(screen.getByTestId('draft-report-card-grade').textContent).toBe('A-')
    expect(screen.getByTestId('draft-report-card-rank').textContent).toContain('#1')
    expect(screen.getByTestId('draft-report-card-steal').textContent).toContain('Value Back')
    expect(screen.getByTestId('draft-report-card-steal').textContent).toContain('+8 spots')
    expect(screen.getByTestId('draft-report-card-reach').textContent).toContain('-1 spots')
    expect(screen.getByTestId('draft-report-card-positions').textContent).toContain('TE')
    expect(screen.getByTestId('draft-report-card-basis').textContent).toContain('current ADP')
    expect(screen.getByTestId('draft-report-card-image').getAttribute('href')).toBe(
      '/api/share/draft?card=report&leagueId=L1&rosterId=r1',
    )
  })

  it('renders nothing for a spectator or a roster outside the results', () => {
    const { container, rerender } = render(<DraftReportCardPanel leagueId="L1" rosterId={null} initialResults={results} />)
    expect(container.innerHTML).toBe('')
    rerender(<DraftReportCardPanel leagueId="L1" rosterId="other" initialResults={results} />)
    expect(container.innerHTML).toBe('')
  })
})
