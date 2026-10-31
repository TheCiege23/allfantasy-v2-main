/** The pick board's loader: the inventory each kind of league trades from, for members only. */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const m = vi.hoisted(() => ({
  league: { platform: 'manual', leagueType: 'dynasty', isDynasty: true, leagueVariant: null, season: 2026, settings: {} } as Record<string, unknown>,
  member: true,
  native: vi.fn(),
  imported: vi.fn(),
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    league: { findUnique: vi.fn(async () => m.league) },
    roster: {
      findMany: vi.fn(async () => [
        { id: 'r1', platformUserId: 'u1', playerData: {} },
        { id: 'r2', platformUserId: 'u2', playerData: {} },
      ]),
    },
    leagueTeam: {
      findMany: vi.fn(async () => [
        { id: 't1', externalId: '1', platformUserId: 'u1', claimedByUserId: null, teamName: 'Aces', ownerName: 'Ann' },
        { id: 't2', externalId: '2', platformUserId: 'u2', claimedByUserId: null, teamName: '', ownerName: 'Bo' },
      ]),
    },
  },
}))
vi.mock('@/lib/league-access', () => ({ resolveLeagueAccess: vi.fn(async () => (m.member ? { isMember: true } : null)) }))
vi.mock('@/lib/league-trade-engine/nativeFuturePicks', () => ({
  isNativeFuturePickLeague: (l: { platform?: string | null }) => l.platform === 'manual',
  loadNativeFuturePicks: m.native,
}))
vi.mock('@/lib/league-trade-engine/importedFuturePicks', () => ({
  hasSyncedProviderPicks: (p: string | null) => p === 'sleeper',
  loadImportedFuturePicks: m.imported,
}))

import { loadLeaguePickBoard } from '@/lib/dynasty-core/leaguePickBoardService'

beforeEach(() => {
  vi.clearAllMocks()
  m.member = true
  m.league = { platform: 'manual', leagueType: 'dynasty', isDynasty: true, leagueVariant: null, season: 2026, settings: {} }
  m.native.mockResolvedValue({
    seasons: [2027],
    rounds: 1,
    picks: [
      { season: 2027, round: 1, ownerTeamId: 'r1', originalTeamId: 'r1', source: 'own' },
      { season: 2027, round: 1, ownerTeamId: 'r1', originalTeamId: 'r2', source: 'stored' },
    ],
    ownerByPickId: new Map(),
  })
})

describe('loadLeaguePickBoard', () => {
  it('reads a native league’s pick inventory, naming every team', async () => {
    const r = await loadLeaguePickBoard('L', 'u2')
    if (!r.ok || !r.board) throw new Error('expected a board')
    expect(r.board.coverage).toBe('complete')
    // The viewer (u2 → r2, no team name → owner name) first; r1 holds both firsts.
    expect(r.board.teams.map((t) => [t.name, t.isViewer, t.total])).toEqual([['Bo', true, 0], ['Aces', false, 2]])
    expect(r.board.teams[1]!.bySeason[2027]!.map((p) => p.fromTeam)).toEqual([null, 'Bo'])
    expect(r.board.teams[0]!.tradedAwayBySeason[2027]).toEqual([{ round: 1, label: '1st', toTeam: 'Aces' }])
  })

  it('carries the league platform and sport, so the pick ledger opens the trade builder honestly', async () => {
    m.league = { ...m.league, sport: 'NFL' }
    const r = await loadLeaguePickBoard('L', 'u2')
    if (!r.ok || !r.board) throw new Error('expected a board')
    expect(r.trade).toEqual({ platform: 'manual', sport: 'NFL' })
  })

  it('reads an imported Sleeper league’s picks in roster space', async () => {
    m.league = { ...m.league, platform: 'sleeper', settings: { status: 'in_season' } }
    m.imported.mockResolvedValue({
      readFailed: false,
      coverage: 'traded_only',
      rosterIdByTeamId: new Map([['1', 'r1'], ['2', 'r2']]),
      picksByRosterId: new Map([['r2', [{ season: 2028, round: 2, ownerTeamId: '2', originalTeamId: '1', source: 'stored', fromTeamName: 'Aces' }]]]),
    })
    const r = await loadLeaguePickBoard('L', 'u1')
    if (!r.ok || !r.board) throw new Error('expected a board')
    expect(r.board).toMatchObject({ seasons: [2028], coverage: 'traded_only', rounds: null })
    expect(m.imported).toHaveBeenCalledWith(expect.objectContaining({ leagueId: 'L', status: 'in_season', isDynasty: true }))
    expect(r.board.teams.find((t) => t.rosterId === 'r1')!.tradedAwayBySeason[2028]).toEqual([{ round: 2, label: '2nd', toTeam: 'Bo' }])
  })

  it('says a league with no pick inventory has none, rather than showing an empty board', async () => {
    m.league = { ...m.league, platform: 'espn' }
    expect(await loadLeaguePickBoard('L', 'u1')).toEqual({ ok: true, board: null, reason: 'no_picks_tracked' })
    m.league = { ...m.league, platform: 'manual' }
    m.native.mockResolvedValue(null)
    expect(await loadLeaguePickBoard('L', 'u1')).toEqual({ ok: true, board: null, reason: 'no_picks_tracked' })
  })

  it('is for league members only', async () => {
    expect(await loadLeaguePickBoard('L', null)).toMatchObject({ ok: false, status: 401 })
    m.member = false
    expect(await loadLeaguePickBoard('L', 'stranger')).toMatchObject({ ok: false, status: 403 })
    expect(m.native).not.toHaveBeenCalled()
  })
})
