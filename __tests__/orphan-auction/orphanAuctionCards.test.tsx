/** Orphan team auction — the Commissioner Hub card and the Waivers bid card, in both languages. */
import React from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'

const lang = vi.hoisted(() => ({ language: 'en' as 'en' | 'es' }))

vi.mock('@/components/i18n/LanguageProviderClient', async () => {
  const { translations } = await import('@/lib/i18n/translations')
  const t = (k: string) => translations[lang.language][k] ?? translations.en[k] ?? k
  return {
    useOptionalLanguage: () => ({
      language: lang.language,
      t,
      tInterpolate: (k: string, vars: Record<string, string | number>) => t(k).replace(/\{\{(\w+)\}\}/g, (_: string, v: string) => String(vars[v] ?? '')),
    }),
  }
})

import { OrphanAuction } from '@/components/core-app/commissioner/OrphanAuction'
import { OrphanAuctionBids } from '@/components/core-app/OrphanAuctionBids'

const FUTURE = new Date(Date.now() + 86_400_000).toISOString()
const PAST = new Date(Date.now() - 3_600_000).toISOString()

const ASSETS = [
  { id: 'p:rO:P1', kind: 'player', label: 'Star', position: 'WR', team: 'KC', from: 'Ghost FC' },
  { id: 'k:fdp', kind: 'pick', label: '2027 1st round', from: 'Ghost FC' },
]
const auction = (over: Record<string, unknown> = {}) => ({
  id: 'A1', status: 'open', closesAt: FUTURE, minBid: 1, teams: ['Ghost FC'], assets: ASSETS, biddingTeams: 1, eligibleTeams: 3, results: null, unsold: 0, ...over,
})
const view = (over: Record<string, unknown> = {}) => ({ supported: true, role: 'member', canOpen: false, orphanTeams: [], auction: auction(), mine: { rosterId: 'rA', teamName: 'Alpha', budget: 50, bids: {} }, ...over })

const stub = (body: unknown, post: { ok: boolean; body: unknown } = { ok: true, body: { ok: true } }) => {
  const f = vi.fn(async (_u: string, init?: { method?: string }) =>
    init?.method === 'POST' ? { ok: post.ok, json: async () => post.body } : { ok: true, json: async () => body },
  )
  vi.stubGlobal('fetch', f)
  return f
}
const posted = (f: ReturnType<typeof stub>) => f.mock.calls.filter((c) => c[1]?.method === 'POST').map((c) => JSON.parse(String((c[1] as { body: string }).body)))

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  lang.language = 'en'
})

describe('the Waivers bid card', () => {
  it('saves whole-dollar bids, leaving empty boxes out', async () => {
    const f = stub(view())
    render(<OrphanAuctionBids leagueId="L" />)
    const [star] = await screen.findAllByTestId('orphan-auction-bid')
    fireEvent.change(star!, { target: { value: '30' } })
    expect(screen.getByTestId('orphan-auction-total').textContent).toContain('$30 of $50')
    fireEvent.click(screen.getByTestId('orphan-auction-save'))
    await waitFor(() => expect(posted(f)).toEqual([{ action: 'bid', bids: { 'p:rO:P1': 30 } }]))
  })

  it('will not send bids over the team’s FAAB', async () => {
    stub(view())
    render(<OrphanAuctionBids leagueId="L" />)
    const [star, pick] = await screen.findAllByTestId('orphan-auction-bid')
    fireEvent.change(star!, { target: { value: '30' } })
    fireEvent.change(pick!, { target: { value: '21' } })
    expect(screen.getByTestId('orphan-auction-total').dataset.over).toBe('true')
    expect((screen.getByTestId('orphan-auction-save') as HTMLButtonElement).disabled).toBe(true)
  })

  it('shows the route’s refusal in the viewer’s language', async () => {
    lang.language = 'es'
    stub(view(), { ok: false, body: { error: 'The auction is closed.', code: 'AUCTION_CLOSED' } })
    render(<OrphanAuctionBids leagueId="L" />)
    fireEvent.click(await screen.findByTestId('orphan-auction-save'))
    expect(await screen.findByText('La subasta está cerrada.')).toBeTruthy()
  })

  it('shows what the team won once it closes, and nothing in a league with no auction', async () => {
    stub(view({ auction: auction({ status: 'closed', closesAt: PAST, results: [{ assetId: 'p:rO:P1', label: 'Star', rosterId: 'rA', teamName: 'Alpha', amount: 41 }] }) }))
    render(<OrphanAuctionBids leagueId="L" />)
    expect(await screen.findByText('You won 1 for $41 of FAAB.')).toBeTruthy()
    cleanup()
    stub({ supported: false })
    const { container } = render(<OrphanAuctionBids leagueId="L" />)
    await waitFor(() => expect(globalThis.fetch).toHaveBeenCalled())
    expect(container.innerHTML).toBe('')
  })
})

describe('the Commissioner Hub card', () => {
  const commish = (over: Record<string, unknown> = {}) =>
    view({ role: 'commissioner', canOpen: true, mine: null, auction: null, orphanTeams: [{ rosterId: 'rO', teamName: 'Ghost FC', players: 22, picks: 6 }], ...over })

  it('opens an auction for the chosen orphan teams', async () => {
    const f = stub(commish())
    render(<OrphanAuction leagueId="L" />)
    fireEvent.click(await screen.findByTestId('orphan-auction-team'))
    fireEvent.change(screen.getByTestId('orphan-auction-hours'), { target: { value: '72' } })
    fireEvent.click(screen.getByTestId('orphan-auction-start'))
    await waitFor(() => expect(posted(f)).toEqual([{ action: 'open', sourceRosterIds: ['rO'], closeAfterHours: 72, minBid: 1 }]))
  })

  it('without the plan it says so and cannot open one', async () => {
    stub(commish({ canOpen: false }))
    render(<OrphanAuction leagueId="L" />)
    expect(await screen.findByTestId('orphan-auction-plan')).toBeTruthy()
    expect((screen.getByTestId('orphan-auction-team').closest('fieldset') as HTMLFieldSetElement).disabled).toBe(true)
  })

  it('cannot close an auction before its bidding ends, and can after', async () => {
    stub(commish({ auction: auction() }))
    render(<OrphanAuction leagueId="L" />)
    expect(((await screen.findByTestId('orphan-auction-close')) as HTMLButtonElement).disabled).toBe(true)
    cleanup()
    const f = stub(commish({ auction: auction({ closesAt: PAST }) }))
    render(<OrphanAuction leagueId="L" />)
    const close = (await screen.findByTestId('orphan-auction-close')) as HTMLButtonElement
    expect(close.disabled).toBe(false)
    fireEvent.click(close)
    await waitFor(() => expect(posted(f)).toEqual([{ action: 'close' }]))
  })

  it('renders nothing for a member', async () => {
    stub(view())
    const { container } = render(<OrphanAuction leagueId="L" />)
    await waitFor(() => expect(globalThis.fetch).toHaveBeenCalled())
    expect(container.innerHTML).toBe('')
  })
})
