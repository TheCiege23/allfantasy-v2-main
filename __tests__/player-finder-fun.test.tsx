import { act, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('next/link', () => ({
  __esModule: true,
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode } & Record<string, unknown>) => (
    <a href={href} {...(rest as Record<string, string>)}>
      {children}
    </a>
  ),
}))

import { CoinFlips, SWIPE_PX } from '@/components/core-app/player-finder/CoinFlips'
import { ExposureChip, FormSpark } from '@/components/core-app/player-finder/PlayerFunChips'
import { TrendingAdds } from '@/components/core-app/player-finder/TrendingAdds'
import { WeeklyMvpCard } from '@/components/core-app/player-finder/WeeklyMvpCard'
import { COIN_FLIP_POINTS, MAX_COIN_FLIPS, coinFlipsOf, exposureOf, formOf, sparkPath, type CoinFlip } from '@/lib/core-app/playerFun'
import type { LeagueImpact } from '@/lib/core-app/playerImpact'
import type { SeasonWeek } from '@/lib/core-app/playerSeason'
import type { WeeklyMvp } from '@/lib/core-app/weeklyMvp'

/*
 * The fun layer and the trending "add him" prompt (Guap, 2026-10-08, #5 and #6). Every piece is built
 * from numbers the card already has, and renders nothing rather than guess.
 */

afterEach(() => vi.unstubAllGlobals())

describe('exposureOf', () => {
  it('a ratio of two counts the header already prints, with a tier', () => {
    expect(exposureOf(4, 65)).toEqual({ leagues: 4, of: 65, pct: 6, tier: 'sprinkle' })
    expect(exposureOf(6, 65)!.tier).toBe('piece')
    expect(exposureOf(15, 65)!.tier).toBe('big')
    expect(exposureOf(30, 65)!.tier).toBe('core')
    expect(exposureOf(1, 500)!.pct).toBe(1) // never "0%" for a league you are in
  })
  it('nothing when you do not have him, or the denominator is unknown', () => {
    expect(exposureOf(0, 65)).toBeNull()
    expect(exposureOf(3, 0)).toBeNull()
  })
})

const wk = (week: number, actual: number | null, played = true): SeasonWeek => ({ week, opponent: null, projected: null, actual, played })

describe('formOf', () => {
  it('🛑 fewer than three real games: no call at all', () => {
    expect(formOf([wk(1, 20), wk(2, 30), wk(3, null, false)])).toBeNull()
  })
  it('hot when the last three run 20% over the season, cold 20% under, steady between', () => {
    expect(formOf([wk(1, 10), wk(2, 10), wk(3, 10), wk(4, 25), wk(5, 25), wk(6, 25)])!.call).toBe('hot')
    expect(formOf([wk(1, 25), wk(2, 25), wk(3, 25), wk(4, 8), wk(5, 8), wk(6, 8)])!.call).toBe('cold')
    expect(formOf([wk(1, 20), wk(2, 21), wk(3, 19), wk(4, 20)])!.call).toBe('steady')
  })
  it('sorts by week and keeps the last six for the sparkline', () => {
    const f = formOf([wk(8, 8), wk(1, 1), wk(2, 2), wk(3, 3), wk(4, 4), wk(5, 5), wk(6, 6), wk(7, 7)])!
    expect(f.points).toEqual([3, 4, 5, 6, 7, 8])
  })
  it('a near-zero season is steady, never a divide-by-nothing "hot"', () => {
    expect(formOf([wk(1, 0), wk(2, 0), wk(3, 0.5)])!.call).toBe('steady')
  })
  it('sparkPath: a flat line sits mid-height', () => {
    expect(sparkPath([5, 5], 10, 10)).toBe('2.0,5.0 8.0,5.0')
  })
})

const impact = (over: Partial<LeagueImpact>): LeagueImpact => ({
  leagueId: 'L1',
  leagueName: 'KBFL',
  platform: 'sleeper',
  platformLeagueId: '123',
  season: 2026,
  slot: 'STARTER',
  exactSlot: 'QB',
  slotConfirmed: true,
  isStarting: true,
  afPoints: { available: true, data: { points: 20, matchedKeys: 1, scoredKeys: 1 } },
  replacements: { available: true, data: [] },
  startOver: null,
  ...over,
} as LeagueImpact)

const rep = (name: string, points: number, injuryStatus: string | null = null) => ({
  playerId: name, name, position: 'QB', team: null, afPoints: points, delta: points - 20, injuryStatus, from: 'BENCH',
})

describe('coinFlipsOf', () => {
  it(`starting: the best healthy bench option within ${COIN_FLIP_POINTS} pts is a flip, leaning to whoever projects more`, () => {
    const [f] = coinFlipsOf([impact({ replacements: { available: true, data: [rep('Mahomes', 21.5), rep('Hurt', 30, 'Out')] } })], 'Josh Allen')
    expect(f).toMatchObject({ a: { name: 'Josh Allen', points: 20 }, b: { name: 'Mahomes', points: 21.5 }, aStarting: true, lean: 'b', margin: 1.5 })
  })
  it('starting with no close option is not a flip', () => {
    expect(coinFlipsOf([impact({ replacements: { available: true, data: [rep('Backup', 10)] } })], 'Josh Allen')).toEqual([])
  })
  it('benched: the starter he could replace, within the band', () => {
    const [f] = coinFlipsOf(
      [impact({ isStarting: false, slot: 'BENCH', startOver: { playerId: 's', name: 'Starter', position: 'QB', team: null, slot: 'QB', afPoints: 21, delta: -1 } })],
      'Josh Allen',
    )
    expect(f).toMatchObject({ aStarting: false, lean: 'b', margin: 1 })
  })
  it('🛑 unpriced under the league’s scoring: skipped, never guessed', () => {
    expect(coinFlipsOf([impact({ afPoints: { available: false, reason: 'no scoring' } as LeagueImpact['afPoints'], replacements: { available: true, data: [rep('M', 21)] } })], 'X')).toEqual([])
  })
  it(`closest first, at most ${MAX_COIN_FLIPS}`, () => {
    const flips = coinFlipsOf(
      [2.5, 0.5, 1.5, 1].map((d, i) => impact({ leagueId: `L${i}`, replacements: { available: true, data: [rep('M', 20 + d)] } })),
      'X',
    )
    expect(flips.map((f) => f.margin)).toEqual([0.5, 1, 1.5])
  })
})

const FLIP: CoinFlip = { leagueId: 'L1', leagueName: 'KBFL', a: { name: 'Josh Allen', points: 20 }, b: { name: 'Patrick Mahomes', points: 21.5 }, aStarting: true, lean: 'b', margin: 1.5 }
const LINK = { href: 'https://sleeper.com/leagues/123/team', external: true, platformLabel: 'Sleeper' }

describe('CoinFlips', () => {
  it('tap a side: we say whether we agree, show our lean, and offer the lineup', () => {
    render(<CoinFlips flips={[FLIP]} linkFor={() => LINK} />)
    expect(screen.queryByRole('status')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: /Josh Allen/ }))
    const reveal = screen.getByRole('status')
    expect(reveal).toHaveTextContent('Bold call 👀')
    expect(reveal).toHaveTextContent('We lean Mahomes by 1.5 pts.')
    expect(within(reveal).getByRole('link', { name: 'Set lineup in Sleeper' })).toHaveAttribute('href', LINK.href)
    fireEvent.click(screen.getByRole('button', { name: 'Change pick' }))
    expect(screen.queryByRole('status')).toBeNull()
  })

  it('swipe toward the other name picks him — and agreeing says so', () => {
    const { container } = render(<CoinFlips flips={[FLIP]} linkFor={() => null} />)
    const pair = container.querySelector('.af-pf-flip-pair')!
    fireEvent.pointerDown(pair, { clientX: 100, clientY: 100 })
    fireEvent.pointerMove(pair, { clientX: 100 + SWIPE_PX + 10, clientY: 104 })
    fireEvent.pointerUp(pair, { clientX: 100 + SWIPE_PX + 10, clientY: 104 })
    expect(screen.getByRole('status')).toHaveTextContent('Great minds ✅')
    expect(screen.getByRole('button', { name: /Patrick Mahomes/ })).toHaveAttribute('aria-pressed', 'true')
  })

  it('a short or vertical drag picks nothing', () => {
    const { container } = render(<CoinFlips flips={[FLIP]} linkFor={() => null} />)
    const pair = container.querySelector('.af-pf-flip-pair')!
    fireEvent.pointerDown(pair, { clientX: 100, clientY: 100 })
    fireEvent.pointerMove(pair, { clientX: 120, clientY: 300 })
    fireEvent.pointerUp(pair, { clientX: 120, clientY: 300 })
    expect(screen.queryByRole('status')).toBeNull()
  })
})

describe('chips', () => {
  it('exposure and form render their words; nothing without data', () => {
    render(
      <>
        <ExposureChip exposure={exposureOf(4, 65)} />
        <FormSpark form={formOf([wk(1, 10), wk(2, 10), wk(3, 10), wk(4, 25), wk(5, 25), wk(6, 25)])} />
      </>,
    )
    expect(screen.getByText('6% exposure · Sprinkle')).toBeInTheDocument()
    expect(screen.getByText('🔥 Hot')).toBeInTheDocument()
    const { container } = render(
      <>
        <ExposureChip exposure={null} />
        <FormSpark form={null} />
      </>,
    )
    expect(container.innerHTML).toBe('')
  })
})

const MVP: WeeklyMvp = {
  season: 2026,
  week: 4,
  player: { sleeperId: '4984', name: 'Josh Allen', position: 'QB', team: 'BUF', imageUrl: null, ref: 'NFL:4984' },
  points: 61.4,
  leagues: [
    { leagueId: 'A', leagueName: 'KBFL', points: 31.2 },
    { leagueId: 'B', leagueName: 'Secret League', points: 30.2 },
  ],
  runnerUp: { name: 'Ja’Marr Chase', points: 44 },
  leaguesRead: 5,
}

describe('WeeklyMvpCard', () => {
  it('names the MVP, the points across leagues and the margin over the runner-up', () => {
    render(<WeeklyMvpCard mvp={MVP} />)
    expect(screen.getByRole('heading', { name: 'Your Week 4 MVP' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Josh Allen' })).toHaveAttribute('href', '/core/players?q=Josh%20Allen&player=NFL%3A4984')
    expect(screen.getByText('61.4 pts for you across 2 leagues')).toBeInTheDocument()
    expect(screen.getByText('17.4 pts clear of Ja’Marr Chase')).toBeInTheDocument()
  })

  it('🛑 shares through the phone’s sheet — the text names no league', async () => {
    const shareFn = vi.fn(async () => {})
    vi.stubGlobal('navigator', { share: shareFn })
    render(<WeeklyMvpCard mvp={MVP} />)
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Share' }))
    })
    const sent = (shareFn.mock.calls[0] as unknown as [{ text: string }])[0].text
    expect(sent).toBe('🏆 My Week 4 fantasy MVP: Josh Allen — 61.4 pts across 2 leagues. Tracked on AllFantasy.')
    expect(sent).not.toMatch(/KBFL|Secret League/)
    expect(screen.getByRole('button', { name: 'Shared' })).toBeInTheDocument()
  })

  it('no share sheet: copies the line instead', async () => {
    const writeText = vi.fn(async () => {})
    vi.stubGlobal('navigator', { clipboard: { writeText } })
    render(<WeeklyMvpCard mvp={MVP} />)
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Share' }))
    })
    expect(writeText).toHaveBeenCalled()
    expect(screen.getByRole('button', { name: /Copied/ })).toBeInTheDocument()
  })

  it('nothing without an MVP', () => {
    const { container } = render(<WeeklyMvpCard mvp={null} />)
    expect(container.innerHTML).toBe('')
  })
})

describe('TrendingAdds — "Free in N of yours · add"', () => {
  const DATA = {
    rows: [
      { sleeperId: '1', name: 'Rico Dowdle', position: 'RB', team: 'DAL', imageUrl: null, ref: 'NFL:1', leagues: 120 },
      { sleeperId: '2', name: 'Nobody Free', position: 'WR', team: 'NYG', imageUrl: null, ref: 'NFL:2', leagues: 80 },
    ],
    activeLeagues: 900,
    through: null,
  }

  it('a player free in your leagues gets the add line, opening his card at "Available in your leagues"', () => {
    render(
      <TrendingAdds
        data={DATA}
        leagueParam=""
        freeIn={{ '1': [{ leagueId: 'A', leagueName: 'KBFL', href: '/core/waivers?league=A' }, { leagueId: 'B', leagueName: 'Home', href: '/core/waivers?league=B' }] }}
      />,
    )
    const add = screen.getByRole('link', { name: 'Rico Dowdle is free in 2 of your leagues — see where to add him' })
    expect(add).toHaveTextContent('Free in 2 of yours · add')
    expect(add).toHaveAttribute('href', '/core/players?q=Rico%20Dowdle&player=NFL%3A1#af-pf-fa-h')
    expect(screen.queryByRole('link', { name: /Nobody Free is free/ })).toBeNull()
  })

  it('signed out (no freeIn): the rows are exactly as before', () => {
    render(<TrendingAdds data={DATA} leagueParam="" />)
    expect(screen.queryByText(/Free in/)).toBeNull()
  })
})
