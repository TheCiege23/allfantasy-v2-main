import { beforeEach, describe, expect, it, vi } from 'vitest'

/*
 * Waiver Oversight on the Commissioner Hub (handoff 2026-09-13).
 *
 * ⚠ HONESTY RULES, NOT LAYOUT. An imported league must say its waivers live on the
 * platform instead of drawing an empty budget table; a manager's email must never be
 * the name shown; "outbid" must mean beaten by another claim, not "player was already
 * rostered"; a co-commissioner must never be offered a run button the route would
 * refuse; and a run that died mid-loop must be called stuck.
 */

const m = vi.hoisted(() => ({
  leagueWaiverSettings: { findUnique: vi.fn() },
  waiverRun: { findFirst: vi.fn() },
  waiverClaim: { count: vi.fn() },
  roster: { findMany: vi.fn() },
  leagueTeam: { findMany: vi.fn() },
  appUser: { findMany: vi.fn() },
  sportsPlayer: { findMany: vi.fn() },
}))
vi.mock('@/lib/prisma', () => ({ prisma: m }))

import { classifyResult, faabTone, getCommissionerWaiverOversight } from '@/lib/core-app/commissionerWaivers'

const NOW = new Date('2026-09-15T12:00:00Z')

beforeEach(() => {
  for (const d of Object.values(m)) for (const fn of Object.values(d)) (fn as ReturnType<typeof vi.fn>).mockReset()
  m.leagueWaiverSettings.findUnique.mockResolvedValue({
    waiverType: 'faab',
    faabBudget: 1000,
    processingDayOfWeek: 2,
    processingTimeUtc: '07:00',
    processingDays: null,
  })
  m.waiverRun.findFirst.mockResolvedValue({
    id: 'run1',
    runAt: new Date('2026-09-15T07:00:00Z'),
    runType: 'scheduled',
    status: 'completed',
    results: [
      { id: 'r1', rosterId: 'ro1', addPlayerId: 'p1', resultType: 'awarded', metadata: null, claim: { faabBid: 62, resultMessage: 'Awarded' } },
      { id: 'r2', rosterId: 'ro2', addPlayerId: 'p1', resultType: 'failed', metadata: { outcomeCode: 'player_no_longer_available', competingRosterId: 'ro1' }, claim: { faabBid: 40, resultMessage: 'Player no longer available (awarded to another team in this run).' } },
      { id: 'r3', rosterId: 'ro3', addPlayerId: 'p2', resultType: 'failed', metadata: { outcomeCode: 'insufficient_faab' }, claim: { faabBid: 80, resultMessage: 'Insufficient FAAB' } },
    ],
  })
  m.waiverClaim.count.mockResolvedValue(0)
  m.roster.findMany.mockResolvedValue([
    { id: 'ro1', platformUserId: 'sl-1', faabRemaining: 810 },
    { id: 'ro2', platformUserId: 'app-uuid-2', faabRemaining: 220 },
    { id: 'ro3', platformUserId: 'sl-3', faabRemaining: 40 },
    { id: 'ro4', platformUserId: 'sl-4', faabRemaining: null },
  ])
  m.leagueTeam.findMany.mockResolvedValue([
    { externalId: 'sl-1', ownerName: 'Dre', teamName: 'Dragons' },
    { externalId: 'sl-3', ownerName: '', teamName: 'Iron Reserve' },
  ])
  m.appUser.findMany.mockResolvedValue([{ id: 'app-uuid-2', displayName: null, username: 'mikek' }])
  m.sportsPlayer.findMany.mockResolvedValue([
    { id: 'p1', externalId: 'x1', name: 'Tank Bigsby', position: 'RB' },
    { id: 'p2', externalId: 'x2', name: 'Tyler Conklin', position: 'TE' },
  ])
})

describe('faabTone', () => {
  it('cuts at half and a fifth of the season budget', () => {
    expect(faabTone(500, 1000)).toBe('good')
    expect(faabTone(499, 1000)).toBe('warn')
    expect(faabTone(199, 1000)).toBe('bad')
  })
})

describe('classifyResult', () => {
  it('calls a claim outbid only when another roster in the run took the player', () => {
    expect(classifyResult('failed', { outcomeCode: 'player_no_longer_available', competingRosterId: 'x' }, null).result).toBe('outbid')
    expect(classifyResult('failed', { outcomeCode: 'player_no_longer_available' }, null).result).toBe('not_awarded')
  })
})

describe('getCommissionerWaiverOversight', () => {
  it('tells an imported league its waivers run on the platform', async () => {
    m.leagueWaiverSettings.findUnique.mockResolvedValue(null)
    m.waiverRun.findFirst.mockResolvedValue(null)
    const out = await getCommissionerWaiverOversight({ leagueId: 'L', platform: 'sleeper', role: 'commissioner', now: NOW })
    expect(out.available).toBe(false)
    if (!out.available) expect(out.reason).toMatch(/run on Sleeper/)
    expect(m.roster.findMany).not.toHaveBeenCalled()
  })

  it('computes spent and remaining per manager, most remaining first, skipping rosters with no balance', async () => {
    const out = await getCommissionerWaiverOversight({ leagueId: 'L', platform: 'manual', role: 'commissioner', now: NOW })
    if (!out.available) throw new Error('expected available')
    expect(out.budgets.map((b) => [b.handle, b.spent, b.remaining, b.tone])).toEqual([
      ['Dre', 190, 810, 'good'],
      ['@mikek', 780, 220, 'warn'],
      ['Iron Reserve', 960, 40, 'bad'],
    ])
  })

  it('never selects an email to name a manager', async () => {
    await getCommissionerWaiverOversight({ leagueId: 'L', platform: 'manual', role: 'commissioner', now: NOW })
    expect(Object.keys(m.appUser.findMany.mock.calls[0][0].select)).not.toContain('email')
  })

  it('labels the last run by what actually happened to each claim', async () => {
    const out = await getCommissionerWaiverOversight({ leagueId: 'L', platform: 'manual', role: 'commissioner', now: NOW })
    if (!out.available || !out.lastRun) throw new Error('expected a run')
    expect(out.lastRun.rows.map((r) => [r.player, r.manager, r.bid, r.result])).toEqual([
      ['Tank Bigsby (RB)', 'Dre', 62, 'won'],
      ['Tank Bigsby (RB)', '@mikek', 40, 'outbid'],
      ['Tyler Conklin (TE)', 'Iron Reserve', 80, 'short'],
    ])
    expect(out.lastRun.stuck).toBe(false)
  })

  it('calls a run that never completed stuck, and offers the run only to the primary commissioner', async () => {
    m.waiverRun.findFirst.mockResolvedValue({ id: 'run2', runAt: new Date('2026-09-15T07:00:00Z'), runType: 'scheduled', status: 'running', results: [] })
    m.waiverClaim.count.mockResolvedValue(3)
    const owner = await getCommissionerWaiverOversight({ leagueId: 'L', platform: 'manual', role: 'commissioner', now: NOW })
    const co = await getCommissionerWaiverOversight({ leagueId: 'L', platform: 'manual', role: 'co_commissioner', now: NOW })
    if (!owner.available || !co.available) throw new Error('expected available')
    expect(owner.lastRun?.stuck).toBe(true)
    expect(owner.canRunNow).toBe(true)
    expect(co.canRunNow).toBe(false)
    expect(co.pendingCount).toBe(3)
  })

  it('does not draw FAAB budgets for a league that does not use FAAB', async () => {
    m.leagueWaiverSettings.findUnique.mockResolvedValue({ waiverType: 'rolling', faabBudget: 100, processingDayOfWeek: null, processingTimeUtc: null, processingDays: null })
    const out = await getCommissionerWaiverOversight({ leagueId: 'L', platform: 'manual', role: 'commissioner', now: NOW })
    if (!out.available) throw new Error('expected available')
    expect(out.budgets).toEqual([])
    expect(out.budgetsReason).toMatch(/does not use FAAB/)
    expect(out.nextRun).toBeNull()
  })
})
