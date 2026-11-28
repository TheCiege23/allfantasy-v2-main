// @vitest-environment jsdom
/**
 * Keeper after the 2026-11-24 visual audit (DB-free harness at /e2e/keeper-league/*):
 * 1. The Keepers tab ignored the window: "Pick your keepers" over a locked list of tickable players, "Waiting for
 *    your commissioner" under "These are final", and a card offering the draft room's Keeper panel when locked or
 *    not yet open.
 * 2. The War Room spoke in rounds of value, the Keepers tab in picks; its deadline had no time; its engine could put
 *    a player on the bubble and on "Let go" at once.
 * 3. Each card said its cost twice; a keep that costs more than it is worth sat in plain grey; status lived in a
 *    second list under the roster.
 * 4. War Room clutter: "AF Legacy — Keeper", greyed Waivers and Start/Sit all offseason.
 * 5. The trade analyzer restated the two players just picked.
 * 6. The carryover window showed no keepers, no positions, and "Open team" twice.
 * 7. A 140px banner above every phone state; one stretched column at 1440.
 * 8. Locking with 5 of 12 teams unpicked took one tap and said nothing; the draft card stayed after the lock.
 */
import React from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'

vi.mock('sonner', () => ({ toast: Object.assign(vi.fn(), { error: vi.fn(), success: vi.fn(), message: vi.fn() }) }))
vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => '/league/kl',
  useSearchParams: () => new URLSearchParams(),
}))

import { KeeperSelectionTab } from '@/app/league/[leagueId]/tabs/KeeperSelectionTab'
import { KeeperWarRoomPanel } from '@/app/league/[leagueId]/tabs/keeper/KeeperWarRoomPanel'
import { KeeperCommissionerDashboard } from '@/app/league/[leagueId]/components/KeeperCommissionerDashboard'
import { KeeperModal } from '@/app/league/[leagueId]/tabs/settings/KeeperModal'
import type { LeagueTeamBrief } from '@/app/league/[leagueId]/tabs/settings/types'
import { KEEPER_LEAGUE_ID, KEEPER_SETTINGS_TEAMS, installKeeperHarnessFetch, type KeeperHarnessState } from '@/app/e2e/keeper-league/fixtures'
import { recommendKeepers } from '@/lib/keeper-war-room/keeperRecommendationEngine'

const realFetch = globalThis.fetch
afterEach(() => {
  cleanup()
  window.fetch = realFetch
  globalThis.fetch = realFetch
})

function harness(state: KeeperHarnessState) {
  // The harness installs once per window (the page renders once); a test renders many times.
  window.fetch = realFetch
  delete (window as typeof window & { __keeperHarnessFetch?: boolean }).__keeperHarnessFetch
  installKeeperHarnessFetch(state)
  globalThis.fetch = window.fetch
}

async function keepersTab(state: KeeperHarnessState) {
  harness(state)
  const view = render(<KeeperSelectionTab leagueId={KEEPER_LEAGUE_ID} />)
  if (state !== 'none') await screen.findAllByText(/Puka Nacua/)
  else await screen.findByText(/isn’t open yet/)
  return view
}

describe('1. The Keepers tab follows the window', () => {
  it('locked: "Your keepers", only the keepers, nothing to tick, no waiting, no draft-room offer', async () => {
    const { container } = await keepersTab('locked')
    expect(container.querySelector('h2')?.textContent).toBe('Your keepers')
    expect(container.querySelectorAll('[aria-pressed]')).toHaveLength(0)
    const names = [...container.querySelectorAll('[data-testid^="keeper-select-"]')].map((e) => e.getAttribute('data-testid'))
    expect(names.sort()).toEqual(['keeper-select-p-bijan', 'keeper-select-p-puka'])
    expect(container.textContent).not.toMatch(/Waiting for your commissioner/)
    expect(screen.getByTestId('keeper-status-p-puka').textContent).toBe('Locked in')
    expect(screen.queryByTestId('keeper-draft-room-note')).toBeNull()
  })
  it('not open: no "Pick your keepers", no draft-room offer', async () => {
    const { container } = await keepersTab('none')
    expect(container.querySelector('h2')?.textContent).toBe('Keepers')
    expect(screen.queryByTestId('keeper-draft-room-note')).toBeNull()
  })
  it('open: you pick, and the draft-room route is offered', async () => {
    const { container } = await keepersTab('open')
    expect(container.querySelector('h2')?.textContent).toBe('Pick your keepers')
    expect(container.querySelectorAll('[aria-pressed]').length).toBeGreaterThan(2)
    expect(screen.getByTestId('keeper-draft-room-note')).toBeTruthy()
  })
})

describe('2. The War Room and the Keepers tab agree', () => {
  it('both say a keeper’s value in rounds, and the same number', async () => {
    await keepersTab('open')
    const card = screen.getByTestId('keeper-select-p-puka').textContent ?? ''
    expect(card).toMatch(/8 rounds of value/)
    expect(document.body.textContent).not.toMatch(/picks more than he costs|picks less than he costs/)
    cleanup()
    harness('open')
    render(<KeeperWarRoomPanel leagueId={KEEPER_LEAGUE_ID} />)
    const recs = await screen.findByTestId('keeper-war-room-recommendations')
    expect(recs.textContent).toMatch(/Puka Nacua \(WR\) · 8 rounds of value/)
  })
  it('the War Room deadline names the minute, as the Keepers tab does', async () => {
    harness('open')
    render(<KeeperWarRoomPanel leagueId={KEEPER_LEAGUE_ID} />)
    const rules = await screen.findByTestId('keeper-war-room-rules-card')
    expect(rules.textContent).toMatch(/Set keepers by .*\d:\d\d/)
  })
  it('the engine never puts a player on the bubble and on "Let go" at once', async () => {
    harness('open')
    const res = await (await window.fetch(`/api/leagues/${KEEPER_LEAGUE_ID}/keeper-war-room`)).json()
    const out = recommendKeepers(res.context, 'r-next-1')
    const avoid = new Set(out.avoid.map((r) => r.playerId))
    expect(out.avoid.map((r) => r.playerId)).toContain('p-kelce')
    expect(out.bubble.filter((r) => avoid.has(r.playerId))).toEqual([])
    expect(out.bubble.map((r) => r.playerId)).toContain('p-bijan')
  })
})

describe('3. Each card says its cost once, flags a bad keep, carries its own status', () => {
  it('cost once; Kelce’s card is a warning; status on the card; no second list', async () => {
    await keepersTab('open')
    const puka = screen.getByTestId('keeper-select-p-puka').textContent ?? ''
    expect(puka.match(/round 9/g)?.length).toBe(1)
    expect(puka).not.toMatch(/costs pick|drafted around pick/)
    const kelce = within(screen.getByTestId('keeper-select-p-kelce')).getByTestId('keeper-value')
    expect(kelce.getAttribute('data-tone')).toBe('bad')
    expect(kelce.className).toMatch(/kp-warn/)
    expect(kelce.textContent).toMatch(/Costs 2 rounds more than he's worth/)
    expect(screen.getByTestId('keeper-status-p-puka').textContent).toBe('Waiting for your commissioner')
    expect(screen.queryByTestId('keeper-submitted')).toBeNull()
  })
})

describe('4–5. War Room: its own name, no dead tools, no echo', () => {
  it('"Keeper War Room", and no Waivers or Start/Sit before the season', async () => {
    harness('open')
    const { container } = render(<KeeperWarRoomPanel leagueId={KEEPER_LEAGUE_ID} />)
    await screen.findByTestId('keeper-war-room-panel')
    expect(container.textContent).toMatch(/Keeper War Room/)
    expect(container.textContent).not.toMatch(/AF Legacy/)
    expect(screen.queryByTestId('keeper-war-room-tool-waivers')).toBeNull()
    expect(screen.queryByTestId('keeper-war-room-tool-lineup')).toBeNull()
  })
  it('the trade result does not restate the two players you picked', async () => {
    harness('open')
    render(<KeeperWarRoomPanel leagueId={KEEPER_LEAGUE_ID} />)
    fireEvent.click(await screen.findByTestId('keeper-war-room-tool-trade-analyze'))
    fireEvent.change(screen.getByTestId('keeper-war-room-trade-outgoing-select'), { target: { value: 'p-jacobs' } })
    fireEvent.change(screen.getByTestId('keeper-war-room-trade-incoming-select'), { target: { value: 'p-laporta' } })
    fireEvent.click(screen.getByTestId('keeper-war-room-trade-analyze-submit'))
    const result = await screen.findByTestId('keeper-war-room-trade-analyze-result')
    expect(result.textContent).not.toMatch(/You give Josh Jacobs/)
    expect(result.textContent).toMatch(/LaPorta would cost a round 8 pick/)
  })
})

describe('6. The carryover window shows the keepers', () => {
  it('keepers first and marked, with positions; a rejected keeper is not kept; "Open team" once', async () => {
    harness('open')
    render(<KeeperModal open leagueId={KEEPER_LEAGUE_ID} teams={KEEPER_SETTINGS_TEAMS as unknown as LeagueTeamBrief[]} onClose={() => undefined} />)
    const mine = await screen.findByTestId('keeper-carryover-team-t1')
    await within(mine).findByText(/Kept · waiting/)
    const rows = [...mine.querySelectorAll('li')].map((li) => li.textContent ?? '')
    expect(rows[0]).toMatch(/Bijan Robinson · RB · Kept \(round 2\)|Puka Nacua · WR · Kept · waiting \(round 9\)/)
    expect(rows.filter((r) => /Kept/.test(r))).toHaveLength(2)
    const sam = screen.getByTestId('keeper-carryover-team-t3').textContent ?? ''
    expect(sam).not.toMatch(/Kept/)
    const open = screen.getByTestId('keeper-carryover-team-t4').textContent ?? ''
    expect(open.match(/Open team/g)?.length).toBe(1)
  })
})

describe('7. Layout', () => {
  it('the banner shows from sm up; the list is two columns at lg', async () => {
    await keepersTab('open')
    expect(screen.getByTestId('keeper-hero-media').className.split(/\s+/)).toEqual(expect.arrayContaining(['hidden', 'sm:block']))
    expect(screen.getByTestId('keeper-list').className.split(/\s+/)).toContain('lg:grid-cols-2')
  })
})

describe('8. Commissioner center', () => {
  it('names the teams still to pick, and locking without them takes a second tap', async () => {
    harness('open')
    const posts: string[] = []
    const harnessFetch = window.fetch
    window.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      if ((init?.method ?? 'GET').toUpperCase() === 'POST') posts.push(String(input))
      return harnessFetch(input, init)
    }) as typeof fetch
    globalThis.fetch = window.fetch
    render(<KeeperCommissionerDashboard leagueId={KEEPER_LEAGUE_ID} />)
    const warning = await screen.findByTestId('keeper-commish-lock-warning')
    expect(warning.textContent).toMatch(/5 teams haven’t picked yet/)
    fireEvent.click(screen.getByRole('button', { name: /Lock keepers now/ }))
    expect(posts).toEqual([])
    expect(screen.getByRole('button', { name: /Lock anyway/ })).toBeTruthy()
    expect(screen.getByTestId('keeper-commish-lock-warning').textContent).toMatch(/Locking now closes the window for them too/)
    expect(screen.getByTestId('keeper-commish-draft-note')).toBeTruthy()
  })
  it('once locked, no draft-room offer', async () => {
    harness('locked')
    render(<KeeperCommissionerDashboard leagueId={KEEPER_LEAGUE_ID} />)
    await screen.findByText(/Locked\. Keepers are final\./)
    expect(screen.queryByTestId('keeper-commish-draft-note')).toBeNull()
    expect(screen.queryByTestId('keeper-commish-lock-warning')).toBeNull()
  })
})
