// @vitest-environment jsdom
/**
 * Defense Hub after the 2026-11-23 audit: the numbers a phone hid off the table's right edge are on a line
 * under each name; one ranking has one label on both tables; the kicker block is said once, in plain words;
 * the two long tables fold; projections are not all painted "good"; the board does not repeat "Blitz
 * Package / you" on your own rows; and the error lines are short.
 */
import React from 'react'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, waitFor, within } from '@testing-library/react'

vi.mock('next/link', () => ({ default: ({ children }: { children: React.ReactNode }) => <a>{children}</a> }))
vi.mock('@/components/values/ValuesPageLink', () => ({ ValuesPageLink: () => <a>How we value defenders</a> }))

import { DefenseHubClient } from '@/app/idp/defense-hub/[leagueId]/DefenseHubClient'
import { defenseHubMessages } from '@/lib/core-app/messages/defenseHub'
import type { DefenseHubPayload } from '@/lib/idp-projections/defenseHub'

afterEach(() => { cleanup(); vi.unstubAllGlobals() })

const KICKER_VALUE = {
  value: 221, replacementRank: 13, scarcity: 0.4, rankPredictability: 'none' as const,
  basis: 'Every kicker prices the same here: kicker rank does not persist (year-over-year Spearman -0.455, negative in all six measured season pairs), and the startable population spans only 1.55x. This league starts 1 kicker across 12 teams, so replacement is about K13.',
}

const hub = (over: Partial<DefenseHubPayload> = {}): DefenseHubPayload => ({
  state: 'ok',
  projectedFor: { season: 2026, week: 10 },
  coverage: { defenders: 2, projected: 2, priced: 2 },
  defenders: [
    { sleeperId: 'p1', name: 'Micah Parsons', team: 'GB', position: 'DE', positionGroup: 'DL', projection: 13.4, vorp: 6, positionRank: 1, value: 4857, valueIsFloor: false, reason: null, lastWeek: { scored: true, points: 20.2, reason: null, lineKeys: 9 } },
  ],
  kickers: [{ sleeperId: 'k1', name: 'Brandon Aubrey', team: 'DAL' }],
  kickerValue: KICKER_VALUE,
  snaps: [{ sleeperId: 'p1', name: 'Micah Parsons', share: 0.81, games: 25, basis: 'defense', trend: null, reason: null }],
  roles: [{ sleeperId: 'p1', name: 'Micah Parsons', games: 25, snaps: 1600, sacks: 14, tackles: 60, lines: [] }],
  tendencies: [{ team: 'GB', tendency: { season: 2025, passRateFaced: 0.6, blitzRate: 0.25, playsFacedSeason: 1018, thirdDownRateFaced: 0.38 } as never }],
  notes: [],
  unresolvedIds: 0,
  ...over,
}) as DefenseHubPayload

const board = {
  state: 'ok',
  projectedFor: { season: 2026, week: 10 },
  rows: [
    { sleeperId: 'p1', name: 'Micah Parsons', team: 'GB', position: 'DE', positionGroup: 'DL', value: 4857, vorp: 6, projectedPoints: 13.4, positionRank: 1, valueIsFloor: false, ownedBy: { teamName: 'Blitz Package', ownerName: 'you', isMine: true } },
    // An older server: no `positionGroup` on the row, so the client derives it from the position.
    { sleeperId: 'p2', name: 'Myles Garrett', team: 'CLE', position: 'DE', value: 3927, vorp: 5.5, projectedPoints: 12.9, positionRank: 2, valueIsFloor: false, ownedBy: { teamName: 'Pick Six Syndicate', ownerName: 'jrod_ff', isMine: false } },
  ],
  kickerValue: KICKER_VALUE,
  kickers: [{ sleeperId: 'k1', name: 'Brandon Aubrey', team: 'DAL', ownedBy: { teamName: 'Blitz Package', ownerName: 'you', isMine: true } }],
  coverage: { defenders: 2, projected: 2, priced: 2 },
  notes: [],
}

const mount = (payload: DefenseHubPayload, boardOk = true) => {
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    if (String(url).includes('trade-board')) return boardOk ? { ok: true, status: 200, json: async () => board } : { ok: false, status: 500, json: async () => ({}) }
    return { ok: true, status: 200, json: async () => payload }
  }))
  return render(<DefenseHubClient leagueId="L1" embedded />)
}

describe('the Defense Hub on a phone', () => {
  it('each defender row carries its other numbers on a line under the name (shown below sm)', async () => {
    mount(hub())
    const line = await screen.findByTestId('defense-hub-row-facts')
    expect(line.textContent).toMatch(/DL1/)
    expect(line.textContent).toMatch(/last week 20\.2/)
    expect(line.textContent).toMatch(/\+6\.0 vs\. a free agent/)
    expect(line.className).toMatch(/sm:hidden/)
  })

  it('both tables drop their phone-hostile minimum width', () => {
    const hubSrc = readFileSync(path.join(process.cwd(), 'app/idp/defense-hub/[leagueId]/DefenseHubClient.tsx'), 'utf8')
    const boardSrc = readFileSync(path.join(process.cwd(), 'app/idp/defense-hub/[leagueId]/TradeBoardSection.tsx'), 'utf8')
    expect(hubSrc).not.toMatch(/className="w-full min-w-\[680px\]/)
    expect(boardSrc).not.toMatch(/className="w-full min-w-\[720px\]/)
  })
})

describe('one ranking, one label', () => {
  it('the board labels a lineman DL1, as the hub does, even from a row with no group', async () => {
    mount(hub())
    await waitFor(() => expect(screen.getAllByTestId('defense-trade-board-row')).toHaveLength(2))
    // The rank cell (5th) of each row: DL1 / DL2, never DE1 / DE2.
    const rankCell = (r: HTMLElement) => r.querySelectorAll('td')[4]!.textContent
    const rows = screen.getAllByTestId('defense-trade-board-row')
    expect(rankCell(rows[0]!)).toBe('DL1')
    expect(rankCell(rows[1]!)).toBe('DL2')
  })
})

describe('said once, in plain words', () => {
  it('one kicker block, no statistics jargon, no "replacement about K13"', async () => {
    mount(hub())
    await waitFor(() => expect(screen.getAllByTestId('defense-trade-board-row')).toHaveLength(2))
    expect(screen.getAllByText('221')).toHaveLength(1)
    const page = document.body.textContent ?? ''
    expect(page).not.toMatch(/Spearman|startable population|replacement about K|Over repl|Blitz rate \(own\)/)
    expect(page).toContain(defenseHubMessages.en.kickerWhy)
  })

  it('the two long tables fold away', async () => {
    mount(hub())
    const play = await screen.findByTestId('defense-hub-play')
    expect(play.closest('details')).toBeTruthy()
    expect(screen.getByText('GB defense').closest('details')).toBeTruthy()
  })

  it('projections are plain text, not all painted "good"', async () => {
    mount(hub())
    const proj = (await screen.findAllByText('13.4'))[0]!
    expect(proj.className).not.toMatch(/var\(--good\)/)
  })

  it('your own board rows say "You", not your team name again', async () => {
    mount(hub())
    await waitFor(() => expect(screen.getAllByTestId('defense-trade-board-row')).toHaveLength(2))
    const mine = screen.getAllByTestId('defense-trade-board-row')[0]!
    expect(within(mine).queryByText('Blitz Package')).toBeNull()
    expect(within(mine).getByText('You')).toBeTruthy()
  })

  it('short error lines', async () => {
    mount(hub(), false)
    await screen.findByText(defenseHubMessages.en.boardLoadFailed)
    for (const v of [defenseHubMessages.en.loadFailed, defenseHubMessages.en.boardLoadFailed]) expect(v).not.toMatch(/rather than/)
  })
})
