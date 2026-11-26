// @vitest-environment node
import { readFileSync } from 'node:fs'
import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * The commissioner safety fixes (2026-11-15):
 *   1. the old zombie rules route let ANY member rewrite the rules — its write is gone;
 *   2. a bracket pool's scoring could change after the tournament locked — refused now, like the manage route;
 *   3. every specialty format's own rules route honours the new "Format rules" settings lock and writes the league
 *      log, so a locked rule changes mid-season only by a vote, and no change is invisible.
 */

const m = vi.hoisted(() => ({
  session: { userId: 'u-comm' as string | null },
  league: { settings: {} as Record<string, unknown> },
  updates: [] as unknown[],
  audits: [] as Array<Record<string, unknown>>,
  locked: [] as string[],
  bracket: { lockAt: null as Date | null },
}))

vi.mock('server-only', () => ({}))
vi.mock('@/lib/auth', () => ({ authOptions: {} }))
vi.mock('next-auth', () => ({ getServerSession: async () => (m.session.userId ? { user: { id: m.session.userId } } : null) }))
vi.mock('@/lib/league/league-access', () => ({
  assertLeagueCommissioner: async () => ({ ok: true, league: { id: 'lg-1', settings: m.league.settings, leagueVariant: 'pirate' } }),
}))
vi.mock('@/lib/league-access', () => ({ resolveLeagueMembership: async () => null }))
vi.mock('@/lib/pirate/service', () => ({ getPirateDashboard: vi.fn(), seedPirateClaims: vi.fn() }))
vi.mock('@/lib/pirate/rules', () => ({
  isPirateLeague: () => true,
  readPirateRules: () => ({ protectionLimit: 3, claimHours: 24, selectionHours: 24, overflowGraceHours: 12, playoffClaims: false }),
}))
vi.mock('@/lib/league/settingsLockService', () => ({
  lockedGroups: async (_leagueId: string, groups: string[]) => groups.filter((g) => m.locked.includes(g)),
  lockedGroupsForPatch: async () => [],
}))
vi.mock('@/lib/prisma', () => ({
  prisma: {
    league: {
      update: vi.fn(async (args: unknown) => { m.updates.push(args); return {} }),
      findUnique: vi.fn(async () => null),
    },
    leagueAuditLog: { create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => { m.audits.push(data); return data }) },
    bracketLeague: {
      findUnique: vi.fn(async () => ({ ownerId: 'u-comm', scoringRules: { roundPoints: [1, 2, 4] }, tournament: { lockAt: m.bracket.lockAt } })),
      update: vi.fn(async (args: unknown) => { m.updates.push(args); return {} }),
    },
  },
}))

import { LOCK_GROUPS, groupForSettingsKey, lockedMessage } from '@/lib/league/settingsLock'
import { LOCK_AREA_COPY } from '@/lib/i18n/settings-lock-copy'
import { describeLogEntry } from '@/lib/league-log/leagueLog'

beforeEach(() => {
  m.updates.length = 0
  m.audits.length = 0
  m.locked = []
  m.bracket.lockAt = null
  m.session.userId = 'u-comm'
})

const ctx = (leagueId = 'lg-1') => ({ params: Promise.resolve({ leagueId }) })
const patch = (url: string, body: unknown) =>
  new Request(url, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }) as never

describe('🛑 the old zombie rules route', () => {
  it('can be read by members but written by nobody (commissioners use /api/zombie/settings)', async () => {
    const mod = (await import('@/app/api/leagues/[leagueId]/zombie/config/route')) as Record<string, unknown>
    expect(typeof mod.GET).toBe('function')
    expect(mod.PUT).toBeUndefined()
    expect(mod.PATCH).toBeUndefined()
    expect(mod.POST).toBeUndefined()
  })
})

describe('🛑 a bracket pool after the tournament locks', () => {
  it('refuses a scoring change once locked, and still allows one before', async () => {
    const { PATCH } = await import('@/app/api/bracket/leagues/[leagueId]/settings/route')
    m.bracket.lockAt = new Date(Date.now() - 60_000)
    const locked = await PATCH(patch('https://allfantasy.ai/api/bracket/leagues/b-1/settings', { roundPoints: [10, 20, 40] }), ctx('b-1'))
    expect(locked.status).toBe(409)
    expect(m.updates).toEqual([])
    m.bracket.lockAt = new Date(Date.now() + 60 * 60_000)
    const open = await PATCH(patch('https://allfantasy.ai/api/bracket/leagues/b-1/settings', { roundPoints: [10, 20, 40] }), ctx('b-1'))
    expect(open.status).toBe(200)
    expect(m.updates).toHaveLength(1)
  })
})

describe('"Format rules" in the settings lock', () => {
  it('is a lock area, worded in both languages, and the generic save maps format rules to it', () => {
    expect(LOCK_GROUPS).toContain('format')
    expect(LOCK_AREA_COPY.format.en.label).toBe('Format rules')
    expect(LOCK_AREA_COPY.format.es.label).toBe('Reglas del formato')
    expect(groupForSettingsKey('conceptRules')).toBe('format')
    // Nothing that mapped before moved.
    expect(groupForSettingsKey('waiverType')).toBe('waivers')
    expect(groupForSettingsKey('rosterPositions')).toBe('rosters')
    expect(lockedMessage(['format'])).toBe('Format rules settings are locked for the season. A league vote can unlock them.')
  })
})

describe('a pirate rules change', () => {
  it('🛑 is refused while Format rules are locked, and nothing is written', async () => {
    m.locked = ['format']
    const { PATCH } = await import('@/app/api/leagues/[leagueId]/pirate/route')
    const res = await PATCH(patch('https://allfantasy.ai/api/leagues/lg-1/pirate', { protectionLimit: 5 }), ctx())
    expect(res.status).toBe(423)
    expect(((await res.json()) as { code: string }).code).toBe('settings_locked')
    expect(m.updates).toEqual([])
    expect(m.audits).toEqual([])
  })

  it('when open, it saves and the league log says the format settings changed', async () => {
    const { PATCH } = await import('@/app/api/leagues/[leagueId]/pirate/route')
    const res = await PATCH(patch('https://allfantasy.ai/api/leagues/lg-1/pirate', { protectionLimit: 5 }), ctx())
    expect(res.status).toBe(200)
    expect(m.updates).toHaveLength(1)
    expect(m.audits).toEqual([
      expect.objectContaining({ leagueId: 'lg-1', userId: 'u-comm', actionType: 'settings_patch', metadata: { section: 'conceptRules', format: 'pirate', fields: ['protectionLimit'] } }),
    ])
    const line = describeLogEntry(
      { id: 'a1', actionType: 'settings_patch', entityId: 'lg-1', userId: 'u-comm', beforeState: null, afterState: null, metadata: m.audits[0]!.metadata, createdAt: new Date() },
      // As a MEMBER sees it, not only the commissioner: a mid-season rule change is the league's news.
      { lang: 'en', names: { users: {}, teams: {} }, forCommissioner: false },
    )
    expect(JSON.stringify(line)).toContain('Changed the format settings')
  })
})

describe('every specialty format rules route checks the lock and writes the log', () => {
  const calls = (path: string, fn: string) =>
    readFileSync(path, 'utf8').split('\n').filter((l) => l.includes(`${fn}(`) && !/^\s*(\*|\/\/|import)/.test(l))
  it.each([
    // First chop week, league rules, chop schedule, and scheduled roster changes (`{ rosterSchedule }`).
    ['app/api/leagues/[leagueId]/guillotine/summary/route.ts', 4],
    ['app/api/leagues/[leagueId]/pirate/route.ts', 1],
    ['app/api/leagues/[leagueId]/big-brother/config/route.ts', 1],
    // Its `update_config` action is the second Big Brother rules write path.
    ['app/api/leagues/[leagueId]/big-brother/admin/route.ts', 1],
    ['app/api/leagues/[leagueId]/devy/config/route.ts', 1],
    ['app/api/leagues/[leagueId]/merged-devy-c2c/config/route.ts', 1],
    ['app/api/leagues/[leagueId]/idp/config/route.ts', 1],
    ['app/api/commissioner/leagues/[leagueId]/idp/cap-config/route.ts', 1],
    ['app/api/devy/route.ts', 1],
    ['app/api/c2c/settings/route.ts', 1],
    // Survivor: every route that rewrites the league's Survivor rules (the foundation route logs its two saves).
    ['app/api/survivor/season/route.ts', 1],
    ['server/api-route-modules/league-survivor/settings-screen/route.ts', 1],
    ['server/api-route-modules/league-survivor/config/route.ts', 1],
    ['server/api-route-modules/league-survivor/foundation/route.ts', 2],
    ['app/api/survivor/commissioner/route.ts', 1],
  ])('%s', (path, logs) => {
    expect(calls(path, 'formatRulesLockedResponse')).toHaveLength(1)
    expect(calls(path, 'logFormatRulesChange').length).toBe(logs)
  })
})
