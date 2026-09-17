import React from 'react'
import { describe, expect, it } from 'vitest'
import { render, within } from '@testing-library/react'

import YourWeekLeague from '@/components/core-app/screens/YourWeekLeague'
import YourWeek from '@/components/core-app/screens/YourWeek'
import type {
  LeagueSideline,
  LeagueWeekBoard,
  WeekBoard,
  WeekMatchup,
} from '@/lib/core-app/weekBoard'

/*
 * Team avatars on "Your week" (2026-09-16).
 *
 * The league-scoped hero rendered a "YOU" circle and the opponent's initials
 * even when both teams had real avatars on the platform, and the "Rest of"
 * grid showed no avatar at all. What must hold now:
 *
 *   · a resolved URL renders as an <img> with that exact src;
 *   · a null URL keeps the text fallback — "YOU" for you, initials for anyone
 *     else — and never renders an <img> with an empty or made-up src.
 */

const MY_AVATAR = 'https://sleepercdn.com/avatars/thumbs/mine'
const OPP_AVATAR = 'https://sleepercdn.com/avatars/thumbs/theirs'
const SIDE_A = 'https://example.com/side-a.png'

function matchup(over: Partial<WeekMatchup> = {}): WeekMatchup {
  return {
    leagueId: 'l1',
    leagueName: 'Turf Wars',
    platform: 'sleeper',
    leagueImageUrl: null,
    season: 2026,
    week: 3,
    opponent: { rosterId: '2', name: 'Gridiron Ghosts', avatarUrl: OPP_AVATAR },
    elimination: false,
    projection: { you: 120, them: 110, margin: 10, winProbability: 0.72 },
    yourSampleWeeks: 5,
    href: '/core/matchup?league=l1',
    ...over,
  }
}

function sideline(over: Partial<LeagueSideline> = {}): LeagueSideline {
  return {
    a: { rosterId: '3', name: 'Alpha Wolves', avatarUrl: SIDE_A, projected: 101.2 },
    b: { rosterId: '4', name: 'Bravo Bears', avatarUrl: null, projected: 99.8 },
    aWinProbability: 0.55,
    ...over,
  }
}

function leagueBoard(over: Partial<LeagueWeekBoard> = {}): LeagueWeekBoard {
  return {
    leagueId: 'l1',
    leagueName: 'Turf Wars',
    platform: 'sleeper',
    season: 2026,
    week: 3,
    yours: matchup(),
    sidelines: [sideline()],
    rivalry: null,
    records: {},
    yourRosterId: '1',
    yourTeamName: 'My Team',
    yourAvatarUrl: MY_AVATAR,
    ...over,
  }
}

function hero(container: HTMLElement): HTMLElement {
  const el = container.querySelector<HTMLElement>('section[aria-label="Your matchup"]')
  expect(el).not.toBeNull()
  return el!
}

function sides(container: HTMLElement): { you: HTMLElement; them: HTMLElement } {
  const all = [...hero(container).querySelectorAll<HTMLElement>('.af-wl-side')]
  expect(all).toHaveLength(2)
  const you = all.find((s) => s.dataset.you === 'true')!
  const them = all.find((s) => s.dataset.you !== 'true')!
  return { you, them }
}

describe('YourWeekLeague — the matchup card', () => {
  it('renders both teams’ avatars as images when the loader resolved them', () => {
    const { container } = render(
      <YourWeekLeague board={leagueBoard()} allWeeksHref="/core/week" />,
    )
    const { you, them } = sides(container)

    const myImg = you.querySelector('img.af-wl-avatar')
    expect(myImg).not.toBeNull()
    expect(myImg!.getAttribute('src')).toBe(MY_AVATAR)
    expect(myImg!.getAttribute('alt')).toBe('')
    expect(myImg!.getAttribute('loading')).toBe('lazy')
    expect(myImg!.classList.contains('af-wl-avatar--img')).toBe(true)
    expect(you.textContent).not.toContain('YOU')

    const oppImg = them.querySelector('img.af-wl-avatar')
    expect(oppImg).not.toBeNull()
    expect(oppImg!.getAttribute('src')).toBe(OPP_AVATAR)
    // The initials fallback is gone when the image is there.
    expect(them.querySelector('span.af-wl-avatar')).toBeNull()
  })

  it('keeps "YOU" and the opponent’s initials when there is no avatar', () => {
    const { container } = render(
      <YourWeekLeague
        board={leagueBoard({
          yourAvatarUrl: null,
          yours: matchup({ opponent: { rosterId: '2', name: 'Gridiron Ghosts', avatarUrl: null } }),
        })}
        allWeeksHref="/core/week"
      />,
    )
    const { you, them } = sides(container)
    expect(you.querySelector('img')).toBeNull()
    expect(you.querySelector('span.af-wl-avatar')?.textContent).toBe('YOU')
    expect(them.querySelector('img')).toBeNull()
    expect(them.querySelector('span.af-wl-avatar')?.textContent).toBe('GG')
  })

  it('mixes the two per side — your image, their initials', () => {
    const { container } = render(
      <YourWeekLeague
        board={leagueBoard({
          yours: matchup({ opponent: { rosterId: '2', name: null, avatarUrl: null } }),
        })}
        allWeeksHref="/core/week"
      />,
    )
    const { you, them } = sides(container)
    expect(you.querySelector('img')?.getAttribute('src')).toBe(MY_AVATAR)
    expect(them.querySelector('img')).toBeNull()
    // An unnamed opponent gets the em-dash mark, never invented letters.
    expect(them.querySelector('span.af-wl-avatar')?.textContent).toBe('—')
  })
})

describe('YourWeekLeague — the rest of the league', () => {
  it('gives each sideline team an avatar: the image when set, initials when not', () => {
    const { container } = render(
      <YourWeekLeague board={leagueBoard()} allWeeksHref="/core/week" />,
    )
    const card = container.querySelector<HTMLElement>('.af-wl-card')
    expect(card).not.toBeNull()
    const rows = [...card!.querySelectorAll<HTMLElement>('.af-wl-card-row')]
    expect(rows).toHaveLength(2)

    const [rowA, rowB] = rows as [HTMLElement, HTMLElement]
    expect(within(rowA).getByText('Alpha Wolves')).toBeTruthy()
    const imgA = rowA.querySelector('img.af-wl-card-avatar')
    expect(imgA).not.toBeNull()
    expect(imgA!.getAttribute('src')).toBe(SIDE_A)
    expect(imgA!.getAttribute('alt')).toBe('')
    expect(imgA!.getAttribute('width')).toBe('22')
    expect(rowA.querySelector('span.af-wl-card-avatar')).toBeNull()

    expect(within(rowB).getByText('Bravo Bears')).toBeTruthy()
    expect(rowB.querySelector('img')).toBeNull()
    const fallbackB = rowB.querySelector('span.af-wl-card-avatar')
    expect(fallbackB?.textContent).toBe('BB')
    expect(fallbackB?.getAttribute('aria-hidden')).toBe('true')
  })

  it('still gives each sideline row an avatar when you have no game this week', () => {
    const { container } = render(
      <YourWeekLeague
        board={leagueBoard({
          yours: null,
          yourAvatarUrl: null,
          sidelines: [
            sideline({
              a: { rosterId: '3', name: null, avatarUrl: null, projected: null },
              b: { rosterId: '4', name: 'Solo', avatarUrl: SIDE_A, projected: null },
              aWinProbability: null,
            }),
          ],
        })}
        allWeeksHref="/core/week"
      />,
    )
    const rows = [...container.querySelectorAll<HTMLElement>('.af-wl-card-row')]
    expect(rows[0]!.querySelector('span.af-wl-card-avatar')?.textContent).toBe('—')
    expect(rows[1]!.querySelector('img.af-wl-card-avatar')?.getAttribute('src')).toBe(SIDE_A)
  })
})

describe('YourWeek (?all=1) — coin-flip opponent avatar', () => {
  function board(m: WeekMatchup): WeekBoard {
    return {
      season: 2026,
      week: 3,
      coinFlips: [m],
      leaning: [],
      unprojected: [],
      model: { basis: 'per-team scoring distributions', sampleSize: 40 },
      withoutSchedule: 0,
      firstKickoffAt: null,
      leagueBoard: null,
    }
  }

  it('shows the opponent’s avatar beside their name when one resolved', () => {
    const { container } = render(
      <YourWeek
        data={board(matchup({ projection: { you: 100, them: 98, margin: 2, winProbability: 0.55 } }))}
        rivalriesHref="/core/week?view=rivalries"
      />,
    )
    const line = container.querySelector('.af-wk-flip-line')
    expect(line).not.toBeNull()
    const img = line!.querySelector('img.af-wk-opp-img')
    expect(img?.getAttribute('src')).toBe(OPP_AVATAR)
    expect(img?.getAttribute('alt')).toBe('')
    expect(line!.textContent).toContain('Gridiron Ghosts')
  })

  it('renders no image at all when there is no avatar', () => {
    const { container } = render(
      <YourWeek
        data={board(
          matchup({
            projection: { you: 100, them: 98, margin: 2, winProbability: 0.55 },
            opponent: { rosterId: '2', name: 'Gridiron Ghosts', avatarUrl: null },
          }),
        )}
        rivalriesHref="/core/week?view=rivalries"
      />,
    )
    const line = container.querySelector('.af-wk-flip-line')
    expect(line).not.toBeNull()
    expect(line!.querySelector('img')).toBeNull()
    expect(line!.textContent).toContain('Gridiron Ghosts')
  })
})
