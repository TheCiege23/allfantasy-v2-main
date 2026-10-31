import { beforeEach, describe, expect, it, vi } from 'vitest'

/*
 * Late-start native guillotine seats: the seat math, the scheduled-draft plan, the roll, and the
 * one seat remover. Prisma is an in-memory fake; nothing here touches a database.
 */

type Row = Record<string, any>
const db = vi.hoisted(() => ({
  league: null as Row | null,
  settings: null as Row | null,
  rosters: [] as Row[],
  users: new Set<string>(),
  teams: [] as Row[],
  slots: [] as Row[],
  members: [] as Row[],
  session: null as Row | null,
  picks: 0,
  notifications: new Set<string>(),
  config: null as Row | null,
  dispatch: [] as Row[],
}))

const fake = vi.hoisted(() => {
  const inIds = (where: Row | undefined, key: string, value: unknown) => {
    const cond = where?.[key]
    if (cond && typeof cond === 'object' && Array.isArray(cond.in)) return cond.in.includes(value)
    return cond === undefined || cond === value
  }
  const p: Row = {
    league: {
      findUnique: async () => (db.league ? { ...db.league } : null),
      update: async ({ data }: Row) => { Object.assign(db.league!, data); return db.league },
    },
    leagueSettings: {
      findUnique: async () => (db.settings ? { ...db.settings } : null),
      updateMany: async ({ where, data }: Row) => {
        if (!db.settings || db.settings.draftDateUtc?.getTime() !== where.draftDateUtc?.getTime()) return { count: 0 }
        Object.assign(db.settings, data)
        return { count: 1 }
      },
      update: async ({ data }: Row) => { Object.assign(db.settings!, data); return db.settings },
    },
    roster: {
      findMany: async () => db.rosters.map((r) => ({ ...r })),
      count: async () => db.rosters.length,
      deleteMany: async ({ where }: Row) => {
        const before = db.rosters.length
        db.rosters = db.rosters.filter((r) => !inIds(where, 'id', r.id))
        return { count: before - db.rosters.length }
      },
    },
    appUser: { findMany: async ({ where }: Row) => [...db.users].filter((id) => where.id.in.includes(id)).map((id) => ({ id })) },
    leagueTeam: {
      findMany: async () => db.teams.map((t) => ({ ...t })),
      deleteMany: async ({ where }: Row) => { db.teams = db.teams.filter((t) => !inIds(where, 'externalId', t.externalId)); return { count: 0 } },
    },
    leagueEntrySlot: {
      findMany: async () => db.slots.map((s) => ({ ...s })),
      deleteMany: async ({ where }: Row) => { db.slots = db.slots.filter((s) => !inIds(where, 'rosterId', s.rosterId)); return { count: 0 } },
      update: async ({ where, data }: Row) => {
        const row = db.slots.find((s) => s.id === where.id)!
        if (db.slots.some((s) => s !== row && s.slotNumber === data.slotNumber)) throw new Error('unique (leagueId, slotNumber)')
        Object.assign(row, data)
        return row
      },
    },
    redraftLeagueMember: {
      updateMany: async ({ where, data }: Row) => {
        for (const m of db.members) if (m.teamNumber === where.teamNumber) Object.assign(m, data)
        return { count: 0 }
      },
    },
    draftSession: {
      findFirst: async () => (db.session ? { ...db.session } : null),
      update: async ({ data }: Row) => { Object.assign(db.session!, data); return db.session },
    },
    draftPick: { count: async () => db.picks },
    platformNotification: { findUnique: async ({ where }: Row) => (db.notifications.has(where.sourceKey) ? { id: 'n' } : null) },
    sportsGame: { findMany: async () => [] },
  }
  p.$transaction = async (fn: (tx: Row) => unknown) => fn(p)
  return p
})

vi.mock('@/lib/prisma', () => ({ prisma: fake }))
vi.mock('@/lib/guillotine/GuillotineLeagueConfig', () => ({
  getGuillotineConfig: async () => db.config,
  DEFAULT_END_WEEK_BY_SPORT: { NFL: 18, NBA: 24 },
}))
vi.mock('@/lib/notifications/NotificationDispatcher', () => ({
  dispatchNotification: async (args: Row) => {
    db.dispatch.push(args)
    db.notifications.add(`${args.dedupePrefix}:${args.userIds[0]}`)
  },
}))

import {
  decideGuillotineSeats,
  formatGuillotineSeatLine,
  guillotineChopWindow,
  rollDraftDateOneWeek,
} from '@/lib/guillotine/lateStartSeatMath'
import {
  guillotineFantasyWeekAt,
  holdGuillotineScheduledDraft,
  loadGuillotineSeatState,
  planGuillotineScheduledDraft,
  prepareGuillotineSeatsForStart,
  resolveGuillotineSeatSummary,
} from '@/lib/guillotine/lateStartSeats'

const LEAGUE = '9626adca-bda9-4be6-9f24-0737f36841da'
/** Mon Oct 19 2026 00:00Z = Sun Oct 18, 8pm EDT — the real league's scheduled draft. */
const DRAFT = new Date('2026-10-19T00:00:00.000Z')

/** A native NBA guillotine league with `size` seats, the first `claimed` held by people. */
function seed(size: number, claimed: number, draftAt: Date = DRAFT) {
  db.league = {
    id: LEAGUE, name: 'The Ciege NBA Guilly', userId: 'commish', sport: 'NBA', season: 2026, leagueSize: size,
    platform: 'manual', guillotineMode: true, leagueVariant: 'guillotine', survivorMode: false,
  }
  db.settings = { draftDateUtc: draftAt, timezone: 'America/New_York', draftOrderSlots: null }
  db.config = { eliminationStartWeek: 10, eliminationEndWeek: 24, teamsPerChop: 1 }
  db.users = new Set()
  db.rosters = []
  db.teams = []
  db.slots = []
  db.members = []
  for (let n = 1; n <= size; n++) {
    const person = n <= claimed ? (n === 1 ? 'commish' : `user-${n}`) : null
    if (person) db.users.add(person)
    db.rosters.push({ id: `r${n}`, platformUserId: person ?? `open-slot-${LEAGUE}-${n}` })
    db.teams.push({ id: `t${n}`, externalId: `r${n}`, claimedByUserId: person })
    db.slots.push({ id: `s${n}`, slotNumber: n, rosterId: `r${n}` })
    if (person) db.members.push({ userId: person, teamNumber: n })
  }
  db.session = {
    id: 'sess', status: 'pre_draft', teamCount: size,
    slotOrder: db.rosters.map((r, i) => ({ slot: i + 1, rosterId: r.id, displayName: `Team ${i + 1}` })),
  }
  db.picks = 0
  db.notifications = new Set()
  db.dispatch = []
}

describe('seat math: chop weeks left × teams per chop + 1', () => {
  it.each([
    // [draftWeek, firstChop, chopWeeks, maxTeams] for start 10, end 24, 1 per chop
    [0, 10, 15, 16],
    [1, 10, 15, 16],
    [9, 10, 15, 16],
    [10, 11, 14, 15],
    [15, 16, 9, 10],
    [21, 22, 3, 4],
    [22, 23, 2, 3],
    [24, 25, 0, 1],
  ])('draft in week %i -> first chop %i, %i chop weeks, %i teams', (draftWeek, first, weeks, max) => {
    expect(guillotineChopWindow({ eliminationStartWeek: 10, eliminationEndWeek: 24, teamsPerChop: 1, draftWeek }))
      .toEqual({ draftWeek, firstChopWeek: first, chopWeeks: weeks, maxTeams: max })
  })
  it('multiplies by teams per chop', () => {
    expect(guillotineChopWindow({ eliminationStartWeek: 1, eliminationEndWeek: 18, teamsPerChop: 2, draftWeek: 5 }).maxTeams).toBe(13 * 2 + 1)
  })
  it('caps at the configured size, never below claimed, with a floor of 4', () => {
    expect(decideGuillotineSeats({ configuredSize: 16, claimed: 2, maxTeams: 15 })).toMatchObject({ seats: 15, belowFloor: false, claimedExceedsSupported: false })
    expect(decideGuillotineSeats({ configuredSize: 12, claimed: 2, maxTeams: 16 }).seats).toBe(12)
    expect(decideGuillotineSeats({ configuredSize: 16, claimed: 9, maxTeams: 7 })).toMatchObject({ seats: 9, supportedSeats: 7, claimedExceedsSupported: true })
    expect(decideGuillotineSeats({ configuredSize: 16, claimed: 2, maxTeams: 3 })).toMatchObject({ seats: 3, belowFloor: true })
    expect(decideGuillotineSeats({ configuredSize: 16, claimed: 2, maxTeams: 4 }).belowFloor).toBe(false)
  })
})

describe('draft dates and fantasy weeks', () => {
  it('rolls a week keeping the weekday and the ET wall-clock time across daylight saving', () => {
    expect(rollDraftDateOneWeek(DRAFT).toISOString()).toBe('2026-10-26T00:00:00.000Z')
    // Mon Oct 26, 8pm EDT -> Mon Nov 2, 8pm EST (one UTC hour later).
    expect(rollDraftDateOneWeek(new Date('2026-10-27T00:00:00.000Z')).toISOString()).toBe('2026-11-03T01:00:00.000Z')
  })
  it('reads NBA weeks as Tuesday-to-Monday Eastern from the Oct 20 opener', async () => {
    expect(await guillotineFantasyWeekAt('NBA', 2026, DRAFT)).toBe(0)
    expect(await guillotineFantasyWeekAt('NBA', 2026, new Date('2026-10-20T02:00:00Z'))).toBe(0) // Mon Oct 19 10pm ET
    expect(await guillotineFantasyWeekAt('NBA', 2026, new Date('2026-10-26T00:00:00Z'))).toBe(1)
    expect(await guillotineFantasyWeekAt('NBA', 2026, new Date('2026-10-27T00:00:00Z'))).toBe(1) // Mon Oct 26 8pm ET
    expect(await guillotineFantasyWeekAt('NBA', 2026, new Date('2026-12-29T01:00:00Z'))).toBe(10) // Mon Dec 28 8pm ET
  })
  it('returns null when the calendar does not know the season', async () => {
    expect(await guillotineFantasyWeekAt('NBA', 2031, DRAFT)).toBeNull()
  })
})

describe('the real league, 9626adca (16 seats, 2 claimed, draft Oct 19 00:00Z, chops weeks 10-24)', () => {
  beforeEach(() => seed(16, 2))
  it('is not full at draft time, so it rolls to Oct 26 and keeps 16 seats (week 1, first chop still 10)', async () => {
    const state = (await loadGuillotineSeatState(LEAGUE))!
    expect(state).toMatchObject({ configuredSize: 16, claimed: 2, eliminationStartWeek: 10, eliminationEndWeek: 24 })
    const plan = await planGuillotineScheduledDraft(state)
    expect(plan).toMatchObject({ action: 'roll', seats: 16, claimed: 2 })
    expect((plan as { to: Date }).to.toISOString()).toBe('2026-10-26T00:00:00.000Z')
  })
  it('summarises the line the league and invite pages show', async () => {
    const summary = (await resolveGuillotineSeatSummary(LEAGUE, new Date('2026-10-18T12:00:00Z')))!
    expect(summary).toMatchObject({ claimed: 2, seats: 16, draftAt: DRAFT.toISOString(), ifNotFull: { seats: 16 } })
    expect(formatGuillotineSeatLine(summary)).toBe('2 of 16 spots filled. Draft Sun Oct 18, 8pm ET. If not full, it moves a week.')
  })
})

describe('the scheduled draft', () => {
  it('a full league starts with no seat removed', async () => {
    seed(16, 16)
    const plan = await planGuillotineScheduledDraft((await loadGuillotineSeatState(LEAGUE))!)
    expect(plan).toMatchObject({ action: 'start', shrinkTo: null })
  })

  it('not full: rolls one week, removes only unclaimed seats, and notifies once', async () => {
    // Draft Mon Dec 28 8pm ET (week 10) -> first chop 11 -> 15 seats; rolled to week 11 -> 14 seats.
    seed(16, 5, new Date('2026-12-29T01:00:00Z'))
    const state = (await loadGuillotineSeatState(LEAGUE))!
    const plan = await planGuillotineScheduledDraft(state)
    expect(plan).toMatchObject({ action: 'roll', seats: 14 })
    expect(await holdGuillotineScheduledDraft(state, plan as never)).toBe('rolled')

    expect(db.settings!.draftDateUtc.toISOString()).toBe('2027-01-05T01:00:00.000Z')
    expect(db.league!.leagueSize).toBe(14)
    expect(db.rosters.map((r) => r.id)).toEqual(['r1', 'r2', 'r3', 'r4', 'r5', 'r6', 'r7', 'r8', 'r9', 'r10', 'r11', 'r12', 'r13', 'r14'])
    expect(db.teams).toHaveLength(14)
    expect(db.slots.map((s) => s.slotNumber).sort((a, b) => a - b)).toEqual([...Array(14)].map((_, i) => i + 1))
    expect(db.session).toMatchObject({ teamCount: 14 })
    expect(db.session!.slotOrder).toHaveLength(14)
    expect(db.dispatch).toHaveLength(1)
    expect(db.dispatch[0]).toMatchObject({ category: 'commissioner_alerts', userIds: ['commish'] })
    expect(db.dispatch[0].body).toBe('Draft moved to Mon Jan 4, 8pm ET: 5/16 filled. Seats now 14.')

    // A second tick (or the other worker replica) holding the stale plan rolls nothing and says nothing.
    expect(await holdGuillotineScheduledDraft(state, plan as never)).toBe('raced')
    expect(db.dispatch).toHaveLength(1)
  })

  it('never drops a claimed seat, even one numbered above the new size', async () => {
    seed(16, 3, new Date('2026-12-29T01:00:00Z'))
    // Seat 16 is claimed; seats 4-15 are open.
    db.users.add('late-joiner')
    db.rosters[15].platformUserId = 'late-joiner'
    db.teams[15].claimedByUserId = 'late-joiner'
    db.members.push({ userId: 'late-joiner', teamNumber: 16 })
    const state = (await loadGuillotineSeatState(LEAGUE))!
    expect(await holdGuillotineScheduledDraft(state, (await planGuillotineScheduledDraft(state)) as never)).toBe('rolled')
    expect(db.rosters.map((r) => r.id)).toContain('r16')
    expect(db.rosters.map((r) => r.platformUserId).filter((id) => !id.startsWith('open-slot-')).sort())
      .toEqual(['commish', 'late-joiner', 'user-2', 'user-3'])
    expect(db.slots.find((s) => s.rosterId === 'r16')!.slotNumber).toBeLessThanOrEqual(14)
    expect(db.members.find((m) => m.userId === 'late-joiner')!.teamNumber).toBeLessThanOrEqual(14)
  })

  it('full at the reduced count: removes the unclaimed seats above it and starts', async () => {
    seed(16, 15, new Date('2026-12-29T01:00:00Z')) // week 10 -> 15 seats, 15 claimed
    const state = (await loadGuillotineSeatState(LEAGUE))!
    const plan = await planGuillotineScheduledDraft(state)
    expect(plan).toMatchObject({ action: 'start', shrinkTo: 15 })
    expect(await prepareGuillotineSeatsForStart(state, plan as never)).toMatchObject({ ok: true, removed: ['r16'], leagueSize: 15 })
    expect(db.rosters).toHaveLength(15)
    expect(db.dispatch).toHaveLength(0)
  })

  it('more claimed than can be chopped: the claimed count wins and the commissioner is warned', async () => {
    // Week 20 draft (Mon Mar 8 8pm ET) -> first chop 21 -> 4 chop weeks -> 5 seats supported; 9 claimed.
    seed(16, 9, new Date('2027-03-09T01:00:00Z'))
    const state = (await loadGuillotineSeatState(LEAGUE))!
    const plan = await planGuillotineScheduledDraft(state)
    expect(plan).toMatchObject({ action: 'start', seats: 9, shrinkTo: 9, claimedExceedsSupported: true, supportedSeats: 5 })
    expect(await prepareGuillotineSeatsForStart(state, plan as never)).toMatchObject({ ok: true, leagueSize: 9 })
    expect(db.rosters.map((r) => r.platformUserId).every((id) => !id.startsWith('open-slot-'))).toBe(true)
    expect(db.dispatch).toHaveLength(1)
    expect(db.dispatch[0].type).toBe('guillotine_claimed_exceeds_chops')
  })

  it('below the floor of 4 it neither starts nor rolls, and says so once', async () => {
    // Week 22 draft (Mon Mar 22 8pm ET) -> first chop 23 -> 2 chop weeks -> 3 seats.
    seed(16, 2, new Date('2027-03-23T00:00:00Z'))
    const state = (await loadGuillotineSeatState(LEAGUE))!
    const plan = await planGuillotineScheduledDraft(state)
    expect(plan).toMatchObject({ action: 'blocked_floor' })
    expect(await holdGuillotineScheduledDraft(state, plan as never)).toBe('blocked')
    expect(await holdGuillotineScheduledDraft(state, plan as never)).toBe('blocked')
    expect(db.settings!.draftDateUtc.toISOString()).toBe('2027-03-23T00:00:00.000Z')
    expect(db.rosters).toHaveLength(16)
    expect(db.dispatch).toHaveLength(1)
    expect(db.dispatch[0].body).toContain('at least 4 teams')
  })

  it('refuses to remove seats once the draft has picks', async () => {
    seed(16, 15, new Date('2026-12-29T01:00:00Z'))
    db.picks = 1
    const state = (await loadGuillotineSeatState(LEAGUE))!
    expect(await prepareGuillotineSeatsForStart(state, (await planGuillotineScheduledDraft(state)) as never))
      .toEqual({ ok: false, reason: 'draft_has_picks' })
    expect(db.rosters).toHaveLength(16)
  })

  it('leaves every other league alone', async () => {
    seed(16, 2)
    db.league = { ...db.league!, guillotineMode: false, leagueVariant: 'redraft' }
    expect(await loadGuillotineSeatState(LEAGUE)).toBeNull()
    db.league = { ...db.league!, guillotineMode: true, leagueVariant: 'guillotine', platform: 'sleeper' }
    expect(await loadGuillotineSeatState(LEAGUE)).toBeNull()
    db.league = { ...db.league!, platform: 'manual', survivorMode: true }
    expect(await loadGuillotineSeatState(LEAGUE)).toBeNull()
    expect(await resolveGuillotineSeatSummary(LEAGUE)).toBeNull()
  })
})

describe('guillotineChopWindow — a final-stage ending needs its final weeks (2026-10-29)', () => {
  it('final two: chops end three weeks early and two teams are left', async () => {
    const { guillotineChopWindow } = await import('@/lib/guillotine/lateStartSeatMath')
    const base = { eliminationStartWeek: 1, eliminationEndWeek: 18, teamsPerChop: 1, draftWeek: 0 }
    expect(guillotineChopWindow(base)).toMatchObject({ chopWeeks: 18, maxTeams: 19 })
    expect(guillotineChopWindow({ ...base, endgame: { threshold: 1, cumulativePeriods: 0 } })).toMatchObject({ chopWeeks: 18, maxTeams: 19 })
    // Chops in weeks 1–15 leave 2 teams; the final runs weeks 16–18.
    expect(guillotineChopWindow({ ...base, endgame: { threshold: 2, cumulativePeriods: 3 } })).toMatchObject({ chopWeeks: 15, maxTeams: 17 })
    expect(guillotineChopWindow({ ...base, endgame: { threshold: 4, cumulativePeriods: 3 }, draftWeek: 10 })).toMatchObject({ firstChopWeek: 11, chopWeeks: 5, maxTeams: 9 })
  })
})

describe('the seat count reads the league endgame (2026-10-29)', () => {
  it('final two leaves room for its three final weeks: 14 seats where last team standing has 16', async () => {
    seed(16, 2)
    const lastTeam = (await resolveGuillotineSeatSummary(LEAGUE, new Date('2026-10-18T12:00:00Z')))!
    expect(lastTeam.seats).toBe(16)
    db.league = { ...db.league!, guillotineEndgame: 'final_two' }
    const state = (await loadGuillotineSeatState(LEAGUE))!
    expect(state.endgame).toEqual({ format: 'final_two', threshold: 2, cumulativePeriods: 3 })
    // Chops in weeks 10–21 (12 teams) leave 2 for the final in weeks 22–24.
    const finalTwo = (await resolveGuillotineSeatSummary(LEAGUE, new Date('2026-10-18T12:00:00Z')))!
    expect(finalTwo.seats).toBe(14)
  })
})
