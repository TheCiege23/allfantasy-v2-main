// @vitest-environment node
/**
 * Scheduled roster changes against a real PostgreSQL: the save, the weekly run, and what a league's roster,
 * lineup seats and lineup validation read afterwards. Nothing between them is mocked: the roster engine's
 * writer, the league settings, the roster template, the row locks.
 *
 * ⚠ WHY A REAL DATABASE. The run changes a roster by a DELTA and is called on every score-sync pass, so the
 * property that matters is that a second pass, or a pass after a crash, leaves the SAME roster. That is a claim
 * about what several statements leave behind, which a mocked database cannot check.
 *
 * Only the edges are stubbed: the plan check (it reads a subscription), the chat post and the league-event
 * publisher. One test makes the roster writer fail on purpose, to stand in for a crash.
 *
 * The roster engine's registry loads each sport with `require()`, which this runner cannot resolve, so the
 * registry here hands out the REAL NFL service built from the same module by import. No roster code is faked.
 *
 * Runs only when RUN_GUILLOTINE_ROSTER_SCHEDULE_DB=1 and DATABASE_URL names the disposable local `chopweek`
 * database (the same one __tests__/guillotine/chop-week-db.test.ts uses); skipped everywhere else.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { randomUUID } from 'node:crypto'

const enabled = process.env.RUN_GUILLOTINE_ROSTER_SCHEDULE_DB === '1'
if (enabled) {
  const target = new URL(process.env.DATABASE_URL ?? 'http://invalid')
  if (!['127.0.0.1', 'localhost'].includes(target.hostname) || target.pathname !== '/chopweek') {
    throw new Error('The roster-schedule test needs the disposable local chopweek database')
  }
}

const edges = vi.hoisted(() => ({
  entitled: true,
  /** 'before': the writer throws without writing. 'after': it writes, then throws. */
  crash: null as null | 'before' | 'after',
  chat: [] as string[],
  notified: [] as Array<{ userIds: string[]; type: string; body: string }>,
}))

vi.mock('server-only', () => ({}))
vi.mock('@/lib/subscription/FeatureGateService', () => ({
  FeatureGateService: class {
    async evaluateUserFeatureAccess() {
      return { allowed: edges.entitled }
    }
  },
}))
vi.mock('@/lib/league-chat/LeagueChatMessageService', () => ({
  createLeagueChatMessage: vi.fn(async (_leagueId: string, _userId: string, message: string) => {
    edges.chat.push(message)
    return null
  }),
}))
vi.mock('@/lib/league-rules-explainer/publishRuleChanges', () => ({ publishRuleChangesEvent: vi.fn(async () => {}) }))
vi.mock('@/lib/notifications/NotificationDispatcher', () => ({
  dispatchNotification: vi.fn(async (p: { userIds: string[]; type: string; body: string }) => {
    edges.notified.push({ userIds: p.userIds, type: p.type, body: p.body })
    return { requested: 1, suppressed: 0, delivered: 1, failed: 0 }
  }),
}))
vi.mock('@/lib/roster-engine/RosterEngineRegistry', async () => {
  const roster = await import('@/lib/nfl-roster')
  const nfl = {
    sport: 'NFL',
    getConfig: async (leagueId: string) => {
      const c = await roster.getLeagueNflRosterConfig(leagueId)
      return { templateKey: c.templateKey, slots: c.slots, isCustom: c.isCustom, lastUpdatedAt: c.lastUpdatedAt, lastUpdatedBy: c.lastUpdatedBy }
    },
    saveConfig: (leagueId: string, payload: Parameters<typeof roster.saveLeagueNflRosterConfig>[1]) => roster.saveLeagueNflRosterConfig(leagueId, payload),
    applyDefaultOnCreate: (leagueId: string, leagueType: string) => roster.applyDefaultNflRosterOnCreate(leagueId, leagueType),
    getSlots: () => roster.getAllNflSlots(),
    getTemplates: () => roster.NFL_ROSTER_TEMPLATES,
    resolveDefaultTemplate: (leagueType: string) => roster.resolveNflRosterTemplate(leagueType),
  }
  const registry = {
    isSupported: (sport: string) => sport.toUpperCase() === 'NFL',
    getService: (sport: string) => {
      if (sport.toUpperCase() !== 'NFL') throw new Error(`Unsupported roster sport: ${sport}`)
      return nfl
    },
  }
  return { getRosterEngineRegistry: () => registry }
})
vi.mock('@/lib/roster-engine', async (orig) => {
  const real = await orig<typeof import('@/lib/roster-engine')>()
  return {
    ...real,
    writeLeagueRosterConfig: vi.fn(async (...args: Parameters<typeof real.writeLeagueRosterConfig>) => {
      if (edges.crash === 'before') throw new Error('crash before the roster write')
      const out = await real.writeLeagueRosterConfig(...args)
      if (edges.crash === 'after') throw new Error('crash after the roster write')
      return out
    }),
  }
})

import { prisma } from '@/lib/prisma'
import { getRosterEngineRegistry, writeLeagueRosterConfig } from '@/lib/roster-engine'
import { resolveRedraftRosterConfig } from '@/lib/redraft/rosterConfigResolver'
import { getRosterTemplateForLeague } from '@/lib/multi-sport/MultiSportRosterService'
import { getFormatTypeForVariant } from '@/lib/sport-defaults/LeagueVariantRegistry'
import { resolveLineupStarterSlots } from '@/lib/league/lineupStarterSlots'
import { applyDueRosterChanges } from '@/lib/guillotine/rosterScheduleApply'
import { readRosterScheduleView, saveRosterSchedule } from '@/lib/guillotine/rosterScheduleSave'
import { ROSTER_SCHEDULE_STATE_KEY, readRosterScheduleState } from '@/lib/guillotine/rosterSchedule'
import { loadWeekLineups, weekSlotType } from '@/lib/redraft/weekLineupSlots'
import { slotCategory } from '@/lib/league-runtime/redraftSlotType'

const SEASON = 2026
const LAYOUT = { QB: 1, RB: 2, WR: 2, TE: 1, FLEX: 1, K: 1, DEF: 1, BN: 6, IR: 1 }
const WEEK_10 = [
  { id: 'w10sf', week: 10, kind: 'add_starter', slot: 'SUPERFLEX', count: 1 },
  { id: 'w10bn', week: 10, kind: 'add_bench', slot: null, count: 1 },
]
const WEEK_11 = { id: 'w11wr', week: 11, kind: 'bench_to_starter', slot: 'WR', count: 1 }
/** A change that moves seats: the third receiver lands after WR2, ahead of the defense. */
const THIRD_WR = [{ id: 'w10wr', week: 10, kind: 'add_starter', slot: 'WR', count: 1 }]

const created = { leagueIds: [] as string[], userIds: [] as string[] }

async function league(opts: { platform?: string; currentWeek?: number; bestBall?: boolean } = {}) {
  const tag = randomUUID().slice(0, 8)
  const owner = await prisma.appUser.create({ data: { email: `roster-${tag}@chopweek.invalid`, username: `roster-${tag}` } })
  created.userIds.push(owner.id)
  await prisma.tenant.upsert({ where: { id: 'allfantasy' }, create: { id: 'allfantasy', slug: 'allfantasy', name: 'Roster-schedule test' }, update: {} })
  const lg = await prisma.league.create({
    data: {
      userId: owner.id, platform: opts.platform ?? 'allfantasy', platformLeagueId: `roster-${tag}`, name: `Roster Schedule ${tag}`,
      season: SEASON, sport: 'NFL', leagueType: 'guillotine', leagueVariant: 'guillotine', guillotineMode: true,
      ...(opts.bestBall ? { bestBallMode: true } : {}),
    },
  })
  created.leagueIds.push(lg.id)
  await prisma.guillotineLeagueConfig.create({
    data: { leagueId: lg.id, eliminationStartWeek: 1, eliminationEndWeek: 17, teamsPerChop: 1, correctionWindow: 'after_stat_corrections', statCorrectionHours: 24, rosterReleaseTiming: 'next_waiver_run' },
  })
  const season = await prisma.redraftSeason.create({
    data: { leagueId: lg.id, sport: 'NFL', season: SEASON, status: 'active', totalWeeks: 17, playoffStartWeek: 15, currentWeek: opts.currentWeek ?? 3 },
  })
  await writeLeagueRosterConfig(lg.id, { templateKey: 'custom', slots: LAYOUT }, { userId: owner.id, auditAction: 'updated' })
  // One team with a saved lineup, in this league's real seat order (K QB RB1 RB2 TE WR1 WR2 DEF FLEX):
  // the kicker in seat 0, the quarterback in seat 1, the defense in seat 7.
  const roster = await prisma.roster.create({
    data: {
      leagueId: lg.id, platformUserId: owner.id, waiverPriority: 1,
      playerData: {
        players: ['qb', 'k', 'def', 'bn'],
        starters: ['qb', 'k', 'def'],
        lineup_sections: {
          starters: [{ id: 'qb', position: 'QB', slotIndex: 1 }, { id: 'k', position: 'K', slotIndex: 0 }, { id: 'def', position: 'DEF', slotIndex: 7 }],
          bench: [{ id: 'bn', position: 'WR' }],
        },
      },
    },
  })
  return { leagueId: lg.id, ownerId: owner.id, rosterId: roster.id, seasonId: season.id }
}

/** The real seat order of LAYOUT, and a full lineup saved in it: every seat filled, a receiver in the Flex. */
const SEATS = ['K', 'QB', 'RB1', 'RB2', 'TE', 'WR1', 'WR2', 'DEF', 'FLEX']
const LINEUP: Array<{ id: string; position: string }> = [
  { id: 'k', position: 'K' }, { id: 'qb', position: 'QB' }, { id: 'rb1', position: 'RB' }, { id: 'rb2', position: 'RB' }, { id: 'te', position: 'TE' },
  { id: 'wr1', position: 'WR' }, { id: 'wr2', position: 'WR' }, { id: 'def', position: 'DEF' }, { id: 'flex', position: 'WR' },
]

/**
 * A second team in the league, the way a drafted team is stored: the lineup the screen saves (`playerData`),
 * its scoring slots (`RedraftRosterPlayer.slotType`), and the link between them. `starters` leaves seats empty.
 */
async function team(lg: Awaited<ReturnType<typeof league>>, opts: { starters?: string[] } = {}) {
  const tag = randomUUID().slice(0, 8)
  const user = await prisma.appUser.create({ data: { email: `team-${tag}@chopweek.invalid`, username: `team-${tag}` } })
  created.userIds.push(user.id)
  const starting = LINEUP.filter((p) => !opts.starters || opts.starters.includes(p.id))
  const bench = [...LINEUP.filter((p) => !starting.includes(p)), { id: 'bn1', position: 'WR' }]
  const pid = (id: string) => `${tag}-${id}`
  const rr = await prisma.redraftRoster.create({ data: { seasonId: lg.seasonId, leagueId: lg.leagueId, ownerId: user.id, ownerName: user.username, teamName: `Team ${tag}` } })
  await prisma.redraftRosterPlayer.createMany({
    data: [
      ...starting.map((p) => ({ rosterId: rr.id, playerId: pid(p.id), playerName: `${p.id} name`, position: p.position, sport: 'NFL', slotType: p.position })),
      ...bench.map((p) => ({ rosterId: rr.id, playerId: pid(p.id), playerName: `${p.id} name`, position: p.position, sport: 'NFL', slotType: 'BN' })),
    ],
  })
  const row = (p: { id: string; position: string }) => ({ id: pid(p.id), position: p.position, name: `${p.id} name` })
  const roster = await prisma.roster.create({
    data: {
      leagueId: lg.leagueId, platformUserId: user.id, redraftRosterId: rr.id, waiverPriority: 2,
      playerData: {
        players: [...starting, ...bench].map((p) => pid(p.id)),
        starters: starting.map((p) => pid(p.id)),
        lineup_sections: {
          starters: starting.map((p) => ({ ...row(p), slotIndex: LINEUP.indexOf(p) })),
          bench: bench.map(row), ir: [], taxi: [], devy: [],
        },
      },
    },
  })
  /** What every reader of this team's lineup sees, straight from the tables. */
  const read = async () => {
    const r = await prisma.roster.findUniqueOrThrow({ where: { id: roster.id }, select: { playerData: true } })
    const data = r.playerData as { starters: string[]; lineup_sections: { starters: Array<{ id: string; slotIndex?: number }>; bench: Array<{ id: string }> } }
    const players = await prisma.redraftRosterPlayer.findMany({ where: { rosterId: rr.id, droppedAt: null }, select: { rosterId: true, playerId: true, slotType: true, position: true } })
    const short = (id: string) => id.replace(`${tag}-`, '')
    const full = await prisma.league.findUniqueOrThrow({ where: { id: lg.leagueId } })
    const template = await getRosterTemplateForLeague('NFL' as never, getFormatTypeForVariant('NFL', full.leagueVariant ?? undefined), lg.leagueId)
    const labels = resolveLineupStarterSlots(full as never, template).map((x) => x.label)
    /** Who scores as a starter in `week`, by the functions weekly scoring itself uses. */
    const scoringStarters = async (week: number) => {
      const lineups = await loadWeekLineups(prisma, { redraftRosterIds: [rr.id], season: SEASON, week })
      return players.filter((p) => slotCategory(weekSlotType(p, lineups)) === 'starter').map((p) => short(p.playerId)).sort()
    }
    return {
      starters: data.lineup_sections.starters.map((s) => short(s.id)),
      bench: data.lineup_sections.bench.map((s) => short(s.id)),
      drawnIn: Object.fromEntries(data.lineup_sections.starters.map((s) => [short(s.id), s.slotIndex == null ? null : labels[s.slotIndex] ?? null])),
      /** Current state: what a week with no saved lineup of its own is scored from. */
      scoringSlots: Object.fromEntries(players.map((p) => [short(p.playerId), slotCategory(p.slotType)])),
      scoringStarters,
      savedWeeks: [...new Set((await prisma.afRosterLineupAssignment.findMany({ where: { rosterId: roster.id }, select: { week: true } })).map((a) => a.week))].sort((a, b) => a - b),
    }
  }
  return { rosterId: roster.id, userId: user.id, redraftRosterId: rr.id, read, pid }
}

type League = Awaited<ReturnType<typeof league>>

/** What each reader of the roster sees, straight from the tables. */
async function seen(lg: League) {
  const row = await prisma.league.findUniqueOrThrow({ where: { id: lg.leagueId }, select: { settings: true } })
  const roster = await prisma.roster.findUniqueOrThrow({ where: { id: lg.rosterId }, select: { playerData: true } })
  const engine = (await getRosterEngineRegistry().getService('NFL').getConfig(lg.leagueId)).slots
  const validation = resolveRedraftRosterConfig('NFL', row.settings)
  const starters = (roster.playerData as { lineup_sections: { starters: Array<{ id: string; slotIndex?: number }> } }).lineup_sections.starters
  const full = await prisma.league.findUniqueOrThrow({ where: { id: lg.leagueId } })
  const template = await getRosterTemplateForLeague('NFL' as never, getFormatTypeForVariant('NFL', full.leagueVariant ?? undefined), lg.leagueId)
  const labels = resolveLineupStarterSlots(full as never, template).map((x) => x.label)
  return {
    engine,
    /** The lineup screen's seats, in order. */
    labels,
    /** Which seat each saved starter is drawn in. */
    drawnIn: Object.fromEntries(starters.map((r) => [r.id, r.slotIndex == null ? null : labels[r.slotIndex] ?? null])),
    /** What lineup saves are validated against (lib/redraft/rosterConfigResolver.ts). */
    superflex: validation.starterCapacities.get('SF') ?? validation.starterCapacities.get('SUPERFLEX') ?? 0,
    wr: validation.starterCapacities.get('WR') ?? 0,
    bench: validation.benchSlots,
    maxRoster: validation.maxRosterSize,
    seats: Object.fromEntries(starters.map((r) => [r.id, r.slotIndex ?? null])),
    state: readRosterScheduleState(row.settings),
    events: await prisma.guillotineEventLog.findMany({ where: { leagueId: lg.leagueId, eventType: 'roster_change' }, orderBy: { createdAt: 'asc' } }),
  }
}

async function clean() {
  edges.entitled = true
  edges.crash = null
  edges.chat.length = 0
  edges.notified.length = 0
  for (const id of created.leagueIds.splice(0)) {
    await prisma.guillotineEventLog.deleteMany({ where: { leagueId: id } })
    await prisma.automationLock.deleteMany({ where: { lockKey: { contains: id } } })
    await prisma.league.delete({ where: { id } }).catch(() => {})
  }
  if (created.userIds.length) await prisma.appUser.deleteMany({ where: { id: { in: created.userIds.splice(0) } } }).catch(() => {})
}

describe.skipIf(!enabled)('scheduled roster changes on a real database', () => {
  // The weekly run loads the lineup engine only when it is about to move a player. Load it once here, so the
  // first test that benches someone is not timed on compiling every league format's rules.
  beforeAll(async () => {
    await import('@/lib/roster-lineup-engine/lineupService')
  }, 180_000)
  afterEach(clean)
  afterAll(async () => {
    await prisma.$disconnect()
  })

  it('the fixture starts where the tests say it does', async () => {
    const lg = await league()
    const s = await seen(lg)
    expect(s.engine).toMatchObject(LAYOUT)
    expect([s.superflex, s.wr, s.bench, s.maxRoster]).toEqual([0, 2, 6, 16])
    expect(s.labels).toEqual(['K', 'QB', 'RB1', 'RB2', 'TE', 'WR1', 'WR2', 'DEF', 'FLEX'])
    expect(s.drawnIn).toEqual({ qb: 'QB', k: 'K', def: 'DEF' })
    expect(s.state).toEqual({ done: [], skipped: [], pending: null })
  })

  it('saves a list, and reads it back with the weeks a change can still be set for', async () => {
    const lg = await league({ currentWeek: 3 })
    const saved = await saveRosterSchedule(lg.leagueId, lg.ownerId, [...WEEK_10, WEEK_11])
    expect(saved.ok && saved.view.changes.map((c) => c.id)).toEqual(['w10sf', 'w10bn', 'w11wr'])
    const view = await readRosterScheduleView(lg.leagueId)
    expect(view).toMatchObject({ supported: true, fromWeek: 4, toWeek: 17, done: [], layout: LAYOUT })
    // Saving a schedule changes nothing yet.
    expect((await seen(lg)).engine).toMatchObject(LAYOUT)
  })

  it('refuses a week that is being played, and a plan without AF Commissioner', async () => {
    const lg = await league({ currentWeek: 10 })
    expect(await saveRosterSchedule(lg.leagueId, lg.ownerId, WEEK_10)).toMatchObject({ ok: false, error: 'bad_week' })
    edges.entitled = false
    expect(await saveRosterSchedule(lg.leagueId, lg.ownerId, [WEEK_11])).toMatchObject({ ok: false, error: 'not_entitled' })
  })

  it('a lapsed plan can remove a change, one or all, but not add or edit one', async () => {
    const lg = await league()
    await saveRosterSchedule(lg.leagueId, lg.ownerId, [...WEEK_10, WEEK_11])
    edges.entitled = false
    // Edit one: refused, and nothing is written.
    expect(await saveRosterSchedule(lg.leagueId, lg.ownerId, [{ ...WEEK_10[0], count: 2 }, WEEK_10[1], WEEK_11])).toMatchObject({ ok: false, error: 'not_entitled' })
    expect((await readRosterScheduleView(lg.leagueId))?.changes.map((c) => [c.id, c.count])).toEqual([['w10sf', 1], ['w10bn', 1], ['w11wr', 1]])
    // Remove one, keeping the others as they are.
    expect(await saveRosterSchedule(lg.leagueId, lg.ownerId, [WEEK_10[0], WEEK_11])).toMatchObject({ ok: true })
    expect((await readRosterScheduleView(lg.leagueId))?.changes.map((c) => c.id)).toEqual(['w10sf', 'w11wr'])
    // Remove the rest.
    expect(await saveRosterSchedule(lg.leagueId, lg.ownerId, [])).toMatchObject({ ok: true })
    expect((await readRosterScheduleView(lg.leagueId))?.changes).toEqual([])
  })

  it('does nothing before the week, then changes the roster once when it arrives', async () => {
    const lg = await league()
    await saveRosterSchedule(lg.leagueId, lg.ownerId, [...WEEK_10, WEEK_11])

    expect(await applyDueRosterChanges({ leagueId: lg.leagueId, week: 9 })).toBeNull()
    expect((await seen(lg)).engine).toMatchObject(LAYOUT)

    const run = await applyDueRosterChanges({ leagueId: lg.leagueId, week: 10 })
    expect(run).toMatchObject({ week: 10, resumed: false, skipped: [] })
    expect(run?.applied.map((c) => c.id)).toEqual(['w10sf', 'w10bn'])

    const s = await seen(lg)
    expect(s.engine).toMatchObject({ ...LAYOUT, SUPERFLEX: 1, BN: 7 })
    // Lineup validation reads the same roster the engine saved.
    expect([s.superflex, s.bench, s.maxRoster]).toEqual([1, 7, 18])
    // The Super Flex seat is new and empty, on the end; everyone is still drawn in his own seat.
    expect(s.labels).toEqual(['K', 'QB', 'RB1', 'RB2', 'TE', 'WR1', 'WR2', 'DEF', 'FLEX', 'SUPERFLEX'])
    expect(s.drawnIn).toEqual({ qb: 'QB', k: 'K', def: 'DEF' })
    expect(s.state).toEqual({ done: ['w10sf', 'w10bn'], skipped: [], pending: null })
    expect(s.events).toHaveLength(1)
    expect(edges.chat).toEqual([
      'Roster change for week 10: Add 1 Super Flex starting spot; Add 1 bench spot. Every team now has 10 starters, 7 bench. Check your lineup before the week locks.',
    ])
  })

  it('every later pass that week leaves the roster alone', async () => {
    const lg = await league()
    await saveRosterSchedule(lg.leagueId, lg.ownerId, THIRD_WR)
    await applyDueRosterChanges({ leagueId: lg.leagueId, week: 10 })
    for (let pass = 0; pass < 3; pass++) expect(await applyDueRosterChanges({ leagueId: lg.leagueId, week: 10 })).toBeNull()
    const s = await seen(lg)
    expect(s.engine).toMatchObject({ WR: 3, BN: 6 })
    // WR3 took position 7; the defense moved to 8 with its seat, once.
    expect(s.labels).toEqual(['K', 'QB', 'RB1', 'RB2', 'TE', 'WR1', 'WR2', 'WR3', 'DEF', 'FLEX'])
    expect(s.seats).toEqual({ qb: 1, k: 0, def: 8 })
    expect(s.drawnIn).toEqual({ qb: 'QB', k: 'K', def: 'DEF' })
    expect(s.events).toHaveLength(1)
    expect(edges.chat).toHaveLength(1)
  })

  it('two passes at the same moment change the roster once', async () => {
    const lg = await league()
    await saveRosterSchedule(lg.leagueId, lg.ownerId, THIRD_WR)
    const runs = await Promise.all([1, 2, 3].map(() => applyDueRosterChanges({ leagueId: lg.leagueId, week: 10 })))
    expect(runs.filter(Boolean)).toHaveLength(1)
    const s = await seen(lg)
    expect(s.engine).toMatchObject({ WR: 3, BN: 6 })
    expect(s.seats).toEqual({ qb: 1, k: 0, def: 8 })
    expect(s.events).toHaveLength(1)
  })

  it('a crash before the roster is written is finished by the next pass, once', async () => {
    const lg = await league()
    await saveRosterSchedule(lg.leagueId, lg.ownerId, THIRD_WR)
    edges.crash = 'before'
    await expect(applyDueRosterChanges({ leagueId: lg.leagueId, week: 10 })).rejects.toThrow('crash before')
    const mid = await seen(lg)
    expect(mid.engine).toMatchObject(LAYOUT)
    expect(mid.state.pending).toMatchObject({ week: 10, ids: ['w10wr'], slots: { WR: 3, BN: 6 } })
    expect(mid.seats).toEqual({ qb: 1, k: 0, def: 7 })

    edges.crash = null
    expect(await applyDueRosterChanges({ leagueId: lg.leagueId, week: 10 })).toMatchObject({ resumed: true })
    const s = await seen(lg)
    expect(s.engine).toMatchObject({ WR: 3, BN: 6 })
    expect(s.seats).toEqual({ qb: 1, k: 0, def: 8 })
    expect(s.state).toEqual({ done: ['w10wr'], skipped: [], pending: null })
  })

  it('a crash after the roster is written does not add the change a second time', async () => {
    const lg = await league()
    await saveRosterSchedule(lg.leagueId, lg.ownerId, THIRD_WR)
    edges.crash = 'after'
    await expect(applyDueRosterChanges({ leagueId: lg.leagueId, week: 10 })).rejects.toThrow('crash after')
    const mid = await seen(lg)
    // The roster is written, the seats are not moved yet, and the run is still on record.
    expect(mid.engine).toMatchObject({ WR: 3, BN: 6 })
    expect(mid.seats).toEqual({ qb: 1, k: 0, def: 7 })
    expect(mid.state.pending).not.toBeNull()

    edges.crash = null
    expect(await applyDueRosterChanges({ leagueId: lg.leagueId, week: 10 })).toMatchObject({ resumed: true })
    const s = await seen(lg)
    // Three receivers, not four: the recorded roster was written again, not the change added again.
    expect(s.engine).toMatchObject({ WR: 3, BN: 6 })
    // And the defense moved one seat, not two.
    expect(s.seats).toEqual({ qb: 1, k: 0, def: 8 })
    expect(s.drawnIn).toEqual({ qb: 'QB', k: 'K', def: 'DEF' })
    expect(s.events).toHaveLength(1)
    expect(await applyDueRosterChanges({ leagueId: lg.leagueId, week: 10 })).toBeNull()
  })

  /**
   * League.settings is one JSON value that many writers read, change and write back whole. One holding a copy
   * from before a run finished puts that run's record back and erases its "done". This happened in this very
   * test file before the event log became the record of what has run: three passes at once, and every seat
   * moved twice.
   */
  it('🛑 a stale settings write that brings a finished run back does not run it again', async () => {
    const lg = await league()
    await saveRosterSchedule(lg.leagueId, lg.ownerId, THIRD_WR)
    edges.crash = 'before'
    await applyDueRosterChanges({ leagueId: lg.leagueId, week: 10 }).catch(() => null)
    // The settings as they were mid-run: the record present, nothing done.
    const stale = (await prisma.league.findUniqueOrThrow({ where: { id: lg.leagueId }, select: { settings: true } })).settings as Record<string, unknown>
    expect(readRosterScheduleState(stale).pending).not.toBeNull()
    edges.crash = null
    await applyDueRosterChanges({ leagueId: lg.leagueId, week: 10 })
    expect((await seen(lg)).seats).toEqual({ qb: 1, k: 0, def: 8 })

    // A writer that read before the finish now writes its copy of the schedule state back.
    const now = (await prisma.league.findUniqueOrThrow({ where: { id: lg.leagueId }, select: { settings: true } })).settings as Record<string, unknown>
    await prisma.league.update({ where: { id: lg.leagueId }, data: { settings: { ...now, [ROSTER_SCHEDULE_STATE_KEY]: stale[ROSTER_SCHEDULE_STATE_KEY] } as object } })
    expect((await seen(lg)).state.pending).not.toBeNull()

    expect(await applyDueRosterChanges({ leagueId: lg.leagueId, week: 10 })).toBeNull()
    const s = await seen(lg)
    // Still three receivers, the defense still one seat down, one event; and the record is cleared again.
    expect(s.engine).toMatchObject({ WR: 3, BN: 6 })
    expect(s.seats).toEqual({ qb: 1, k: 0, def: 8 })
    expect(s.events).toHaveLength(1)
    expect(s.state).toEqual({ done: ['w10wr'], skipped: [], pending: null })
    expect(edges.chat).toHaveLength(1)
  })

  it('🛑 a stale settings write that erases "done" does not add the change again', async () => {
    const lg = await league()
    await saveRosterSchedule(lg.leagueId, lg.ownerId, THIRD_WR)
    await applyDueRosterChanges({ leagueId: lg.leagueId, week: 10 })
    const now = (await prisma.league.findUniqueOrThrow({ where: { id: lg.leagueId }, select: { settings: true } })).settings as Record<string, unknown>
    const { [ROSTER_SCHEDULE_STATE_KEY]: _gone, ...without } = now
    await prisma.league.update({ where: { id: lg.leagueId }, data: { settings: without as object } })

    expect(await applyDueRosterChanges({ leagueId: lg.leagueId, week: 10 })).toBeNull()
    expect(await applyDueRosterChanges({ leagueId: lg.leagueId, week: 12 })).toBeNull()
    const s = await seen(lg)
    expect(s.engine).toMatchObject({ WR: 3, BN: 6 })
    expect(s.seats).toEqual({ qb: 1, k: 0, def: 8 })
    expect(s.events).toHaveLength(1)
    // The rules page still shows it as done, not as something to edit.
    expect((await readRosterScheduleView(lg.leagueId))?.done).toEqual(['w10wr'])
  })

  it("a commissioner's own roster edit in between is kept, and the next change builds on it", async () => {
    const lg = await league()
    await saveRosterSchedule(lg.leagueId, lg.ownerId, [...WEEK_10, WEEK_11])
    await applyDueRosterChanges({ leagueId: lg.leagueId, week: 10 })
    // By hand, in the roster editor: the bench cut from 7 to 4.
    await writeLeagueRosterConfig(lg.leagueId, { templateKey: 'custom', slots: { ...LAYOUT, SUPERFLEX: 1, BN: 4 } }, { userId: lg.ownerId, auditAction: 'updated' })
    await applyDueRosterChanges({ leagueId: lg.leagueId, week: 11 })
    const s = await seen(lg)
    expect(s.engine).toMatchObject({ SUPERFLEX: 1, WR: 3, BN: 3 })
    expect([s.wr, s.bench]).toEqual([3, 3])
  })

  it('a change the roster can no longer take is skipped with its reason, and never retried', async () => {
    const lg = await league()
    await saveRosterSchedule(lg.leagueId, lg.ownerId, [WEEK_11])
    // By hand, after the schedule was saved: no bench left to turn into a starter.
    await writeLeagueRosterConfig(lg.leagueId, { templateKey: 'custom', slots: { ...LAYOUT, BN: 0 } }, { userId: lg.ownerId, auditAction: 'updated' })
    const run = await applyDueRosterChanges({ leagueId: lg.leagueId, week: 11 })
    expect(run?.applied).toEqual([])
    const why = 'the league has 0 bench spots, so 1 cannot become a starter.'
    expect(run?.skipped.map((s) => [s.change.id, s.reason])).toEqual([['w11wr', why]])
    const s = await seen(lg)
    expect(s.engine).toMatchObject({ WR: 2, BN: 0 })
    expect(s.state).toEqual({ done: ['w11wr'], skipped: [{ id: 'w11wr', reason: why }], pending: null })
    // The league is told, and the rules page will not call it done.
    expect(edges.chat).toEqual([`A roster change scheduled for week 11 was not made: Turn 1 bench spot into a Wide Receiver starting spot. Why: ${why}`])
    expect((await readRosterScheduleView(lg.leagueId))?.skipped).toEqual([{ id: 'w11wr', reason: why }])
    expect(await applyDueRosterChanges({ leagueId: lg.leagueId, week: 12 })).toBeNull()
  })

  it('a change that has run is history: a save can neither edit nor remove it', async () => {
    const lg = await league()
    await saveRosterSchedule(lg.leagueId, lg.ownerId, WEEK_10)
    await applyDueRosterChanges({ leagueId: lg.leagueId, week: 10 })
    await prisma.redraftSeason.updateMany({ where: { leagueId: lg.leagueId }, data: { currentWeek: 10 } })
    const saved = await saveRosterSchedule(lg.leagueId, lg.ownerId, [{ ...WEEK_10[0], count: 2 }, WEEK_11])
    expect(saved.ok).toBe(true)
    const view = await readRosterScheduleView(lg.leagueId)
    expect(view?.changes.map((c) => [c.id, c.count])).toEqual([['w10sf', 1], ['w10bn', 1], ['w11wr', 1]])
    expect(view?.done).toEqual(['w10sf', 'w10bn'])
    // And clearing the list keeps the history.
    await saveRosterSchedule(lg.leagueId, lg.ownerId, [])
    expect((await readRosterScheduleView(lg.leagueId))?.changes.map((c) => c.id)).toEqual(['w10sf', 'w10bn'])
  })

  it('a save is refused while a run is half way through', async () => {
    const lg = await league()
    await saveRosterSchedule(lg.leagueId, lg.ownerId, WEEK_10)
    edges.crash = 'before'
    await applyDueRosterChanges({ leagueId: lg.leagueId, week: 10 }).catch(() => null)
    expect(await saveRosterSchedule(lg.leagueId, lg.ownerId, [WEEK_11])).toMatchObject({ ok: false, error: 'busy' })
  })

  describe('"week 7 a starter is taken away"', () => {
    const TAKE_FLEX = [{ id: 'w7flex', week: 7, kind: 'starter_to_bench', slot: 'FLEX', count: 1 }]
    const ALL = ['def', 'flex', 'k', 'qb', 'rb1', 'rb2', 'te', 'wr1', 'wr2']
    const WITHOUT_FLEX = ALL.filter((id) => id !== 'flex')

    it('the fixture team starts as a full, legal lineup that scores nine starters', async () => {
      const lg = await league()
      const t = await team(lg)
      const s = await t.read()
      expect(s.starters).toHaveLength(9)
      expect(s.drawnIn).toEqual(Object.fromEntries(LINEUP.map((p, i) => [p.id, SEATS[i]])))
      expect(await s.scoringStarters(6)).toEqual(ALL)
      expect(s.savedWeeks).toEqual([])
    })

    it('waits while a week is being played, then runs between weeks', async () => {
      const lg = await league()
      const t = await team(lg)
      expect(await saveRosterSchedule(lg.leagueId, lg.ownerId, TAKE_FLEX)).toMatchObject({ ok: true })

      // Week 7 has arrived with a game already under way: nobody is moved, and nothing is marked done.
      expect(await applyDueRosterChanges({ leagueId: lg.leagueId, week: 7, betweenWeeks: false })).toBeNull()
      expect((await seen(lg)).engine).toMatchObject(LAYOUT)
      expect((await t.read()).starters).toHaveLength(9)
      expect((await seen(lg)).state.done).toEqual([])

      // Week 6 is over and week 7 has not started.
      const run = await applyDueRosterChanges({ leagueId: lg.leagueId, week: 7, betweenWeeks: true })
      expect(run?.applied.map((c) => c.id)).toEqual(['w7flex'])
      expect(run?.benched).toEqual([{ rosterId: t.rosterId, players: [{ id: t.pid('flex'), name: 'flex name' }] }])
      expect(run?.benchFailures).toEqual([])
      expect((await seen(lg)).engine).toMatchObject({ ...LAYOUT, FLEX: 0, BN: 7 })
    })

    it('the player in the Flex seat is benched everywhere a lineup is read', async () => {
      const lg = await league()
      const t = await team(lg)
      await saveRosterSchedule(lg.leagueId, lg.ownerId, TAKE_FLEX)
      await applyDueRosterChanges({ leagueId: lg.leagueId, week: 7, betweenWeeks: true })
      const s = await t.read()
      // The lineup screen.
      expect(s.starters.sort()).toEqual(WITHOUT_FLEX)
      expect(s.bench).toContain('flex')
      // Everyone else is still drawn in his own seat.
      expect(s.drawnIn).toEqual({ k: 'K', qb: 'QB', rb1: 'RB1', rb2: 'RB2', te: 'TE', wr1: 'WR1', wr2: 'WR2', def: 'DEF' })
      // Scoring's current state, and week 7's own record.
      expect(s.scoringSlots.flex).toBe('bench')
      expect(await s.scoringStarters(7)).toEqual(WITHOUT_FLEX)
      // Told once, by name; and the league is told a player moved.
      expect(edges.notified).toEqual([{ userIds: [t.userId], type: 'guillotine_roster_change_benched', body: 'flex name moved to your bench: the league took away a starting spot this week. Set your lineup before it locks.' }])
      expect(edges.chat).toEqual([
        'Roster change for week 7: Take away 1 Flex starting spot. Every team now has 8 starters, 7 bench. The player in a spot that was taken away moved to the bench. Check your lineup before the week locks.',
      ])
    })

    it('🛑 the week just played still scores him: his points are not taken back', async () => {
      const lg = await league()
      const t = await team(lg)
      await saveRosterSchedule(lg.leagueId, lg.ownerId, TAKE_FLEX)
      // This team never saved a lineup for week 6, so week 6 is scored from its current slots.
      expect((await t.read()).savedWeeks).toEqual([])
      await applyDueRosterChanges({ leagueId: lg.leagueId, week: 7, betweenWeeks: true })
      const s = await t.read()
      // Week 6 was written down before he was moved, so its chop, which can run a day later, still counts him.
      expect(s.savedWeeks).toEqual([6, 7])
      expect(await s.scoringStarters(6)).toEqual(ALL)
      expect(await s.scoringStarters(7)).toEqual(WITHOUT_FLEX)
    })

    it('a lineup already saved for the week just played is left exactly as saved', async () => {
      const lg = await league()
      const t = await team(lg)
      // In week 6 this manager had benched the tight end and saved it.
      await prisma.afRosterLineupAssignment.createMany({
        data: [...LINEUP, { id: 'bn1', position: 'WR' }].map((p, i) => ({ leagueId: lg.leagueId, rosterId: t.rosterId, season: SEASON, week: 6, section: p.id === 'te' || p.id === 'bn1' ? 'bench' : 'starters', slotIndex: i, playerId: t.pid(p.id) })),
      })
      await saveRosterSchedule(lg.leagueId, lg.ownerId, TAKE_FLEX)
      await applyDueRosterChanges({ leagueId: lg.leagueId, week: 7, betweenWeeks: true })
      expect(await (await t.read()).scoringStarters(6)).toEqual(ALL.filter((id) => id !== 'te'))
    })

    it('an empty Flex seat taken away moves nobody', async () => {
      const lg = await league()
      const t = await team(lg, { starters: WITHOUT_FLEX })
      await saveRosterSchedule(lg.leagueId, lg.ownerId, TAKE_FLEX)
      const run = await applyDueRosterChanges({ leagueId: lg.leagueId, week: 7, betweenWeeks: true })
      expect(run?.benched).toEqual([])
      expect((await t.read()).starters.sort()).toEqual(WITHOUT_FLEX)
      expect(edges.notified).toEqual([])
    })

    it('every later pass leaves the lineup alone', async () => {
      const lg = await league()
      const t = await team(lg)
      await saveRosterSchedule(lg.leagueId, lg.ownerId, TAKE_FLEX)
      await applyDueRosterChanges({ leagueId: lg.leagueId, week: 7, betweenWeeks: true })
      const first = await t.read()
      for (const between of [true, false, true]) expect(await applyDueRosterChanges({ leagueId: lg.leagueId, week: 7, betweenWeeks: between })).toBeNull()
      const again = await t.read()
      expect(again.starters).toEqual(first.starters)
      expect(again.bench).toEqual(first.bench)
      expect(again.drawnIn).toEqual(first.drawnIn)
      expect(edges.notified).toHaveLength(1)
    })

    it('a crash after the roster is written still benches him once, and keeps week 6', async () => {
      const lg = await league()
      const t = await team(lg)
      await saveRosterSchedule(lg.leagueId, lg.ownerId, TAKE_FLEX)
      edges.crash = 'after'
      await expect(applyDueRosterChanges({ leagueId: lg.leagueId, week: 7, betweenWeeks: true })).rejects.toThrow('crash after')
      // The spot is gone and he is still starting: exactly the state that must not last.
      expect((await seen(lg)).engine).toMatchObject({ FLEX: 0, BN: 7 })
      expect((await t.read()).starters).toHaveLength(9)

      edges.crash = null
      const run = await applyDueRosterChanges({ leagueId: lg.leagueId, week: 7, betweenWeeks: true })
      expect(run).toMatchObject({ resumed: true })
      const s = await t.read()
      expect(s.starters.sort()).toEqual(WITHOUT_FLEX)
      expect(s.bench.filter((id) => id === 'flex')).toHaveLength(1)
      expect(await s.scoringStarters(6)).toEqual(ALL)
      expect(s.drawnIn).toEqual({ k: 'K', qb: 'QB', rb1: 'RB1', rb2: 'RB2', te: 'TE', wr1: 'WR1', wr2: 'WR2', def: 'DEF' })
    })

    it('a second back loses his seat when RB goes from two to one', async () => {
      const lg = await league()
      const t = await team(lg)
      await saveRosterSchedule(lg.leagueId, lg.ownerId, [{ id: 'w7rb', week: 7, kind: 'starter_to_bench', slot: 'RB', count: 1 }])
      const run = await applyDueRosterChanges({ leagueId: lg.leagueId, week: 7, betweenWeeks: true })
      expect(run?.benched.flatMap((b) => b.players.map((p) => p.name))).toEqual(['rb2 name'])
      const s = await t.read()
      expect(s.drawnIn).toEqual({ k: 'K', qb: 'QB', rb1: 'RB', te: 'TE', wr1: 'WR1', wr2: 'WR2', def: 'DEF', flex: 'FLEX' })
      expect(await s.scoringStarters(7)).toEqual(ALL.filter((id) => id !== 'rb2'))
    })

    it('a best ball league has no saved starter to move: the layout changes and that is all', async () => {
      const lg = await league({ bestBall: true })
      const t = await team(lg)
      await saveRosterSchedule(lg.leagueId, lg.ownerId, TAKE_FLEX)
      const run = await applyDueRosterChanges({ leagueId: lg.leagueId, week: 7, betweenWeeks: true })
      expect(run?.applied.map((c) => c.id)).toEqual(['w7flex'])
      expect(run?.benched).toEqual([])
      expect((await seen(lg)).engine).toMatchObject({ FLEX: 0, BN: 7 })
      expect(edges.notified).toEqual([])
      expect((await t.read()).savedWeeks).toEqual([])
    })
  })

  it('never touches an imported league', async () => {
    const lg = await league({ platform: 'sleeper' })
    // Written straight to settings: the save route refuses an imported league before it gets this far.
    const row = await prisma.league.findUniqueOrThrow({ where: { id: lg.leagueId }, select: { settings: true } })
    await prisma.league.update({ where: { id: lg.leagueId }, data: { settings: { ...(row.settings as object), guillotineRosterSchedule: WEEK_10 } } })
    expect(await applyDueRosterChanges({ leagueId: lg.leagueId, week: 12 })).toBeNull()
    const s = await seen(lg)
    expect(s.engine).toMatchObject(LAYOUT)
    expect((await prisma.league.findUniqueOrThrow({ where: { id: lg.leagueId }, select: { settings: true } })).settings).not.toHaveProperty(ROSTER_SCHEDULE_STATE_KEY)
  })
})
