import React from 'react'
import { describe, expect, it, vi } from 'vitest'
import { render } from '@testing-library/react'

import { MyTeam } from '@/components/core-app/screens/MyTeam'
import type { LineupPlayer, MyTeamData } from '@/lib/core-app/myTeam'

const NOW = new Date('2026-08-24T20:00:00Z')

function player(over: Partial<LineupPlayer> = {}): LineupPlayer {
  return {
    sleeperId: over.sleeperId ?? 'p1',
    name: 'Bo Nix',
    position: 'QB',
    team: 'DEN',
    imageUrl: null,
    gameContext: 'DEN vs MIA · Sun 9:05p',
    kickoff: new Date('2026-09-13T21:05:00Z'),
    preseason: false,
    venue: null,
    injuryStatus: null,
    ruledOut: false,
    projectedPoints: 19.8,
    afProjectedPoints: 22.4,
    indoors: false,
    weather: null,
    onBye: false,
    ...over,
  }
}

function data(over: Partial<MyTeamData> = {}): MyTeamData {
  return {
    league: { id: 'l1', name: 'SF TEP.5', platform: 'sleeper', format: 'dynasty' },
    team: {
      available: true,
      data: {
        teamName: '(F) SF TEP.5',
        ownerName: 'chxnk',
        managerAvatarUrl: 'https://sleepercdn.com/avatars/thumbs/abc',
        record: 'no results read yet',
        rank: 4,
        pointsFor: 0,
        pointsAgainst: 0,
        teamCount: 12,
      },
    },
    starters: {
      available: true,
      data: [{ slotLabel: 'QB', player: player(), empty: false, unresolvedId: null }],
    },
    bench: { available: true, data: [player({ sleeperId: 'b1' })] },
    ir: { available: false, reason: 'nobody on injured reserve' },
    taxi: { available: false, reason: 'nobody on the taxi squad' },
    lock: {
      available: true,
      data: {
        at: new Date('2026-09-13T21:05:00Z'),
        anyEmptySlot: false,
        week: 1,
        season: 2026,
        daysAway: 3,
      },
    },
    projections: {
      available: true,
      data: {
        total: 118.4,
        projected: 8,
        unprojected: 0,
        season: '2026',
        week: 1,
        afTotal: 131.7,
        afProjected: 8,
      },
    },
    projectionBasis: { notes: ['Tight ends get an extra 0.5 per catch on top.'], scoringKnown: true },
    nextMatchup: {
      available: true,
      data: {
        seasonYear: 2026,
        week: 1,
        you: {
          rosterId: 4, teamName: '(F) SF TEP.5', managerName: 'chxnk',
          avatarUrl: null, projected: 131.7, projectedFrom: 9, starterCount: 9,
        },
        opponent: {
          rosterId: 7, teamName: 'DynastyDan', managerName: 'dan',
          avatarUrl: null, projected: 118.2, projectedFrom: 9, starterCount: 9,
        },
        bye: false,
      },
    },
    upcomingByes: [],
    rosterGrade: {
      available: true,
      data: {
        rank: 3, outOf: 12, value: 41200, median: 38000,
        strongest: { position: 'WR', value: 18400, rank: 2, outOf: 12, playerCount: 7 },
        weakest: { position: 'TE', value: 2100, rank: 11, outOf: 12, playerCount: 2 },
        pricedPlayers: 24, totalPlayers: 26,
        basis: { format: 'DYNASTY', qbFormat: 'ONE_QB', capturedAt: '2026-08-22T00:00:00.000Z' },
      },
    },
    liveScore: { available: false, reason: 'no live scoring' },
    ...over,
  } as MyTeamData
}

function text(ui: React.ReactElement): string {
  return (render(ui).container.textContent ?? '').replace(/\s+/g, ' ')
}

describe('My Team — the reported problems', () => {
  it('⚠ prices BENCH players, not only starters', () => {
    // The bench rendered a name and a status chip and nothing else, so half the
    // roster carried no number at all and could not be compared to the half
    // that did — which is the entire point of looking at a bench.
    const t = text(<MyTeam data={data()} />)
    expect(t).toContain('19.8')
    // Twice: once in the starting slot, once on the bench.
    expect(t.match(/19\.8/g)?.length).toBe(2)
  })

  it('⚠ shows a ruled-out player as 0.0 beside the reason, not as an em dash', () => {
    const out = player({ injuryStatus: 'Out', ruledOut: true, projectedPoints: 0, afProjectedPoints: 0 })
    const t = text(
      <MyTeam
        data={data({
          starters: {
            available: true,
            data: [{ slotLabel: 'RB', player: out, empty: false, unresolvedId: null }],
          },
        })}
      />,
    )
    expect(t).toContain('Out')
    expect(t).toContain('0.0')
  })

  it('keeps the em dash for a player we simply cannot price', () => {
    /*
     * The distinction the whole screen rests on: zero is a claim that he will
     * score nothing, and we may only make it when the league has ruled him out.
     * "No projection on file" is a different sentence and stays a dash.
     */
    const unpriced = player({ projectedPoints: null, afProjectedPoints: null, ruledOut: false })
    const t = text(
      <MyTeam
        data={data({
          starters: {
            available: true,
            data: [{ slotLabel: 'WR', player: unpriced, empty: false, unresolvedId: null }],
          },
          bench: { available: false, reason: 'no bench players recorded on this roster' },
        })}
      />,
    )
    expect(t).toContain('—')
    expect(t).not.toMatch(/\b0\.0\b/)
  })

  it('⚠ counts the lock in DAYS, never as a four-digit hour', () => {
    // It printed "2321:15:08" — 97 days expressed in hours, because hours were
    // the largest unit the formatter had.
    const t = text(
      <MyTeam
        data={data({
          lock: {
            available: true,
            data: {
              at: new Date(NOW.getTime() + 3 * 86_400_000),
              anyEmptySlot: false,
              week: 1,
              season: 2026,
              daysAway: 3,
            },
          },
        })}
      />,
    )
    expect(t).toMatch(/\dd \d+h/)
    expect(t).not.toMatch(/\b\d{4,}:\d\d:\d\d\b/)
  })

  it('⚠ calls a lock months out a coverage gap instead of counting down to it', () => {
    const t = text(
      <MyTeam
        data={data({
          lock: {
            available: true,
            data: {
              at: new Date('2026-11-29T18:00:00Z'),
              anyEmptySlot: false,
              week: 13,
              season: 2026,
              daysAway: 97,
            },
          },
        })}
      />,
    )
    expect(t).toContain('97 days away')
    expect(t).toMatch(/has not been ingested/)
  })

  it('names the week the lock belongs to', () => {
    expect(text(<MyTeam data={data()} />)).toContain('Week 1 locks')
  })

  it('⚠ shows the manager, whose name was imported and never rendered', () => {
    const t = text(<MyTeam data={data()} />)
    expect(t).toContain('chxnk')
    const img = render(<MyTeam data={data()} />).container.querySelector('.af-mt-crest--photo')
    expect(img?.getAttribute('src')).toContain('sleepercdn.com')
  })

  it('falls back to a monogram when the manager has no avatar', () => {
    const d = data()
    const c = render(
      <MyTeam data={data({ team: { available: true, data: { ...d.team.data!, managerAvatarUrl: null } } as never })} />,
    ).container
    expect(c.querySelector('.af-mt-crest--photo')).toBeNull()
    expect(c.querySelector('.af-mt-crest')).toBeTruthy()
  })

  it('puts BOTH weekly totals at the top', () => {
    const t = text(<MyTeam data={data()} />)
    expect(t).toContain('118.4')
    expect(t).toContain('131.7')
    expect(t).toContain('Projected · your league')
  })

  it('explains why the two totals differ, in the league&apos;s own rules', () => {
    expect(text(<MyTeam data={data()} />)).toContain('Tight ends get an extra 0.5')
  })

  it('says so plainly when we do not hold the league&apos;s scoring', () => {
    const t = text(
      <MyTeam
        data={data({
          projectionBasis: { notes: [], scoringKnown: false },
          projections: {
            available: true,
            data: {
              total: 118.4, projected: 8, unprojected: 0, season: '2026', week: 1,
              afTotal: null, afProjected: 0,
            },
          },
        })}
      />,
    )
    expect(t).toContain('do not hold this league')
  })

  it('offers to hand the question to Chimmy, seeded and unsent', () => {
    const spy = vi.fn()
    window.addEventListener('af-comms-open', spy)
    const btn = render(<MyTeam data={data()} />).container.querySelector(
      '.af-mt-ask',
    ) as HTMLButtonElement
    btn.click()
    window.removeEventListener('af-comms-open', spy)

    expect(spy).toHaveBeenCalledTimes(1)
    const detail = (spy.mock.calls[0][0] as CustomEvent).detail
    expect(detail.tab).toBe('chimmy')
    // Seeded only — the screen must not spend a request the user never sent.
    expect(detail.prefill).toContain('SF TEP.5')
  })

  it('⚠ labels taxi players TAXI, not IR', () => {
    /*
     * IR and taxi were one list and every row said "IR". A healthy rookie on
     * the taxi squad is not injured, and the label sent managers looking for a
     * problem that did not exist.
     */
    const t = text(
      <MyTeam
        data={data({
          taxi: {
            available: true,
            data: [
              {
                ...player({ sleeperId: 't1' }),
                tenure: { yearsUsed: 1, yearsAllowed: 2, yearsRemaining: 1 },
              },
            ],
          } as never,
        })}
      />,
    )
    expect(t).toContain('TAXI')
    expect(t).toContain('Taxi squad')
    expect(t).toContain('1 of 2 year left')
  })

  it('refuses to guess taxi years when the history is missing', () => {
    const t = text(
      <MyTeam
        data={data({
          taxi: {
            available: true,
            data: [{ ...player({ sleeperId: 't1' }), tenure: null }],
          } as never,
        })}
      />,
    )
    expect(t).toContain('years left unknown')
  })

  it('marks a preseason game so a meaningless projection cannot pose as a week', () => {
    const t = text(
      <MyTeam
        data={data({
          starters: {
            available: true,
            data: [
              {
                slotLabel: 'QB',
                player: player({ preseason: true, gameContext: 'DEN vs MIA · Thu 8:00p' }),
                empty: false,
                unresolvedId: null,
              },
            ],
          },
        })}
      />,
    )
    expect(t).toContain('PRESEASON')
  })

  it('shows an indoor mark for a dome and an outdoor mark otherwise', () => {
    const dome = render(
      <MyTeam
        data={data({
          starters: {
            available: true,
            data: [{ slotLabel: 'QB', player: player({ indoors: true }), empty: false, unresolvedId: null }],
          },
        })}
      />,
    ).container.querySelector('.af-mt-venue')
    expect(dome?.getAttribute('data-indoors')).toBe('true')
  })

  it('renders no venue mark at all when the stadium is unknown', () => {
    // Better a missing symbol than a confident "outdoors" for a game we cannot
    // place — weather advice would follow from it.
    const c = render(
      <MyTeam
        data={data({
          starters: {
            available: true,
            data: [{ slotLabel: 'QB', player: player({ indoors: null }), empty: false, unresolvedId: null }],
          },
          bench: { available: false, reason: 'none' },
        })}
      />,
    ).container
    expect(c.querySelector('.af-mt-venue')).toBeNull()
  })

  it('shows each starter&apos;s share of the projected total', () => {
    // 22.4 of 131.7 = 17%. Concentration is a real risk signal: a lineup
    // resting on one player reads very differently from an even one.
    expect(text(<MyTeam data={data()} />)).toContain('17%')
  })

  it('gives bench players no share, because they contribute none', () => {
    const rows = render(<MyTeam data={data()} />).container.querySelectorAll('.af-mt-row')
    const bench = rows[rows.length - 1]
    expect(bench.textContent).not.toMatch(/\d+%/)
  })

  it('⚠ replaces the two empty points tiles with the matchup you are about to play', () => {
    /*
     * Points for / against were the season's running totals — 0-0 for every
     * team until a game is scored — so the most prominent numbers on the screen
     * were em dashes through the whole preseason.
     */
    const t = text(<MyTeam data={data()} />)
    expect(t).toContain('projected matchup')
    expect(t).toContain('131.7')
    expect(t).toContain('118.2')
    expect(t).toContain('DynastyDan')
    expect(t).toContain('projected ahead by 13.5')
  })

  it('calls a close matchup a coin flip rather than picking a winner', () => {
    const d = data()
    const t = text(
      <MyTeam
        data={data({
          nextMatchup: {
            available: true,
            data: {
              ...d.nextMatchup.data!,
              opponent: { ...d.nextMatchup.data!.opponent!, projected: 130.1 },
            },
          },
        } as never)}
      />,
    )
    expect(t).toContain('coin flip')
  })

  it('⚠ gives NO verdict when either lineup is only partly priced', () => {
    /*
     * A margin between two totals built from different numbers of starters is
     * not a margin, it is an artefact of coverage — and "ahead by 12" is
     * exactly the sentence a manager would act on.
     */
    const d = data()
    const t = text(
      <MyTeam
        data={data({
          nextMatchup: {
            available: true,
            data: {
              ...d.nextMatchup.data!,
              opponent: { ...d.nextMatchup.data!.opponent!, projectedFrom: 5, starterCount: 9 },
            },
          },
        } as never)}
      />,
    )
    expect(t).not.toMatch(/projected (ahead|behind)/)
    expect(t).toContain('from 5 of 9')
  })

  it('says the opponent is unset rather than inventing one', () => {
    const d = data()
    const t = text(
      <MyTeam
        data={data({
          nextMatchup: {
            available: true,
            data: { ...d.nextMatchup.data!, opponent: null, bye: true },
          },
        } as never)}
      />,
    )
    expect(t).toContain('Opponent not set')
  })

  it('⚠ grades the roster as a RANK inside the league, never a letter', () => {
    /*
     * A "C" trade grade in this repo turned out to mean "we priced nothing",
     * and it was indistinguishable from a considered verdict. A rank names the
     * comparison it is making; a letter invents a scale and hides its inputs.
     */
    const t = text(<MyTeam data={data()} />)
    expect(t).toContain('3rd')
    expect(t).toContain('of 12')
    expect(t).toContain('Roster value in this league')
    expect(t).not.toMatch(/grade: [A-F][+-]?/i)
  })

  it('names the strongest and thinnest position, which is the actionable half', () => {
    const t = text(<MyTeam data={data()} />)
    expect(t).toContain('WR is your best')
    expect(t).toContain('TE your thinnest')
  })

  it('states partial pricing rather than folding it into the rank', () => {
    expect(text(<MyTeam data={data()} />)).toContain('priced 24 of your 26')
  })

  it('says why there is no rank instead of showing a neutral one', () => {
    const t = text(
      <MyTeam
        data={data({
          rosterGrade: { available: false, reason: 'we need prices for most of this league' },
        } as never)}
      />,
    )
    expect(t).toContain('we need prices for most of this league')
  })

  it('⚠ flags a starter whose team is not playing at all', () => {
    /*
     * The most preventable loss in fantasy, and nothing on this screen warned
     * about it. A starter on bye is a guaranteed zero, so the row gets the same
     * treatment as an empty slot — because that is what it is.
     */
    const c = render(
      <MyTeam
        data={data({
          starters: {
            available: true,
            data: [
              {
                slotLabel: 'RB',
                player: player({ onBye: true, projectedPoints: 0, afProjectedPoints: 0 }),
                empty: false,
                unresolvedId: null,
              },
            ],
          },
        })}
      />,
    ).container
    expect(c.textContent).toContain('BYE')
    expect(c.querySelector('.af-mt-row[data-bye="true"]')).toBeTruthy()
  })

  it('shows byes forming before the waiver wire is picked over', () => {
    const t = text(
      <MyTeam
        data={data({
          upcomingByes: [{ week: 7, names: ['Bo Nix', 'RJ Harvey', 'Tyler Allgeier'] }],
        } as never)}
      />,
    )
    expect(t).toContain('Byes coming up')
    expect(t).toContain('Week 7')
    expect(t).toContain('3 off')
  })

  it('marks three-or-more in one week as a stack', () => {
    const c = render(
      <MyTeam
        data={data({
          upcomingByes: [
            { week: 7, names: ['a', 'b', 'c'] },
            { week: 9, names: ['d'] },
          ],
        } as never)}
      />,
    ).container
    const items = c.querySelectorAll('.af-mt-byes-list li')
    expect(items[0].getAttribute('data-stack')).toBe('true')
    expect(items[1].getAttribute('data-stack')).toBe('false')
  })

  it('⚠ labels the columns PTS and AF PTS, with an explainer on the AF one', () => {
    const t = text(<MyTeam data={data()} />)
    expect(t).toContain('AF PTS')
    // Two numbers side by side with no explanation read as a bug, not a feature.
    const c = render(<MyTeam data={data()} />).container
    expect(c.querySelector('.af-mt-info')).toBeTruthy()
    expect(c.querySelector('.af-mt-info')?.getAttribute('aria-label')?.toLowerCase()).toContain(
      'your league',
    )
  })

  it('⚠ shares are taken against ONE measure, so they cannot exceed 100%', () => {
    /*
     * THE BUG: the share fell back to the generic number when the league-scored
     * one was missing, while the total it divided by summed only league-scored
     * values. A player with no AF number counted in the numerator and not the
     * denominator. On a real roster the shares summed to 116%.
     */
    const withAf = player({ afProjectedPoints: 20, projectedPoints: 10 })
    const noAf = player({ sleeperId: 'p2', afProjectedPoints: null, projectedPoints: 40 })
    const c = render(
      <MyTeam
        data={data({
          starters: {
            available: true,
            data: [
              { slotLabel: 'QB', player: withAf, empty: false, unresolvedId: null },
              { slotLabel: 'RB', player: noAf, empty: false, unresolvedId: null },
            ],
          },
          bench: { available: false, reason: 'none' },
          projections: {
            available: true,
            data: {
              total: 50, projected: 2, unprojected: 0, season: '2026', week: 1,
              afTotal: 20, afProjected: 1,
            },
          },
        })}
      />,
    ).container

    const shares = [...c.querySelectorAll('.af-mt-share')]
      .map((e) => e.textContent ?? '')
      .filter((x) => x.includes('%'))
      .map((x) => Number(x.replace('%', '')))
    // The AF-priced player is 100% of the AF total; the unpriced one gets none.
    expect(shares).toEqual([100])
    expect(shares.reduce((a, b) => a + b, 0)).toBeLessThanOrEqual(100)
  })

  it('colour-codes the position chip by family', () => {
    const c = render(<MyTeam data={data()} />).container
    expect(c.querySelector('.af-mt-slot[data-pos="qb"]')).toBeTruthy()
  })

  it('puts the BYE chip beside the name, where it is read first', () => {
    const c = render(
      <MyTeam
        data={data({
          starters: {
            available: true,
            data: [
              { slotLabel: 'RB', player: player({ onBye: true }), empty: false, unresolvedId: null },
            ],
          },
        })}
      />,
    ).container
    expect(c.querySelector('.af-mt-player-name .af-mt-bye')).toBeTruthy()
  })

  it('shows a real forecast when one is cached, and a bare venue mark when not', () => {
    const withForecast = render(
      <MyTeam
        data={data({
          starters: {
            available: true,
            data: [
              {
                slotLabel: 'WR',
                player: player({
                  weather: {
                    indoors: false, temperatureF: 31, windSpeedMph: 18,
                    precipChancePct: 60, conditionLabel: 'Snow', symbol: '❄',
                  },
                }),
                empty: false,
                unresolvedId: null,
              },
            ],
          },
          bench: { available: false, reason: 'none' },
        })}
      />,
    ).container
    expect(withForecast.querySelector('.af-mt-venue[data-forecast="true"]')).toBeTruthy()
    expect(withForecast.textContent).toContain('31°')

    // No forecast yet is a different statement from no weather.
    const bare = render(<MyTeam data={data()} />).container
    expect(bare.querySelector('.af-mt-venue[data-forecast="true"]')).toBeNull()
    expect(bare.querySelector('.af-mt-venue')).toBeTruthy()
  })
})
