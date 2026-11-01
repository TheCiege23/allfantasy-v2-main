/**
 * Commissioner schedule regeneration for every weekly league — NFL redraft, dynasty (a year-2+
 * season included) and NBA/NHL/MLB.
 *
 * Before: `generateNflRedraftScheduleForSeason` refused anything that was not NFL redraft
 * (`NOT_NFL_REDRAFT`), refused a regeneration outright once any week was protected, and with
 * `commissionerOverride` deleted EVERY matchup of the season — final weeks included.
 *
 * Rules pinned here:
 *   - only weeks after the last started week are rewritten; started weeks are byte-for-byte kept;
 *   - regular-season weeks only (never at or past `playoffStartWeek`), whatever the final's length;
 *   - odd team counts get exactly one bye a week; divisions are prioritised;
 *   - refused while a draft is live (lifecycle `drafting` or a live draft session) and when archived;
 *   - once a week has started, `confirmMidSeasonChange` is required;
 *   - a regeneration writes a `schedule_regenerated` audit row and a league announcement.
 *
 * The generator (`canonicalScheduleRuntime`) and the regeneration rules run for real; only prisma,
 * the league rules loader and the side-effect sinks are mocked.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

type Row = {
  id: string
  seasonId: string
  leagueId: string
  week: number
  type: string
  homeRosterId: string
  awayRosterId: string | null
  homeScore: number
  awayScore: number
  status: string
  isMedianMatchup: boolean
}

const h = vi.hoisted(() => ({
  season: null as null | Record<string, unknown>,
  rows: [] as Row[],
  leagueTeams: [] as Array<Record<string, unknown>>,
  lifecycleState: 'in_season' as string | null,
  liveDraft: null as null | { id: string },
  rules: null as unknown,
  logAction: vi.fn(async (_input: Record<string, unknown>) => ({ id: 'audit-1' })),
  publish: vi.fn(async (_input: Record<string, unknown>) => undefined),
  deleteMany: vi.fn(),
  createMany: vi.fn(),
  nextId: 0,
}))

function seasonWithRows() {
  return h.season ? { ...h.season, schedule: [...h.rows].sort((a, b) => a.week - b.week || a.id.localeCompare(b.id)) } : null
}

vi.mock('@/lib/prisma', () => {
  const tx = {
    redraftMatchup: {
      deleteMany: async (args: { where: { seasonId: string; week?: { gte: number } } }) => {
        h.deleteMany(args)
        const gte = args.where.week?.gte ?? -Infinity
        h.rows = h.rows.filter((r) => !(r.seasonId === args.where.seasonId && r.week >= gte))
        return { count: 0 }
      },
      createMany: async (args: { data: Array<Omit<Row, 'id' | 'homeScore' | 'awayScore'>> }) => {
        h.createMany(args)
        for (const d of args.data) {
          h.nextId += 1
          h.rows.push({ id: `new-${String(h.nextId).padStart(4, '0')}`, homeScore: 0, awayScore: 0, ...d } as Row)
        }
        return { count: args.data.length }
      },
    },
  }
  return {
    prisma: {
      redraftSeason: {
        findUnique: vi.fn(async () => seasonWithRows()),
        findFirst: vi.fn(async () => seasonWithRows()),
      },
      leagueTeam: { findMany: vi.fn(async () => h.leagueTeams) },
      league: { findUnique: vi.fn(async () => ({ lifecycleState: h.lifecycleState })) },
      draftSession: { findFirst: vi.fn(async () => h.liveDraft) },
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
vi.mock('@/lib/league-events/publisher', () => ({ publishLeagueFanoutEvent: h.publish }))

import { generateNflRedraftScheduleForSeason } from '@/lib/schedule-runtime/resolveNflRedraftScheduleRuntime'
import {
  firstRegenerableWeek,
  scheduleRegenerationLifecycleRefusal,
  weekHasStarted,
} from '@/lib/schedule-runtime/scheduleRegeneration'

const PRESEASON_NOW = new Date('2026-01-15T12:00:00Z') // before every curated opener used below

function rulesFor(sport: string, format: string, playoffs: Record<string, unknown> = {}) {
  return {
    version: 1,
    leagueId: 'L1',
    generatedAtIso: new Date(0).toISOString(),
    general: { sport, format, season: 2026, status: 'active' },
    playoffs: { startWeek: null, teamCount: null, standingsTiebreakers: [], weeksPerRound: null, championshipLength: null, ...playoffs },
    schedule: { regularSeasonLength: null, playoffTransitionPoint: null },
  }
}

function rosters(n: number) {
  return Array.from({ length: n }, (_, i) => ({ id: `r${i + 1}`, ownerId: `o${i + 1}`, ownerName: `Owner ${i + 1}`, teamName: `Team ${i + 1}` }))
}

function setup(opts: {
  sport: string
  format: string
  teams: number
  seasonYear?: number
  totalWeeks?: number
  playoffStartWeek?: number
  currentWeek?: number
  status?: string
  playoffs?: Record<string, unknown>
}) {
  h.season = {
    id: 'S1',
    leagueId: 'L1',
    sport: opts.sport,
    season: opts.seasonYear ?? 2026,
    status: opts.status ?? 'active',
    totalWeeks: opts.totalWeeks ?? 17,
    playoffStartWeek: opts.playoffStartWeek ?? 15,
    currentWeek: opts.currentWeek ?? 1,
    rosters: rosters(opts.teams),
  }
  h.rules = rulesFor(opts.sport, opts.format, opts.playoffs)
}

/** Seed a persisted schedule with a DIFFERENT pairing (r1 always home vs the next team) so a rewrite is visible. */
function seedSchedule(weeks: number, teams: number) {
  h.rows = []
  for (let week = 1; week <= weeks; week += 1) {
    for (let i = 0; i < teams; i += 2) {
      h.nextId += 1
      h.rows.push({
        id: `old-${String(h.nextId).padStart(4, '0')}`,
        seasonId: 'S1',
        leagueId: 'L1',
        week,
        type: 'regular',
        homeRosterId: `r${i + 1}`,
        awayRosterId: i + 2 <= teams ? `r${i + 2}` : null,
        homeScore: 0,
        awayScore: 0,
        status: 'scheduled',
        isMedianMatchup: false,
      })
    }
  }
}

function markWeek(week: number, status: string, score = 100) {
  for (const r of h.rows) if (r.week === week) Object.assign(r, { status, homeScore: score, awayScore: score - 10 })
}

const weeksOf = (rows: Row[]) => Array.from(new Set(rows.map((r) => r.week))).sort((a, b) => a - b)

beforeEach(() => {
  vi.clearAllMocks()
  h.rows = []
  h.leagueTeams = []
  h.lifecycleState = 'in_season'
  h.liveDraft = null
  h.nextId = 0
})

describe('which weeks have started (pure)', () => {
  const base = { currentWeek: 1, sport: 'NFL', seasonYear: 2026, now: PRESEASON_NOW, persisted: [] as Array<{ week: number; status?: string; homeScore?: number; awayScore?: number }> }

  it('the current week right after the draft has NOT started — status active, week 1, nothing scored', () => {
    expect(weekHasStarted(1, { ...base, persisted: [{ week: 1, status: 'scheduled', homeScore: 0, awayScore: 0 }] })).toBe(false)
  })

  it('a week before currentWeek, a week with a non-scheduled matchup, and a week with a score have started', () => {
    expect(weekHasStarted(3, { ...base, currentWeek: 4 })).toBe(true)
    expect(weekHasStarted(4, { ...base, currentWeek: 4, persisted: [{ week: 4, status: 'active' }] })).toBe(true)
    expect(weekHasStarted(4, { ...base, currentWeek: 4, persisted: [{ week: 4, status: 'scheduled', homeScore: 3.5 }] })).toBe(true)
  })

  it('a daily sport week has started once its calendar window opens, even if the roller has not moved', () => {
    // NHL 2026 opens 2026-09-29; Oct 15 is inside week 3.
    const now = new Date('2026-10-15T12:00:00Z')
    expect(weekHasStarted(3, { ...base, sport: 'NHL', now })).toBe(true)
    expect(weekHasStarted(4, { ...base, sport: 'NHL', now })).toBe(false)
    // NFL has no daily windows: the calendar alone never marks a week started.
    expect(weekHasStarted(3, { ...base, sport: 'NFL', now })).toBe(false)
  })

  it('first regenerable week is one past the LAST started week, even when an earlier week is not started', () => {
    const persisted = [
      { week: 2, status: 'final' },
      { week: 5, status: 'locked' },
    ]
    expect(firstRegenerableWeek({ ...base, persisted, regularSeasonWeeks: 14 })).toBe(6)
  })

  it('lifecycle refusals: drafting, a live draft session, archived — and nothing else', () => {
    expect(scheduleRegenerationLifecycleRefusal({ lifecycleState: 'drafting', liveDraft: false })?.code).toBe('DRAFT_IN_PROGRESS')
    expect(scheduleRegenerationLifecycleRefusal({ lifecycleState: 'offseason', liveDraft: true })?.code).toBe('DRAFT_IN_PROGRESS')
    expect(scheduleRegenerationLifecycleRefusal({ lifecycleState: 'archived', liveDraft: false })?.code).toBe('LEAGUE_ARCHIVED')
    for (const state of ['setup', 'pre_draft', 'post_draft', 'in_season', 'playoffs', 'completed', 'offseason', 'renewal_pending', null]) {
      expect(scheduleRegenerationLifecycleRefusal({ lifecycleState: state, liveDraft: false })).toBeNull()
    }
  })
})

describe('regenerating before the season starts — every sport and league type', () => {
  it.each([
    ['NFL', 'redraft', 2026, 'in_season'],
    ['NFL', 'dynasty', 2027, 'offseason'], // a year-2 season opened by startDynastyNewSeason
    ['NBA', 'redraft', 2026, 'post_draft'],
    ['NBA', 'dynasty', 2026, 'post_draft'],
    ['NHL', 'dynasty', 2027, 'offseason'],
    ['MLB', 'keeper', 2027, 'post_draft'],
    ['MLB', 'dynasty', 2027, 'offseason'],
  ])('%s %s (season %s, lifecycle %s) rewrites every regular-season week', async (sport, format, year, lifecycle) => {
    setup({ sport, format, teams: 8, seasonYear: year, currentWeek: year === 2027 ? 0 : 1, status: year === 2027 ? 'setup' : 'active' })
    h.lifecycleState = lifecycle
    seedSchedule(14, 8)

    const result = await generateNflRedraftScheduleForSeason({ seasonId: 'S1', regenerate: true, actorUserId: 'u1', now: PRESEASON_NOW })

    expect(result).toMatchObject({ ok: true, regenerated: true, regeneratedFromWeek: 1 })
    expect(h.deleteMany).toHaveBeenCalledWith({ where: { seasonId: 'S1', week: { gte: 1 } } })
    expect(h.rows.every((r) => r.id.startsWith('new-'))).toBe(true)
    expect(weeksOf(h.rows)).toEqual(Array.from({ length: 14 }, (_, i) => i + 1))
    // A real round robin, not the seeded "r1 v r2 every week".
    expect(h.rows.filter((r) => r.homeRosterId === 'r1' && r.awayRosterId === 'r2' || r.homeRosterId === 'r2' && r.awayRosterId === 'r1').length).toBeLessThan(14)
    // No confirmation needed: nothing had started.
    expect(h.logAction).toHaveBeenCalledWith(expect.objectContaining({ actionType: 'schedule_regenerated', metadata: expect.objectContaining({ midSeason: false, fromWeek: 1 }) }))
  })

  it('still refuses a format with its own engine (guillotine)', async () => {
    setup({ sport: 'NBA', format: 'guillotine', teams: 8 })
    seedSchedule(14, 8)
    const result = await generateNflRedraftScheduleForSeason({ seasonId: 'S1', regenerate: true, now: PRESEASON_NOW })
    expect(result).toMatchObject({ ok: false, code: 'NOT_NFL_REDRAFT' })
    expect(h.deleteMany).not.toHaveBeenCalled()
  })
})

describe('mid-season: only weeks that have not started are rewritten', () => {
  function midSeason(sport = 'NFL', format = 'dynasty') {
    setup({ sport, format, teams: 8, currentWeek: 5, status: 'active' })
    seedSchedule(14, 8)
    for (const w of [1, 2, 3, 4]) markWeek(w, 'final')
    markWeek(5, 'active', 40) // week in progress
  }

  it('without confirmation it is refused with the mid-season code and nothing is written', async () => {
    midSeason()
    const result = await generateNflRedraftScheduleForSeason({ seasonId: 'S1', regenerate: true, now: PRESEASON_NOW })
    expect(result).toMatchObject({ ok: false, code: 'mid_season_confirmation_required' })
    expect(h.deleteMany).not.toHaveBeenCalled()
    expect(h.createMany).not.toHaveBeenCalled()
  })

  it.each([['NFL', 'dynasty'], ['NFL', 'redraft'], ['NBA', 'redraft'], ['MLB', 'dynasty']])(
    '%s %s with confirmation keeps weeks 1-5 exactly and rebuilds 6-14',
    async (sport, format) => {
      midSeason(sport, format)
      const before = h.rows.filter((r) => r.week <= 5).map((r) => ({ ...r }))
      const result = await generateNflRedraftScheduleForSeason({
        seasonId: 'S1',
        regenerate: true,
        confirmMidSeasonChange: true,
        actorUserId: 'u1',
        now: PRESEASON_NOW,
      })
      expect(result).toMatchObject({ ok: true, regeneratedFromWeek: 6 })
      expect(h.deleteMany).toHaveBeenCalledWith({ where: { seasonId: 'S1', week: { gte: 6 } } })
      expect(h.rows.filter((r) => r.week <= 5)).toEqual(before)
      const written = h.rows.filter((r) => r.week >= 6)
      expect(written.every((r) => r.id.startsWith('new-') && r.status === 'scheduled')).toBe(true)
      expect(weeksOf(written)).toEqual([6, 7, 8, 9, 10, 11, 12, 13, 14])
    },
  )

  it('the legacy commissionerOverride confirms but no longer unlocks a started week', async () => {
    midSeason()
    const result = await generateNflRedraftScheduleForSeason({ seasonId: 'S1', regenerate: true, commissionerOverride: true, now: PRESEASON_NOW })
    expect(result).toMatchObject({ ok: true, regeneratedFromWeek: 6 })
    expect(h.rows.filter((r) => r.week <= 5).every((r) => r.id.startsWith('old-'))).toBe(true)
  })

  it('an unchanged league regenerates to the same pairings it already had for the remaining weeks', async () => {
    setup({ sport: 'NFL', format: 'dynasty', teams: 8, currentWeek: 1 })
    await generateNflRedraftScheduleForSeason({ seasonId: 'S1', now: PRESEASON_NOW })
    const original = h.rows.map(({ week, homeRosterId, awayRosterId }) => ({ week, homeRosterId, awayRosterId }))
    for (const w of [1, 2, 3]) markWeek(w, 'final')
    await generateNflRedraftScheduleForSeason({ seasonId: 'S1', regenerate: true, confirmMidSeasonChange: true, now: PRESEASON_NOW })
    const after = h.rows.map(({ week, homeRosterId, awayRosterId }) => ({ week, homeRosterId, awayRosterId }))
    const key = (x: { week: number; homeRosterId: string; awayRosterId: string | null }) => `${x.week}:${x.homeRosterId}:${x.awayRosterId}`
    expect(after.map(key).sort()).toEqual(original.map(key).sort())
  })

  it('a daily sport whose roller lags the calendar still protects the weeks already played (NHL)', async () => {
    setup({ sport: 'NHL', format: 'dynasty', teams: 8, currentWeek: 1, status: 'active' })
    seedSchedule(14, 8)
    const result = await generateNflRedraftScheduleForSeason({
      seasonId: 'S1',
      regenerate: true,
      confirmMidSeasonChange: true,
      now: new Date('2026-10-15T12:00:00Z'),
    })
    expect(result).toMatchObject({ ok: true, regeneratedFromWeek: 4 })
    expect(h.rows.filter((r) => r.week <= 3).every((r) => r.id.startsWith('old-'))).toBe(true)
  })

  it('refuses when every regular-season week has started', async () => {
    setup({ sport: 'NFL', format: 'dynasty', teams: 8, currentWeek: 14, playoffStartWeek: 15 })
    seedSchedule(14, 8)
    markWeek(14, 'active')
    const result = await generateNflRedraftScheduleForSeason({ seasonId: 'S1', regenerate: true, confirmMidSeasonChange: true, now: PRESEASON_NOW })
    expect(result).toMatchObject({ ok: false, code: 'NO_REGENERABLE_WEEKS' })
    expect(h.deleteMany).not.toHaveBeenCalled()
  })
})

describe('team count, divisions, playoff start and championship length', () => {
  it.each([5, 7, 9])('%s teams: every week covers each team exactly once, with exactly one bye', async (n) => {
    setup({ sport: 'NBA', format: 'dynasty', teams: n })
    seedSchedule(14, n)
    const result = await generateNflRedraftScheduleForSeason({ seasonId: 'S1', regenerate: true, now: PRESEASON_NOW })
    expect(result.ok).toBe(true)
    for (const week of weeksOf(h.rows)) {
      const rows = h.rows.filter((r) => r.week === week)
      const ids = rows.flatMap((r) => [r.homeRosterId, r.awayRosterId].filter(Boolean))
      expect(new Set(ids).size).toBe(n)
      expect(ids.length).toBe(n)
      expect(rows.filter((r) => r.awayRosterId === null)).toHaveLength(1)
    }
  })

  it('never writes into the playoff weeks, whatever the championship length — and warns when the final overruns the season', async () => {
    setup({
      sport: 'NHL',
      format: 'dynasty',
      teams: 8,
      totalWeeks: 17,
      playoffStartWeek: 15,
      playoffs: { teamCount: 6, weeksPerRound: 1, championshipLength: 2 },
    })
    seedSchedule(16, 8) // stale rows in weeks 15-16 from an earlier, later playoff start
    const result = await generateNflRedraftScheduleForSeason({ seasonId: 'S1', regenerate: true, now: PRESEASON_NOW })
    expect(result.ok).toBe(true)
    expect(Math.max(...h.rows.map((r) => r.week))).toBe(14)
    // 3 rounds from week 15, the final lasting 2 weeks → ends week 18, past totalWeeks 17.
    expect(result.ok && result.warnings[0]).toMatch(/week 18/)
  })

  it('no warning when the final fits', async () => {
    setup({ sport: 'NFL', format: 'dynasty', teams: 8, totalWeeks: 17, playoffStartWeek: 15, playoffs: { teamCount: 6, championshipLength: 1 } })
    seedSchedule(14, 8)
    const result = await generateNflRedraftScheduleForSeason({ seasonId: 'S1', regenerate: true, now: PRESEASON_NOW })
    expect(result.ok && result.warnings).toEqual([])
  })

  it('divisions: the opening weeks are division games', async () => {
    setup({ sport: 'MLB', format: 'dynasty', teams: 4 })
    h.leagueTeams = [
      { id: 't1', externalId: 'o1', ownerName: 'Owner 1', teamName: 'Team 1', claimedByUserId: null, platformUserId: null, divisionId: 'A', division: { id: 'A', name: 'East', tierLevel: 1 } },
      { id: 't2', externalId: 'o2', ownerName: 'Owner 2', teamName: 'Team 2', claimedByUserId: null, platformUserId: null, divisionId: 'B', division: { id: 'B', name: 'West', tierLevel: 1 } },
      { id: 't3', externalId: 'o3', ownerName: 'Owner 3', teamName: 'Team 3', claimedByUserId: null, platformUserId: null, divisionId: 'A', division: { id: 'A', name: 'East', tierLevel: 1 } },
      { id: 't4', externalId: 'o4', ownerName: 'Owner 4', teamName: 'Team 4', claimedByUserId: null, platformUserId: null, divisionId: 'B', division: { id: 'B', name: 'West', tierLevel: 1 } },
    ]
    seedSchedule(14, 4)
    await generateNflRedraftScheduleForSeason({ seasonId: 'S1', regenerate: true, now: PRESEASON_NOW })
    const division: Record<string, string> = { r1: 'A', r2: 'B', r3: 'A', r4: 'B' }
    const week1 = h.rows.filter((r) => r.week === 1)
    expect(week1.every((r) => division[r.homeRosterId] === division[r.awayRosterId!])).toBe(true)
  })
})

describe('refusals', () => {
  it.each([
    ['drafting', null, 'DRAFT_IN_PROGRESS'],
    ['offseason', { id: 'rookie-draft' }, 'DRAFT_IN_PROGRESS'], // a dynasty rookie draft is live
    ['archived', null, 'LEAGUE_ARCHIVED'],
  ])('lifecycle %s (live session: %s) → %s, nothing deleted', async (state, live, code) => {
    setup({ sport: 'NFL', format: 'dynasty', teams: 8, seasonYear: 2027, currentWeek: 0, status: 'setup' })
    seedSchedule(14, 8)
    h.lifecycleState = state
    h.liveDraft = live
    const result = await generateNflRedraftScheduleForSeason({ seasonId: 'S1', regenerate: true, confirmMidSeasonChange: true, now: PRESEASON_NOW })
    expect(result).toMatchObject({ ok: false, code })
    expect(h.deleteMany).not.toHaveBeenCalled()
    expect(h.createMany).not.toHaveBeenCalled()
    expect(h.logAction).not.toHaveBeenCalled()
  })

  it('first-time generation is unchanged: no lifecycle check, no audit, no announcement', async () => {
    setup({ sport: 'NFL', format: 'redraft', teams: 8 })
    h.lifecycleState = 'drafting'
    const result = await generateNflRedraftScheduleForSeason({ seasonId: 'S1', now: PRESEASON_NOW })
    expect(result).toMatchObject({ ok: true, regenerated: false, regeneratedFromWeek: 1 })
    expect(h.logAction).not.toHaveBeenCalled()
    expect(h.publish).not.toHaveBeenCalled()
  })
})

describe('audit and announcement', () => {
  it('a confirmed mid-season regeneration writes the audit row and announces it to all members', async () => {
    setup({ sport: 'NBA', format: 'redraft', teams: 6, currentWeek: 3 })
    seedSchedule(14, 6)
    markWeek(1, 'final')
    markWeek(2, 'final')
    await generateNflRedraftScheduleForSeason({ seasonId: 'S1', regenerate: true, confirmMidSeasonChange: true, actorUserId: 'u1', now: PRESEASON_NOW })
    expect(h.logAction).toHaveBeenCalledWith({
      leagueId: 'L1',
      userId: 'u1',
      actionType: 'schedule_regenerated',
      entityType: 'redraft_season',
      entityId: 'S1',
      metadata: expect.objectContaining({ seasonId: 'S1', fromWeek: 3, throughWeek: 14, midSeason: true, confirmed: true }),
    })
    expect(h.publish).toHaveBeenCalledWith(
      expect.objectContaining({
        leagueId: 'L1',
        eventType: 'settings_changed',
        title: 'Schedule regenerated',
        visibility: 'all_members',
        category: 'league_announcements',
        actorUserId: 'u1',
      }),
    )
    expect(h.publish.mock.calls[0]![0]).toMatchObject({ message: expect.stringContaining('week 3') })
  })
})
