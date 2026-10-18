// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'

vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: any) => <a href={href} {...rest}>{children}</a>,
}))

import { buildChopLine, guillotineHeadline, tiebreakLabels } from '@/components/guillotine/guillotineHomeModel'
import { GuillotineChopMoment, GuillotineSpecialtyHome } from '@/components/guillotine/GuillotineSpecialtyHome'
import { bottomScores } from '@/lib/league-specialty/guillotineHome'

const tiers = [
  { rosterId: 'z', displayName: 'Open Team 11', tier: 'chop_zone', pointsFromChopZone: 0 },
  { rosterId: 'd', displayName: 'Open Team 4', tier: 'danger', pointsFromChopZone: 5 },
  { rosterId: 'me', displayName: 'TheCiege26', tier: 'safe', pointsFromChopZone: 35.9 },
]
const scores = { z: 92.7, d: 97.7, me: 128.6 }

describe('guillotine home model', () => {
  it('orders safest-first, keeps the engine tiers, and draws the cut above the chop zone', () => {
    const line = buildChopLine(tiers, 'me', scores)
    expect(line.rows.map((r) => r.rosterId)).toEqual(['me', 'd', 'z'])
    expect(line.rows.map((r) => r.tier)).toEqual(['safe', 'danger', 'chop_zone'])
    expect(line.rows.filter((r) => r.cutAbove).map((r) => r.rosterId)).toEqual(['z'])
    expect(line.cutScore).toBe(92.7)
    expect(line.me?.rank).toBe(1)
    expect(line.rows[0].points).toBe(128.6)
  })

  it('prints no score it was not served', () => {
    const line = buildChopLine(tiers, null, null)
    expect(line.rows.every((r) => r.points === null)).toBe(true)
    expect(line.cutScore).toBeNull()
  })

  it('headline is worded from the tier', () => {
    const line = buildChopLine(tiers, 'me', scores)
    expect(guillotineHeadline({ week: 5, me: line.me, alive: 3, myChoppedWeek: null })).toBe('Week 5 · You’re 35.9 points over the cut')
    const zone = buildChopLine(tiers, 'z', scores)
    expect(guillotineHeadline({ week: 5, me: zone.me, alive: 3, myChoppedWeek: null })).toBe('Week 5 · You’re in the chop zone')
    expect(guillotineHeadline({ week: 5, me: null, alive: 3, myChoppedWeek: 2 })).toBe('Week 5 · You were chopped in week 2')
  })

  it('tiebreak words follow the engine (later draft slot loses, week 1 only)', () => {
    expect(tiebreakLabels(['season_points', 'previous_period', 'draft_slot', 'commissioner'])).toEqual([
      'Total season points',
      'Last week’s points',
      'Draft slot, week 1 only (the later slot loses)',
      'Commissioner decision',
    ])
  })

  it('bottomScores returns the lowest three, lowest last', () => {
    expect(bottomScores([{ points: 5 }, { points: 1 }, { points: 9 }, { points: 3 }]).map((r) => r.points)).toEqual([5, 3, 1])
  })
})

const lastChop = {
  week: 4,
  bottom: [
    { rosterId: 'a', name: 'Open Team 12', points: 101.5 },
    { rosterId: 'b', name: 'Open Team 4', points: 97.7 },
    { rosterId: 'c', name: 'Open Team 11', points: 92.7 },
  ],
  choppedRosterIds: ['c'],
  releases: [
    { playerId: 'p1', playerName: 'Player Open', position: 'WR', team: 'MIA', availableAt: '2026-01-01T00:00:00.000Z', status: 'available' },
    { playerId: 'p2', playerName: 'Player Later', position: 'RB', team: null, availableAt: '2099-01-01T00:00:00.000Z', status: 'pending' },
  ],
}

describe('the chop moment', () => {
  it('drops the blade, stamps the lowest team, and Replay re-arms it', () => {
    render(<GuillotineChopMoment leagueId="L1" lastChop={lastChop} aliveCount={8} waiverLabel="Wednesday 7:00 AM ET" />)
    const moment = screen.getByTestId('guillotine-chop-moment')
    expect(moment.getAttribute('data-state')).toBe('armed')
    expect(screen.queryByText('Chopped')).toBeNull()
    fireEvent.click(screen.getByTestId('guillotine-drop-blade'))
    expect(moment.getAttribute('data-state')).toBe('chopped')
    expect(screen.getByText('Chopped')).toBeTruthy()
    expect(screen.getByText('Open Team 11 is out with 92.7. 8 teams remain. Their roster is on waivers.')).toBeTruthy()
    expect(screen.getByText('Survived by 8.8')).toBeTruthy()
    // Bid is live only once a player's FAAB window has opened.
    expect(screen.getByRole('link', { name: 'Bid on Player Open' }).getAttribute('href')).toBe('/league/L1?view=players')
    expect((screen.getByRole('button', { name: /Bid on Player Later/ }) as HTMLButtonElement).disabled).toBe(true)
    fireEvent.click(screen.getByTestId('specialty-replay'))
    expect(moment.getAttribute('data-state')).toBe('armed')
  })

  it('reduced motion opens on the end state', () => {
    const mm = vi.fn().mockReturnValue({ matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn() })
    vi.stubGlobal('matchMedia', mm)
    window.matchMedia = mm as any
    render(<GuillotineChopMoment leagueId="L1" lastChop={lastChop} aliveCount={8} />)
    expect(screen.getByTestId('guillotine-chop-moment').getAttribute('data-state')).toBe('chopped')
    vi.unstubAllGlobals()
    // @ts-expect-error reset jsdom
    delete window.matchMedia
  })
})

describe('GuillotineSpecialtyHome', () => {
  it('wires the hero, chop line, rail and chopped chips to the summary', () => {
    render(
      <GuillotineSpecialtyHome
        leagueId="L1"
        sport="NFL"
        leagueName="Guillotine League 26"
        summary={{
          weekOrPeriod: 5,
          dangerTiers: tiers,
          myRosterId: 'me',
          myEscapes: [{ weekOrPeriod: 4, margin: 22.1 }],
          config: { tiebreakerOrder: ['season_points'], teamsPerChop: 1, dangerMarginPoints: 12 },
          home: {
            season: 2026,
            scores,
            teamCount: 14,
            aliveCount: 3,
            chopped: [{ rosterId: 'x', name: 'Open Team 3', week: 1, points: 71.2 }],
            nextChopAt: new Date(Date.now() + 86400000).toISOString(),
            chopLabel: 'Tuesday 7:00 AM ET',
            nextWaiversAt: null,
            waiverLabel: null,
            lastChop,
          },
        }}
      />,
    )
    expect(screen.getAllByText('Guillotine League 26').length).toBeGreaterThan(0)
    expect(screen.getByText('14 teams · 3 alive')).toBeTruthy()
    expect(screen.getByTestId('specialty-headline').textContent).toBe('Week 5 · You’re 35.9 points over the cut')
    expect(screen.getByTestId('guillotine-row-chop_zone').textContent).toContain('92.7')
    expect(screen.getByTestId('guillotine-cut-line').textContent).toBe('CUT LINE · 92.7')
    expect(screen.getByTestId('guillotine-your-survival').textContent).toContain('You’re 1st of 3. The cut is at 92.7.')
    expect(screen.getByText('Open Team 3 was chopped')).toBeTruthy()
    expect(screen.getByText('You survived week 4')).toBeTruthy()
    expect(screen.getByTestId('guillotine-chop-moment')).toBeTruthy()
    // Projected has no data source yet: present, honest, and not clickable.
    expect((screen.getByRole('button', { name: 'Projected' }) as HTMLButtonElement).disabled).toBe(true)
  })
})
