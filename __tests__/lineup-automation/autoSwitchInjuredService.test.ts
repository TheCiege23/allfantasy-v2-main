/**
 * The service around "auto-switch injured starters" (decisions 2026-11-18): the commissioner switches it
 * on and the manager is told; the manager may only switch it off; it runs only while the owner has Pro,
 * and only for a starter inside his window.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))

const h = vi.hoisted(() => {
  const db = {
    league: { findUnique: vi.fn() },
    roster: { findFirst: vi.fn(), findMany: vi.fn(), findUnique: vi.fn(), update: vi.fn() },
    $queryRaw: vi.fn(),
    $transaction: vi.fn(),
  }
  return {
    db,
    isElevatedCommissioner: vi.fn(),
    logAction: vi.fn(),
    hasPro: vi.fn(),
    dispatchNotification: vi.fn(),
    persist: vi.fn(),
    lockContext: vi.fn(),
    playerRows: vi.fn(),
    gameLock: vi.fn(),
  }
})

vi.mock('@/lib/prisma', () => ({ prisma: h.db }))
vi.mock('@/server/services/permissionService', () => ({ isElevatedCommissioner: h.isElevatedCommissioner }))
vi.mock('@/server/services/auditService', () => ({ logAction: h.logAction }))
vi.mock('@/lib/subscription/EntitlementResolver', () => ({
  EntitlementResolver: class {
    resolveForUser(userId: string, feature: string) {
      return Promise.resolve({ hasAccess: h.hasPro(userId, feature) })
    }
  },
}))
vi.mock('@/lib/notifications/NotificationDispatcher', () => ({ dispatchNotification: h.dispatchNotification }))
vi.mock('@/lib/lineup-automation/autoBenchByeService', () => ({ autoBenchByeLeagueBlock: () => null }))
vi.mock('@/lib/core-app/seasonTimeline', () => ({ leagueWeekFromSettings: () => 12 }))
vi.mock('@/lib/multi-sport/MultiSportRosterService', () => ({ getRosterTemplateForLeague: async () => null }))
vi.mock('@/lib/sport-defaults/LeagueVariantRegistry', () => ({ getFormatTypeForVariant: () => 'standard' }))
vi.mock('@/lib/league/lineupStarterSlots', () => ({
  resolveLineupStarterSlots: () => [
    { index: 0, label: 'QB', allowedPositions: ['QB'], isFlexible: false },
    { index: 1, label: 'RB', allowedPositions: ['RB'], isFlexible: false },
  ],
}))
vi.mock('@/lib/roster-lineup-engine/lineupLockService', () => ({ resolveFullLineupLockContext: h.lockContext }))
vi.mock('@/lib/roster-lineup-engine/lineupService', () => ({ persistRosterLineupWithEngine: h.persist }))
vi.mock('@/lib/player-data/getNormalizedPlayerData', () => ({ getNormalizedPlayerData: h.playerRows }))
vi.mock('@/lib/player-data/serializeUnifiedPlayerForApi', () => ({ serializeUnifiedPlayerForApi: (p: unknown) => p }))
vi.mock('@/lib/autocoach/playerGameLock', () => ({ getPlayerGameLockStateForAutoCoach: h.gameLock }))

import { runAutoSwitchInjured, setAutoSwitchInjured } from '@/lib/lineup-automation/autoSwitchInjuredService'
import { AUTO_SWITCH_INJURED_KEY } from '@/lib/lineup-automation/autoSwitchInjured'

const LEAGUE = { id: 'L', name: 'Test League', platform: 'native', sport: 'NFL', settings: {}, leagueType: 'redraft', bestBallMode: false, season: 2026, status: 'active', lifecycleState: 'in_season', lockAllMoves: false, leagueVariant: null }
const SETTING = { on: true, level: 'out', timing: 'pregame_90', byUserId: 'commish', ownerUserId: 'owner', since: '2026-11-18T00:00:00.000Z' }
const LINEUP = { lineup_sections: { starters: [{ id: 'qb1', position: 'QB', slotIndex: 0 }, { id: 'rb-hurt', position: 'RB', slotIndex: 1 }], bench: [{ id: 'rb-ok', position: 'RB' }], ir: [], taxi: [], devy: [] } }

beforeEach(() => {
  vi.clearAllMocks()
  h.db.league.findUnique.mockResolvedValue(LEAGUE)
  h.db.$transaction.mockImplementation(async (fn: (tx: unknown) => unknown) => fn(h.db))
  h.db.$queryRaw.mockResolvedValue([])
  h.db.roster.update.mockResolvedValue({})
  h.logAction.mockResolvedValue({ id: 'a' })
  h.dispatchNotification.mockResolvedValue(undefined)
})

describe('setAutoSwitchInjured', () => {
  beforeEach(() => {
    h.db.roster.findFirst.mockResolvedValue({ id: 'R1', platformUserId: 'owner' })
    h.db.roster.findUnique.mockResolvedValue({ settings: { other: 1 }, platformUserId: 'owner' })
  })

  it('refuses to let the manager switch it on', async () => {
    h.isElevatedCommissioner.mockResolvedValue(false)
    const r = await setAutoSwitchInjured('L', 'owner', 'R1', { on: true })
    expect(r).toMatchObject({ ok: false, status: 403 })
    expect(h.db.roster.update).not.toHaveBeenCalled()
  })

  it('refuses a member who is neither commissioner nor owner', async () => {
    h.isElevatedCommissioner.mockResolvedValue(false)
    expect(await setAutoSwitchInjured('L', 'stranger', 'R1', { on: false })).toMatchObject({ ok: false, status: 403 })
  })

  it('lets the manager switch it off, keeping the team’s other settings, without notifying themselves', async () => {
    h.isElevatedCommissioner.mockResolvedValue(false)
    h.db.roster.findUnique.mockResolvedValue({ settings: { other: 1, [AUTO_SWITCH_INJURED_KEY]: SETTING }, platformUserId: 'owner' })
    const r = await setAutoSwitchInjured('L', 'owner', 'R1', { on: false })
    expect(r).toEqual({ ok: true, setting: null })
    expect(h.db.roster.update).toHaveBeenCalledWith({ where: { id: 'R1' }, data: { settings: { other: 1 } } })
    expect(h.dispatchNotification).not.toHaveBeenCalled()
  })

  it('lets the commissioner switch it on for the current owner, and tells the manager', async () => {
    h.isElevatedCommissioner.mockResolvedValue(true)
    const r = await setAutoSwitchInjured('L', 'commish', 'R1', { on: true, level: 'doubtful', timing: 'night_before' })
    expect(r).toMatchObject({ ok: true, setting: { level: 'doubtful', timing: 'night_before', byUserId: 'commish', ownerUserId: 'owner' } })
    const written = h.db.roster.update.mock.calls[0]![0].data.settings
    expect(written.other).toBe(1)
    expect(written[AUTO_SWITCH_INJURED_KEY]).toMatchObject({ on: true, level: 'doubtful', ownerUserId: 'owner' })
    expect(h.dispatchNotification).toHaveBeenCalledTimes(1)
    expect(h.dispatchNotification.mock.calls[0]![0]).toMatchObject({ userIds: ['owner'], type: 'auto_switch_injured_on' })
    expect(h.logAction).toHaveBeenCalledWith(expect.objectContaining({ actionType: 'auto_switch_injured.on', entityId: 'R1' }))
  })
})

describe('runAutoSwitchInjured', () => {
  const now = new Date('2026-11-22T17:00:00Z')
  const kickoff = new Date('2026-11-22T18:00:00Z') // 60 minutes away: inside the 90-minute window

  beforeEach(() => {
    h.db.$queryRaw.mockResolvedValue([{ id: 'R1', leagueId: 'L' }])
    h.db.roster.findFirst.mockResolvedValue({ id: 'R1', platformUserId: 'owner', settings: { [AUTO_SWITCH_INJURED_KEY]: SETTING }, playerData: LINEUP })
    h.lockContext.mockResolvedValue({ locked: false, lockedPlayerIds: [] })
    h.playerRows.mockResolvedValue([
      { id: 'qb1', name: 'QB One', position: 'QB', projectedPoints: 20, injuryStatus: null, team: 'KC' },
      { id: 'rb-hurt', name: 'Hurt Back', position: 'RB', projectedPoints: 15, injuryStatus: 'Out', team: 'BUF' },
      { id: 'rb-ok', name: 'Healthy Back', position: 'RB', projectedPoints: 9, injuryStatus: null, team: 'MIA' },
    ])
    h.gameLock.mockResolvedValue({ scheduleKnown: true, lockedBecauseGameStarted: false, nextKickoffUtc: kickoff })
    h.persist.mockResolvedValue({ ok: true })
  })

  it('does nothing while the owner has no Pro', async () => {
    h.hasPro.mockReturnValue(false)
    const r = await runAutoSwitchInjured({ now: () => now })
    expect(r.skipped).toEqual({ owner_not_pro: 1 })
    expect(h.persist).not.toHaveBeenCalled()
  })

  it('swaps the injured starter inside his window, through the lineup engine, and tells the owner', async () => {
    h.hasPro.mockImplementation((userId: string, feature: string) => userId === 'owner' && feature === 'pro_autocoach')
    const r = await runAutoSwitchInjured({ now: () => now })
    expect(r.swapped).toBe(1)
    const save = h.persist.mock.calls[0]![0]
    expect(save).toMatchObject({ rosterId: 'R1', actorUserId: 'owner', expectedOwnerUserId: 'owner', source: 'system' })
    expect(save.automationAudit.action).toBe('auto_switch_injured.applied')
    expect(save.nextPlayerData.lineup_sections.starters.map((p: { id: string }) => p.id)).toEqual(['qb1', 'rb-ok'])
    expect(h.dispatchNotification.mock.calls[0]![0]).toMatchObject({ userIds: ['owner'], type: 'auto_switch_injured' })
  })

  it('waits when the game is further away than the window', async () => {
    h.hasPro.mockReturnValue(true)
    h.gameLock.mockResolvedValue({ scheduleKnown: true, lockedBecauseGameStarted: false, nextKickoffUtc: new Date('2026-11-22T20:00:00Z') })
    const r = await runAutoSwitchInjured({ now: () => now })
    expect(r.unchanged).toBe(1)
    expect(h.persist).not.toHaveBeenCalled()
  })

  it('does not run for a new owner who never had it switched on', async () => {
    h.hasPro.mockReturnValue(true)
    h.db.roster.findFirst.mockResolvedValue({ id: 'R1', platformUserId: 'someone-else', settings: { [AUTO_SWITCH_INJURED_KEY]: SETTING }, playerData: LINEUP })
    const r = await runAutoSwitchInjured({ now: () => now })
    expect(r.skipped).toEqual({ new_owner_or_off: 1 })
    expect(h.persist).not.toHaveBeenCalled()
  })
})
