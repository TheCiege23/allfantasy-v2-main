/**
 * The guided "Propose trade" flow (components/core-app/screens/ProposeTradeFlow.tsx): partners from every
 * roster, assets with a per-team RECEIVES / SENDS summary, review and send — and the launch bar's gate.
 */
import React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, waitFor, within } from '@testing-library/react'

import {
  ProposeTradeFlow,
  ProposeTradeLaunch,
  buildProposalBody,
  defaultRecipient,
  partnersNotInDeal,
  shortName,
  summarize,
  type FlowAsset,
} from '@/components/core-app/screens/ProposeTradeFlow'
import type { LeagueRoster } from '@/components/core-app/screens/useLeagueRosters'

const player = (id: string, name: string, position: string, team: string, value = 10) => ({
  id, name, position, team, imageUrl: null, byeWeek: 9, injuryStatus: null, value,
})
const roster = (rosterId: string, ownerName: string, players: LeagueRoster['players'], extra: Partial<LeagueRoster> = {}): LeagueRoster => ({
  rosterId, platformUserId: `u-${rosterId}`, players, picks: [], teamExternalId: null, ownerName, avatarUrl: null,
  wins: 0, losses: 0, ties: 0, faabRemaining: 64, canReceiveProposal: true, ...extra,
})

const ROSTERS: LeagueRoster[] = [
  roster('r1', 'Brown Pig Bandits', [player('p1', 'Jahmyr Gibbs', 'RB', 'DET', 80), player('p2', 'Dalton Kincaid', 'TE', 'BUF', 30)], {
    picks: [{ pickId: 'pk1', season: 2027, round: 3, label: '2027 Round 3', itemType: 'future_pick', value: 8 },
      { pickId: 'pk2', season: 2027, round: 1, label: '2027 Round 1 (Sleeper)', itemType: 'future_pick', value: 30, proposable: false }],
  }),
  roster('r2', 'Gridiron Goons', [player('p3', 'Puka Nacua', 'WR', 'LAR', 90)], { faabRemaining: 41 }),
  roster('r3', 'Taco Tuesday', [player('p4', 'Tee Higgins', 'WR', 'CIN', 50)]),
  roster('r4', 'Kickin Knees', [player('p5', 'Cam Little', 'K', 'JAX', 2)], { canReceiveProposal: false }),
]

let calls: Array<{ url: string; method: string; body: unknown }> = []
function stubFetch(handler?: (url: string, init?: { method?: string; body?: string }) => unknown) {
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: { method?: string; body?: string }) => {
    calls.push({ url: String(url), method: init?.method ?? 'GET', body: init?.body ? JSON.parse(init.body) : null })
    const out = handler?.(String(url), init) ?? { ok: true }
    return { ok: true, status: 200, json: async () => out }
  }))
}

beforeEach(() => { calls = []; stubFetch() })
afterEach(() => { vi.unstubAllGlobals(); cleanup() })

function renderFlow(extra: Partial<React.ComponentProps<typeof ProposeTradeFlow>> = {}) {
  const onClose = vi.fn()
  const onSent = vi.fn()
  const r = render(
    <ProposeTradeFlow leagueId="lg1" rosters={ROSTERS} viewerRosterId="r1" onClose={onClose} onSent={onSent} signals={false} {...extra} />,
  )
  return { ...r, onClose, onSent }
}
const footer = (c: HTMLElement) => c.querySelector('.af-ptf-foot') as HTMLElement

describe('the pure rules', () => {
  it('short names, default recipients and teams not yet in the deal', () => {
    expect(shortName('Jared Goff')).toBe('J. Goff')
    expect(shortName('Amon-Ra St. Brown')).toBe('A. St. Brown')
    expect(shortName('Ravens')).toBe('Ravens')
    expect(defaultRecipient('r1', 'r1', ['r2', 'r3'])).toBe('r2')
    expect(defaultRecipient('r3', 'r1', ['r2', 'r3'])).toBe('r1')
    const assets = [{ key: 'a', kind: 'player', fromRosterId: 'r1', toRosterId: 'r2', ref: 'p1', label: 'X', value: 1 }] as FlowAsset[]
    expect(partnersNotInDeal(['r2', 'r3'], assets)).toEqual(['r3'])
    const sum = summarize(['r1', 'r2'], assets)
    expect(sum[0]!.sends.map((a) => a.key)).toEqual(['a'])
    expect(sum[1]!.receives.map((a) => a.key)).toEqual(['a'])
  })

  it('builds the body the trades route takes: players, picks with their type, FAAB amounts, message', () => {
    const body = buildProposalBody({
      viewerRosterId: 'r1',
      partners: ['r2'],
      assets: [
        { key: 'a', kind: 'player', fromRosterId: 'r1', toRosterId: 'r2', ref: 'p1', label: 'Gibbs', value: 80 },
        { key: 'b', kind: 'pick', fromRosterId: 'r1', toRosterId: 'r2', ref: 'pk1', itemType: 'future_pick', label: '2027 R3', value: 8 },
        { key: 'c', kind: 'faab', fromRosterId: 'r2', toRosterId: 'r1', ref: null, label: '$10 FAAB', amount: 10, value: null },
      ],
      message: '  fair deal  ',
      expiresInHours: 72,
    })
    expect(body).toEqual({
      proposerRosterId: 'r1',
      receiverRosterId: 'r2',
      assets: [
        { itemType: 'player', itemReference: 'p1', fromRosterId: 'r1', toRosterId: 'r2' },
        { itemType: 'future_pick', itemReference: 'pk1', fromRosterId: 'r1', toRosterId: 'r2' },
        { itemType: 'faab', fromRosterId: 'r2', toRosterId: 'r1', faabAmount: 10 },
      ],
      expiresInHours: 72,
      metadata: { offerMessage: 'fair deal' },
    })
  })
})

describe('step 1 — choose trade partners', () => {
  it('is a modal dialog listing every team, you first; Next waits for a partner', () => {
    const r = renderFlow()
    const dialog = r.getByRole('dialog')
    expect(dialog.getAttribute('aria-modal')).toBe('true')
    const names = [...dialog.querySelectorAll('.af-ptf-col-name > span:not(.af-ptf-avatar)')].map((n) => n.textContent)
    expect(names).toEqual(['You', 'Gridiron Goons', 'Taco Tuesday', 'Kickin Knees'])
    expect((within(footer(r.container)).getByRole('button', { name: 'Next' }) as HTMLButtonElement).disabled).toBe(true)
    expect(footer(r.container).textContent).toContain('Choose at least one partner')
  })

  it('a column header adds and removes a partner, and the footer names the N-way trade', () => {
    const r = renderFlow()
    const goons = r.getByRole('button', { name: 'Add Gridiron Goons as a trade partner' })
    fireEvent.click(goons)
    expect(goons.getAttribute('aria-pressed')).toBe('true')
    expect(footer(r.container).textContent).toContain('2-way trade: You, Gridiron Goons')
    fireEvent.click(r.getByRole('button', { name: 'Add Taco Tuesday as a trade partner' }))
    expect(footer(r.container).textContent).toContain('3-way trade: You, Gridiron Goons, Taco Tuesday')
    fireEvent.click(r.getByRole('button', { name: 'Remove Gridiron Goons from this trade' }))
    expect(footer(r.container).textContent).toContain('2-way trade: You, Taco Tuesday')
    expect((within(footer(r.container)).getByRole('button', { name: 'Next' }) as HTMLButtonElement).disabled).toBe(false)
  })

  it('a team that cannot receive offers cannot be chosen', () => {
    const r = renderFlow()
    const knees = r.getByRole('button', { name: 'Add Kickin Knees as a trade partner' }) as HTMLButtonElement
    expect(knees.disabled).toBe(true)
    expect(knees.textContent).toContain('Can’t receive offers')
  })

  it('cards show position, team and bye, a short name, and a position tint', () => {
    const r = renderFlow()
    const card = r.getByText('J. Gibbs').closest('.af-ptf-card') as HTMLElement
    expect(card.getAttribute('data-pos')).toBe('rb')
    expect(card.textContent).toContain('RB · DET (bye 9)')
  })

  it('Esc and × both close', () => {
    const r = renderFlow()
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(r.onClose).toHaveBeenCalledTimes(1)
    fireEvent.click(r.getByRole('button', { name: 'Close' }))
    expect(r.onClose).toHaveBeenCalledTimes(2)
  })
})

describe('step 2 — add trade assets', () => {
  function toStep2(partners: string[]) {
    const r = renderFlow()
    for (const p of partners) fireEvent.click(r.getByRole('button', { name: `Add ${p} as a trade partner` }))
    fireEvent.click(within(footer(r.container)).getByRole('button', { name: 'Next' }))
    return r
  }

  it('shows only the teams in the deal; a card toggle fills each team’s RECEIVES and SENDS', () => {
    const r = toStep2(['Gridiron Goons'])
    expect(r.queryByText('T. Higgins')).toBeNull()
    const gibbs = r.getByRole('button', { name: 'Include Jahmyr Gibbs' })
    fireEvent.click(gibbs)
    expect(gibbs.getAttribute('aria-pressed')).toBe('true')
    fireEvent.click(r.getByRole('button', { name: 'Include Puka Nacua' }))
    const summary = r.container.querySelector('.af-ptf-aside') as HTMLElement
    const [you, goons] = [...summary.querySelectorAll('.af-ptf-sum-team')] as HTMLElement[]
    expect(you!.textContent).toMatch(/Receives\s*Puka Nacua\s*From Gridiron Goons/)
    expect(you!.textContent).toMatch(/Sends\s*Jahmyr Gibbs\s*To Gridiron Goons/)
    expect(goons!.textContent).toMatch(/Receives\s*Jahmyr Gibbs\s*From You/)
    // Toggling it off takes it out again.
    fireEvent.click(gibbs)
    expect(you!.textContent).not.toContain('Jahmyr Gibbs')
  })

  it('a pick traded on its own platform cannot be added; FAAB is capped at what the team has left', () => {
    const r = toStep2(['Gridiron Goons'])
    expect((r.getByRole('button', { name: 'Include 2027 Round 1 (Sleeper)' }) as HTMLButtonElement).disabled).toBe(true)
    fireEvent.click(r.getByRole('button', { name: 'Include 2027 Round 3' }))
    fireEvent.change(r.getByLabelText('FAAB — Gridiron Goons'), { target: { value: '500' } })
    const summary = r.container.querySelector('.af-ptf-aside') as HTMLElement
    expect(summary.textContent).toContain('$41 FAAB')
    expect(summary.textContent).toContain('2027 Round 3')
  })

  it('a 3-team deal asks who receives each asset, and every partner must be in it before Next', () => {
    const r = toStep2(['Gridiron Goons', 'Taco Tuesday'])
    fireEvent.click(r.getByRole('button', { name: 'Include Jahmyr Gibbs' }))
    const next = within(footer(r.container)).getByRole('button', { name: 'Next' }) as HTMLButtonElement
    expect(next.disabled).toBe(true)
    expect(footer(r.container).textContent).toContain('Taco Tuesday isn’t in the deal yet')
    fireEvent.change(r.getByLabelText('Who receives Jahmyr Gibbs'), { target: { value: 'r3' } })
    fireEvent.click(r.getByRole('button', { name: 'Include Puka Nacua' }))
    expect(next.disabled).toBe(false)
    const summary = r.container.querySelector('.af-ptf-aside') as HTMLElement
    const taco = [...summary.querySelectorAll('.af-ptf-sum-team')].find((t) => t.textContent?.startsWith('Taco Tuesday')) as HTMLElement
    expect(taco.textContent).toMatch(/Receives\s*Jahmyr Gibbs/)
  })
})

describe('step 3 — review and send', () => {
  it('sends the trades route the deal, the message and the expiry, then refreshes and closes', async () => {
    const r = renderFlow()
    fireEvent.click(r.getByRole('button', { name: 'Add Gridiron Goons as a trade partner' }))
    fireEvent.click(within(footer(r.container)).getByRole('button', { name: 'Next' }))
    fireEvent.click(r.getByRole('button', { name: 'Include Jahmyr Gibbs' }))
    fireEvent.click(r.getByRole('button', { name: 'Include Puka Nacua' }))
    fireEvent.click(within(footer(r.container)).getByRole('button', { name: 'Next' }))
    expect(r.getByText('Review & send')).toBeTruthy()
    expect(r.container.textContent).toContain('Market value in 90 · out 80')
    fireEvent.change(r.getByLabelText('Message (optional)'), { target: { value: 'Puka for Gibbs?' } })
    fireEvent.change(r.getByLabelText('Offer expires in'), { target: { value: '24' } })
    fireEvent.click(r.getByRole('button', { name: 'Send offer' }))
    await waitFor(() => expect(r.onSent).toHaveBeenCalled())
    const post = calls.find((c) => c.method === 'POST')!
    expect(post.url).toBe('/api/leagues/lg1/trades')
    expect(post.body).toEqual({
      proposerRosterId: 'r1',
      receiverRosterId: 'r2',
      assets: [
        { itemType: 'player', itemReference: 'p1', fromRosterId: 'r1', toRosterId: 'r2' },
        { itemType: 'player', itemReference: 'p3', fromRosterId: 'r2', toRosterId: 'r1' },
      ],
      expiresInHours: 24,
      metadata: { offerMessage: 'Puka for Gibbs?' },
    })
    expect(r.onClose).toHaveBeenCalled()
  })

  it('a refusal stays open and says the league’s reason', async () => {
    stubFetch(() => ({ ok: false, error: 'Trade deadline has passed' }))
    const r = renderFlow()
    fireEvent.click(r.getByRole('button', { name: 'Add Gridiron Goons as a trade partner' }))
    fireEvent.click(within(footer(r.container)).getByRole('button', { name: 'Next' }))
    fireEvent.click(r.getByRole('button', { name: 'Include Jahmyr Gibbs' }))
    fireEvent.click(within(footer(r.container)).getByRole('button', { name: 'Next' }))
    fireEvent.click(r.getByRole('button', { name: 'Send offer' }))
    expect((await r.findByRole('alert')).textContent).toBe('Trade deadline has passed')
    expect(r.onSent).not.toHaveBeenCalled()
    expect(r.onClose).not.toHaveBeenCalled()
  })
})

describe('phone — one roster at a time', () => {
  it('a team strip picks the roster on screen, and a team is added from its own header', () => {
    vi.stubGlobal('matchMedia', (q: string) => ({ matches: q.includes('max-width: 720px'), addEventListener: () => {}, removeEventListener: () => {} }))
    const r = renderFlow()
    expect(r.container.querySelectorAll('.af-ptf-col').length).toBe(1)
    const strip = r.getByRole('tablist', { name: 'Teams' })
    fireEvent.click(within(strip).getByRole('tab', { name: /Gridiron Goons/ }))
    expect(r.container.querySelectorAll('.af-ptf-col').length).toBe(1)
    expect(r.getByText('P. Nacua')).toBeTruthy()
    fireEvent.click(r.getByRole('button', { name: 'Add Gridiron Goons as a trade partner' }))
    expect(footer(r.container).textContent).toContain('2-way trade: You, Gridiron Goons')
  })
})

describe('the league’s own trade block and interests', () => {
  it('tags block players, filters to them, and marks and adds an interest', async () => {
    stubFetch((url) => {
      if (url.includes('/trade-block')) return { items: [{ id: 'b1', playerId: 'p4' }] }
      if (url.includes('/interests') && !url.includes('/interests/')) return { interests: [{ id: 'i1', playerId: 'p3' }], interest: { id: 'i9' } }
      return { ok: true }
    })
    const r = renderFlow({ signals: true })
    await r.findByText('Trade block')
    expect(r.getByText('T. Higgins').closest('.af-ptf-card')!.textContent).toContain('Trade block')
    expect(r.getByRole('button', { name: 'Interested in Puka Nacua' }).getAttribute('aria-pressed')).toBe('true')
    fireEvent.click(r.getByLabelText('Trade block only'))
    expect(r.queryByText('P. Nacua')).toBeNull()
    expect(r.getByText('T. Higgins')).toBeTruthy()
    fireEvent.click(r.getByRole('button', { name: 'Mark interest in Tee Higgins' }))
    await waitFor(() => expect(calls.some((c) => c.method === 'POST' && c.url === '/api/redraft/trades/interests')).toBe(true))
    expect(calls.find((c) => c.method === 'POST')!.body).toMatchObject({ leagueId: 'lg1', playerId: 'p4', interestType: 'player_interest', targetRosterId: 'r3' })
  })

  it('a league with no block data shows neither the tag nor the filter', async () => {
    stubFetch(() => ({ items: [], interests: [] }))
    const r = renderFlow({ signals: true })
    await waitFor(() => expect(calls.length).toBeGreaterThanOrEqual(2))
    expect(r.queryByText('Trade block')).toBeNull()
    expect(r.queryByLabelText('Trade block only')).toBeNull()
  })
})

describe('the launch bar', () => {
  it('opens with a roster; without an AllFantasy roster it says why and stays shut', () => {
    const onOpen = vi.fn()
    const a = render(<ProposeTradeLaunch rosterData={{ rosters: ROSTERS, viewerRosterId: 'r1' }} onOpen={onOpen} />)
    fireEvent.click(a.getByRole('button', { name: 'Propose trade' }))
    expect(onOpen).toHaveBeenCalled()
    cleanup()
    const b = render(<ProposeTradeLaunch rosterData={{ rosters: ROSTERS, viewerRosterId: null }} onOpen={onOpen} />)
    expect((b.getByRole('button', { name: 'Propose trade' }) as HTMLButtonElement).disabled).toBe(true)
    expect(b.getByTestId('propose-trade-launch').textContent).toContain('You don’t hold a team in AllFantasy for this league')
  })
})
