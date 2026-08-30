import React from 'react'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { render } from '@testing-library/react'

import { MyTeam } from '@/components/core-app/screens/MyTeam'
import type { LineupPlayer, MyTeamData } from '@/lib/core-app/myTeam'

const NOW = new Date('2026-08-24T20:00:00Z')

/*
 * ⚠ THIS SUITE ROTTED WITH THE CALENDAR AND HAD NOTHING TO DO WITH THE CODE.
 * Fixtures are built relative to NOW, but the screen reads the REAL clock — so
 * "a lock three days out" stopped being three days out on 2026-08-27, when the
 * wall clock caught up with NOW + 3 days. The lock countdown then rendered
 * `0:34:57`, which is CORRECT for a lock 34 minutes away, and the day-format
 * assertion failed. It would have gone red on that date no matter what shipped.
 *
 * Freezing the clock to NOW makes the fixtures mean what they say, permanently.
 * `shouldAdvanceTime` keeps timer-driven work in React and testing-library from
 * hanging on a clock that never moves.
 */
beforeAll(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true })
  vi.setSystemTime(NOW)
})
afterAll(() => {
  vi.useRealTimers()
})

function player(over: Partial<LineupPlayer> = {}): LineupPlayer {
  return {
    sleeperId: over.sleeperId ?? 'p1',
    name: 'Bo Nix',
    position: 'QB',
    team: 'DEN',
    sport: 'NFL',
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
    market: { ownPct: 1, startPct: 0.92 },
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
        record: 'No game in this league has been scored yet, so there is no record to read.',
        recordKnown: false,
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
        standardComparable: true,
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
        basis: {
          format: 'DYNASTY',
          qbFormat: 'ONE_QB',
          capturedAt: '2026-08-22T00:00:00.000Z',
          leagueScored: true,
        },
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
    // Abbreviated on screen now — "O" — with the full designation preserved as
    // the title, so nothing is lost for a screen reader or an unfamiliar code.
    expect(t).toContain('0.0')
    const chip = render(
      <MyTeam
        data={data({
          starters: {
            available: true,
            data: [{ slotLabel: 'RB', player: out, empty: false, unresolvedId: null }],
          },
        })}
      />,
    ).container.querySelector('.af-mt-status')
    expect(chip?.textContent).toBe('O')
    expect(chip?.getAttribute('title')).toBe('Out')
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
              afTotal: null, afProjected: 0, standardComparable: true,
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

  it('⚠ shows OWN and START from the whole app, not a share of one lineup', () => {
    /*
     * Share used to be this player's fraction of his own team's projected
     * total — a real number answering a question nobody asked. What a manager
     * wants is what the field is doing: universally started, or a bench stash
     * everywhere? Both are computed from AllFantasy's own rosters.
     */
    const t = text(<MyTeam data={data()} />)
    expect(t).toContain('100%')
    expect(t).toContain('92%')
    expect(t).toContain('OWN')
    expect(t).toContain('START')
  })

  it('shows the market on bench rows too, because it is about the player', () => {
    /*
     * The old share column was deliberately blank on the bench, since a benched
     * player contributes nothing to a lineup total. Own and start rates are a
     * fact about the PLAYER across the whole app, so they belong on every row —
     * a bench player started in 80% of leagues elsewhere is exactly the thing
     * worth knowing.
     */
    const rows = render(<MyTeam data={data()} />).container.querySelectorAll('.af-mt-row')
    const bench = rows[rows.length - 1]
    expect(bench.textContent).toMatch(/\d+%/)
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

  it('prints an em dash when the sample is too small to publish a rate', () => {
    // Early on, one manager's decision swings a percentage by double digits.
    // The loader withholds the market entirely below its threshold, and the
    // row must render that absence rather than a zero.
    const c = render(
      <MyTeam
        data={data({
          starters: {
            available: true,
            data: [
              {
                slotLabel: 'QB',
                player: player({ market: null }),
                empty: false,
                unresolvedId: null,
              },
            ],
          },
          bench: { available: false, reason: 'none' },
        })}
      />,
    ).container
    const cells = [...c.querySelectorAll('.af-mt-share')].map((e) => e.textContent)
    expect(cells.every((x) => x === '\u2014')).toBe(true)
  })

  it('⚠ shows 0% owned but NO start rate for an unrostered player', () => {
    // A start rate over zero leagues is undefined, not zero. Rendering 0%
    // would call a free agent a universal bench player.
    const c = render(
      <MyTeam
        data={data({
          starters: {
            available: true,
            data: [
              {
                slotLabel: 'QB',
                player: player({ market: { ownPct: 0, startPct: null } }),
                empty: false,
                unresolvedId: null,
              },
            ],
          },
          bench: { available: false, reason: 'none' },
        })}
      />,
    ).container
    const cells = [...c.querySelectorAll('.af-mt-share')].map((e) => e.textContent)
    expect(cells[0]).toBe('0%')
    expect(cells[1]).toBe('\u2014')
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

  it('⚠ leads with the LEAGUE-scored number, not the generic one', () => {
    /*
     * Order and weight both carry meaning here. Generic PPR used to be first
     * and full weight, so the most prominent number on every row was the one
     * scored for a league nobody is in — while the figure that matches what the
     * platform itself displays sat behind it. Measured on a real roster:
     * ours 30.0 against Sleeper's 29.98, generic 20.5.
     */
    const c = render(<MyTeam data={data()} />).container
    const pair = c.querySelector('.af-mt-projpair')!
    const nums = [...pair.querySelectorAll('.af-mt-proj')].map((e) => e.textContent)
    // League-scored first, generic second.
    expect(nums[0]).toBe('22.4')
    expect(nums[1]).toBe('19.8')
    expect(pair.querySelector('.af-mt-proj--af')?.textContent).toBe('22.4')
  })

  it('labels the generic column PPR, so it cannot be mistaken for your league', () => {
    expect(text(<MyTeam data={data()} />)).toContain('PPR')
  })

  it('puts the league total first among the header tiles', () => {
    const c = render(<MyTeam data={data()} />).container
    const first = c.querySelector('.af-mt-tile')
    expect(first?.className).toContain('af-mt-tile--af')
    expect(first?.textContent).toContain('131.7')
  })

  it('abbreviates every designation to a fixed-width code', () => {
    /*
     * The full words were the widest thing on the row — "NO DESIGNATION" is
     * fourteen characters carrying one bit — and they pushed the numbers
     * around on every line.
     */
    const cases: Array<[string, string]> = [
      ['Questionable', 'Q'],
      ['Doubtful', 'D'],
      ['Out', 'O'],
      ['Injured Reserve', 'IR'],
      ['Did Not Practice', 'DNP'],
      ['Active', 'H'],
    ]
    for (const [full, short] of cases) {
      const c = render(
        <MyTeam
          data={data({
            starters: {
              available: true,
              data: [
                {
                  slotLabel: 'RB',
                  player: player({ injuryStatus: full }),
                  empty: false,
                  unresolvedId: null,
                },
              ],
            },
            bench: { available: false, reason: 'none' },
          })}
        />,
      ).container
      expect(c.querySelector('.af-mt-status')?.textContent).toBe(short)
    }
  })

  it('shows an unfamiliar designation as-is rather than inventing a letter', () => {
    // A wrong abbreviation is worse than a long one.
    const c = render(
      <MyTeam
        data={data({
          starters: {
            available: true,
            data: [
              {
                slotLabel: 'RB',
                player: player({ injuryStatus: 'Reserve/COVID' }),
                empty: false,
                unresolvedId: null,
              },
            ],
          },
          bench: { available: false, reason: 'none' },
        })}
      />,
    ).container
    expect(c.querySelector('.af-mt-status')?.getAttribute('title')).toBe('Reserve/COVID')
  })

  it('rides the team crest on the headshot rather than beside it', () => {
    const c = render(<MyTeam data={data()} />).container
    const portrait = c.querySelector('.af-mt-portrait')
    expect(portrait).toBeTruthy()
    expect(portrait?.querySelector('.af-mt-teamlogo')).toBeTruthy()
  })

  it('⚠ groups the two totals in one frame, because they are one comparison', () => {
    /*
     * Four equal bordered rectangles in a row is what "blocky" meant, and it
     * hid the point: the whole reason both numbers are on screen is that they
     * differ. The frame belongs around the pair, not around each of them.
     */
    const c = render(<MyTeam data={data()} />).container
    const group = c.querySelector('.af-mt-projgroup')
    expect(group).not.toBeNull()
    expect(group!.querySelectorAll('.af-mt-tile').length).toBe(2)
    // Your league's total leads.
    expect(group!.querySelector('.af-mt-tile')?.className).toContain('af-mt-tile--af')
    // Record is context, not a projection, and stays outside the frame.
    expect(group!.textContent).not.toContain('Record')
  })

  it('⚠ says whether the roster rank was priced under YOUR scoring', () => {
    /*
     * "3rd of 12" repriced under a TE-premium rulebook is a different and much
     * stronger claim than "3rd of 12" on raw 12-team full-PPR market prices.
     * Both are honest; rendering them identically is not, because the manager
     * cannot tell which one they are being shown.
     */
    expect(text(<MyTeam data={data()} />)).toContain('valued under your scoring')

    const raw = data({
      rosterGrade: {
        available: true,
        data: {
          ...(data().rosterGrade as { available: true; data: Record<string, unknown> }).data,
          basis: {
            format: 'DYNASTY',
            qbFormat: 'ONE_QB',
            capturedAt: '2026-08-22T00:00:00.000Z',
            leagueScored: false,
          },
        },
      },
    })
    expect(text(<MyTeam data={raw} />)).toContain('not adjusted for your scoring')
  })
})
