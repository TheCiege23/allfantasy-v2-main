import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SurvivorSideGamesSettings } from '@/app/league/[leagueId]/components/settings/survivor/SurvivorSideGamesSettings'
import { SurvivorSideGamesCard } from '@/components/survivor/SurvivorSideGamesCard'
import { SurvivorSideGamesHubPanel } from '@/components/survivor/SurvivorSideGamesHubPanel'
import { SURVIVOR_SIDE_GAME_DEFAULTS } from '@/lib/survivor/survivorSideGameSettings'

const fetchMock = vi.fn()
vi.stubGlobal('fetch', fetchMock)
afterEach(() => cleanup())

const row = (label: string) => screen.getByText(label).closest('div.border-b') as HTMLElement

describe('league settings → Exile → side games', () => {
  beforeEach(() => {
    fetchMock.mockReset()
    fetchMock.mockImplementation(async (_url: string, init?: RequestInit) => {
      if (init?.method === 'POST') {
        const patch = JSON.parse(String(init.body)).settings
        return { ok: true, json: async () => ({ ok: true, settings: { ...SURVIVOR_SIDE_GAME_DEFAULTS, ...patch }, locked: [] }) }
      }
      return { ok: true, json: async () => ({ settings: SURVIVOR_SIDE_GAME_DEFAULTS, locked: ['exileTokenFaabRate'], sport: 'NFL' }) }
    })
  })

  it('saves only what changed (slots normalised) through side_games_settings', async () => {
    render(<SurvivorSideGamesSettings leagueId="L1" canEdit />)
    await screen.findByText('Survivor Pool on')
    fireEvent.change(screen.getByLabelText('Exile starting slots (blank = the main league’s)'), { target: { value: 'QB RB WR TE W/R/T' } })
    fireEvent.click(within(row('Survivor Pool on')).getByRole('switch'))
    fireEvent.click(within(row('Hide who is on Exile from everyone not there')).getByRole('switch'))
    fireEvent.click(screen.getByTestId('survivor-side-games-save'))
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/api/survivor/commissioner', expect.objectContaining({ method: 'POST' })))
    const body = JSON.parse(String(fetchMock.mock.calls.find(([, init]) => init?.method === 'POST')![1].body))
    expect(body.action).toBe('side_games_settings')
    expect(body.settings).toEqual({ exileLineupSlots: ['QB', 'RB', 'WR', 'TE', 'FLX'], hideExileMembership: true, survivorPoolEnabled: true })
    expect(await screen.findByRole('status')).toHaveTextContent('Saved.')
  })

  it('a season-locked setting is shown locked and disabled; read-only viewers cannot save', async () => {
    render(<SurvivorSideGamesSettings leagueId="L1" canEdit={false} />)
    await screen.findByText('FAAB per token on return ($, 0 = off) (Locked for the season)')
    expect(screen.getByLabelText('FAAB per token on return ($, 0 = off)')).toBeDisabled()
    expect(screen.getByTestId('survivor-side-games-save')).toBeDisabled()
  })
})

const view = (over: Record<string, unknown> = {}) => ({
  week: 5, sport: 'NFL', role: 'active',
  settings: { ...SURVIVOR_SIDE_GAME_DEFAULTS, survivorPoolEnabled: true },
  poolRule: { rule: 'any', conference: 'AFC', allowedTeams: [] },
  games: [{ key: 'BUF@KC', homeTeam: 'KC', awayTeam: 'BUF', homeKey: 'KC', awayKey: 'BUF', startTime: '2026-10-04T17:00:00Z', open: true, final: false, homeScore: null, awayScore: null }],
  tokens: 2, tokenPool: { pot: 0, picks: [] },
  pool: { entry: { alive: true, revivesUsed: 0, revivesGranted: 0, eliminatedWeek: null, wins: 0 }, revivesLeft: 2, banned: false, pick: null },
  shop: [], purchases: [], auctions: [], balances: { faab: 80, auctionCash: 0 }, exileBid: null,
  ...over,
})

describe('the castaway card', () => {
  beforeEach(() => fetchMock.mockReset())

  it('renders nothing when no side game applies', async () => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => view({ settings: SURVIVOR_SIDE_GAME_DEFAULTS }) })
    const { container } = render(<SurvivorSideGamesCard leagueId="L1" />)
    await waitFor(() => expect(fetchMock).toHaveBeenCalled())
    expect(container.querySelector('[data-testid="survivor-side-games-card"]')).toBeNull()
  })

  it('a castaway on the island picks in the Survivor Pool', async () => {
    fetchMock.mockImplementation(async (_url: string, init?: RequestInit) => (init?.method === 'POST' ? { ok: true, json: async () => ({ ok: true }) } : { ok: true, json: async () => view() }))
    render(<SurvivorSideGamesCard leagueId="L1" />)
    const pool = await screen.findByTestId('survivor-side-pool')
    fireEvent.click(within(pool).getByRole('button', { name: 'BUF' }))
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/api/survivor/side-games', expect.objectContaining({ method: 'POST' })))
    const body = JSON.parse(String(fetchMock.mock.calls.find(([, init]) => init?.method === 'POST')![1].body))
    expect(body).toEqual({ leagueId: 'L1', action: 'pool_pick', gameKey: 'BUF@KC', teamKey: 'BUF' })
  })

  it('an exile sees the Token Pool with the streak cash-out, never the Survivor Pool', async () => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => view({ role: 'exile', settings: { ...SURVIVOR_SIDE_GAME_DEFAULTS, survivorPoolEnabled: true, tokenPoolMode: 'streak' }, tokenPool: { pot: 2, picks: [] } }) })
    render(<SurvivorSideGamesCard leagueId="L1" />)
    const tp = await screen.findByTestId('survivor-side-token-pool')
    expect(within(tp).getByText('Streak: 2')).toBeInTheDocument()
    expect(within(tp).getByRole('button', { name: 'Bank streak' })).not.toBeDisabled()
    expect(screen.queryByTestId('survivor-side-pool')).toBeNull()
  })

  it('a sealed bid already placed shows as locked (no second bid box)', async () => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => view({ auctions: [{ auctionId: 'a1', label: 'Week 5', mode: 'sealed', currency: 'faab', opensAt: '', closesAt: '2026-10-05T01:00:00Z', status: 'open', takingBids: true, items: [{ itemId: 'item1', label: 'Mystery item', blind: true, prizeKind: null, myBid: 20, highBid: null, won: false }, { itemId: 'item2', label: 'Free trade', blind: false, prizeKind: 'free_trade_token', myBid: null, highBid: null, won: false }] }] }) })
    render(<SurvivorSideGamesCard leagueId="L1" />)
    const auctions = await screen.findByTestId('survivor-side-auctions')
    expect(within(auctions).getByText('Your bid: 20')).toBeInTheDocument()
    expect(within(auctions).queryByLabelText('Bid Mystery item')).toBeNull()
    expect(within(auctions).getByLabelText('Bid Free trade')).toBeInTheDocument()
  })
})

describe('Commissioner Hub → Exile → side games', () => {
  beforeEach(() => {
    fetchMock.mockReset()
    fetchMock.mockImplementation(async (_url: string, init?: RequestInit) => (init?.method === 'POST'
      ? { ok: true, json: async () => ({ ok: true }) }
      : { ok: true, json: async () => ({
        settings: { ...SURVIVOR_SIDE_GAME_DEFAULTS, survivorPoolEnabled: true }, week: 5,
        games: [{ key: 'BUF@KC', homeTeam: 'KC', awayTeam: 'BUF', homeKey: 'KC', awayKey: 'BUF', startTime: '2026-10-04T17:00:00Z', final: false, homeScore: null, awayScore: null }],
        openPicks: [{ game: 'pool', gameKey: 'BUF@KC', count: 3 }],
        pool: [{ userId: 'u2', displayName: 'Sam', alive: false, revivesLeft: 0, banned: true, wins: 1, picked: false }],
        auctions: [], pendingPurchases: 0, castaways: [],
      }) }))
  })

  it('settles a game by hand and grants a revive', async () => {
    render(<SurvivorSideGamesHubPanel leagueId="L1" />)
    const settleRow = await screen.findByTestId('survivor-settle-BUF@KC')
    expect(within(settleRow).getByText('3 open picks')).toBeInTheDocument()
    fireEvent.change(within(settleRow).getByLabelText('Winner'), { target: { value: 'KC' } })
    fireEvent.click(within(settleRow).getByRole('button', { name: 'Settle' }))
    await waitFor(() => expect(fetchMock.mock.calls.some(([, init]) => init?.method === 'POST')).toBe(true))
    const settle = JSON.parse(String(fetchMock.mock.calls.find(([, init]) => init?.method === 'POST')![1].body))
    expect(settle).toEqual({ leagueId: 'L1', action: 'side_game_settle', week: 5, gameKey: 'BUF@KC', winnerKey: 'KC' })
    const poolRow = await screen.findByTestId('survivor-pool-row-u2')
    expect(within(poolRow).getByText(/Banned/)).toBeInTheDocument()
    fireEvent.click(within(poolRow).getByRole('button', { name: 'Grant a revive' }))
    await waitFor(() => expect(fetchMock.mock.calls.filter(([, init]) => init?.method === 'POST')).toHaveLength(2))
    const grant = JSON.parse(String(fetchMock.mock.calls.filter(([, init]) => init?.method === 'POST')[1][1].body))
    expect(grant).toEqual({ leagueId: 'L1', action: 'pool_grant_revive', targetUserId: 'u2', count: 1 })
  })
})
