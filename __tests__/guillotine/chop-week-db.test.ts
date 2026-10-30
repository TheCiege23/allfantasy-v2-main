// @vitest-environment node
/**
 * A Guilly season, chop week by chop week, against a real PostgreSQL — the chop the way score-sync
 * runs it (`runNativeGuillotineWeek`), with nothing in between mocked: the league config, the season
 * shell, scoring from the players' stat lines, the tiebreak, the elimination engine, the chop audit and
 * its row lock, the roster release, the standings flags, the automation locks and the season finish.
 *
 * Only the edges are stubbed: the week finalizer (it reads the game slate and the stat feed), the
 * notification dispatcher (it would push and email), and the AI recap writer.
 *
 * ⚠ WHY THIS EXISTS. Every other chop test mocks the database, so each one proves its own module
 * against the module it imagines next door. The bugs this league has actually had were BETWEEN
 * modules — two id spaces that did not line up, a score table nothing wrote, two replicas chopping the
 * same week, a duplicate elimination row with nothing to stop it. Here the modules meet for real.
 *
 * Runs only when RUN_GUILLOTINE_CHOP_WEEK_DB=1 and DATABASE_URL names the disposable local `chopweek`
 * database (.github/workflows/guillotine-chop-week-db.yml); skipped everywhere else.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { randomUUID } from 'node:crypto'

const enabled = process.env.RUN_GUILLOTINE_CHOP_WEEK_DB === '1'
if (enabled) {
  const target = new URL(process.env.DATABASE_URL ?? 'http://invalid')
  if (!['127.0.0.1', 'localhost'].includes(target.hostname) || target.pathname !== '/chopweek') {
    throw new Error('The chop-week test needs the disposable local chopweek database')
  }
}

const edges = vi.hoisted(() => ({
  lastKickoff: new Map<number, string>(),
  dispatched: [] as Array<{ type: string; userIds: string[]; title: string; dedupePrefix?: string }>,
}))

vi.mock('@/lib/redraft/weekFinalizer', async (orig) => ({
  ...(await orig<typeof import('@/lib/redraft/weekFinalizer')>()),
  // The week's games are final and its stats are in: what the finalizer decides from the slate.
  finalizeRedraftWeek: vi.fn(async ({ week }: { week: number }) => ({
    refusal: null,
    finalized: true,
    slate: { lastStartTime: edges.lastKickoff.get(week) ?? null },
  })),
}))
vi.mock('@/lib/notifications/NotificationDispatcher', () => ({
  dispatchNotification: vi.fn(async (p: { type: string; userIds: string[]; title: string; dedupePrefix?: string }) => {
    edges.dispatched.push({ type: p.type, userIds: [...p.userIds].sort(), title: p.title, dedupePrefix: p.dedupePrefix })
    return { ok: true }
  }),
}))
vi.mock('@/lib/ai/providerRouter', () => ({
  routeTextCall: vi.fn(async () => {
    throw new Error('no AI in the chop-week test')
  }),
}))

import { prisma } from '@/lib/prisma'
import { runNativeGuillotineWeek } from '@/lib/guillotine/nativeGuillotineWeek'

const SEASON = 2026
/** Each week's Monday night kickoff; the chop waits a day past it for stat corrections. */
const KICKOFF: Record<number, string> = {
  1: '2026-09-15T00:15:00.000Z',
  2: '2026-09-22T00:15:00.000Z',
  3: '2026-09-29T00:15:00.000Z',
}
const afterWeek = (week: number) => new Date(new Date(KICKOFF[week]!).getTime() + 2 * 24 * 3600_000)

type Team = { name: string; starter: number[]; bench: number[] }
/**
 * Passing yards for each team's quarterback (starter) and its benched quarterback, per week. Points
 * come from the league's own scoring of those stat lines, not from this table.
 */
const TEAMS: Team[] = [
  { name: 'Axes', starter: [300, 280, 310], bench: [100, 100, 100] },
  { name: 'Blades', starter: [150, 290, 120], bench: [100, 100, 100] },
  { name: 'Cleavers', starter: [250, 160, 260], bench: [100, 100, 100] },
  { name: 'Daggers', starter: [200, 240, 200], bench: [100, 100, 100] },
]

const created = { leagueIds: [] as string[], userIds: [] as string[], playerIds: [] as string[] }

async function league(teams: Team[] = TEAMS, opts: { settings?: Record<string, unknown> } = {}) {
  const tag = randomUUID().slice(0, 8)
  const users = []
  for (let i = 0; i < teams.length; i++) {
    users.push(await prisma.appUser.create({ data: { email: `chop-${tag}-${i}@chopweek.invalid`, username: `chop-${tag}-${i}` } }))
  }
  created.userIds.push(...users.map((u) => u.id))
  await prisma.tenant.upsert({ where: { id: 'allfantasy' }, create: { id: 'allfantasy', slug: 'allfantasy', name: 'Chop-week test' }, update: {} })
  const lg = await prisma.league.create({
    data: {
      userId: users[0]!.id, platform: 'allfantasy', platformLeagueId: `chop-${tag}`, name: `Chop Week ${tag}`,
      season: SEASON, sport: 'NFL', leagueType: 'guillotine', leagueVariant: 'guillotine', guillotineMode: true,
      ...(opts.settings ? { settings: opts.settings } : {}),
    },
  })
  created.leagueIds.push(lg.id)
  await prisma.guillotineLeagueConfig.create({
    data: {
      leagueId: lg.id, eliminationStartWeek: 1, eliminationEndWeek: 17, teamsPerChop: 1,
      correctionWindow: 'after_stat_corrections', statCorrectionHours: 24, rosterReleaseTiming: 'next_waiver_run',
    },
  })
  const season = await prisma.redraftSeason.create({
    data: { leagueId: lg.id, sport: 'NFL', season: SEASON, status: 'active', totalWeeks: 17, playoffStartWeek: 15, currentWeek: 1 },
  })
  const rosters: Array<{ redraftId: string; rosterId: string; userId: string; name: string }> = []
  for (let i = 0; i < teams.length; i++) {
    const t = teams[i]!
    const user = users[i]!
    const rr = await prisma.redraftRoster.create({
      data: { seasonId: season.id, leagueId: lg.id, ownerId: user.id, ownerName: user.username, teamName: t.name },
    })
    const qb = `chop-${tag}-qb-${i}`
    const backup = `chop-${tag}-qb2-${i}`
    created.playerIds.push(qb, backup)
    await prisma.redraftRosterPlayer.createMany({
      data: [
        { rosterId: rr.id, playerId: qb, playerName: `${t.name} QB`, position: 'QB', sport: 'NFL', slotType: 'QB' },
        { rosterId: rr.id, playerId: backup, playerName: `${t.name} QB2`, position: 'QB', sport: 'NFL', slotType: 'BN' },
      ],
    })
    for (let w = 0; w < t.starter.length; w++) {
      await prisma.playerWeeklyScore.createMany({
        data: [
          { playerId: qb, sport: 'NFL', week: w + 1, season: SEASON, stats: { pass_yds: t.starter[w]! }, isFinalized: true },
          { playerId: backup, sport: 'NFL', week: w + 1, season: SEASON, stats: { pass_yds: t.bench[w]! }, isFinalized: true },
        ],
      })
    }
    const roster = await prisma.roster.create({
      data: { leagueId: lg.id, platformUserId: user.id, redraftRosterId: rr.id, playerData: [qb, backup], waiverPriority: i + 1 },
    })
    await prisma.leagueTeam.create({
      data: { leagueId: lg.id, externalId: roster.id, teamName: t.name, ownerName: user.username, claimedByUserId: user.id },
    })
    rosters.push({ redraftId: rr.id, rosterId: roster.id, userId: user.id, name: t.name })
  }
  const byName = (name: string) => rosters.find((r) => r.name === name)!
  return { leagueId: lg.id, seasonId: season.id, rosters, byName }
}

type League = Awaited<ReturnType<typeof league>>

/** One score-sync pass over the league, as the route makes it: the calendar says `currentWeek`. */
const sync = (lg: League, currentWeek: number, now: Date) =>
  runNativeGuillotineWeek({ seasonId: lg.seasonId, currentFantasyWeek: currentWeek }, { now: () => now, firstChopWeekAfterDraft: async () => null })

/** What every page reads, straight from the tables. */
async function state(lg: League) {
  const [eliminations, roster, redraft, players, teams, gSeason, chopped] = await Promise.all([
    prisma.guillotineElimination.findMany({ where: { leagueId: lg.leagueId }, orderBy: { scoringPeriod: 'asc' } }),
    prisma.roster.findMany({ where: { leagueId: lg.leagueId }, select: { id: true, playerData: true } }),
    prisma.redraftRoster.findMany({ where: { leagueId: lg.leagueId }, select: { id: true, isEliminated: true } }),
    prisma.redraftRosterPlayer.findMany({ where: { roster: { leagueId: lg.leagueId } }, select: { rosterId: true, droppedAt: true } }),
    prisma.leagueTeam.findMany({ where: { leagueId: lg.leagueId }, select: { externalId: true, eliminatedAt: true } }),
    prisma.guillotineSeason.findFirst({ where: { leagueId: lg.leagueId } }),
    prisma.guillotineRosterState.findMany({ where: { leagueId: lg.leagueId, choppedAt: { not: null } }, select: { rosterId: true, choppedInPeriod: true } }),
  ])
  const nameOfRoster = (id: string) => lg.rosters.find((r) => r.rosterId === id || r.redraftId === id)?.name ?? id
  return {
    eliminations,
    /** Chopped teams by week, from the engine's own record. */
    choppedByWeek: Object.fromEntries(chopped.map((c) => [nameOfRoster(c.rosterId), c.choppedInPeriod])),
    /** Teams the standings show as eliminated. */
    eliminated: redraft.filter((r) => r.isEliminated).map((r) => nameOfRoster(r.id)).sort(),
    /** Teams whose players were dropped to waivers. */
    released: [...new Set(players.filter((p) => p.droppedAt).map((p) => nameOfRoster(p.rosterId)))].sort(),
    /** Teams whose engine roster was emptied. */
    emptied: roster.filter((r) => Array.isArray(r.playerData) && r.playerData.length === 0).map((r) => nameOfRoster(r.id)).sort(),
    /** Teams marked eliminated on the league's team list. */
    teamsOut: teams.filter((t) => t.eliminatedAt).map((t) => nameOfRoster(t.externalId)).sort(),
    gSeason,
  }
}

async function clean() {
  for (const id of created.leagueIds.splice(0)) {
    await prisma.guillotineRosterState.deleteMany({ where: { leagueId: id } })
    await prisma.guillotinePeriodScore.deleteMany({ where: { leagueId: id } })
    await prisma.guillotineEventLog.deleteMany({ where: { leagueId: id } })
    await prisma.automationLock.deleteMany({ where: { lockKey: { contains: id } } })
    await prisma.league.delete({ where: { id } })
  }
  for (const id of created.userIds.splice(0)) await prisma.appUser.delete({ where: { id } }).catch(() => undefined)
  if (created.playerIds.length) await prisma.playerWeeklyScore.deleteMany({ where: { playerId: { in: created.playerIds.splice(0) } } })
}

describe.runIf(enabled)('a Guilly chop week against a real database', () => {
  beforeAll(async () => {
    for (const [w, k] of Object.entries(KICKOFF)) edges.lastKickoff.set(Number(w), k)
    await prisma.$connect()
  })
  beforeEach(() => {
    edges.dispatched.length = 0
  })
  afterEach(clean)
  afterAll(async () => {
    await prisma.$disconnect()
  })

  it('holds the chop until the stat-correction window closes, writing nothing', async () => {
    const lg = await league()
    // Monday night's game is final, but corrections can still land for a day.
    const r = await sync(lg, 2, new Date(new Date(KICKOFF[1]!).getTime() + 6 * 3600_000))
    expect(r).toMatchObject({ outcome: 'waiting', week: 1, reason: 'stat_correction_window' })
    const s = await state(lg)
    expect(s.eliminations).toHaveLength(0)
    expect(s.choppedByWeek).toEqual({})
    expect(await prisma.guillotinePeriodScore.count({ where: { leagueId: lg.leagueId } })).toBe(0)
    expect(edges.dispatched).toHaveLength(0)
  })

  it('chops the week’s lowest scorer — and every page that reads the league agrees', async () => {
    const lg = await league()
    const r = await sync(lg, 2, afterWeek(1))
    expect(r).toMatchObject({ outcome: 'chopped', week: 1, choppedRedraftRosterIds: [lg.byName('Blades').redraftId] })

    // The week's scores, from the players' stat lines, as the engine saved them.
    const scores = await prisma.guillotinePeriodScore.findMany({ where: { leagueId: lg.leagueId, weekOrPeriod: 1 } })
    const points = Object.fromEntries(scores.map((p) => [lg.rosters.find((x) => x.rosterId === p.rosterId)!.name, p.periodPoints]))
    expect(Object.keys(points).sort()).toEqual(['Axes', 'Blades', 'Cleavers', 'Daggers'])
    expect(points.Blades).toBeLessThan(points.Daggers!)
    expect(points.Daggers).toBeLessThan(points.Cleavers!)
    expect(points.Cleavers).toBeLessThan(points.Axes!)

    const s = await state(lg)
    expect(s.choppedByWeek).toEqual({ Blades: 1 })
    expect(s.eliminations.map((e) => [e.scoringPeriod, e.eliminatedTeamName])).toEqual([[1, 'Blades']])
    expect(s.eliminated).toEqual(['Blades'])
    expect(s.released).toEqual(['Blades'])
    expect(s.emptied).toEqual(['Blades'])
    expect(s.teamsOut).toEqual(['Blades'])
    expect(s.gSeason).toMatchObject({ status: 'active', currentScoringPeriod: 1, currentTeamsActive: 3, totalTeamsStarted: 4 })
    expect(await prisma.guillotineSurvivalLog.count({ where: { seasonId: s.gSeason!.id, scoringPeriod: 1 } })).toBe(4)

    // The chopped manager is told they are out; the other three that they survived.
    const out = edges.dispatched.find((d) => d.type === 'guillotine_chopped')
    const alive = edges.dispatched.find((d) => d.type === 'guillotine_survived')
    expect(out?.userIds).toEqual([lg.byName('Blades').userId])
    expect(alive?.userIds).toEqual(['Axes', 'Cleavers', 'Daggers'].map((n) => lg.byName(n).userId).sort())
  })

  it('a second score-sync pass, and two replicas at once, never chop a second team for the same week', async () => {
    const lg = await league()
    // score-sync runs every five minutes on two worker replicas: the first pass lands on both at once.
    const [a, b] = await Promise.all([sync(lg, 2, afterWeek(1)), sync(lg, 2, afterWeek(1))])
    expect([a.outcome, b.outcome].filter((o) => o === 'chopped')).toHaveLength(1)
    // …and five minutes later, again: week 1 is done, so it waits on week 2 rather than chop again.
    const again = await sync(lg, 2, new Date(afterWeek(1).getTime() + 5 * 60_000))
    expect(again).toMatchObject({ outcome: 'waiting', week: 2, reason: 'week_in_progress' })
    // Even a pass that is told week 1 again (a stale calendar) finds it already chopped.
    expect(await sync(lg, 1, afterWeek(1))).toMatchObject({ outcome: 'waiting', week: 2 })

    const s = await state(lg)
    expect(s.choppedByWeek).toEqual({ Blades: 1 })
    expect(s.eliminations).toHaveLength(1)
    expect(s.eliminated).toEqual(['Blades'])
    expect(s.gSeason).toMatchObject({ currentScoringPeriod: 1, currentTeamsActive: 3 })
    // One alert each, whichever replica sent it.
    expect(edges.dispatched.filter((d) => d.type === 'guillotine_chopped')).toHaveLength(1)
  })

  it('plays the season out: each week chops the lowest survivor, and the last chop crowns the champion', async () => {
    const lg = await league()
    expect(await sync(lg, 2, afterWeek(1))).toMatchObject({ outcome: 'chopped', week: 1 })
    // Week 2 has not finished yet: the calendar still says week 2.
    expect(await sync(lg, 2, afterWeek(1))).toMatchObject({ outcome: 'waiting', week: 2, reason: 'week_in_progress' })
    // Week 2: Blades would have scored well, but Blades is gone. Cleavers is the low survivor.
    expect(await sync(lg, 3, afterWeek(2))).toMatchObject({ outcome: 'chopped', week: 2, choppedRedraftRosterIds: [lg.byName('Cleavers').redraftId] })

    // The tiebreak's season total runs through every week a team has played.
    const cumul = await prisma.guillotinePeriodScore.findMany({ where: { leagueId: lg.leagueId, rosterId: lg.byName('Axes').rosterId }, orderBy: { weekOrPeriod: 'asc' } })
    expect(cumul.map((c) => c.weekOrPeriod)).toEqual([1, 2])
    expect(cumul[1]!.seasonPointsCumul).toBeCloseTo(cumul[0]!.periodPoints + cumul[1]!.periodPoints, 2)
    expect(await prisma.guillotinePeriodScore.count({ where: { leagueId: lg.leagueId, weekOrPeriod: 2, rosterId: lg.byName('Blades').rosterId } })).toBe(0)

    // Week 3: two teams left, Daggers the lower. The last chop ends the season.
    expect(await sync(lg, 4, afterWeek(3))).toMatchObject({ outcome: 'chopped', week: 3, choppedRedraftRosterIds: [lg.byName('Daggers').redraftId] })

    const s = await state(lg)
    expect(s.choppedByWeek).toEqual({ Blades: 1, Cleavers: 2, Daggers: 3 })
    expect(s.eliminations.map((e) => [e.scoringPeriod, e.eliminatedTeamName])).toEqual([[1, 'Blades'], [2, 'Cleavers'], [3, 'Daggers']])
    expect(s.eliminated).toEqual(['Blades', 'Cleavers', 'Daggers'])
    expect(s.gSeason).toMatchObject({ status: 'complete', currentTeamsActive: 1 })
    expect((await prisma.redraftSeason.findUniqueOrThrow({ where: { id: lg.seasonId } })).status).toBe('complete')
    const champion = await prisma.leagueChampionship.findFirst({ where: { leagueId: lg.leagueId } })
    expect(champion).not.toBeNull()

    // And the finished season stays finished.
    expect(await sync(lg, 5, afterWeek(3))).toMatchObject({ outcome: 'season_complete' })
    expect((await state(lg)).eliminations).toHaveLength(3)
  })

  it('a tie at the bottom goes to bench points, and the audit says a tiebreak decided it', async () => {
    // Cleavers and Daggers both start a 200-yard quarterback; Daggers' bench scored less.
    const lg = await league([
      { name: 'Axes', starter: [300], bench: [100] },
      { name: 'Blades', starter: [280], bench: [100] },
      { name: 'Cleavers', starter: [200], bench: [150] },
      { name: 'Daggers', starter: [200], bench: [50] },
    ])
    expect(await sync(lg, 2, afterWeek(1))).toMatchObject({ outcome: 'chopped', week: 1, choppedRedraftRosterIds: [lg.byName('Daggers').redraftId] })
    const [chop] = (await state(lg)).eliminations
    expect(chop).toMatchObject({ eliminatedTeamName: 'Daggers', wasTiebreaker: true })
  })

  describe('best ball Guilly (settings.best_ball, lib/guillotine/guillotineBestBall.ts)', () => {
    // Blades' starter had a bad week and its backup a big one: a lineup league chops Blades, a best
    // ball league starts the backup and chops Daggers instead.
    const SWAP: Team[] = [
      { name: 'Axes', starter: [300], bench: [100] },
      { name: 'Blades', starter: [150], bench: [280] },
      { name: 'Cleavers', starter: [250], bench: [100] },
      { name: 'Daggers', starter: [200], bench: [100] },
    ]

    it('scores every team on its best lineup, so the benched big week counts and a different team is chopped', async () => {
      const lg = await league(SWAP, { settings: { best_ball: true } })
      expect(await sync(lg, 2, afterWeek(1))).toMatchObject({ outcome: 'chopped', week: 1, choppedRedraftRosterIds: [lg.byName('Daggers').redraftId] })
      const scores = await prisma.guillotinePeriodScore.findMany({ where: { leagueId: lg.leagueId, weekOrPeriod: 1 } })
      const points = Object.fromEntries(scores.map((p) => [lg.rosters.find((x) => x.rosterId === p.rosterId)!.name, p.periodPoints]))
      // Blades scored its backup's line, not its starter's.
      const lineupLeague = await league(SWAP)
      await sync(lineupLeague, 2, afterWeek(1))
      const lineupScores = await prisma.guillotinePeriodScore.findMany({ where: { leagueId: lineupLeague.leagueId, weekOrPeriod: 1 } })
      const lineupPoints = Object.fromEntries(lineupScores.map((p) => [lineupLeague.rosters.find((x) => x.rosterId === p.rosterId)!.name, p.periodPoints]))
      expect(points.Blades).toBeGreaterThan(lineupPoints.Blades!)
      expect(points.Axes).toBe(lineupPoints.Axes)
      expect((await state(lineupLeague)).choppedByWeek).toEqual({ Blades: 1 })
      expect((await state(lg)).choppedByWeek).toEqual({ Daggers: 1 })
    })

    it('a tie at the bottom still goes to bench points: the players the best lineup left out', async () => {
      // Cleavers and Daggers both start 200 yards; Daggers' left-out quarterback scored less.
      const lg = await league([
        { name: 'Axes', starter: [300], bench: [100] },
        { name: 'Blades', starter: [280], bench: [100] },
        { name: 'Cleavers', starter: [200], bench: [150] },
        { name: 'Daggers', starter: [200], bench: [50] },
      ], { settings: { best_ball: true } })
      expect(await sync(lg, 2, afterWeek(1))).toMatchObject({ outcome: 'chopped', week: 1, choppedRedraftRosterIds: [lg.byName('Daggers').redraftId] })
      expect((await state(lg)).eliminations[0]).toMatchObject({ eliminatedTeamName: 'Daggers', wasTiebreaker: true })
    })
  })
})
