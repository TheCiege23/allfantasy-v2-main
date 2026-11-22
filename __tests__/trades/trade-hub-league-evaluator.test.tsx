import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import React from 'react'

/**
 * The /core Trades hub's league trade evaluator (2026-11-05): pick a league, and Team A is your roster
 * and picks there while Team B is a dropdown of the league's other managers. Each team is headed by
 * that manager's league avatar. "Outside offer" keeps the no-league analyzer.
 */

import { TradeCenter } from '@/components/core-app/screens/TradeCenter'

const LEAGUES = [
  { id: 'lg-1', name: 'Dynasty One', platform: 'sleeper', mark: 'S', meta: 'NFL · 12 teams' },
  { id: 'lg-2', name: 'Redraft Two', platform: 'sleeper', mark: 'S', meta: 'NFL · 10 teams' },
]

const player = (id: string, name: string, value: number) => ({
  id, name, position: 'WR', team: 'PIT', value, imageUrl: null, byeWeek: null, injuryStatus: null, stock: null, stockDelta: null,
})
const roster = (rosterId: string, ownerName: string, avatarUrl: string | null, players: unknown[]) => ({
  rosterId, platformUserId: `u-${rosterId}`, players, picks: [], teamExternalId: `t-${rosterId}`,
  ownerName, avatarUrl, wins: 3, losses: 2, ties: 0, faabRemaining: null, canReceiveProposal: false,
})

const ROSTERS = {
  rosters: [
    roster('r1', 'Me Myself', 'https://img.test/me.png', [player('p1', 'DK Metcalf', 5000)]),
    roster('r2', 'Matt Jones', 'https://img.test/matt.png', [player('p9', 'Christian McCaffrey', 7000)]),
    roster('r3', 'Ana Lopez', null, [player('p7', 'Drake London', 6000)]),
  ],
  viewerRosterId: null,
  viewerTeamRosterId: 'r1',
}

const fetchMock = vi.fn()

beforeEach(() => {
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    writable: true,
    value: (query: string) => ({
      matches: false, media: query, addEventListener: () => {}, removeEventListener: () => {},
      addListener: () => {}, removeListener: () => {}, onchange: null, dispatchEvent: () => false,
    }),
  })
  fetchMock.mockReset()
  fetchMock.mockImplementation(async (url: string) =>
    /\/api\/leagues\/[^/]+\/trades\/rosters$/.test(String(url))
      ? { ok: true, status: 200, json: async () => ROSTERS }
      : { ok: false, status: 500, json: async () => ({}) },
  )
  vi.stubGlobal('fetch', fetchMock)
})

afterEach(() => {
  vi.unstubAllGlobals()
})

const hub = () => render(<TradeCenter league={null} leagues={LEAGUES} valueActions={[]} />)
const evaluator = () => document.querySelector('.af-tc-hub-evaluator') as HTMLElement
const leagueSelect = () => evaluator().querySelector('.af-tc-hub-league-select select') as HTMLSelectElement
const side = (s: 'give' | 'get') => evaluator().querySelector(`.af-tc-team[data-side='${s}']`) as HTMLElement
/** The Team B dropdown, once the rosters have arrived. */
const partnerSelect = () =>
  waitFor(() => {
    const el = evaluator().querySelector('.af-tc-partner-select select') as HTMLSelectElement | null
    expect(el).not.toBeNull()
    return el!
  })
const rosterReads = () => fetchMock.mock.calls.map(([u]) => String(u)).filter((u) => u.includes('/trades/rosters'))

describe('the hub evaluator', () => {
  it('opens on the first league, reading that league\'s rosters — no click needed for Team A', async () => {
    hub()
    expect(leagueSelect().value).toBe('lg-1')
    await waitFor(() => expect(side('give').textContent).toContain('DK Metcalf'))
    expect(rosterReads()).toEqual(['/api/leagues/lg-1/trades/rosters'])
  })

  it('heads Team A with your own manager name and league avatar', async () => {
    hub()
    await waitFor(() => expect(side('give').querySelector('.af-tc-team-name')!.textContent).toBe('Me Myself'))
    expect(side('give').querySelector('.af-tc-team-avatar img')?.getAttribute('src')).toBe('https://img.test/me.png')
  })

  it('🛑 Team B lists every other manager and never you', async () => {
    hub()
    const select = await partnerSelect()
    const names = [...select.options].map((o) => o.textContent ?? '')
    expect(names.some((n) => n.includes('Matt Jones'))).toBe(true)
    expect(names.some((n) => n.includes('Ana Lopez'))).toBe(true)
    expect(names.some((n) => n.includes('Me Myself'))).toBe(false)
  })

  it('choosing a manager loads their assets under their own name and avatar', async () => {
    hub()
    const select = await partnerSelect()
    // No manager yet: Team B shows no face rather than a placeholder one.
    expect(side('get').querySelector('.af-tc-team-avatar')).toBeNull()
    fireEvent.change(select, { target: { value: 'r2' } })
    // Team B's name is the dropdown itself: the chosen option names the manager.
    expect(select.selectedOptions[0]?.textContent).toContain('Matt Jones')
    expect(side('get').querySelector('.af-tc-team-avatar img')?.getAttribute('src')).toBe('https://img.test/matt.png')
    expect(side('get').textContent).toContain('Christian McCaffrey')
  })

  it('names Team B once: the dropdown sits in the team head, with no second name above or below it', async () => {
    hub()
    const select = await partnerSelect()
    fireEvent.change(select, { target: { value: 'r2' } })
    const head = side('get').querySelector('.af-tc-team-head') as HTMLElement
    expect(head.contains(select)).toBe(true)
    expect(side('get').querySelector('.af-tc-team-name')).toBeNull()
    // Team A has no dropdown — it is always you.
    expect(side('give').querySelector('select')).toBeNull()
  })

  it('a manager with no league image gets their initial, not an empty circle', async () => {
    hub()
    const select = await partnerSelect()
    fireEvent.change(select, { target: { value: 'r3' } })
    expect(side('get').querySelector('.af-tc-team-avatar')!.textContent).toBe('A')
  })

  it('switching league reads the new league and starts a clean deal', async () => {
    hub()
    await waitFor(() => expect(side('give').textContent).toContain('DK Metcalf'))
    fireEvent.click(screen.getByLabelText('Add DK Metcalf'))
    expect(side('give').querySelector('div.af-tc-row[data-kind]')).not.toBeNull()
    fireEvent.change(leagueSelect(), { target: { value: 'lg-2' } })
    await waitFor(() => expect(rosterReads()).toContain('/api/leagues/lg-2/trades/rosters'))
    expect(side('give').querySelector('div.af-tc-row[data-kind]')).toBeNull()
  })

  it('keeps the page\'s own header out of the embedded builder, along with the offers fold and the finder', async () => {
    hub()
    await waitFor(() => expect(side('give').textContent).toContain('DK Metcalf'))
    expect(evaluator().querySelector('.af-tc-head')).toBeNull()
    expect(evaluator().querySelector('details.af-tc-offers')).toBeNull()
    // The trade finder's root is `.af-tc-dos` without the breakdown marker.
    expect(evaluator().querySelector('.af-tc-dos:not([data-section])')).toBeNull()
    // …while the deal itself is all there.
    expect(evaluator().querySelector('.af-tc-builder')).not.toBeNull()
    expect(evaluator().querySelector('.af-tc-actions')).not.toBeNull()
  })

  it('"Outside offer" swaps in the no-league analyzer and stops reading rosters', async () => {
    hub()
    await waitFor(() => expect(rosterReads()).toHaveLength(1))
    fireEvent.change(leagueSelect(), { target: { value: 'outside' } })
    expect(evaluator().querySelector('.af-tc-builder')).toBeNull()
    expect(evaluator().querySelector('.af-tc-generic')).not.toBeNull()
    expect(rosterReads()).toHaveLength(1)
  })

  it('with no connected league it is the no-league analyzer from the start', () => {
    render(<TradeCenter league={null} leagues={[]} valueActions={[]} />)
    expect(leagueSelect().value).toBe('outside')
    expect(evaluator().querySelector('.af-tc-generic')).not.toBeNull()
    expect(rosterReads()).toHaveLength(0)
  })
})

describe('the league Trade Center keeps its page', () => {
  it('a full (not embedded) Trade Center still has its header, offers fold and avatar heads', async () => {
    const { container } = render(<TradeCenter league={{ id: 'lg-1', name: 'Dynasty One', format: 'Dynasty', teamCount: 12 }} />)
    expect(container.querySelector('.af-tc-head')).not.toBeNull()
    expect(container.querySelector('details.af-tc-offers')).not.toBeNull()
    await waitFor(() =>
      expect(container.querySelector(".af-tc-team[data-side='give'] .af-tc-team-avatar img")?.getAttribute('src')).toBe('https://img.test/me.png'),
    )
  })
})

describe('batch 2: lighter cards', () => {
  const phoneWidth = () =>
    Object.defineProperty(window, 'matchMedia', {
      configurable: true,
      writable: true,
      value: (query: string) => ({
        matches: query.includes('max-width: 720px'), media: query, addEventListener: () => {}, removeEventListener: () => {},
        addListener: () => {}, removeListener: () => {}, onchange: null, dispatchEvent: () => false,
      }),
    })

  it('on a phone each roster starts folded behind "Browse roster"; search still reaches it', async () => {
    phoneWidth()
    hub()
    await waitFor(() => expect(side('give').querySelector('details.af-tc-roster')).not.toBeNull())
    const fold = side('give').querySelector('details.af-tc-roster') as HTMLDetailsElement
    expect(fold.open).toBe(false)
    expect(fold.querySelector('summary')!.textContent).toContain('Browse roster')
  })

  it('on a wider screen the rosters start open', async () => {
    hub()
    await waitFor(() => expect(side('give').querySelector('details.af-tc-roster')).not.toBeNull())
    expect((side('give').querySelector('details.af-tc-roster') as HTMLDetailsElement).open).toBe(true)
  })

  it('a player with no headshot shows their position in its colour, not the first letter of the name', async () => {
    hub()
    await waitFor(() => expect(side('give').textContent).toContain('DK Metcalf'))
    const shot = side('give').querySelector('.af-tc-roster .af-tc-headshot') as HTMLElement
    expect(shot.getAttribute('data-pos')).toBe('wr')
    expect(shot.textContent).toBe('WR')
  })

  it('the team cards no longer repeat the league platform chip', async () => {
    hub()
    await waitFor(() => expect(side('give').textContent).toContain('DK Metcalf'))
    expect(side('give').querySelector('.af-tc-team-head .af-tc-mark')).toBeNull()
  })

  it('the value balance is one bar with the lean in words, not a red half and a green half', async () => {
    hub()
    const select = await partnerSelect()
    fireEvent.change(select, { target: { value: 'r2' } })
    fireEvent.click(screen.getByLabelText('Add DK Metcalf'))
    await waitFor(() => expect(side('get').textContent).toContain('Christian McCaffrey'))
    fireEvent.click(screen.getByLabelText('Add Christian McCaffrey'))
    const balance = evaluator().querySelector('.af-tc-balance') as HTMLElement
    expect(balance.querySelector('.af-tc-balance-give')).toBeNull()
    expect(balance.querySelector('.af-tc-balance-meter')?.getAttribute('data-tone')).toBe('good')
    expect(balance.querySelector('.af-tc-meter-label')?.textContent).toBe('Leans your way')
  })
})

describe('batch 2: a player in the deal', () => {
  it('without a headshot, wears the same position chip as in the roster list', async () => {
    hub()
    await waitFor(() => expect(side('give').textContent).toContain('DK Metcalf'))
    fireEvent.click(screen.getByLabelText('Add DK Metcalf'))
    const line = side('give').querySelector('div.af-tc-row[data-kind]') as HTMLElement
    expect(line.querySelector('.af-tc-headshot')?.getAttribute('data-pos')).toBe('wr')
    expect(line.querySelector('.af-tc-glyph')).toBeNull()
  })
})
