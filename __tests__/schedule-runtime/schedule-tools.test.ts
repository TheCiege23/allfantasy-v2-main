/**
 * Commissioner Hub schedule tools (owner's page review #17, Phase C3):
 *   - custom weeks keep their pairings through every regeneration;
 *   - randomize N times: every draw posted to league chat, the last one saved;
 *   - setting a week by hand obeys the started-week rule and the one-match-per-team rule.
 *
 * The generator (`canonicalScheduleRuntime`), the regeneration rules and ./customWeeks run for real;
 * only prisma, the league rules loader and the side-effect sinks are mocked — the same harness as
 * schedule-regeneration.test.ts.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

type Row = {
  id: string; seasonId: string; leagueId: string; week: number; type: string
  homeRosterId: string; awayRosterId: string | null; homeScore: number; awayScore: number; status: string; isMedianMatchup: boolean
}

const h = vi.hoisted(() => ({
  season: null as null | Record<string, unknown>,
  rows: [] as Row[],
  settings: {} as Record<string, unknown>,
  rules: null as unknown,
  chat: vi.fn(async (_leagueId: string, _userId: string, _message: string, _opts: Record<string, unknown>) => ({ id: 'm' }) as unknown),
  logAction: vi.fn(async (_input: Record<string, unknown>) => ({ id: 'audit-1' })),
  nextId: 0,
}))

function seasonWithRows() {
  return h.season
    ? { ...h.season, schedule: [...h.rows].sort((a, b) => a.week - b.week || a.id.localeCompare(b.id)), league: { settings: h.settings } }
    : null
}

vi.mock('@/lib/prisma', () => {
  const matches = (r: Row, where: Record<string, unknown>) => {
    if (where.seasonId && r.seasonId !== where.seasonId) return false
    const w = where.week as number | { gte: number } | undefined
    if (typeof w === 'number' && r.week !== w) return false
    if (w && typeof w === 'object' && r.week < w.gte) return false
    if (where.type && r.type !== where.type) return false
    return true
  }
  const redraftMatchup = {
    deleteMany: async (args: { where: Record<string, unknown> }) => {
      h.rows = h.rows.filter((r) => !matches(r, args.where))
      return { count: 0 }
    },
    createMany: async (args: { data: Array<Omit<Row, 'id' | 'homeScore' | 'awayScore'>> }) => {
      for (const d of args.data) {
        h.nextId += 1
        h.rows.push({ id: `new-${String(h.nextId).padStart(4, '0')}`, homeScore: 0, awayScore: 0, ...d } as Row)
      }
      return { count: args.data.length }
    },
    findMany: async (args: { where: Record<string, unknown> }) => h.rows.filter((r) => matches(r, args.where)),
  }
  const league = {
    findUnique: async () => ({ lifecycleState: 'in_season', settings: h.settings }),
    update: async (args: { data: { settings: Record<string, unknown> } }) => {
      h.settings = args.data.settings
      return {}
    },
  }
  const tx = { redraftMatchup, league }
  return {
    prisma: {
      redraftSeason: { findUnique: vi.fn(async () => seasonWithRows()), findFirst: vi.fn(async () => seasonWithRows()) },
      redraftMatchup,
      leagueTeam: { findMany: vi.fn(async () => []) },
      league,
      draftSession: { findFirst: vi.fn(async () => null) },
      $transaction: vi.fn(async (cb: (t: typeof tx) => Promise<unknown>) => cb(tx)),
    },
  }
})
vi.mock('@/lib/league-runtime', () => ({ resolveCanonicalLeagueRules: vi.fn(async () => h.rules) }))
vi.mock('@/lib/redraft/fantraxNativePresentation', () => ({ loadFantraxNativePresentation: vi.fn(async () => null) }))
vi.mock('@/lib/roster-runtime/resolveNflRedraftRosterRuntime', () => ({ resolveNflRedraftRosterRuntime: vi.fn() }))
vi.mock('@/lib/redraft/standingsEngine', () => ({ updateStandings: vi.fn() }))
vi.mock('@/lib/playoff-runtime', () => ({ generateNflRedraftPlayoffRuntimeBracket: vi.fn() }))
vi.mock('@/server/services/auditService', () => ({ logAction: h.logAction }))
vi.mock('@/lib/league-events/publisher', () => ({ publishLeagueFanoutEvent: vi.fn(async () => undefined) }))
vi.mock('@/lib/league-chat/LeagueChatMessageService', () => ({ createLeagueChatMessage: h.chat }))

import { generateNflRedraftScheduleForSeason } from '@/lib/schedule-runtime/resolveNflRedraftScheduleRuntime'
import { keepWeekAsCustom, randomizeSchedule, setCustomWeek } from '@/lib/schedule-runtime/scheduleToolsService'
import { CUSTOM_WEEKS_SETTINGS_KEY, readCustomWeeks } from '@/lib/schedule-runtime/customWeeks'

const PRESEASON_NOW = new Date('2026-01-15T12:00:00Z')

function setup(teams: number, currentWeek = 1) {
  h.season = {
    id: 'S1', leagueId: 'L1', sport: 'NFL', season: 2026, status: 'active', totalWeeks: 17, playoffStartWeek: 15, currentWeek,
    rosters: Array.from({ length: teams }, (_, i) => ({ id: `r${i + 1}`, ownerId: `o${i + 1}`, ownerName: `Owner ${i + 1}`, teamName: `Team ${i + 1}` })),
  }
  h.rules = {
    version: 1, leagueId: 'L1', generatedAtIso: new Date(0).toISOString(),
    general: { sport: 'NFL', format: 'redraft', season: 2026, status: 'active' },
    playoffs: { startWeek: null, teamCount: null, standingsTiebreakers: [], weeksPerRound: null, championshipLength: null },
    schedule: { regularSeasonLength: null, playoffTransitionPoint: null },
  }
}

const weekPairs = (week: number) =>
  h.rows.filter((r) => r.week === week).map((r) => [r.homeRosterId, r.awayRosterId].join('-')).sort()

const CUSTOM5 = [['r1', 'r8'], ['r2', 'r7'], ['r3', 'r6'], ['r4', 'r5']]

beforeEach(() => {
  vi.clearAllMocks()
  h.rows = []
  h.settings = {}
  h.nextId = 0
})

describe('custom weeks survive a regeneration', () => {
  it('a custom week is written as set; every other week is drawn', async () => {
    setup(8)
    h.settings = { [CUSTOM_WEEKS_SETTINGS_KEY]: { '2026': { '5': CUSTOM5 } } }
    const out = await generateNflRedraftScheduleForSeason({ seasonId: 'S1', now: PRESEASON_NOW })
    expect(out.ok).toBe(true)
    if (!out.ok) return
    expect(out.customWeeksKept).toEqual([5])
    expect(weekPairs(5)).toEqual(['r1-r8', 'r2-r7', 'r3-r6', 'r4-r5'])
    // Control: without the custom week, week 5 is the generator's, which is different.
    h.rows = []
    h.settings = {}
    await generateNflRedraftScheduleForSeason({ seasonId: 'S1', now: PRESEASON_NOW })
    expect(weekPairs(5)).not.toEqual(['r1-r8', 'r2-r7', 'r3-r6', 'r4-r5'])
  })

  it('a custom week whose teams no longer match the league is skipped, not half-applied', async () => {
    setup(8)
    h.settings = { [CUSTOM_WEEKS_SETTINGS_KEY]: { '2026': { '5': [['r1', 'r8'], ['r2', 'r7'], ['r3', 'r6']] } } }
    const out = await generateNflRedraftScheduleForSeason({ seasonId: 'S1', now: PRESEASON_NOW })
    expect(out.ok && out.staleCustomWeeks).toEqual([5])
    expect(weekPairs(5)).toHaveLength(4)
  })

  it('team order changes the draw; the same order draws the same schedule', async () => {
    setup(8)
    await generateNflRedraftScheduleForSeason({ seasonId: 'S1', now: PRESEASON_NOW })
    const plain = weekPairs(1)
    h.rows = []
    const order = ['r5', 'r2', 'r8', 'r1', 'r7', 'r3', 'r6', 'r4']
    await generateNflRedraftScheduleForSeason({ seasonId: 'S1', now: PRESEASON_NOW, teamOrder: order })
    const shuffled = weekPairs(1)
    expect(shuffled).not.toEqual(plain)
    h.rows = []
    await generateNflRedraftScheduleForSeason({ seasonId: 'S1', now: PRESEASON_NOW, teamOrder: order })
    expect(weekPairs(1)).toEqual(shuffled)
  })
})

describe('randomize N times', () => {
  it('posts every draw to league chat in order, the last saying it is the schedule, and saves the last', async () => {
    setup(8)
    let seed = 7
    const random = () => ((seed = (seed * 9301 + 49297) % 233280) / 233280)
    const out = await randomizeSchedule({ seasonId: 'S1', times: 3, actorUserId: 'u1', random })
    expect(out.ok).toBe(true)
    if (!out.ok) return
    expect(out.posted).toBe(3)
    const messages = h.chat.mock.calls.map((c) => c[2])
    expect(messages[0]).toMatch(/^🎲 Schedule randomization 1 of 3\nWeek 1:/)
    expect(messages[2]).toMatch(/^🎲 Schedule randomization 3 of 3: this is the schedule\./)
    // The saved week 1 is the last draw's week 1.
    const lastDraw = messages[2]!.split('\n').slice(2).map((l) => l.replace(/Team (\d+)/g, 'r$1').split(' vs ').join('-')).sort()
    expect(weekPairs(1)).toEqual(lastDraw)
    for (const c of h.chat.mock.calls) {
      expect(c[3]).toMatchObject({ messageSubtype: 'commissioner_change', metadata: { category: 'Schedule', isSystemMessage: true } })
    }
    expect(h.logAction).toHaveBeenCalledWith(expect.objectContaining({ actionType: 'schedule_randomized' }))
  })

  it('refuses 0 or 26 times, and posts nothing when the schedule is not saved', async () => {
    setup(8)
    expect(await randomizeSchedule({ seasonId: 'S1', times: 0, actorUserId: 'u1' })).toMatchObject({ ok: false, status: 400 })
    expect(await randomizeSchedule({ seasonId: 'S1', times: 26, actorUserId: 'u1' })).toMatchObject({ ok: false, status: 400 })
    // Mid-season without confirmation: refused by the regeneration rules, so no chat post.
    setup(8, 4)
    await generateNflRedraftScheduleForSeason({ seasonId: 'S1', now: PRESEASON_NOW })
    for (const r of h.rows) if (r.week < 4) Object.assign(r, { status: 'final', homeScore: 100, awayScore: 90 })
    h.chat.mockClear()
    const out = await randomizeSchedule({ seasonId: 'S1', times: 2, actorUserId: 'u1' })
    expect(out).toMatchObject({ ok: false, status: 409 })
    expect(h.chat).not.toHaveBeenCalled()
  })
})

describe('setting a week by hand', () => {
  it('writes the pairs and keeps the week custom; a later regeneration leaves it', async () => {
    setup(8)
    await generateNflRedraftScheduleForSeason({ seasonId: 'S1', now: PRESEASON_NOW })
    const pairs = CUSTOM5.map(([home, away]) => ({ home: home!, away: away! }))
    expect(await setCustomWeek({ seasonId: 'S1', week: 6, pairs, actorUserId: 'u1', now: PRESEASON_NOW })).toEqual({ ok: true, week: 6, cleared: false })
    expect(weekPairs(6)).toEqual(['r1-r8', 'r2-r7', 'r3-r6', 'r4-r5'])
    expect(Object.keys(readCustomWeeks(h.settings, 2026))).toEqual(['6'])
    await generateNflRedraftScheduleForSeason({ seasonId: 'S1', regenerate: true, now: PRESEASON_NOW })
    expect(weekPairs(6)).toEqual(['r1-r8', 'r2-r7', 'r3-r6', 'r4-r5'])
    // Cleared: the next rebuild draws it again.
    expect(await setCustomWeek({ seasonId: 'S1', week: 6, pairs: null, actorUserId: 'u1', now: PRESEASON_NOW })).toEqual({ ok: true, week: 6, cleared: true })
    expect(readCustomWeeks(h.settings, 2026)).toEqual({})
  })

  it('refuses a team twice, a started week, and a playoff week', async () => {
    setup(8, 3)
    await generateNflRedraftScheduleForSeason({ seasonId: 'S1', now: PRESEASON_NOW })
    const twice = [{ home: 'r1', away: 'r2' }, { home: 'r1', away: 'r3' }, { home: 'r4', away: 'r5' }, { home: 'r6', away: 'r7' }]
    expect(await setCustomWeek({ seasonId: 'S1', week: 6, pairs: twice, actorUserId: 'u1', now: PRESEASON_NOW })).toMatchObject({ ok: false, code: 'TEAM_TWICE' })
    const ok = CUSTOM5.map(([home, away]) => ({ home: home!, away: away! }))
    expect(await setCustomWeek({ seasonId: 'S1', week: 2, pairs: ok, actorUserId: 'u1', now: PRESEASON_NOW })).toMatchObject({ ok: false, code: 'WEEK_STARTED' })
    expect(await setCustomWeek({ seasonId: 'S1', week: 15, pairs: ok, actorUserId: 'u1', now: PRESEASON_NOW })).toMatchObject({ ok: false, code: 'NOT_REGULAR_SEASON' })
  })

  it('keeps an applied week (Rivalry Week) custom; a swap updates only a week that is already custom', async () => {
    setup(8)
    await generateNflRedraftScheduleForSeason({ seasonId: 'S1', now: PRESEASON_NOW })
    expect(await keepWeekAsCustom({ seasonId: 'S1', week: 7, onlyIfCustom: true })).toBe(false)
    expect(readCustomWeeks(h.settings, 2026)).toEqual({})
    expect(await keepWeekAsCustom({ seasonId: 'S1', week: 7 })).toBe(true)
    expect(Object.keys(readCustomWeeks(h.settings, 2026))).toEqual(['7'])
  })
})
