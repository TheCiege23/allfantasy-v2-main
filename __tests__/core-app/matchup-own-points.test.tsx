/**
 * AllFantasy's own estimate of what a starter scored, where the platform's player scores are not on file.
 *
 * Production 2026-11-21, a Fantrax NFL league: the board said "no per-player scoring has been ingested for
 * 2026 week 11" two days after C.J. Stroud's Thursday game, with his box score printed on the same row.
 * The stored stat line and the league's scoring rules were both on file and nothing priced one by the other.
 */
import React from 'react'
import { render } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { ownPointsByPlayer } from '@/lib/core-app/matchupOwnPoints'
import { matchupFixture } from '@/app/e2e/redraft-core/matchup/fixtures'

vi.mock('next/navigation', () => ({ useRouter: () => ({ push() {}, refresh() {}, prefetch() {} }), usePathname: () => '/core/matchup', useSearchParams: () => new URLSearchParams() }))

const SCORING = { pass_yd: 0.04, pass_td: 4, pass_int: -2, rush_yd: 0.1, rec: 1, rec_yd: 0.1, idp_tkl_solo: 1.5 }

describe('ownPointsByPlayer', () => {
  it('prices a stored stat line under the league’s own rules', () => {
    const out = ownPointsByPlayer(
      [
        // 194 × 0.04 + 3 × 4 − 2 + 27 × 0.1 = 20.46
        { playerId: '9758', normalizedStatMap: { pass_yd: 194, pass_td: 3, pass_int: 1, rush_yd: 27, pass_cmp: 21 } },
        // 4 receptions + 31 yards = 7.1
        { playerId: '8155', normalizedStatMap: { rec: 4, rec_yd: 31 } },
      ],
      SCORING,
    )
    expect(out.get('9758')).toBe(20.46)
    expect(out.get('8155')).toBe(7.1)
  })

  it('gives no number, never a zero, for a line the league’s rules do not price', () => {
    const out = ownPointsByPlayer(
      [
        { playerId: 'db-1', normalizedStatMap: { def_snp: 61, tm_def_snp: 64 } },
        { playerId: 'none', normalizedStatMap: null },
        { playerId: 'list', normalizedStatMap: [1, 2] },
      ],
      SCORING,
    )
    expect(out.size).toBe(0)
  })

  it('gives nothing without the league’s scoring rules', () => {
    const rows = [{ playerId: '9758', normalizedStatMap: { pass_yd: 194 } }]
    expect(ownPointsByPlayer(rows, null).size).toBe(0)
    expect(ownPointsByPlayer(rows, undefined).size).toBe(0)
  })

  it('reads one line per player: the first row stands', () => {
    const out = ownPointsByPlayer(
      [
        { playerId: '8155', normalizedStatMap: { rec: 4, rec_yd: 31 } },
        { playerId: '8155', normalizedStatMap: { rec: 9, rec_yd: 120 } },
      ],
      SCORING,
    )
    expect(out.get('8155')).toBe(7.1)
  })
})

describe('the board', () => {
  function fixtureWithEstimate(platformScores: boolean) {
    const data = matchupFixture('NFL', 'final')
    if (!platformScores) data.playerScoring = { available: false, reason: 'no per-player scoring has been ingested' }
    if (!data.lineups.available) throw new Error('fixture has no lineups')
    const cell = data.lineups.data.map((s) => s.you).find((c) => c && !c.empty && c.statLine)
    if (!cell) throw new Error('fixture has no final starter with a stat line')
    cell.ownPoints = 20.46
    return data
  }

  it('shows the estimate under the box score, named as AllFantasy’s, when the platform’s scores are not on file', async () => {
    const { default: Matchup } = await import('@/components/core-app/screens/Matchup')
    const { container } = render(<Matchup data={fixtureWithEstimate(false)} />)
    const lines = container.querySelectorAll('[data-testid="matchup-own-points"]')
    expect(lines).toHaveLength(1)
    expect(lines[0]!.textContent).toBe('AllFantasy estimate: 20.5 pts')
  })

  it('shows no estimate where the platform scored the players itself, or where there is none', async () => {
    const { default: Matchup } = await import('@/components/core-app/screens/Matchup')
    const scored = fixtureWithEstimate(true)
    expect(scored.playerScoring.available).toBe(true)
    expect(render(<Matchup data={scored} />).container.querySelectorAll('[data-testid="matchup-own-points"]')).toHaveLength(0)
    const none = matchupFixture('NFL', 'final')
    none.playerScoring = { available: false, reason: 'no per-player scoring has been ingested' }
    expect(render(<Matchup data={none} />).container.querySelectorAll('[data-testid="matchup-own-points"]')).toHaveLength(0)
  })
})
