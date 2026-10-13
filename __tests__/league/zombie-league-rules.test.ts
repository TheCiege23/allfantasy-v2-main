/**
 * Per-league Zombie rules: the override store (lib/zombie/zombieLeagueRules.ts), the league resolver
 * (getZombieRulesForLeague), the REAL bashing engine reading it, and the Specialty handler's
 * `zombie` save. The point of the feature is that the live engine honours the league's number, so
 * the bashing test drives detectAndProcessBashings itself rather than the resolver alone.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => {
  const state = {
    settings: {} as Record<string, unknown>,
    bashes: [] as Array<Record<string, unknown>>,
    zombieLeague: { id: 'Z1', leagueId: 'L1', sport: 'NFL', season: 2026, whispererAmbushCount: 3, universeId: null as string | null },
    cfg: { whispererSelection: 'random', infectionLossToWhisperer: true, infectionLossToZombie: true },
    cfgUpserts: [] as Array<Record<string, unknown>>,
    zlUpdates: [] as Array<Record<string, unknown>>,
    audits: [] as Array<Record<string, unknown>>,
  }
  const prisma: Record<string, any> = {
    zombieRulesTemplate: { findUnique: vi.fn(async () => null) },
    league: {
      findUnique: vi.fn(async () => ({ settings: JSON.parse(JSON.stringify(state.settings)) })),
      update: vi.fn(async ({ data }: { data: { settings: Record<string, unknown> } }) => {
        state.settings = data.settings
      }),
    },
    zombieLeague: {
      findUnique: vi.fn(async () => ({ ...state.zombieLeague })),
      update: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        state.zlUpdates.push(data)
        Object.assign(state.zombieLeague, data)
      }),
    },
    zombieLeagueConfig: { findUnique: vi.fn(async () => ({ ...state.cfg })) },
    zombieUniverse: { findUnique: vi.fn(async () => null) },
    redraftSeason: { findFirst: vi.fn(async () => ({ id: 'S1' })) },
    redraftMatchup: {
      // A 35-point win: a bash under the NFL default of 30, not under a league margin of 40.
      findMany: vi.fn(async () => [{ homeRosterId: 'rrA', awayRosterId: 'rrB', homeScore: 135, awayScore: 100 }]),
    },
    redraftRoster: { findUnique: vi.fn(async ({ where }: { where: { id: string } }) => ({ ownerId: where.id === 'rrA' ? 'uA' : 'uB' })) },
    roster: { findFirst: vi.fn(async () => null) },
    zombieLeagueTeam: { findUnique: vi.fn(async () => null) },
    zombieBashingEvent: {
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        state.bashes.push(data)
        return { id: `b${state.bashes.length}`, ...data }
      }),
    },
  }
  prisma.$transaction = vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => fn(prisma))
  return { state, prisma }
})

vi.mock('@/lib/prisma', () => ({ prisma: h.prisma }))
vi.mock('@/lib/zombie/commissionerNotificationService', () => ({ notifyCommissioner: vi.fn(async () => undefined), notifyZombiePlayer: vi.fn(async () => undefined) }))
vi.mock('@/lib/zombie/animationEngine', () => ({ queueAnimation: vi.fn(async () => undefined) }))
vi.mock('@/lib/zombie/ZombieOwnerStatusService', () => ({ setZombie: vi.fn() }))
vi.mock('@/lib/zombie/ZombieAuditLog', () => ({ appendZombieAudit: vi.fn() }))
vi.mock('@/lib/zombie/auditService', () => ({ logAuditEntry: vi.fn(async (_id: string, e: Record<string, unknown>) => { h.state.audits.push(e) }) }))
vi.mock('@/lib/zombie/ZombieLeagueConfig', () => ({
  upsertZombieLeagueConfig: vi.fn(async (_l: string, input: Record<string, unknown>) => {
    h.state.cfgUpserts.push(input)
    Object.assign(h.state.cfg, input)
  }),
}))
vi.mock('@/lib/auth', () => ({ authOptions: {} }))
vi.mock('next-auth', () => ({ getServerSession: vi.fn(async () => ({ user: { id: 'u-head', email: null } })) }))
vi.mock('@/lib/subscription/entitlement-middleware', () => ({ requireFeatureEntitlement: vi.fn() }))
vi.mock('@/lib/guillotine/GuillotineLeagueConfig', () => ({ getGuillotineConfig: vi.fn(), upsertGuillotineConfig: vi.fn() }))
vi.mock('@/lib/salary-cap/SalaryCapLeagueConfig', () => ({ getSalaryCapConfig: vi.fn(), upsertSalaryCapConfig: vi.fn() }))
vi.mock('@/lib/scoring-engine/resolveTeamLabels', () => ({ buildRosterLabelMap: vi.fn(async () => new Map()) }))
vi.mock('@/lib/league/specialty-settings-access', async (orig) => {
  const actual = await orig<typeof import('@/lib/league/specialty-settings-access')>()
  return {
    ...actual,
    detectGatedSpecialtyFormats: vi.fn(async () => ['zombie']),
    resolveSpecialtySettingsAccess: vi.fn(async () => ({
      isCommish: true, canEdit: true, coveredBySubscription: true, unlock: null, season: 2026,
      tokenCost: 200, paywallLive: true, paywallStartsAt: '2026-10-15',
    })),
    specialtySettingsEditRefusal: vi.fn(async () => null),
  }
})

import { parseZombieRulesPatch, readZombieRuleOverrides } from '@/lib/zombie/zombieLeagueRules'
import { getZombieRulesForLeague } from '@/lib/zombie/zombieRules'
import { detectAndProcessBashings } from '@/lib/zombie/bashingEngine'
import { GET, PATCH } from '@/app/api/leagues/[leagueId]/specialty-settings/handler'

const effective = {
  bashingThreshold: 30, maulingThreshold: 50, bashDecisionHours: 48, weaponShieldThreshold: 100,
  weaponAmbushThreshold: 120, bombEnabled: true, reviveThreshold: 3, serumMaxHold: 5,
  whispererDefeatRule: 'commissioner_decides' as const,
}

beforeEach(() => {
  h.state.settings = {}
  h.state.bashes = []
  h.state.cfgUpserts = []
  h.state.zlUpdates = []
  h.state.audits = []
  h.state.cfg = { whispererSelection: 'random', infectionLossToWhisperer: true, infectionLossToZombie: true }
  h.state.zombieLeague.whispererAmbushCount = 3
})

describe('zombie rule overrides', () => {
  it('keeps only valid stored keys, so a bad value falls back to the sport rule', () => {
    expect(readZombieRuleOverrides({ zombie_rules: { bashingThreshold: 40, maulingThreshold: -5, bombEnabled: 'no', whispererDefeatRule: 'season_escalation' } }))
      .toEqual({ bashingThreshold: 40, whispererDefeatRule: 'season_escalation' })
  })

  it('judges pairs on the effective values', () => {
    expect(parseZombieRulesPatch({ bashingThreshold: 55 }, effective)).toEqual({ ok: false, error: 'A mauling has to take a bigger margin than a bashing.' })
    expect(parseZombieRulesPatch({ weaponShieldThreshold: 130 }, effective).ok).toBe(false)
    expect(parseZombieRulesPatch({ serumMaxHold: 2 }, effective).ok).toBe(false)
    expect(parseZombieRulesPatch({ bashingThreshold: 32.5 }, effective)).toEqual({ ok: true, patch: { bashingThreshold: 32.5 } })
    expect(parseZombieRulesPatch({ bashDecisionHours: 30.5 }, effective).ok).toBe(false)
  })

  it('takes an NBA-sized line (its own bow is 1,050 and its maul 211) and still stops a typo', () => {
    const nba = { ...effective, bashingThreshold: 128, maulingThreshold: 211, weaponShieldThreshold: 900, weaponAmbushThreshold: 1050 }
    expect(parseZombieRulesPatch({ weaponAmbushThreshold: 1200, maulingThreshold: 260 }, nba)).toEqual({ ok: true, patch: { weaponAmbushThreshold: 1200, maulingThreshold: 260 } })
    expect(readZombieRuleOverrides({ zombie_rules: { weaponAmbushThreshold: 1200 } })).toEqual({ weaponAmbushThreshold: 1200 })
    expect(parseZombieRulesPatch({ weaponAmbushThreshold: 50000 }, nba).ok).toBe(false)
  })

  it('getZombieRulesForLeague lays the league override over the sport rule', async () => {
    h.state.settings = { zombie_rules: { bashingThreshold: 40, bombEnabled: false } }
    const r = await getZombieRulesForLeague('L1', 'NFL')
    expect(r).toMatchObject({ bashingThreshold: 40, maulingThreshold: 50, bombEnabled: false, bashDecisionHours: 48 })
    expect(r.overridden.sort()).toEqual(['bashingThreshold', 'bombEnabled'])
  })
})

describe('the live bashing engine reads the league rules', () => {
  it('a 35-point win bashes under the sport default and not under a league margin of 40', async () => {
    await detectAndProcessBashings('L1', 5, 'Z1')
    expect(h.state.bashes).toHaveLength(1)

    h.state.bashes = []
    h.state.settings = { zombie_rules: { bashingThreshold: 40 } }
    await detectAndProcessBashings('L1', 5, 'Z1')
    expect(h.state.bashes).toHaveLength(0)
  })

  it('the decision window follows the league setting', async () => {
    h.state.settings = { zombie_rules: { bashDecisionHours: 24 } }
    const before = Date.now()
    await detectAndProcessBashings('L1', 5, 'Z1')
    const deadline = (h.state.bashes[0]!.decisionDeadline as Date).getTime()
    expect(deadline - before).toBeGreaterThanOrEqual(24 * 3600 * 1000 - 1000)
    expect(deadline - before).toBeLessThan(25 * 3600 * 1000)
  })
})

const params = { params: { leagueId: 'L1' } }
const req = (method: string, body?: unknown) =>
  new Request('http://localhost/api/leagues/L1/specialty-settings', {
    method,
    headers: { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  }) as never

describe('specialty-settings handler — zombie', () => {
  it('GET shows the effective rules and the sport defaults', async () => {
    h.state.settings = { zombie_rules: { maulingThreshold: 60 } }
    const body = await (await GET(req('GET'), params)).json()
    expect(body.zombie.value).toMatchObject({ bashingThreshold: 30, maulingThreshold: 60, whispererAmbushCount: 3 })
    expect(body.zombie.sportDefaults.maulingThreshold).toBe(50)
    expect(body.zombie.overridden).toEqual(['maulingThreshold'])
  })

  it('PATCH stores overrides without touching other settings, writes the columns, and audits', async () => {
    h.state.settings = { someOtherKey: 'keep me' }
    const res = await PATCH(req('PATCH', { zombie: { bashingThreshold: 35, infectionLossToZombie: false, whispererAmbushCount: 2 } }), params)
    expect(res.status).toBe(200)
    expect(h.state.settings).toEqual({ someOtherKey: 'keep me', zombie_rules: { bashingThreshold: 35 } })
    expect(h.state.cfgUpserts).toEqual([{ infectionLossToZombie: false }])
    expect(h.state.zlUpdates).toEqual([{ whispererAmbushCount: 2 }])
    expect(h.state.audits).toEqual([expect.objectContaining({ action: 'RULES_CHANGED' })])
  })

  it('null puts an override back to the sport rule', async () => {
    h.state.settings = { zombie_rules: { bashingThreshold: 35, bombEnabled: false } }
    const res = await PATCH(req('PATCH', { zombie: { bashingThreshold: null } }), params)
    expect(res.status).toBe(200)
    expect(h.state.settings).toEqual({ zombie_rules: { bombEnabled: false } })
  })

  it('refuses a rule that breaks a pair, and a selection mode the engine cannot run', async () => {
    expect((await PATCH(req('PATCH', { zombie: { maulingThreshold: 20 } }), params)).status).toBe(400)
    expect((await PATCH(req('PATCH', { zombie: { whispererSelection: 'manual' } }), params)).status).toBe(400)
    expect(h.state.settings).toEqual({})
    expect(h.state.cfgUpserts).toEqual([])
  })
})
