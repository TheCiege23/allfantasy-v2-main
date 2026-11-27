/**
 * The native trade builder is three steps, the shape of Sleeper's (owner ask, 2026-11-26):
 *   1. pick a partner — Chimmy's suggested partners on top, then every manager as a tappable row;
 *   2. add assets — both rosters side by side as player and pick tiles, with a live Receives / Sends
 *      summary that can take an asset back out;
 *   3. review — the same summary, the grade, an expiry and a "send a DM" switch, then send.
 * The submit body is the one the trades route has always taken; nothing about the server changed.
 */
import React from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'

vi.mock('next-auth/react', () => ({ useSession: () => ({ data: { user: { id: 'u1' } } }) }))
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))
vi.mock('@/components/ui/AppModal', () => ({
  AppModal: ({ open, title, children, footer }: { open: boolean; title?: string; children: React.ReactNode; footer?: React.ReactNode }) =>
    open ? <div><h2>{title}</h2>{children}{footer}</div> : null,
}))

import { ProposeTradeModal, tileName } from '@/app/league/[leagueId]/tabs/ProposeTradeModal'

const player = (id: string, name: string, position: string, team: string) => ({ id, name, position, team, imageUrl: `https://img/${id}.png` })
const rosters = [
  { rosterId: 'r1', platformUserId: 'u1', ownerName: 'Brown Pig Bandits', avatarUrl: null, wins: 3, losses: 1, ties: 0, canReceiveProposal: true, faabRemaining: 80,
    players: [player('p1', 'Jahmyr Gibbs', 'RB', 'DET'), player('p2', 'Dalton Kincaid', 'TE', 'BUF')],
    picks: [{ pickId: 'k1', season: 2027, round: 1, label: '2027 Round 1', itemType: 'future_pick', value: 30 }] },
  { rosterId: 'r2', platformUserId: 'u2', ownerName: 'Gridiron Goons', avatarUrl: null, wins: 2, losses: 2, ties: 0, canReceiveProposal: true, faabRemaining: 41,
    players: [player('p3', 'Puka Nacua', 'WR', 'LAR')], picks: [] },
  { rosterId: 'r3', platformUserId: 'u3', ownerName: 'Taco Tuesday', avatarUrl: null, wins: 1, losses: 3, ties: 0, canReceiveProposal: true, faabRemaining: null,
    players: [player('p4', 'Tee Higgins', 'WR', 'CIN')], picks: [] },
]
const suggestion = {
  rosterId: 'r3', fitScore: 72,
  packages: [{ id: 'pkg1', send: [{ kind: 'player', id: 'p2', name: 'Dalton Kincaid' }], receive: [{ kind: 'player', id: 'p4', name: 'Tee Higgins' }], fairness: 90, reason: 'Fills your WR2.', grade: null }],
}

function setup(opts: { submitError?: string; sport?: string } = {}) {
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    let body: unknown = {}
    let ok = true
    if (url.endsWith('/rosters')) body = { rosters, viewerRosterId: 'r1', viewerTeamRosterId: 'r1', suggestions: [suggestion], multiTeamSuggestions: [] }
    else if (url.endsWith('/grade-preview')) body = { grade: { graded: true, letter: 'B', partnerLetter: 'B', label: 'Even', giveValue: 80, getValue: 90 } }
    else if (url.endsWith('/trades') && init?.method === 'POST') {
      ok = !opts.submitError
      body = opts.submitError ? { error: opts.submitError } : { ok: true }
    }
    return { ok, json: async () => body }
  })
  vi.stubGlobal('fetch', fetchMock)
  const onClose = vi.fn(), onSubmitted = vi.fn()
  render(<ProposeTradeModal open leagueId="lg1" teams={[]} platform="allfantasy" sport={opts.sport ?? 'NFL'} onClose={onClose} onSubmitted={onSubmitted} />)
  return { fetchMock, onClose, onSubmitted }
}
const next = () => screen.getByTestId('propose-trade-next') as HTMLButtonElement
const note = () => screen.getByTestId('propose-trade-foot-note').textContent

afterEach(() => { cleanup(); vi.unstubAllGlobals() })

describe('tile names', () => {
  it('first initial and the rest; one word stays whole', () => {
    expect(tileName('Jahmyr Gibbs')).toBe('J. Gibbs')
    expect(tileName('Amon-Ra St. Brown')).toBe('A. St. Brown')
    expect(tileName('Ravens')).toBe('Ravens')
  })
})

describe('step 1 — pick a partner', () => {
  it("lists Chimmy's suggested partners above every manager; Next waits for a choice", async () => {
    setup()
    const step = await screen.findByTestId('propose-trade-step-partner')
    expect(screen.getByRole('heading', { level: 2 }).textContent).toBe('Propose a trade')
    const text = step.textContent ?? ''
    expect(text.indexOf("Chimmy's suggested partners")).toBeGreaterThanOrEqual(0)
    expect(text.indexOf("Chimmy's suggested partners")).toBeLessThan(text.indexOf('Pick a manager'))
    expect(screen.getByTestId('suggested-trade-partner-r3').textContent).toContain('72% fit')
    expect(screen.queryByTestId('propose-trade-partner-r1')).toBeNull() // never yourself
    expect(next().disabled).toBe(true)
    expect(note()).toBe('Choose who you are trading with')
    fireEvent.click(screen.getByTestId('propose-trade-partner-r2'))
    expect(screen.getByTestId('propose-trade-partner-r2').getAttribute('aria-pressed')).toBe('true')
    expect(note()).toBe('2-way trade: You, Gridiron Goons')
    expect(next().disabled).toBe(false)
  })

  it('a suggested partner fills in its package and goes straight to the assets', async () => {
    setup()
    fireEvent.click(await screen.findByTestId('suggested-trade-partner-r3'))
    expect(screen.getByTestId('propose-trade-step-assets')).toBeTruthy()
    expect(screen.getByRole('button', { name: /^Dalton Kincaid/ }).getAttribute('aria-pressed')).toBe('true')
    expect(screen.getByRole('button', { name: /^Tee Higgins/ }).getAttribute('aria-pressed')).toBe('true')
  })

  it('a third team needs a second manager before Next', async () => {
    setup()
    fireEvent.click(await screen.findByTestId('propose-trade-partner-r2'))
    fireEvent.click(screen.getByTestId('propose-trade-third-team'))
    expect(next().disabled).toBe(true)
    expect(note()).toBe('Pick the third team')
    fireEvent.click(screen.getByTestId('propose-trade-partner-r3'))
    expect(note()).toBe('3-way trade: You, Gridiron Goons, Taco Tuesday')
    expect(next().disabled).toBe(false)
  })
})

describe('step 2 — add assets', () => {
  async function toAssets() {
    const ctx = setup()
    fireEvent.click(await screen.findByTestId('propose-trade-partner-r2'))
    fireEvent.click(next())
    return ctx
  }

  it('shows both rosters as tiles: position, team, a short name, a face', async () => {
    await toAssets()
    expect(screen.getByRole('heading', { level: 2 }).textContent).toBe('Add trade assets')
    const mine = screen.getByRole('region', { name: 'Your roster' })
    const theirs = screen.getByRole('region', { name: 'Gridiron Goons roster' })
    const gibbs = within(mine).getByRole('button', { name: /^Jahmyr Gibbs, RB, DET/ })
    expect(gibbs.textContent).toContain('RB · DET')
    expect(gibbs.textContent).toContain('J. Gibbs')
    expect(gibbs.getAttribute('data-pos')).toBe('rb')
    expect(gibbs.querySelector('img')?.getAttribute('src')).toBe('https://img/p1.png')
    expect(within(mine).getByRole('button', { name: '2027 Round 1' })).toBeTruthy()
    expect(within(theirs).getByRole('button', { name: /^Puka Nacua/ })).toBeTruthy()
    // Taco Tuesday is not in this deal.
    expect(screen.queryByRole('button', { name: /^Tee Higgins/ })).toBeNull()
  })

  it('a tap adds to the live summary; × takes it back out', async () => {
    await toAssets()
    expect(next().disabled).toBe(true)
    fireEvent.click(screen.getByRole('button', { name: /^Jahmyr Gibbs/ }))
    fireEvent.click(screen.getByRole('button', { name: /^Puka Nacua/ }))
    const [you, goons] = screen.getAllByTestId('propose-trade-review-team')
    expect(you!.textContent).toMatch(/Receives.*Puka Nacua.*From Gridiron Goons.*Sends.*Jahmyr Gibbs.*To Gridiron Goons/)
    expect(goons!.textContent).toMatch(/Receives.*Jahmyr Gibbs.*From You/)
    expect(note()).toBe('You send 1 · You get 1')
    expect(next().disabled).toBe(false)
    fireEvent.click(within(you!).getByRole('button', { name: 'Remove Jahmyr Gibbs' }))
    expect(screen.getByRole('button', { name: /^Jahmyr Gibbs/ }).getAttribute('aria-pressed')).toBe('false')
    expect(you!.textContent).not.toContain('Jahmyr Gibbs')
  })

  it('FAAB shows in the summary as a dollar line', async () => {
    await toAssets()
    fireEvent.change(screen.getByLabelText('FAAB — Gridiron Goons'), { target: { value: '15' } })
    expect(screen.getByTestId('propose-trade-summary').textContent).toContain('$15 FAAB')
  })

  it('in a three-team deal, a second tap sends your player to the other partner', async () => {
    setup()
    fireEvent.click(await screen.findByTestId('propose-trade-partner-r2'))
    fireEvent.click(screen.getByTestId('propose-trade-third-team'))
    fireEvent.click(screen.getByTestId('propose-trade-partner-r3'))
    fireEvent.click(next())
    expect(screen.getByRole('region', { name: 'Taco Tuesday roster' })).toBeTruthy()
    const gibbs = () => screen.getByRole('button', { name: /^Jahmyr Gibbs/ })
    fireEvent.click(gibbs())
    expect(gibbs().getAttribute('aria-label')).toContain('to Gridiron Goons')
    fireEvent.click(gibbs())
    expect(gibbs().getAttribute('aria-label')).toContain('to Taco Tuesday')
    // Gibbs now goes to Taco Tuesday, so Gridiron Goons is in nothing yet: Next waits for them.
    expect(next().disabled).toBe(true)
    fireEvent.click(screen.getByRole('button', { name: /^Puka Nacua/ }))
    expect(next().disabled).toBe(false)
    const [, goons, taco] = screen.getAllByTestId('propose-trade-review-team')
    expect(goons!.textContent).toMatch(/Sends.*Puka Nacua.*To You/)
    expect(taco!.textContent).toMatch(/Receives.*Jahmyr Gibbs.*From You/)
    fireEvent.click(gibbs())
    expect(gibbs().getAttribute('aria-pressed')).toBe('false')
  })
})

describe('step 3 — review and send', () => {
  async function toReview(opts: Parameters<typeof setup>[0] = {}) {
    const ctx = setup(opts)
    fireEvent.click(await screen.findByTestId('propose-trade-partner-r2'))
    fireEvent.click(next())
    fireEvent.click(screen.getByRole('button', { name: /^Jahmyr Gibbs/ }))
    fireEvent.click(screen.getByRole('button', { name: /^Puka Nacua/ }))
    fireEvent.click(next())
    return ctx
  }

  it('shows the deal, the grade, an expiry and the DM switch; Back keeps the selection', async () => {
    await toReview()
    expect(screen.getByRole('heading', { level: 2 }).textContent).toBe('Review trade offer')
    const review = screen.getByTestId('propose-trade-review')
    expect(note()).toBe('2-way trade: You, Gridiron Goons')
    expect(within(review).queryByRole('button', { name: /^Remove/ })).toBeNull() // read-only here
    await waitFor(() => expect(screen.getByTestId('composer-deal-grade-box').textContent).toContain('Gridiron Goons B'))
    expect((screen.getByTestId('propose-trade-send-dm') as HTMLInputElement).checked).toBe(true)
    fireEvent.click(screen.getByRole('button', { name: 'Back' }))
    expect(screen.getByRole('button', { name: /^Jahmyr Gibbs/ }).getAttribute('aria-pressed')).toBe('true')
  })

  it('sends the same body the trades route has always taken, with the expiry and DM choice', async () => {
    const { fetchMock, onSubmitted, onClose } = await toReview()
    fireEvent.change(screen.getByTestId('propose-trade-expiry'), { target: { value: '168' } })
    fireEvent.click(screen.getByTestId('propose-trade-send-dm'))
    fireEvent.click(screen.getByTestId('propose-trade-submit'))
    await waitFor(() => expect(onSubmitted).toHaveBeenCalledOnce())
    expect(onClose).toHaveBeenCalledOnce()
    const call = fetchMock.mock.calls.find(([url, init]) => url === '/api/leagues/lg1/trades' && init?.method === 'POST')!
    const body = JSON.parse(String(call[1]?.body))
    expect(body).toMatchObject({ proposerRosterId: 'r1', receiverRosterId: 'r2', expiresInHours: 168, metadata: { sendDirectMessage: false, multiTeam: false } })
    expect(body.assets).toEqual([
      expect.objectContaining({ itemType: 'player', itemReference: 'p1', fromRosterId: 'r1', toRosterId: 'r2' }),
      expect.objectContaining({ itemType: 'player', itemReference: 'p3', fromRosterId: 'r2', toRosterId: 'r1' }),
    ])
  })

  it("a refusal stays on review and says the league's reason", async () => {
    const { onSubmitted } = await toReview({ submitError: 'Trade deadline has passed' })
    fireEvent.click(screen.getByTestId('propose-trade-submit'))
    expect((await screen.findByRole('alert')).textContent).toBe('Trade deadline has passed')
    expect(screen.getByTestId('propose-trade-review')).toBeTruthy()
    expect(onSubmitted).not.toHaveBeenCalled()
  })
})

describe('every sport', () => {
  it.each(['NBA', 'MLB', 'NHL', 'NCAAF', 'NCAAB', 'SOCCER'])('%s rosters draw as the same tiles', async (sport) => {
    setup({ sport })
    fireEvent.click(await screen.findByTestId('propose-trade-partner-r2'))
    fireEvent.click(next())
    expect(screen.getByRole('button', { name: /^Jahmyr Gibbs/ }).querySelector('[data-testid=nls-pavatar]')).toBeTruthy()
  })
})
