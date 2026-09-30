import React from 'react'
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'

/*
 * Draft HQ's pre-draft sections as the screen draws them: your picks with pick trades applied,
 * the lottery odds table, the prepared queue and your keepers — and, where the loader says a
 * section does not apply, its sentence instead of an empty table.
 */

import DraftHq from '@/components/core-app/screens/DraftHq'
import type { DraftHqData } from '@/lib/core-app/draftHq'

afterEach(cleanup)

const missing = (reason: string) => ({ available: false as const, reason })

function data(over: Partial<DraftHqData>): DraftHqData {
  return {
    league: { id: 'lg-1', name: 'League', platform: 'sleeper', format: 'dynasty' },
    session: {
      available: true,
      data: { status: 'pre_draft', draftType: 'snake', rounds: 3, teamCount: 3, yourSlot: 2 },
    },
    pickSlots: missing('picks'),
    madePicks: missing('made'),
    board: missing('board'),
    grades: missing('grades'),
    lottery: missing('lottery'),
    queue: missing('queue'),
    keepers: missing('keepers'),
    ...over,
  } as DraftHqData
}

describe('Draft HQ — your picks', () => {
  it('shows an acquired pick with its source, and a traded-away pick with its new owner', () => {
    render(
      <DraftHq
        data={data({
          pickSlots: {
            available: true,
            data: {
              held: [
                { round: 1, pickInRound: 2, overall: 2, label: '1.02', acquiredFrom: null },
                { round: 2, pickInRound: 3, overall: 6, label: '2.03', acquiredFrom: 'Dre' },
              ],
              tradedAway: [{ round: 3, overall: 8, label: '3.02', to: 'Kim' }],
              note: null,
            },
          },
        })}
      />,
    )
    const held = screen.getByTestId('draft-hq-picks-held').textContent ?? ''
    expect(held).toContain('1.02')
    expect(held).toContain('2.03')
    expect(held).toContain('From Dre')
    expect(screen.getByTestId('draft-hq-picks-away').textContent).toContain('3.02 traded to Kim')
    // The old blanket caption claimed trades were never ingested; it must not come back.
    expect(document.body.textContent).not.toContain('pick trades are not ingested')
    expect(screen.queryByTestId('draft-hq-picks-note')).toBeNull()
  })

  it('carries the loader’s caveat for a provider-hosted league beside the heading', () => {
    render(
      <DraftHq
        data={data({
          pickSlots: {
            available: true,
            data: {
              held: [{ round: 1, pickInRound: 2, overall: 2, label: '1.02', acquiredFrom: null }],
              tradedAway: [],
              note: 'pick trades made on Sleeper are not synced into this draft, so a pick shown here may have changed hands there',
            },
          },
        })}
      />,
    )
    expect(screen.getByTestId('draft-hq-picks-note').textContent).toContain('not synced into this draft')
  })

  it('every pick traded away is said, not an empty grid', () => {
    render(
      <DraftHq
        data={data({
          pickSlots: {
            available: true,
            data: { held: [], tradedAway: [{ round: 1, overall: 2, label: '1.02', to: 'Kim' }], note: null },
          },
        })}
      />,
    )
    expect(document.body.textContent).toContain('you have traded away every pick you started this draft with')
  })
})

describe('Draft HQ — lottery', () => {
  it('draws the odds table, marking you', () => {
    render(
      <DraftHq
        data={data({
          lottery: {
            available: true,
            data: {
              pickCount: 2,
              playoffTeamCount: 2,
              fallbackOrder: 'reverse order of finish',
              alreadyRunAt: null,
              teams: [
                { rosterId: 'me', name: 'Mine', record: '5-8', oddsPercent: 33.333, isYou: true },
                { rosterId: 'r4', name: 'Delta', record: '2-10-1', oddsPercent: 66.667, isYou: false },
              ],
            },
          },
        })}
      />,
    )
    const table = screen.getByTestId('draft-hq-lottery')
    expect(table.textContent).toContain('Mine')
    expect(table.textContent).toContain('33.3%')
    expect(table.textContent).toContain('66.7%')
    expect(table.querySelector('tr[data-you="true"]')?.textContent).toContain('Mine')
    expect(document.body.textContent).toContain('The first 2 picks are drawn')
  })

  it('where no lottery applies, the reason and no table', () => {
    render(
      <DraftHq
        data={data({ lottery: missing('a weighted draft lottery only applies to dynasty leagues, and this one is not') })}
      />,
    )
    expect(screen.queryByTestId('draft-hq-lottery')).toBeNull()
    expect(document.body.textContent).toContain('only applies to dynasty leagues')
  })
})

describe('Draft HQ — queue and keepers', () => {
  it('lists the queue and says how many more there are', () => {
    render(
      <DraftHq
        data={data({
          queue: {
            available: true,
            data: {
              total: 12,
              players: [
                { rank: 1, playerName: 'Bijan Robinson', position: 'RB', team: 'ATL' },
                { rank: 2, playerName: 'Sam LaPorta', position: 'TE', team: 'DET' },
              ],
            },
          },
        })}
      />,
    )
    const q = screen.getByTestId('draft-hq-queue').textContent ?? ''
    expect(q).toContain('Bijan Robinson')
    expect(q).toContain('RB · ATL')
    expect(document.body.textContent).toContain('10 more in your queue')
  })

  it('lists your keepers with the round each costs', () => {
    render(
      <DraftHq
        data={data({
          keepers: {
            available: true,
            data: {
              source: 'draft',
              season: null,
              maxKeepers: 2,
              players: [{ playerName: 'Ja’Marr Chase', position: 'WR', team: 'CIN', round: 2 }],
            },
          },
        })}
      />,
    )
    const k = screen.getByTestId('draft-hq-keepers').textContent ?? ''
    expect(k).toContain('Rd 2')
    expect(k).toContain('Ja’Marr Chase')
    expect(document.body.textContent).toContain('up to 2 allowed')
  })

  it('imported keepers say where they came from', () => {
    render(
      <DraftHq
        data={data({
          keepers: {
            available: true,
            data: {
              source: 'imported',
              season: 2026,
              maxKeepers: null,
              players: [{ playerName: 'Saquon Barkley', position: 'RB', team: 'PHI', round: 3 }],
            },
          },
        })}
      />,
    )
    expect(document.body.textContent).toContain('kept in your 2026 draft, as Sleeper recorded it')
  })

  it('unavailable sections keep their reasons', () => {
    render(
      <DraftHq
        data={data({
          queue: missing('you have not queued any players for this draft yet'),
          keepers: missing('this draft has no keepers set up'),
        })}
      />,
    )
    expect(screen.queryByTestId('draft-hq-queue')).toBeNull()
    expect(screen.queryByTestId('draft-hq-keepers')).toBeNull()
    expect(document.body.textContent).toContain('you have not queued any players for this draft yet')
    expect(document.body.textContent).toContain('this draft has no keepers set up')
  })
})

describe('Draft HQ — AllFantasy projections on picks', () => {
  it('shows AF on your picks and on the full board, with the season total on hover, and nothing for a pick without one', () => {
    const af = { af: 18.4, ros: 240.5, rosWeeks: 14, week: 4 }
    render(
      <DraftHq
        data={data({
          madePicks: {
            available: true,
            data: [
              { overall: 2, round: 1, label: '1.02', playerName: 'Bijan Robinson', position: 'RB', team: 'ATL', imageUrl: null, af },
              { overall: 5, round: 2, label: '2.02', playerName: 'No Engine Row', position: 'WR', team: 'KC', imageUrl: null },
            ],
          },
          board: {
            available: true,
            data: {
              season: 2026,
              rounds: [{ round: 1, picks: [{ round: 1, overall: 1, label: '1.01', teamKey: 't1', teamName: 'Kim', isYou: false, playerName: 'Ja’Marr Chase', position: 'WR', af: { af: 21.1, ros: null, rosWeeks: null, week: 4 } }] }],
              teams: [{ teamKey: 't1', name: 'Kim', isYou: false, picks: 1 }],
              totalPicks: 1,
            },
          },
        })}
      />,
    )
    const text = document.body.textContent ?? ""
    expect(text).toContain('AF 18.4')
    expect(text).toContain('AF 21.1')
    // Exactly two AF figures: the pick with no engine row shows none.
    expect(text.match(/AF \d/g)?.length).toBe(2)
    const titles = [...document.querySelectorAll('.af-dh-af')].map((e) => e.getAttribute('title'))
    expect(titles).toContain("AllFantasy projection, week 4: 18.4 under this league's scoring · rest of season 240.5 PPR over 14 games")
  })
})
