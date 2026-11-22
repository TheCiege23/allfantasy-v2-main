// @vitest-environment node
/**
 * The legacy Token Pool (/api/survivor/token-pool and /resolve, tokenPoolEngine.ts) is a bridge onto
 * the side-game Token Pool: a legacy win_pick becomes a side-game pick, a legacy resolve settles the
 * side-game picks (the commissioner override), an old unresolved legacy row pays into the ONE side-game
 * balance, and reads keep the legacy shape. Route: cron or commissioner allowed, others 403, bad input 400.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  session: { user: { id: 'u1' } } as { user: { id: string } } | null,
  cron: false,
  gate: { ok: true, status: 200 } as { ok: boolean; status: number },
  db: {
    tokenPoolPick: { findMany: vi.fn(), updateMany: vi.fn() },
    survivorPlayer: { findUnique: vi.fn() },
    survivorAuditEntry: { findMany: vi.fn() },
    $transaction: vi.fn(),
  },
  svc: { submitTokenPoolPick: vi.fn(), settleSideGamePicksForGame: vi.fn() },
  store: { loadSideGameLeague: vi.fn(), currentSurvivorWeek: vi.fn(), loadSideGameWeekGames: vi.fn(), loadSideGameState: vi.fn(), adjustSideGameTokens: vi.fn() },
}))
vi.mock('server-only', () => ({}))
vi.mock('next-auth', () => ({ getServerSession: async () => h.session }))
vi.mock('@/lib/auth', () => ({ authOptions: {} }))
vi.mock('@/app/api/cron/_auth', () => ({ requireCronAuth: () => h.cron }))
vi.mock('@/lib/league/league-access', () => ({ assertLeagueCommissioner: async () => h.gate, assertLeagueMember: async () => h.gate }))
vi.mock('@/lib/prisma', () => ({ prisma: h.db }))
vi.mock('@/lib/survivor/survivorSideGameService', () => h.svc)
vi.mock('@/lib/survivor/survivorSideGameStore', () => h.store)

import { POST as resolvePOST } from '@/app/api/survivor/token-pool/resolve/route'
import { getTokenBalance, getTokenPoolPicks, resolveTokenPoolPicks, submitTokenPoolPick } from '@/lib/survivor/tokenPoolEngine'
import { emptySideGameState } from '@/lib/survivor/survivorSideGameLedger'
import { readSurvivorSideGameSettings } from '@/lib/survivor/survivorSideGameSettings'

const games = [{ key: 'BUF@KC', homeKey: 'KC', awayKey: 'BUF', homeTeam: 'KC', awayTeam: 'BUF', startTime: null, final: false, homeScore: null, awayScore: null }]
const league = { id: 'L1', sport: 'NFL', season: 2026, language: 'en', settings: {}, platform: null, userId: 'host', survivorTokenCap: null, sideGames: readSurvivorSideGameSettings({}) }
const post = (body: object) => resolvePOST(new Request('https://x.test/api', { method: 'POST', body: JSON.stringify(body) }) as never)

beforeEach(() => {
  vi.clearAllMocks()
  h.session = { user: { id: 'u1' } }
  h.cron = false
  h.gate = { ok: true, status: 200 }
  h.store.loadSideGameLeague.mockResolvedValue(league)
  h.store.currentSurvivorWeek.mockResolvedValue({ week: 3, phase: 'pre_merge' })
  h.store.loadSideGameWeekGames.mockResolvedValue(games)
  h.store.loadSideGameState.mockResolvedValue(emptySideGameState())
  h.db.tokenPoolPick.findMany.mockResolvedValue([])
  h.db.survivorAuditEntry.findMany.mockResolvedValue([])
  h.db.survivorPlayer.findUnique.mockResolvedValue({ tokenBalance: 4 })
})

describe('/api/survivor/token-pool/resolve (legacy)', () => {
  it('commissioner allowed: settles the side-game picks as the commissioner override', async () => {
    const res = await post({ leagueId: 'L1', week: 3, results: { 'BUF@KC': { winner: 'Kansas City Chiefs' } } })
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ ok: true, resolved: 0, outcomes: [] })
    expect(h.svc.settleSideGamePicksForGame).toHaveBeenCalledWith(expect.objectContaining({ gameKey: 'BUF@KC', winnerKey: 'KC', by: 'commissioner', actorUserId: 'u1', which: 'token_pool' }))
  })

  it('cron allowed (settles as automation); a manager is refused 403', async () => {
    h.cron = true
    expect((await post({ leagueId: 'L1', week: 3, results: { 'BUF@KC': { winner: 'KC' } } })).status).toBe(200)
    expect(h.svc.settleSideGamePicksForGame).toHaveBeenCalledWith(expect.objectContaining({ by: 'auto', actorUserId: null }))
    h.cron = false
    h.gate = { ok: false, status: 403 }
    vi.clearAllMocks()
    expect((await post({ leagueId: 'L1', week: 3, results: { 'BUF@KC': { winner: 'KC' } } })).status).toBe(403)
    expect(h.svc.settleSideGamePicksForGame).not.toHaveBeenCalled()
  })

  it('bad input: 400', async () => {
    expect((await post({ leagueId: 'L1', week: 3 })).status).toBe(400)
    expect((await post({ week: 3, results: { a: {} } })).status).toBe(400)
  })
})

describe('tokenPoolEngine bridge', () => {
  it('a legacy win_pick becomes a side-game Token Pool pick', async () => {
    h.svc.submitTokenPoolPick.mockResolvedValue({ ok: true, pickId: 'tp:u1:3:BUF@KC', duplicate: false })
    const r = await submitTokenPoolPick({ leagueId: 'L1', userId: 'u1', week: 3, sport: 'NFL', pickType: 'win_pick', pick: { gameId: 'legacy-9', winner: 'Buffalo Bills' } })
    expect(r).toEqual({ pickId: 'tp:u1:3:BUF@KC' })
    expect(h.svc.submitTokenPoolPick).toHaveBeenCalledWith({ leagueId: 'L1', userId: 'u1', gameKey: 'BUF@KC', teamKey: 'BUF' })
  })

  it('other legacy pick types and side-game refusals throw a plain message', async () => {
    await expect(submitTokenPoolPick({ leagueId: 'L1', userId: 'u1', week: 3, sport: 'NFL', pickType: 'over_under', pick: {} })).rejects.toThrow(/game-winner/)
    h.svc.submitTokenPoolPick.mockResolvedValue({ ok: false, status: 403, error: 'Only managers on Exile Island can play the Token Pool.' })
    await expect(submitTokenPoolPick({ leagueId: 'L1', userId: 'u1', week: 3, sport: 'NFL', pickType: 'win_pick', pick: { gameKey: 'BUF@KC', winner: 'KC' } })).rejects.toThrow(/Exile/)
  })

  it('an old unresolved legacy row pays into the ONE side-game balance (never survivorExileToken)', async () => {
    h.db.tokenPoolPick.findMany.mockResolvedValue([{ id: 'old1', userId: 'u2', week: 3, pickType: 'win_pick', pick: { gameId: 'g1', winner: 'KC' }, isCorrect: null, tokensEarned: 0, tokensLost: 0 }])
    h.db.tokenPoolPick.updateMany.mockResolvedValue({ count: 1 })
    h.db.$transaction.mockImplementation(async (fn: (db: unknown) => unknown) => fn({}))
    h.store.adjustSideGameTokens.mockResolvedValue({ applied: 1, balance: 5 })
    const out = await resolveTokenPoolPicks('L1', 3, { g1: { winner: 'KC' } })
    expect(h.store.adjustSideGameTokens).toHaveBeenCalledWith({}, expect.objectContaining({ userId: 'u2', delta: 1, source: 'token_pool_legacy' }))
    expect(out).toEqual([{ pickId: 'old1', isCorrect: true, tokensEarned: 1, tokensLost: 0, newBalance: 5 }])
  })

  it('a pre-bridge row already stored as a no-cost miss is never charged again', async () => {
    h.db.tokenPoolPick.findMany.mockResolvedValue([{ id: 'old2', userId: 'u2', week: 3, pickType: 'win_pick', pick: { gameId: 'g1', winner: 'BUF' }, isCorrect: false, tokensEarned: 0, tokensLost: 0 }])
    const harshLeague = { ...league, sideGames: readSurvivorSideGameSettings({ survivorSideGames: { tokenPoolWrongPick: 'minus_one' } }) }
    h.store.loadSideGameLeague.mockResolvedValue(harshLeague)
    await resolveTokenPoolPicks('L1', 3, { g1: { winner: 'KC' } })
    expect(h.store.adjustSideGameTokens).not.toHaveBeenCalled()
    expect(h.db.tokenPoolPick.updateMany).not.toHaveBeenCalled()
  })

  it('reads: side-game picks in the legacy shape plus history, and the one balance', async () => {
    const s = emptySideGameState()
    s.tokenPool.set('u1', { pot: 0, picks: [{ pickId: 'tp:u1:3:BUF@KC', week: 3, gameKey: 'BUF@KC', teamKey: 'KC', at: '2026-10-20T00:00:00Z', outcome: 'correct', settledBy: 'auto' }] })
    h.store.loadSideGameState.mockResolvedValue(s)
    h.db.tokenPoolPick.findMany.mockResolvedValue([{ id: 'old', week: 1, sport: 'NFL', pickType: 'win_pick', pick: {}, isCorrect: true, tokensEarned: 1, tokensLost: 0, submittedAt: new Date('2026-09-10T00:00:00Z') }])
    const rows = await getTokenPoolPicks('L1', 'u1')
    expect(rows.map((r) => [r.id, r.source])).toEqual([['tp:u1:3:BUF@KC', 'side_game'], ['old', 'legacy']])
    expect(rows[0]).toMatchObject({ isCorrect: true, tokensEarned: 1 })
    expect(await getTokenBalance('L1', 'u1')).toBe(4)
  })
})
