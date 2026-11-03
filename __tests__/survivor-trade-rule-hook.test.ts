// @vitest-environment node
/**
 * The one Survivor trade-rule check every trade path calls. Non-Survivor leagues and leagues with the
 * rules off pass after a single league read; a Survivor league's refusal comes back in its language.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  db: {
    league: { findUnique: vi.fn() },
    roster: { findMany: vi.fn() },
    survivorPlayer: { findMany: vi.fn() },
    survivorGameState: { findUnique: vi.fn() },
    survivorTribalCouncil: { findFirst: vi.fn() },
    redraftRosterPlayer: { findMany: vi.fn() },
  },
  kickoffs: vi.fn(),
  effects: vi.fn(),
}))
vi.mock('@/lib/prisma', () => ({ prisma: h.db }))
vi.mock('@/lib/redraft/lineupLock', () => ({
  buildWeekKickoffMap: h.kickoffs,
  lockTeamLookupKeys: (_sport: string, team: string | null | undefined) => (team ? [team.toUpperCase()] : []),
}))
vi.mock('@/lib/survivor/SurvivorEffectEngine', () => ({ getActiveEffectsForRoster: h.effects }))

import { checkSurvivorTradeRules } from '@/lib/survivor/survivorTradeRuleHook'
import { registerSurvivorTradeBypassProvider } from '@/lib/survivor/survivorTradeRuleBypass'

const THURSDAY_NIGHT = new Date('2026-11-06T00:30:00Z') // Thursday 19:30 ET: cross-tribe window closed
const input = {
  leagueId: 'L1',
  rosterIds: ['rd-a', 'rd-b'],
  rosterIdSpace: 'redraft' as const,
  players: [{ playerId: 'p1', playerName: null, fromRosterId: 'rd-a' }],
  now: THURSDAY_NIGHT,
}

function survivorLeague(governance: Record<string, unknown>, language = 'en') {
  h.db.league.findUnique.mockResolvedValue({ survivorMode: true, sport: 'NFL', season: 2026, language, settings: { tribalCouncilDay: 'Tuesday', tribalCouncilTime: '20:00', survivorGovernance: { tradeRulesEnabled: true, ...governance } } })
}

beforeEach(() => {
  vi.clearAllMocks()
  h.db.roster.findMany.mockResolvedValue([{ id: 'ra', redraftRosterId: 'rd-a', platformUserId: 'ua' }, { id: 'rb', redraftRosterId: 'rd-b', platformUserId: 'ub' }])
  h.db.survivorPlayer.findMany.mockResolvedValue([{ userId: 'ua', redraftRosterId: 'ra', tribeId: 'scorps' }, { userId: 'ub', redraftRosterId: 'rb', tribeId: 'shrooms' }])
  h.db.survivorGameState.findUnique.mockResolvedValue({ currentWeek: 9, phase: 'pre_merge', mergeTriggeredAt: null })
  h.db.survivorTribalCouncil.findFirst.mockResolvedValue(null)
  h.db.redraftRosterPlayer.findMany.mockResolvedValue([{ playerId: 'p1', playerName: 'Jalen Hurts', team: 'PHI' }])
  h.kickoffs.mockResolvedValue({ byTeam: new Map([['PHI', new Date('2026-11-09T01:20:00Z')]]), firstKickoff: null, warnings: [] })
  h.effects.mockResolvedValue([])
})

describe('checkSurvivorTradeRules', () => {
  it('a non-Survivor league passes after one read', async () => {
    h.db.league.findUnique.mockResolvedValue({ survivorMode: false, settings: {} })
    expect(await checkSurvivorTradeRules(input)).toEqual({ ok: true, skipped: 'not_survivor' })
    expect(h.db.roster.findMany).not.toHaveBeenCalled()
  })

  it('a Survivor league with the rules off passes', async () => {
    h.db.league.findUnique.mockResolvedValue({ survivorMode: true, settings: {} })
    expect(await checkSurvivorTradeRules(input)).toEqual({ ok: true, skipped: 'rules_off' })
  })

  it('refuses a cross-tribe trade after the window closes, in the league language', async () => {
    survivorLeague({}, 'es')
    const result = await checkSurvivorTradeRules(input)
    expect(result).toMatchObject({ ok: false, code: 'SURVIVOR_CROSS_TRIBE_CLOSED', status: 409 })
    expect(!result.ok && result.message).toContain('cambios entre tribus')
  })

  it('refuses a within-tribe trade of a player whose game has kicked off, until Tribal', async () => {
    survivorLeague({})
    h.db.survivorPlayer.findMany.mockResolvedValue([{ userId: 'ua', redraftRosterId: 'ra', tribeId: 'scorps' }, { userId: 'ub', redraftRosterId: 'rb', tribeId: 'scorps' }])
    h.kickoffs.mockResolvedValue({ byTeam: new Map([['PHI', new Date('2026-11-05T01:15:00Z')]]), firstKickoff: null, warnings: [] })
    const result = await checkSurvivorTradeRules(input)
    expect(result).toMatchObject({ ok: false, code: 'SURVIVOR_PLAYED_LOCK' })
    expect(!result.ok && result.message).toBe('Jalen Hurts has already played this week and cannot be traded until after Tribal Council.')
    // Once the week's council has closed, he is tradable again.
    h.db.survivorTribalCouncil.findFirst.mockImplementation(async ({ where }: { where: { closedAt: unknown } }) => (where.closedAt === null ? null : { id: 'c1' }))
    expect(await checkSurvivorTradeRules(input)).toMatchObject({ ok: true })
  })

  it('a free-trade effect on either roster bypasses the tribe rule', async () => {
    survivorLeague({})
    h.effects.mockImplementation(async (_l: string, rosterId: string) => (rosterId === 'rb' ? [{ rewardType: 'free_trade', appliedMode: 'full' }] : []))
    // The trade needed the bypass (the window is closed), so whatever settles it must spend it.
    expect(await checkSurvivorTradeRules(input)).toEqual({ ok: true, bypassed: true, bypassRequired: true, bypassSource: 'free_trade', week: 9 })
  })

  it('a registered bypass provider is honoured and can be removed', async () => {
    survivorLeague({})
    const remove = registerSurvivorTradeBypassProvider(async () => ({ bypass: true, source: 'test_token' }))
    expect(await checkSurvivorTradeRules(input)).toEqual({ ok: true, bypassed: true, bypassRequired: true, bypassSource: 'test_token', week: 9 })
    remove()
    expect(await checkSurvivorTradeRules(input)).toMatchObject({ ok: false })
  })

  it('fails open on a read error', async () => {
    survivorLeague({})
    h.db.roster.findMany.mockRejectedValue(new Error('db down'))
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    expect(await checkSurvivorTradeRules(input)).toEqual({ ok: true, skipped: 'error' })
    warn.mockRestore()
  })
})
