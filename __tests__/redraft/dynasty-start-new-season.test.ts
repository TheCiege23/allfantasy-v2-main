import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * Year two of a dynasty league has to actually start.
 *
 * Next season is a `setup` shell, and only a completed rookie draft ever moved it to `active`. A
 * league that skipped (or never created) its rookie draft sat in `setup` forever, outside the week
 * roller's scope, never scored. These pin the two new ways in — the commissioner's "Start new
 * season" and kickoff — and the one thing neither may ever do: start a season mid-draft.
 */

type Season = {
  id: string
  leagueId: string
  season: number
  status: string
  createdAt: Date
  currentWeek: number
  sport: string
  totalWeeks: number
  playoffStartWeek: number
  medianGame: boolean
}
type Draft = { leagueId: string; status: string; createdAt: Date }

const db = vi.hoisted(() => ({
  league: null as null | Record<string, unknown>,
  seasons: [] as Season[],
  drafts: [] as Draft[],
}))

const m = vi.hoisted(() => ({
  ensureShell: vi.fn(),
  carry: vi.fn(),
  after: vi.fn(),
  ensureSchedule: vi.fn(),
  syncDraft: vi.fn(),
  emit: vi.fn(),
  logAction: vi.fn(),
  leagueUpdate: vi.fn(),
  gate: vi.fn(),
  session: vi.fn(),
}))

function newestFirst<T extends { createdAt: Date }>(rows: T[]): T[] {
  return [...rows].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
}

vi.mock('@/lib/prisma', () => ({
  prisma: {
    league: {
      findUnique: vi.fn(async () => db.league),
      update: vi.fn(async (args: { data: Record<string, unknown> }) => {
        m.leagueUpdate(args)
        Object.assign(db.league as object, args.data)
      }),
    },
    redraftSeason: {
      findMany: vi.fn(async (args: { where: Record<string, unknown>; take?: number }) => {
        let rows = db.seasons.filter((s) => (args.where.leagueId ? s.leagueId === args.where.leagueId : true))
        if (args.where.status) rows = rows.filter((s) => s.status === args.where.status)
        if (args.where.league) rows = rows.map((s) => ({ ...s, league: { ...db.league } }))
        return newestFirst(rows).slice(0, args.take ?? rows.length)
      }),
      findUnique: vi.fn(async (args: { where: { id: string } }) => db.seasons.find((s) => s.id === args.where.id) ?? null),
      findFirst: vi.fn(async (args: { where: { leagueId: string; status: string; NOT: { id: string }; createdAt: { lt: Date } } }) => {
        const w = args.where
        return (
          db.seasons.find(
            (s) => s.leagueId === w.leagueId && s.status === w.status && s.id !== w.NOT.id && s.createdAt < w.createdAt.lt,
          ) ?? null
        )
      }),
      updateMany: vi.fn(async (args: { where: { id: string; status: string }; data: Partial<Season> }) => {
        const row = db.seasons.find((s) => s.id === args.where.id && s.status === args.where.status)
        if (!row) return { count: 0 }
        Object.assign(row, args.data)
        return { count: 1 }
      }),
    },
    draftSession: {
      findFirst: vi.fn(async (args: { where: { leagueId: string } }) =>
        newestFirst(db.drafts.filter((d) => d.leagueId === args.where.leagueId))[0] ?? null,
      ),
    },
  },
}))
vi.mock('@/lib/redraft/offseason/ensureNextRedraftSeasonShell', () => ({ ensureNextRedraftSeasonShell: m.ensureShell }))
vi.mock('@/lib/redraft/offseason/carryDynastyRosters', async (orig) => ({
  ...(await orig<typeof import('@/lib/redraft/offseason/carryDynastyRosters')>()),
  carryDynastyRostersForward: m.carry,
}))
vi.mock('@/lib/redraft/offseason/dynastyRolloverHousekeeping', () => ({
  afterDynastyNewSeasonActivated: m.after,
  DYNASTY_ROLLOVER_METADATA_KEY: 'dynastyRollover',
}))
vi.mock('@/lib/redraft/finalizeDraftToRedraftSeason', () => ({
  ensureScheduleForNewSeason: m.ensureSchedule,
  syncCompletedDraftToRedraftSeason: m.syncDraft,
}))
vi.mock('@/lib/events', () => ({ getPlatformEvents: () => ({ emit: m.emit }), EVENT: { SEASON_ACTIVATED: 'x' } }))
vi.mock('@/server/services/auditService', () => ({ logAction: m.logAction }))
vi.mock('@/lib/tournament/seasonNativeContract', () => ({ seasonSetupBlocked: () => false }))
vi.mock('@/server/services/leagueActionGate', () => ({ assertLeagueActionGate: m.gate }))
vi.mock('next-auth', () => ({ getServerSession: m.session }))
vi.mock('@/lib/auth', () => ({ authOptions: {} }))

import { startDynastyNewSeason, activateDynastyNewSeasonsAtKickoff } from '@/lib/redraft/offseason/startDynastyNewSeason'
import { POST } from '@/app/api/leagues/[leagueId]/season/start-new/route'
import { engineSeasonScope } from '@/lib/redraft/seasonStatus'

const T0 = new Date('2026-01-10T00:00:00Z')
const T1 = new Date('2026-02-10T00:00:00Z')

function season(id: string, year: number, status: string, createdAt: Date, sport = 'NFL'): Season {
  return { id, leagueId: 'L', season: year, status, createdAt, currentWeek: 0, sport, totalWeeks: 17, playoffStartWeek: 15, medianGame: false }
}

function seed(opts: { leagueType?: string; isDynasty?: boolean; sport?: string } = {}) {
  db.league = {
    id: 'L',
    leagueType: opts.leagueType ?? 'dynasty',
    isDynasty: opts.isDynasty ?? true,
    settings: {},
    lifecycleState: 'offseason',
    lifecycleMetadata: {},
  }
  // Year one complete, year two's shell waiting.
  db.seasons = [season('y1', 2025, 'complete', T0, opts.sport), season('y2', 2026, 'setup', T1, opts.sport)]
  db.drafts = [{ leagueId: 'L', status: 'completed', createdAt: new Date('2025-08-01T00:00:00Z') }]
}

const y2 = () => db.seasons.find((s) => s.id === 'y2')!

beforeEach(() => {
  vi.clearAllMocks()
  seed()
  m.carry.mockResolvedValue({ playersCopied: 0 })
  m.after.mockResolvedValue({ seasonId: 'y2', movedToBench: [], needsCutDown: [], taxiUnverified: 0 })
  m.ensureSchedule.mockResolvedValue(undefined)
  m.emit.mockResolvedValue(undefined)
  m.logAction.mockResolvedValue({ id: 'a' })
  m.gate.mockResolvedValue({ ok: true })
  m.session.mockResolvedValue({ user: { id: 'commish' } })
})

describe('startDynastyNewSeason (commissioner)', () => {
  it('does not start without a rookie draft unless the commissioner explicitly skips it', async () => {
    const out = await startDynastyNewSeason('L', 'commish')
    expect(out).toMatchObject({ ok: false, code: 'ROOKIE_DRAFT_NOT_DONE' })
    expect(y2().status).toBe('setup')
  })

  it('skipping the rookie draft activates the season, moves the league out of the offseason and runs housekeeping', async () => {
    const out = await startDynastyNewSeason('L', 'commish', { skipRookieDraft: true })
        expect(out).toMatchObject({ ok: true, via: 'skipped_rookie_draft', seasonId: 'y2', season: 2026 })
    expect(y2().status).toBe('active')
    expect(y2().currentWeek).toBe(1)
    expect(db.league!.lifecycleState).toBe('post_draft')
    expect(m.carry).toHaveBeenCalledWith('L', 'y1', 'y2')
    expect(m.after).toHaveBeenCalledWith('L', 'y2', expect.any(Date))
  })

  it('is idempotent: a second click changes nothing and reports already_active', async () => {
    await startDynastyNewSeason('L', 'commish', { skipRookieDraft: true })
    m.after.mockClear()
    const again = await startDynastyNewSeason('L', 'commish', { skipRookieDraft: true })
    expect(again).toMatchObject({ ok: true, via: 'already_active', seasonId: 'y2' })
    expect(m.after).not.toHaveBeenCalled()
    expect(y2().status).toBe('active')
  })

  it.each(['pre_draft', 'in_progress', 'paused'])('refuses while the rookie draft is %s, even when told to skip', async (status) => {
    db.drafts.push({ leagueId: 'L', status, createdAt: new Date('2026-03-01T00:00:00Z') })
    const out = await startDynastyNewSeason('L', 'commish', { skipRookieDraft: true })
    expect(out).toMatchObject({ ok: false, code: 'ROOKIE_DRAFT_IN_PROGRESS' })
    expect(y2().status).toBe('setup')
  })

  it('a completed rookie draft activates through the draft path, not around it', async () => {
    db.drafts.push({ leagueId: 'L', status: 'completed', createdAt: new Date('2026-04-01T00:00:00Z') })
    m.syncDraft.mockImplementation(async () => {
      y2().status = 'active'
    })
    const out = await startDynastyNewSeason('L', 'commish')
    expect(out).toMatchObject({ ok: true, via: 'rookie_draft' })
    expect(m.syncDraft).toHaveBeenCalledWith('L')
    expect(m.after).not.toHaveBeenCalled() // the draft path runs its own housekeeping
  })

  it('creates the shell and carries rosters when finalize left no next season', async () => {
    db.seasons = [season('y1', 2025, 'complete', T0)]
    m.ensureShell.mockImplementation(async () => {
      db.seasons.push(season('y2', 2026, 'setup', T1))
      return { id: 'y2', season: 2026 }
    })
    m.carry.mockResolvedValue({ playersCopied: 30 })
    const out = await startDynastyNewSeason('L', 'commish', { skipRookieDraft: true })
    expect(m.ensureShell).toHaveBeenCalledWith('L', 'y1')
    expect(out).toMatchObject({ ok: true, playersCarried: 30 })
    expect(y2().status).toBe('active')
  })

  it('refuses a redraft or keeper league and a dynasty league in its first season', async () => {
    seed({ leagueType: 'redraft', isDynasty: false })
    expect(await startDynastyNewSeason('L', 'commish', { skipRookieDraft: true })).toMatchObject({ code: 'NOT_DYNASTY' })
    seed({ leagueType: 'keeper', isDynasty: false })
    expect(await startDynastyNewSeason('L', 'commish', { skipRookieDraft: true })).toMatchObject({ code: 'NOT_DYNASTY' })
    seed()
    db.seasons = [season('y1', 2026, 'setup', T0)]
    expect(await startDynastyNewSeason('L', 'commish', { skipRookieDraft: true })).toMatchObject({ code: 'NOT_YEAR_TWO' })
    expect(db.seasons[0].status).toBe('setup')
  })
})

describe('POST /api/leagues/[leagueId]/season/start-new', () => {
  const call = (body: unknown) =>
    POST({ json: async () => body } as never, { params: Promise.resolve({ leagueId: 'L' }) })

  it('401 without a session', async () => {
    m.session.mockResolvedValue(null)
    expect((await call({})).status).toBe(401)
  })

  it('403 for a non-commissioner, and nothing is touched', async () => {
    m.gate.mockResolvedValue({ ok: false, err: { status: 403, error: 'Forbidden', code: 'FORBIDDEN' } })
    const res = await call({ skipRookieDraft: true })
    expect(res.status).toBe(403)
    expect(y2().status).toBe('setup')
    expect(m.gate).toHaveBeenCalledWith('L', 'commish', 'settings_edit_commissioner')
  })

  it('409 mid-draft; 200 on skip; 200 already_active on repeat', async () => {
    db.drafts.push({ leagueId: 'L', status: 'in_progress', createdAt: new Date('2026-03-01T00:00:00Z') })
    expect((await call({ skipRookieDraft: true })).status).toBe(409)
    db.drafts.pop()
    const first = await call({ skipRookieDraft: true })
    expect(first.status).toBe(200)
    expect((await first.json()).via).toBe('skipped_rookie_draft')
    const second = await call({ skipRookieDraft: true })
    expect((await second.json()).via).toBe('already_active')
  })

  it('only a literal `true` skips the rookie draft', async () => {
    const res = await call({ skipRookieDraft: 'yes' })
    expect(res.status).toBe(409)
    expect((await res.json()).code).toBe('ROOKIE_DRAFT_NOT_DONE')
  })
})

describe('activateDynastyNewSeasonsAtKickoff (week roller)', () => {
  const run = (resolveWeek: (id: string) => Promise<{ ok: boolean; phase?: string; reason?: string }>) =>
    activateDynastyNewSeasonsAtKickoff({ now: new Date('2026-09-11T00:00:00Z'), limit: 50, actorUserId: 'system:week-roller', resolveWeek, nativePlatforms: ['allfantasy'] })

  it('holds in the preseason', async () => {
    const out = await run(async () => ({ ok: true, phase: 'preseason' }))
    expect(out[0]).toMatchObject({ seasonId: 'y2', action: 'held', detail: 'PRESEASON' })
    expect(y2().status).toBe('setup')
  })

  it('holds when the week cannot be resolved', async () => {
    const out = await run(async () => ({ ok: false, reason: 'NO_SCHEDULE_ROWS' }))
    expect(out[0].action).toBe('held')
    expect(y2().status).toBe('setup')
  })

  it('never activates while a rookie draft is open, even after kickoff', async () => {
    db.drafts.push({ leagueId: 'L', status: 'paused', createdAt: new Date('2026-08-01T00:00:00Z') })
    const resolveWeek = vi.fn(async () => ({ ok: true, phase: 'regular' }))
    const out = await run(resolveWeek)
    expect(out[0]).toMatchObject({ action: 'held', detail: 'ROOKIE_DRAFT_IN_PROGRESS' })
    expect(y2().status).toBe('setup')
  })

  it('leaves a first season to its startup draft', async () => {
    db.seasons = [season('y1', 2026, 'setup', T0)]
    const out = await run(async () => ({ ok: true, phase: 'regular' }))
    expect(out[0]).toMatchObject({ action: 'held', detail: 'first_season' })
    expect(db.seasons[0].status).toBe('setup')
  })

  it('a completed rookie draft activates through the draft path', async () => {
    db.drafts.push({ leagueId: 'L', status: 'completed', createdAt: new Date('2026-04-01T00:00:00Z') })
    m.syncDraft.mockResolvedValue({})
    const out = await run(async () => ({ ok: true, phase: 'regular' }))
    expect(out[0]).toMatchObject({ action: 'activated', detail: 'rookie_draft' })
    expect(m.syncDraft).toHaveBeenCalledWith('L')
  })

  it.each(['NFL', 'NBA', 'NHL', 'MLB'])(
    '%s: a season with no rookie draft starts at week 1 and is then inside the week roller scope',
    async (sport) => {
      seed({ sport })
      const out = await run(async () => ({ ok: true, phase: 'regular' }))
      expect(out[0]).toMatchObject({ action: 'activated', detail: 'kickoff' })
      expect(y2().status).toBe('active')
      expect(db.league!.lifecycleState).toBe('post_draft')
      // The roller reads `engineSeasonScope()` with no sport filter; the activated status must be in it.
      const scope = engineSeasonScope()
      expect((scope.status as { in: string[] }).in).toContain(y2().status)
      expect(scope.sport).toBeUndefined()
      expect(m.after).toHaveBeenCalledWith('L', 'y2', expect.any(Date))
    },
  )

  it('skips a redraft league entirely', async () => {
    seed({ leagueType: 'redraft', isDynasty: false })
    const out = await run(async () => ({ ok: true, phase: 'regular' }))
    expect(out[0]).toMatchObject({ action: 'held', detail: 'not_dynasty' })
    expect(y2().status).toBe('setup')
  })
})
