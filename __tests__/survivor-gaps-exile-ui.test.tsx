/**
 * G3 gaps, the screens: the castaway card shows the manager's used teams and refuses them; the Exile
 * page says nothing about who is there when membership is secret; the Survivor setup screen carries
 * the key side-game settings (season locks respected) and its route saves them through the SAME
 * side-game validator as league settings → Exile (allowed / locked 409 / bad 400 / non-commissioner 403).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'

const m = vi.hoisted(() => ({
  ui: { season: null as Record<string, unknown> | null, playerState: 'active', isCommissioner: false, survivorFairPlayActive: false, currentWeek: 6 },
  session: { user: { id: 'commish' } } as { user?: { id?: string } } | null,
  access: { isLeagueMember: true, decisions: { canUpdateSettings: true, canSeeHiddenIdolAssignments: false } } as Record<string, unknown> | null,
  lockCtx: { draftStarted: true, seasonStarted: false },
  tx: { league: { findUnique: vi.fn(), update: vi.fn() }, survivorCommissionerAction: { create: vi.fn() } },
  db: { league: { findUnique: vi.fn() }, survivorTribeMember: { count: vi.fn() }, $transaction: vi.fn() },
}))
vi.mock('next/navigation', () => ({ useParams: () => ({ leagueId: 'L1' }) }))
vi.mock('@/lib/survivor/SurvivorUiContext', () => ({ useSurvivorUi: () => m.ui }))
vi.mock('@/components/league/survivor/ExileRosterWaivers', () => ({ ExileRosterWaivers: () => null }))
vi.mock('@/components/league/survivor/ExileTokenWallet', () => ({ ExileTokenWallet: () => null }))
vi.mock('@/components/survivor/late/ExileBossBoard', () => ({ ExileBossBoard: () => null }))
vi.mock('next-auth', () => ({ getServerSession: vi.fn(async () => m.session) }))
vi.mock('@/lib/auth', () => ({ authOptions: {} }))
vi.mock('@/lib/prisma', () => ({ prisma: m.db }))
vi.mock('@/lib/survivor/survivorAccessControl', () => ({ resolveSurvivorAccessContext: vi.fn(async () => m.access) }))
vi.mock('@/lib/survivor/SurvivorLeagueConfig', () => ({ upsertSurvivorConfig: vi.fn() }))
vi.mock('@/lib/survivor/survivorIdolConfigService', () => ({
  isSurvivorDraftStarted: vi.fn(async () => true),
  getSurvivorIdolSetupView: vi.fn(async () => ({ config: { mode: 'random', count: 7, hideFromCommish: true, pickedTypeIds: [], pointSurgePct: 10, tributePct: 5 }, saved: true })),
  saveSurvivorIdolConfig: vi.fn(),
}))
vi.mock('@/lib/survivor/survivorSideGameService', () => ({ sideGameLockContext: vi.fn(async () => m.lockCtx) }))

import SurvivorExilePage from '@/app/survivor/[leagueId]/exile/page'
import { SurvivorSideGamesCard } from '@/components/survivor/SurvivorSideGamesCard'
import { SurvivorSettingsScreen } from '@/components/survivor/SurvivorSettingsScreen'
import { GET, POST } from '@/server/api-route-modules/league-survivor/settings-screen/route'
import { SURVIVOR_SIDE_GAME_DEFAULTS } from '@/lib/survivor/survivorSideGameSettings'
import { sideGamesForScreen, type SurvivorSettingsForm } from '@/lib/survivor/survivorSettingsScreen'

const fetchMock = vi.fn()
beforeEach(() => {
  fetchMock.mockReset()
  vi.stubGlobal('fetch', fetchMock)
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('castaway card: no reusing a team', () => {
  const view = {
    week: 5, sport: 'NFL', role: 'active',
    settings: { ...SURVIVOR_SIDE_GAME_DEFAULTS, survivorPoolEnabled: true, survivorPoolNoReuse: true },
    poolRule: { rule: 'any', conference: 'AFC', allowedTeams: [], division: '' },
    games: [{ key: 'BUF@KC', homeTeam: 'KC', awayTeam: 'BUF', homeKey: 'KC', awayKey: 'BUF', startTime: '2026-10-04T17:00:00Z', open: true, final: false, homeScore: null, awayScore: null }],
    tokens: 0, tokenPool: { pot: 0, picks: [] },
    pool: { entry: { alive: true, revivesUsed: 0, revivesGranted: 0, eliminatedWeek: null, wins: 1 }, revivesLeft: 2, banned: false, pick: null, usedTeams: ['KC'] },
    shop: [], purchases: [], auctions: [], balances: { faab: 80, auctionCash: 0 }, exileBid: null,
  }

  it('lists the manager’s used teams and disables them', async () => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => view })
    render(<SurvivorSideGamesCard leagueId="L1" />)
    const pool = await screen.findByTestId('survivor-side-pool')
    expect(within(pool).getByTestId('survivor-side-pool-used').textContent).toBe('Teams you have used: KC')
    expect((within(pool).getByRole('button', { name: 'KC · Used' }) as HTMLButtonElement).disabled).toBe(true)
    expect((within(pool).getByRole('button', { name: 'BUF' }) as HTMLButtonElement).disabled).toBe(false)
  })
})

describe('the Exile page under secrecy', () => {
  const players = [{ userId: 'a', displayName: 'Ana', playerState: 'exile' }, { userId: 'b', displayName: 'Ben', playerState: 'active' }]
  beforeEach(() => fetchMock.mockResolvedValue({ json: async () => ({ island: { isActive: true, currentWeek: 6 } }) }))

  it('a viewer who may not know sees no headcount and no names', async () => {
    m.ui = { ...m.ui, playerState: 'active', season: { exileMembershipHidden: true, players: [{ ...players[0], playerState: 'eliminated' }, players[1]] } }
    render(<SurvivorExilePage />)
    expect(screen.getByTestId('survivor-exile-headcount').textContent).toContain('Who is on Exile is secret')
    expect(screen.queryByText(/players marooned/)).toBeNull()
    expect(screen.queryByText('Ana')).toBeNull()
  })

  it('without secrecy the headcount shows as before; an exile sees the others', async () => {
    m.ui = { ...m.ui, playerState: 'active', season: { exileMembershipHidden: false, players } }
    render(<SurvivorExilePage />)
    expect(screen.getByTestId('survivor-exile-headcount').textContent).toBe('1 players marooned · Week 6')
    cleanup()
    m.ui = { ...m.ui, playerState: 'exile', season: { exileMembershipHidden: false, players } }
    render(<SurvivorExilePage />)
    expect(screen.getByText('Ana')).toBeTruthy()
  })
})

const ctx = { managers: 12, firstWeek: 1, lastWeek: 13 }
function form(over: Partial<SurvivorSettingsForm> = {}): SurvivorSettingsForm {
  return {
    tribeCount: 2, tribeFormation: 'random', voteDay: 'Tuesday', voteTime: '20:00', selfVotesAllowed: false, tieRule: 'revote_then_rocks',
    idolCount: 7, hideIdolsFromCommissioner: false, exileEnabled: true, exileReturnTokens: 3, exileBossMode: 'median', exileBossFixedScore: null, exileBossTopN: 3,
    swapEnabled: false, swapWeek: 5, mergeTrigger: 'week', mergeWeek: 8, mergeActivePlayerCount: 7, finalistCount: 3, shareCardsEnabled: true, publicMomentPages: true, spectatorPageEnabled: false,
    coCommissionerMode: 'disabled', mergeNamingMode: 'commissioner', juryEnabled: true, tribeChatsEnabled: true, exileHarshTokenLoss: false, houseRules: '',
    winningTribeFaabPerPlayer: 0, topScorerReward: 'none', topScorerAmount: 0, topScorerPowerType: 'extra_vote', tribeTieBreakPosition: 'none',
    realGameEnabled: true, realGamePerWeek: 2, realGamePrizeType: 'faab', realGamePrizeAmount: 5, challengeFaabWeeklyCap: 40,
    sideGames: { ...sideGamesForScreen(SURVIVOR_SIDE_GAME_DEFAULTS), survivorPoolEnabled: true },
    ...over,
  }
}

describe('Survivor setup screen: the key side games', () => {
  it('renders them, respects a side-game season lock, and counts a change as unsaved', async () => {
    const state = { leagueName: 'S', form: form(), context: { ...ctx, sideGames: { ...SURVIVOR_SIDE_GAME_DEFAULTS, survivorPoolEnabled: true } }, locks: { draftStarted: true, finalistLocked: true, tribesLocked: true }, chimmyBossAvailable: false, commissionerPlays: false, sideGameLocked: ['survivorPoolTieRule'] }
    fetchMock.mockImplementation(async () => new Response(JSON.stringify(state), { status: 200 }))
    render(<SurvivorSettingsScreen leagueId="L1" backHref="/league/L1" />)
    const section = await screen.findByTestId('survivor-settings-side-games')
    const tie = within(section).getByTestId('survivor-settings-pool-tie')
    expect(within(tie).getAllByRole('button').every((b) => (b as HTMLButtonElement).disabled)).toBe(true)
    expect(within(section).getByText('Locked for the season')).toBeTruthy()
    fireEvent.click(within(section).getByTestId('survivor-settings-pool-no-reuse'))
    expect(screen.getByTestId('survivor-settings-unsaved').textContent).toBe('1 unsaved change')
  })
})

describe('settings-screen route: side games through the shared validator', () => {
  const stored = { defaultTeamCount: 12, minTeamCount: 12, maxTeamCount: 12, tribeCount: 2, tribeAssignmentMode: 'random', mergeTriggerType: 'week', mergeWeek: 8, exileIslandEnabled: true, exileReturnTokens: 3, exileBossMode: 'median', finalistCount: 3, survivorSideGames: { survivorPoolEnabled: true } }
  const req = (body: unknown) => new Request('http://test/api', { method: 'POST', body: JSON.stringify(body), headers: { 'Content-Type': 'application/json' } }) as never
  const params = { params: Promise.resolve({ leagueId: 'L1' }) }
  beforeEach(() => {
    m.session = { user: { id: 'commish' } }
    m.access = { isLeagueMember: true, decisions: { canUpdateSettings: true, canSeeHiddenIdolAssignments: false } }
    m.lockCtx = { draftStarted: true, seasonStarted: false }
    m.db.league.findUnique.mockReset().mockImplementation(async () => ({ name: 'S', sport: 'NFL', settings: stored, survivorSwapWeek: null, survivorFinal3: true }))
    m.db.survivorTribeMember.count.mockReset().mockResolvedValue(12)
    m.db.$transaction.mockReset().mockImplementation(async (fn: (tx: unknown) => unknown) => fn(m.tx))
    m.tx.league.findUnique.mockReset().mockImplementation(async () => ({ settings: stored }))
    m.tx.league.update.mockReset()
    m.tx.survivorCommissionerAction.create.mockReset()
  })

  it('commissioner: a side-game change saves under survivorSideGames (merged, nothing else lost)', async () => {
    const before = (await (await GET(req({}), params)).json()).form as SurvivorSettingsForm
    expect(before.sideGames).toMatchObject({ survivorPoolEnabled: true, survivorPoolNoReuse: false })
    const res = await POST(req({ form: { ...before, sideGames: { ...before.sideGames, survivorPoolNoReuse: true } } }), params)
    expect(res.status).toBe(200)
    const saved = m.tx.league.update.mock.calls[0][0].data.settings.survivorSideGames
    expect(saved).toMatchObject({ survivorPoolEnabled: true, survivorPoolNoReuse: true })
  })

  it('a side-game key locked for the season: 409, nothing written', async () => {
    m.lockCtx = { draftStarted: true, seasonStarted: true }
    const before = (await (await GET(req({}), params)).json()).form as SurvivorSettingsForm
    const res = await POST(req({ form: { ...before, sideGames: { ...before.sideGames, survivorPoolTieRule: 'loss' } } }), params)
    expect(res.status).toBe(409)
    expect(m.tx.league.update).not.toHaveBeenCalled()
  })

  it('bad input: an unknown side-game key is 400; an out-of-range value is 422', async () => {
    const before = (await (await GET(req({}), params)).json()).form as SurvivorSettingsForm
    expect((await POST(req({ form: { ...before, sideGames: { tokenShopItems: [] } } }), params)).status).toBe(400)
    expect((await POST(req({ form: { ...before, sideGames: { ...before.sideGames, exileTokenFaabRate: 999 } } }), params)).status).toBe(422)
    expect(m.tx.league.update).not.toHaveBeenCalled()
  })

  it('non-commissioner: 403', async () => {
    m.access = { isLeagueMember: true, decisions: { canUpdateSettings: false } }
    expect((await POST(req({ form: {} }), params)).status).toBe(403)
  })
})
