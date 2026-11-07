/**
 * Campus to Canton league screens, 2026-11-07 visual audit (phone + desktop, dark + light, DB-free harness at
 * /e2e/c2c/[leagueId]/[screen]).
 *
 * 1. Always dark. The screens sit on fixed dark grounds, and the light-mode clamp recoloured parts of them —
 *    the score summary's total, the Roster Balance button and the picks' status went near-invisible. The new
 *    league layout carries `af-draft-dark`, the app's opt-out.
 * 2. Player names were `truncate`d in a lineup card ~80px wide on a phone ("Jeremiyah L…"), and still cut on
 *    desktop ("Dakorien Mo…"). They now wrap to two lines.
 * 3. Picks showed the owner as the first characters of a roster id ("ro-me…", in production a cuid). They now
 *    show the team name from the season's rosters, and the Team × Round table gains the season.
 */
import React from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import C2CLeagueLayout from '@/app/c2c/[leagueId]/layout'
import { C2CCampusPlayerCard } from '@/app/c2c/components/C2CCampusPlayerCard'
import { C2CCantonPlayerCard } from '@/app/c2c/components/C2CCantonPlayerCard'
import { C2CPicksClient } from '@/app/c2c/[leagueId]/picks/C2CPicksClient'
import type { C2CPlayerRow } from '@/app/c2c/components/c2cPlayerTypes'

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('C2C league is dark in every mode', () => {
  it('wraps every league screen in the always-dark opt-out', () => {
    const { container } = render(
      <C2CLeagueLayout>
        <p>screen</p>
      </C2CLeagueLayout>,
    )
    expect((container.firstElementChild as HTMLElement).className.split(/\s+/)).toContain('af-draft-dark')
    expect(container.textContent).toBe('screen')
  })
})

describe('C2C lineup cards', () => {
  const row = (side: 'campus' | 'canton'): C2CPlayerRow => ({
    playerId: 'p1', playerName: 'Jeremiyah Love', position: 'RB', playerSide: side, playerType: side === 'campus' ? 'college' : 'pro',
    bucketState: `${side}_starter`, scoringEligibility: 'starter',
  })

  it.each([
    ['campus', () => <C2CCampusPlayerCard player={row('campus')} />],
    ['canton', () => <C2CCantonPlayerCard player={row('canton')} />],
  ])('lets the %s player name wrap rather than cutting it', (_side, card) => {
    render(card())
    const name = screen.getByText('Jeremiyah Love')
    const classes = name.className.split(/\s+/)
    expect(classes).not.toContain('truncate')
    expect(classes).toContain('line-clamp-2')
  })
})

describe('C2C picks', () => {
  function stubApi(seasonOk: boolean) {
    vi.stubGlobal('fetch', vi.fn(async (input: string) => {
      const url = String(input)
      const json = (body: unknown, ok = true) => ({ ok, json: async () => body })
      if (url.startsWith('/api/c2c/picks')) {
        return json({ picks: [{ id: 'k1', pickSide: 'campus', season: 2027, round: 1, originalOwnerId: 'ckroster0001', currentOwnerId: 'ckroster0001', isUsed: false }] })
      }
      if (url.startsWith('/api/c2c')) return json({ c2c: { sportPair: 'NFL_CFB', scoringMode: 'combined_total', campusScoreWeight: 0.4, cantonScoreWeight: 0.6, futureDraftFormat: 'separate_campus_and_canton' } })
      if (url.startsWith('/api/redraft/season')) {
        return seasonOk ? json({ season: { rosters: [{ id: 'ckroster0001', teamName: 'Saturday to Sunday Pipeline' }] } }) : json({}, false)
      }
      return json({}, false)
    }))
  }

  it('names the team that owns each pick', async () => {
    stubApi(true)
    const { container } = render(<C2CPicksClient leagueId="L1" rosterId="ckroster0001" />)
    expect(await screen.findByText('Saturday to Sunday Pipeline · R1 · 2027')).toBeTruthy()
    expect(container.querySelector('[data-testid="c2c-pick-row-k1"]')?.textContent).toContain('Saturday to Sunday Pipeline')
    expect(container.textContent).not.toContain('ckrost')
  })

  // Control: without the season the page still reads, with a plain label instead of an id.
  it('falls back to a label, never an id, when team names are unavailable', async () => {
    stubApi(false)
    const { container } = render(<C2CPicksClient leagueId="L1" rosterId="ckroster0001" />)
    expect(await screen.findByText('Your team · R1 · 2027')).toBeTruthy()
    expect(container.textContent).not.toContain('ckrost')
  })
})
