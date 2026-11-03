/**
 * The league Trade Center's trade panel (TradeCenterPanel): Active · Review · History, a card per trade,
 * a per-team detail pane, and the engine's own accept / reject / cancel / vote / commissioner routes.
 */
import React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, waitFor, within } from '@testing-library/react'

const fetchTradesPanel = vi.fn()
vi.mock('@/components/core-app/screens/tradesPanelFetch', () => ({
  fetchTradesPanel: (...args: unknown[]) => fetchTradesPanel(...args),
}))
vi.mock('@/components/core-app/screens/ImpactNowReview', () => ({ ImpactNowReview: () => null }))
vi.mock('@/components/core-app/screens/TradeReactions', () => ({
  TradeReaction: () => null,
  TradeReactionSettings: () => null,
  AcceptedTradeReaction: () => null,
}))

import { TradeCenterPanel, cardStatus, teamStanding, timeLeft } from '@/components/core-app/screens/TradeCenterPanel'

const asset = (id: string, label: string, extra: Record<string, unknown> = {}) => ({ id, label, sublabel: null, headshotUrl: null, accent: 'teal', ...extra })
const side = (rosterId: string, name: string, isViewer: boolean, assets: unknown[], received: unknown[]) => ({
  rosterId, name, avatarUrl: null, isViewer, assets, received, grade: null, reason: null,
})
const FUTURE = new Date(Date.now() + 19 * 3_600_000 + 10 * 60_000).toISOString()

const INCOMING = {
  id: 't-in', direction: 'incoming', partnerName: 'Gridiron Goons', status: 'pending', timestamp: '2026-10-30T12:00:00.000Z',
  viewerIsReceiver: true, viewerIsProposer: false, viewerIsParticipant: true, viewerRosterId: 'r1', proposerRosterId: 'r2',
  expiresAt: FUTURE, acceptedRosterIds: [],
  sent: [asset('i1', 'Jahmyr Gibbs')], received: [asset('i2', 'Puka Nacua')],
  participantSides: [
    side('r1', 'Brown Pig Bandits', true, [asset('i1', 'Jahmyr Gibbs')], [asset('i2', 'Puka Nacua')]),
    side('r2', 'Gridiron Goons', false, [asset('i2', 'Puka Nacua')], [asset('i1', 'Jahmyr Gibbs')]),
  ],
}
const OUTGOING = {
  ...INCOMING, id: 't-out', direction: 'outgoing', viewerIsReceiver: false, viewerIsProposer: true, proposerRosterId: 'r1', partnerName: 'Taco Tuesday',
  participantSides: [
    side('r1', 'Brown Pig Bandits', true, [asset('o1', 'Dalton Kincaid')], [asset('o2', 'Tee Higgins')]),
    side('r7', 'Taco Tuesday', false, [asset('o2', 'Tee Higgins')], [asset('o1', 'Dalton Kincaid')]),
  ],
}
const THREE_WAY = {
  ...INCOMING, id: 't-3', partnerName: 'Taco Tuesday + Run CMC', proposerRosterId: 'r2', acceptedRosterIds: ['r3'],
  participantSides: [
    side('r1', 'Brown Pig Bandits', true, [asset('a1', 'A One')], [asset('b1', 'B One')]),
    side('r2', 'Taco Tuesday', false, [asset('b1', 'B One')], [asset('c1', 'C One')]),
    side('r3', 'Run CMC', false, [asset('c1', 'C One')], [asset('a1', 'A One')]),
    side('r4', 'Hail Murray', false, [], []),
  ],
}
const VOTE = {
  ...INCOMING, id: 't-vote', direction: 'complete', status: 'awaiting_votes', viewerIsReceiver: false, viewerIsParticipant: false,
  viewerCanVote: true, votes: { veto: 2, allow: 1, needed: 6, viewerVote: null },
  participantSides: [side('r5', 'Taco Tuesday', false, [asset('v1', 'X')], [asset('v2', 'Y')]), side('r6', 'Run CMC', false, [asset('v2', 'Y')], [asset('v1', 'X')])],
  proposerRosterId: 'r5',
}
const COMMISH = { ...VOTE, id: 't-com', status: 'awaiting_commissioner', viewerCanVote: false, votes: null, viewerIsCommissioner: true }
const PICK_TRADE = {
  ...INCOMING, id: 't-pick',
  participantSides: [
    side('r1', 'Brown Pig Bandits', true, [asset('k1', '2027 Round 3', { pick: { season: 2027, round: 3, originalRosterId: null, fromRosterId: null } })], []),
    side('r2', 'Gridiron Goons', false, [], [asset('k1', '2027 Round 3', { pick: { season: 2027, round: 3, originalRosterId: null, fromRosterId: null } })]),
  ],
}
const SLEEPER_OFFER = {
  provider: 'sleeper', transactionId: 'sl-1', direction: 'incoming', partnerName: 'Mixon It Up', proposedAt: '2026-10-31T00:00:00.000Z',
  give: [{ playerId: '1', name: 'Tua Tagovailoa', position: 'QB', team: 'MIA', isPick: false, pickYear: null, pickRound: null, faabAmount: null }],
  get: [{ playerId: '2', name: 'Baker Mayfield', position: 'QB', team: 'TB', isPick: false, pickYear: null, pickRound: null, faabAmount: null }],
}

const DATA = {
  activeTrades: [INCOMING, OUTGOING, THREE_WAY, VOTE, COMMISH, PICK_TRADE],
  historyTrades: [
    { id: 'h-done', direction: 'incoming', partnerName: 'Blitz Kreig', status: 'processed', timestamp: '2026-10-01T00:00:00.000Z', sent: [asset('h1', 'Done Player')], received: [] },
    { id: 'h-no', direction: 'outgoing', partnerName: 'End Zone Ballers', status: 'rejected', timestamp: '2026-09-01T00:00:00.000Z', sent: [asset('h2', 'Declined Player')], received: [] },
  ],
  pendingOffers: [SLEEPER_OFFER],
  pending: { scanned: true, reason: null, platform: 'sleeper', leagueUrl: 'https://sleeper.com/leagues/1', weeksUnanswered: 0 },
}

type Call = { url: string; method: string; body: unknown }
let calls: Call[] = []

beforeEach(() => {
  calls = []
  fetchTradesPanel.mockResolvedValue({ ok: true, data: DATA })
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: { method?: string; body?: string }) => {
    calls.push({ url: String(url), method: init?.method ?? 'GET', body: init?.body ? JSON.parse(init.body) : null })
    return { ok: true, status: 200, json: async () => ({ ok: true }) }
  }))
})
afterEach(() => { vi.unstubAllGlobals(); cleanup() })

function renderPanel(extra: Partial<React.ComponentProps<typeof TradeCenterPanel>> = {}) {
  return render(<TradeCenterPanel leagueId="lg1" onLoad={vi.fn()} onCounter={vi.fn()} {...extra} />)
}

describe('TradeCenterPanel — tabs and cards', () => {
  it('counts Active (open offers + provider offers) and Review (votes + commissioner) separately', async () => {
    const r = renderPanel()
    const active = await r.findByRole('tab', { name: /Active/ })
    expect(active.textContent).toContain('5')
    expect(r.getByRole('tab', { name: /Review/ }).textContent).toContain('2')
    expect(active.getAttribute('aria-selected')).toBe('true')
  })

  it('a card names everyone in the deal, its size, a countdown and the status in words', async () => {
    const r = renderPanel()
    const card = (await r.findAllByText('You, Gridiron Goons'))[0]!
    const btn = card.closest('button')!
    expect(btn.textContent).toMatch(/Incoming/)
    expect(btn.textContent).toMatch(/2-way trade/)
    // Minutes tick down between building the fixture and rendering it, so match the hour only.
    expect(btn.textContent).toMatch(/Ends in 19h \d+m/)
    expect(r.getByText('You, Taco Tuesday, Run CMC, Hail Murray').closest('button')!.textContent).toMatch(/4-way trade/)
  })

  it('draws a pick as a "3rd / 2027" token', async () => {
    const r = renderPanel()
    await r.findAllByText('You, Gridiron Goons')
    const tokens = r.container.querySelectorAll('.af-tcp-token--pick')
    expect(tokens.length).toBeGreaterThan(0)
    expect(tokens[0]!.textContent).toMatch(/3rd\s*2027/)
  })
})

describe('TradeCenterPanel — the detail pane and its actions', () => {
  it('an incoming offer: Decline, Counter and Accept, each to its own route', async () => {
    const r = renderPanel()
    fireEvent.click((await r.findAllByText('You, Gridiron Goons'))[0]!.closest('button')!)
    const detail = r.container.querySelector('.af-tcp-detail') as HTMLElement
    expect(within(detail).getByText('Trade offer')).toBeTruthy()
    fireEvent.click(within(detail).getByRole('button', { name: 'Accept' }))
    await waitFor(() => expect(calls.some((c) => c.url.endsWith('/trades/t-in/accept') && c.method === 'POST')).toBe(true))
    fireEvent.click(within(detail).getByRole('button', { name: 'Decline' }))
    await waitFor(() => expect(calls.some((c) => c.url.endsWith('/trades/t-in/reject'))).toBe(true))
    expect(within(detail).getByRole('button', { name: 'Counter' })).toBeTruthy()
  })

  it('each team gets a block: what it receives (from whom) and sends (to whom)', async () => {
    const r = renderPanel()
    fireEvent.click((await r.findAllByText('You, Gridiron Goons'))[0]!.closest('button')!)
    const teams = r.container.querySelectorAll('.af-tcp-team')
    expect(teams.length).toBe(2)
    expect(teams[0]!.textContent).toMatch(/Receives.*Puka Nacua.*From Gridiron Goons/)
    expect(teams[0]!.textContent).toMatch(/Sends.*Jahmyr Gibbs.*To Gridiron Goons/)
  })

  it('Survivor: a player whose idol rides along is marked in the detail pane', async () => {
    const withIdol = {
      ...INCOMING, id: 't-idol', partnerName: 'Island Rivals',
      participantSides: [
        side('r1', 'Brown Pig Bandits', true, [asset('d1', 'Tribal Star', { idol: true })], []),
        side('r9', 'Island Rivals', false, [], [asset('d1', 'Tribal Star', { idol: true })]),
      ],
    }
    fetchTradesPanel.mockResolvedValue({ ok: true, data: { ...DATA, activeTrades: [withIdol] } })
    const r = renderPanel()
    fireEvent.click((await r.findByText('You, Island Rivals')).closest('button')!)
    expect(r.getAllByText('Idol rides along').length).toBe(2)
  })

  it('a three-team offer marks who proposed, who has accepted, and who is still pending', async () => {
    const r = renderPanel()
    fireEvent.click((await r.findByText('You, Taco Tuesday, Run CMC, Hail Murray')).closest('button')!)
    const standing = (name: string) => [...r.container.querySelectorAll('.af-tcp-team')]
      .find((el) => el.querySelector('header b')?.textContent === name)!
      .querySelector('.af-tcp-standing')!.textContent
    expect(standing('Taco Tuesday')).toMatch(/Proposed/)
    expect(standing('Run CMC')).toMatch(/Accepted/)
    expect(standing('Hail Murray')).toMatch(/Pending/)
  })

  it('your own offer can be cancelled, not accepted', async () => {
    const r = renderPanel()
    fireEvent.click((await r.findByText('You, Taco Tuesday')).closest('button')!)
    const detail = r.container.querySelector('.af-tcp-detail') as HTMLElement
    expect(within(detail).queryByRole('button', { name: 'Accept' })).toBeNull()
    fireEvent.click(within(detail).getByRole('button', { name: 'Cancel offer' }))
    await waitFor(() => expect(calls.some((c) => c.url.endsWith('/trades/t-out/cancel'))).toBe(true))
  })

  it('the engine’s refusal is shown, not swallowed', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 400, json: async () => ({ error: 'The trade deadline has passed.' }) })))
    const r = renderPanel()
    fireEvent.click((await r.findAllByText('You, Gridiron Goons'))[0]!.closest('button')!)
    fireEvent.click(within(r.container.querySelector('.af-tcp-detail') as HTMLElement).getByRole('button', { name: 'Accept' }))
    expect((await r.findByRole('alert')).textContent).toBe('The trade deadline has passed.')
  })

  it('a Sleeper offer is read-only: no Accept, but Load into builder and a link to Sleeper', async () => {
    const onLoad = vi.fn()
    const r = renderPanel({ onLoad })
    fireEvent.click((await r.findByText('You, Mixon It Up')).closest('button')!)
    const detail = r.container.querySelector('.af-tcp-detail') as HTMLElement
    expect(within(detail).queryByRole('button', { name: 'Accept' })).toBeNull()
    expect(within(detail).getByRole('link', { name: 'Respond on Sleeper' }).getAttribute('href')).toBe('https://sleeper.com/leagues/1')
    fireEvent.click(within(detail).getByRole('button', { name: 'Load into builder' }))
    expect(onLoad).toHaveBeenCalledTimes(1)
  })
})

describe('TradeCenterPanel — Review: the league vote and commissioner review', () => {
  it('shows the veto meter and sends the viewer’s roster with the vote', async () => {
    const r = renderPanel()
    fireEvent.click(await r.findByRole('tab', { name: /Review/ }))
    const card = (await r.findAllByText('Taco Tuesday, Run CMC'))[0]!.closest('button')!
    expect(card.textContent).toMatch(/2 of 6 votes to veto/)
    fireEvent.click(card)
    const detail = r.container.querySelector('.af-tcp-detail') as HTMLElement
    expect(within(detail).getByText(/2 of 6 votes to veto · 1 vote to allow/)).toBeTruthy()
    fireEvent.click(within(detail).getByRole('button', { name: 'Veto' }))
    await waitFor(() => expect(calls.find((c) => c.url.endsWith('/trades/t-vote/vote'))?.body).toEqual({ voterRosterId: 'r1', vote: 'veto' }))
  })

  it('a commissioner approves or vetoes through the commissioner route', async () => {
    const r = renderPanel()
    fireEvent.click(await r.findByRole('tab', { name: /Review/ }))
    const cards = await r.findAllByText('Taco Tuesday, Run CMC')
    fireEvent.click(cards[1]!.closest('button')!)
    fireEvent.click(within(r.container.querySelector('.af-tcp-detail') as HTMLElement).getByRole('button', { name: 'Approve' }))
    await waitFor(() => expect(calls.find((c) => c.url.endsWith('/trades/t-com/commissioner'))?.body).toEqual({ decision: 'approve' }))
  })
})

describe('TradeCenterPanel — History', () => {
  it('lists settled trades only, with All · Sent · Received · Complete · Rejected', async () => {
    const r = renderPanel()
    fireEvent.click(await r.findByRole('tab', { name: /History/ }))
    const group = await r.findByRole('group', { name: 'Filter trade history' })
    expect([...group.querySelectorAll('button')].map((b) => b.textContent)).toEqual(['All', 'Sent', 'Received', 'Complete', 'Rejected'])
    await r.findByText('Done Player')
    expect(r.queryByText('Puka Nacua')).toBeNull()
    fireEvent.click(within(group).getByRole('button', { name: 'Rejected' }))
    await waitFor(() => expect(r.queryByText('Done Player')).toBeNull())
    expect(r.getByText('Declined Player')).toBeTruthy()
  })
})

describe('TradeCenterPanel — pure helpers', () => {
  it('timeLeft reads hours and minutes, days for long ones, and nothing once it has passed', () => {
    const now = Date.parse('2026-11-01T00:00:00.000Z')
    expect(timeLeft('2026-11-01T19:10:00.000Z', now)).toBe('19h 10m')
    expect(timeLeft('2026-11-03T04:00:00.000Z', now)).toBe('2d 4h')
    expect(timeLeft('2026-10-31T00:00:00.000Z', now)).toBeNull()
    expect(timeLeft(null, now)).toBeNull()
  })

  it('cardStatus and teamStanding follow the trade status and acceptedRosterIds', () => {
    expect(cardStatus(INCOMING as never)).toBe('incoming')
    expect(cardStatus(VOTE as never)).toBe('votes')
    expect(cardStatus({ ...INCOMING, status: 'scheduled' } as never)).toBe('processing')
    expect(teamStanding(THREE_WAY as never, 'r3', 'r2')).toBe('accepted')
    expect(teamStanding(THREE_WAY as never, 'r4', 'r2')).toBe('pending')
    expect(teamStanding({ ...THREE_WAY, status: 'awaiting_votes' } as never, 'r4', 'r2')).toBe('accepted')
  })
})
