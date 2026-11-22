/**
 * A commissioner marks one regular-season game final by hand, and can reopen it while its week is
 * still being played (lib/score-adjustments/manualFinal.ts).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))

type Row = { id: string; leagueId: string; seasonId: string; week: number; type: string; status: string; awayRosterId: string | null; homeScore: number; awayScore: number }
const db = vi.hoisted(() => {
  const state = { settings: {} as Record<string, unknown>, platform: 'manual' as string, currentWeek: 4, matchups: [] as Row[] }
  const shaped = (m: Row | undefined) => (m ? { ...m, season: { currentWeek: state.currentWeek } } : null)
  const matchup = {
    findFirst: vi.fn(async ({ where }: { where: { id: string; leagueId: string } }) => shaped(state.matchups.find((m) => m.id === where.id && m.leagueId === where.leagueId))),
    findUnique: vi.fn(async ({ where }: { where: { id: string } }) => shaped(state.matchups.find((m) => m.id === where.id))),
    update: vi.fn(async ({ where, data }: { where: { id: string }; data: { status?: string } }) => {
      const m = state.matchups.find((x) => x.id === where.id)!
      if (data.status) m.status = data.status
      return m
    }),
  }
  const tx = {
    $queryRaw: vi.fn(async () => []),
    league: {
      findUnique: vi.fn(async () => ({ settings: state.settings, platform: state.platform })),
      update: vi.fn(async ({ data }: { data: { settings: Record<string, unknown> } }) => { state.settings = data.settings; return {} }),
    },
    redraftMatchup: matchup,
  }
  const prisma = {
    $transaction: vi.fn(async (fn: (t: typeof tx) => unknown) => fn(tx)),
    redraftMatchup: matchup,
    leagueAuditLog: { create: vi.fn(async () => ({})) },
  }
  return { state, tx, prisma }
})
const standings = vi.hoisted(() => vi.fn(async () => ({})))
vi.mock('@/lib/prisma', () => ({ prisma: db.prisma }))
vi.mock('@/lib/redraft/standingsEngine', () => ({ updateStandings: standings }))

import { finalizeMatchupManually, reopenMatchupManually } from '@/lib/score-adjustments/manualFinalService'
import { isManuallyFinal, parseManualFinalReason, readManualFinals } from '@/lib/score-adjustments/manualFinal'

const finalize = (over: Record<string, unknown> = {}) => finalizeMatchupManually('L', 'commish', { matchupId: 'm1', reason: 'no stat feed this week', ...over })
const row = (id: string) => db.state.matchups.find((m) => m.id === id)!

beforeEach(() => {
  vi.clearAllMocks()
  db.state.settings = { scoring_mode: 'points', other: 1 }
  db.state.platform = 'manual'
  db.state.currentWeek = 4
  db.state.matchups = [
    { id: 'm1', leagueId: 'L', seasonId: 's1', week: 4, type: 'regular', status: 'active', awayRosterId: 'away', homeScore: 101.5, awayScore: 88 },
    { id: 'bye', leagueId: 'L', seasonId: 's1', week: 4, type: 'regular', status: 'scheduled', awayRosterId: null, homeScore: 0, awayScore: 0 },
    { id: 'next', leagueId: 'L', seasonId: 's1', week: 5, type: 'regular', status: 'scheduled', awayRosterId: 'away', homeScore: 0, awayScore: 0 },
    { id: 'po', leagueId: 'L', seasonId: 's1', week: 4, type: 'playoff', status: 'active', awayRosterId: 'away', homeScore: 1, awayScore: 2 },
    { id: 'done', leagueId: 'L', seasonId: 's1', week: 3, type: 'regular', status: 'final', awayRosterId: 'away', homeScore: 9, awayScore: 8 },
    { id: 'elsewhere', leagueId: 'L2', seasonId: 's9', week: 4, type: 'regular', status: 'active', awayRosterId: 'y', homeScore: 1, awayScore: 1 },
  ]
})

describe('marking a game final by hand', () => {
  it('closes it at the score it shows, lists it beside the matchup, refreshes standings and audits', async () => {
    expect(await finalize()).toEqual({ ok: true, matchupId: 'm1', week: 4, homeScore: 101.5, awayScore: 88 })
    expect(row('m1').status).toBe('final')
    expect(db.state.settings).toMatchObject({ other: 1 })
    expect(readManualFinals(db.state.settings)).toEqual([
      expect.objectContaining({ matchupId: 'm1', week: 4, homeScore: 101.5, awayScore: 88, reason: 'no stat feed this week', byUserId: 'commish' }),
    ])
    expect(db.tx.$queryRaw).toHaveBeenCalled()
    expect(standings).toHaveBeenCalledWith('s1', 4)
    expect(db.prisma.leagueAuditLog.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ actionType: 'matchup_finalized_manually', entityId: 'm1', userId: 'commish' }),
    }))
  })

  it('needs a reason, and refuses what is not a regular-season game being played', async () => {
    expect(await finalize({ reason: 'x' })).toEqual({ ok: false, error: 'bad_reason' })
    expect(await finalize({ matchupId: 'bye' })).toEqual({ ok: false, error: 'bye' })
    expect(await finalize({ matchupId: 'next' })).toEqual({ ok: false, error: 'future_week' })
    expect(await finalize({ matchupId: 'po' })).toEqual({ ok: false, error: 'not_regular_season' })
    expect(await finalize({ matchupId: 'done' })).toEqual({ ok: false, error: 'already_final' })
    expect(await finalize({ matchupId: 'elsewhere' })).toEqual({ ok: false, error: 'not_found' })
    expect(db.tx.league.update).not.toHaveBeenCalled()
    expect(standings).not.toHaveBeenCalled()
  })

  it('🛑 an imported league is scored by its provider, and a rotisserie league has no games', async () => {
    db.state.platform = 'sleeper'
    expect(await finalize()).toEqual({ ok: false, error: 'not_native' })
    db.state.platform = 'manual'
    db.state.settings = { scoring_mode: 'roto' }
    expect(await finalize()).toEqual({ ok: false, error: 'roto' })
    expect(row('m1').status).toBe('active')
  })

  it('a second mark on the same game is refused', async () => {
    await finalize()
    expect(await finalize()).toEqual({ ok: false, error: 'already_final' })
    expect(readManualFinals(db.state.settings)).toHaveLength(1)
  })
})

describe('reopening', () => {
  it('takes the game off the list and hands it back to the scorer, clearing the key when the list empties', async () => {
    await finalize()
    expect(await reopenMatchupManually('L', 'commish', { matchupId: 'm1' })).toMatchObject({ ok: true, matchupId: 'm1' })
    expect(row('m1').status).toBe('active')
    expect('commissioner_final_matchups' in db.state.settings).toBe(false)
    expect(db.state.settings).toMatchObject({ other: 1 })
    expect(db.prisma.leagueAuditLog.create).toHaveBeenLastCalledWith(expect.objectContaining({ data: expect.objectContaining({ actionType: 'matchup_reopened_manually' }) }))
  })

  it('only a game closed by hand, and only while its week is still the current one', async () => {
    expect(await reopenMatchupManually('L', 'commish', { matchupId: 'm1' })).toEqual({ ok: false, error: 'not_manual' })
    await finalize()
    db.state.currentWeek = 5
    expect(await reopenMatchupManually('L', 'commish', { matchupId: 'm1' })).toEqual({ ok: false, error: 'week_closed' })
    expect(row('m1').status).toBe('final')
  })
})

describe('the list', () => {
  it('drops an unreadable entry, and a reason is 3 to 200 characters', () => {
    const list = readManualFinals({ commissioner_final_matchups: [{ matchupId: 'a', week: 1, reason: 'r', byUserId: 'u', at: 't' }, { matchupId: '' }, 'junk'] })
    expect(list.map((f) => f.matchupId)).toEqual(['a'])
    expect(isManuallyFinal(list, 'a')).toBe(true)
    expect(isManuallyFinal(list, 'b')).toBe(false)
    expect(readManualFinals(null)).toEqual([])
    expect(parseManualFinalReason('  ruling  ')).toBe('ruling')
    expect(parseManualFinalReason('no')).toBeNull()
    expect(parseManualFinalReason('x'.repeat(201))).toBeNull()
  })
})
