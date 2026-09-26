/**
 * One seat, five records. `assignLeagueSeat` / `releaseLeagueSeat` must move all of them together,
 * and `countSeatsHeldByPeople` must count people rather than rosters.
 *
 * What each case guards, from the 2026-09-24 membership audit:
 *   - every invite code into a native league answered "League is full": the count excluded only
 *     `orphan-*` rosters, and a native league has an `open-slot-*` roster for every open seat;
 *   - a draft-room claim or commissioner assignment set only `Roster.platformUserId`, so after the
 *     draft the manager got 403 on their own team (the redraft routes check the team claim);
 *   - a seat taken after the draft never reached `RedraftRoster.ownerId`;
 *   - removing a manager only renamed the roster owner, leaving their claim and membership;
 *   - a new holder inherited the team's commissioner flag, which `getLeagueRole` trusts.
 */
import { describe, expect, it } from 'vitest'

import { assignLeagueSeat, countSeatsHeldByPeople, releaseLeagueSeat } from '@/lib/league/leagueSeats'

type Row = Record<string, any>

function matches(row: Row, where: Row | undefined): boolean {
  if (!where) return true
  return Object.entries(where).every(([key, cond]) => {
    if (key === 'NOT') return !matches(row, cond as Row)
    if (key === 'leagueId_userId') return row.leagueId === cond.leagueId && row.userId === cond.userId
    if (cond && typeof cond === 'object' && !Array.isArray(cond)) {
      if ('in' in cond) return (cond.in as unknown[]).includes(row[key])
      if ('not' in cond) return row[key] !== cond.not
    }
    return row[key] === cond
  })
}

function table(rows: Row[]) {
  return {
    rows,
    findUnique: async ({ where }: { where: Row }) => rows.find((r) => matches(r, where)) ?? null,
    findFirst: async ({ where }: { where?: Row }) => rows.find((r) => matches(r, where)) ?? null,
    findMany: async ({ where }: { where?: Row } = {}) => rows.filter((r) => matches(r, where)),
    update: async ({ where, data }: { where: Row; data: Row }) => {
      const row = rows.find((r) => matches(r, where))
      if (!row) throw new Error(`no row for ${JSON.stringify(where)}`)
      Object.assign(row, data)
      return row
    },
    updateMany: async ({ where, data }: { where: Row; data: Row }) => {
      const hit = rows.filter((r) => matches(r, where))
      hit.forEach((r) => Object.assign(r, data))
      return { count: hit.length }
    },
    deleteMany: async ({ where }: { where: Row }) => {
      const keep = rows.filter((r) => !matches(r, where))
      const count = rows.length - keep.length
      rows.splice(0, rows.length, ...keep)
      return { count }
    },
    upsert: async ({ where, create, update }: { where: Row; create: Row; update: Row }) => {
      const row = rows.find((r) => matches(r, where))
      if (row) return Object.assign(row, update)
      // The real table is unique on (leagueId, userId); a second insert would abort the txn.
      if (rows.some((r) => r.leagueId === create.leagueId && r.userId === create.userId)) {
        throw new Error('P2002 unique violation')
      }
      rows.push({ ...create })
      return create
    },
  }
}

function nativeLeague() {
  const db = {
    league: table([{ id: 'L', platform: 'manual', userId: 'commish' }]),
    appUser: table([
      { id: 'commish', username: 'commish' },
      { id: 'amy', username: 'amy' },
      { id: 'ben', username: 'ben' },
    ]),
    userProfile: table([{ userId: 'amy', displayName: 'Amy' }, { userId: 'ben', displayName: 'Ben' }]),
    roster: table([
      { id: 'r1', leagueId: 'L', platformUserId: 'commish', playerData: {}, settings: { commissioner: true } },
      ...[2, 3, 4].map((n) => ({
        id: `r${n}`,
        leagueId: 'L',
        platformUserId: `open-slot-L-${n}`,
        playerData: { foundation: { slotNumber: n, openTeam: true } },
        settings: { openSlot: true, aiManaged: false },
      })),
    ]),
    leagueTeam: table([
      { id: 't1', leagueId: 'L', externalId: 'r1', claimedByUserId: 'commish', platformUserId: 'commish', isCommissioner: true, isCoCommissioner: false, role: 'commissioner', isOrphan: false, teamName: "Commish's Team" },
      ...[2, 3, 4].map((n) => ({
        id: `t${n}`, leagueId: 'L', externalId: `r${n}`, claimedByUserId: null, platformUserId: `open-slot-L-${n}`,
        isCommissioner: false, isCoCommissioner: false, role: 'member', isOrphan: true, teamName: `Open Team ${n}`,
      })),
    ]),
    leagueEntrySlot: table([1, 2, 3, 4].map((n) => ({ id: `s${n}`, leagueId: 'L', slotNumber: n, rosterId: `r${n}`, status: n === 1 ? 'FILLED' : 'OPEN' }))),
    redraftLeagueMember: table([{ leagueId: 'L', userId: 'commish', role: 'COMMISSIONER', teamNumber: 1 }]),
    redraftRoster: table([
      { id: 'rr1', leagueId: 'L', seasonId: 'S', ownerId: 'commish', ownerName: 'Commish' },
      ...[2, 3, 4].map((n) => ({ id: `rr${n}`, leagueId: 'L', seasonId: 'S', ownerId: `open-slot-L-${n}`, ownerName: `Open Team ${n}` })),
    ]),
  }
  return db as any
}

describe('countSeatsHeldByPeople', () => {
  it('counts people, not the open-seat rosters a native league is created with', async () => {
    const db = nativeLeague()
    expect(db.roster.rows).toHaveLength(4)
    expect(await countSeatsHeldByPeople(db, 'L')).toBe(1)
  })
})

describe('assignLeagueSeat', () => {
  it('refuses an ownership change committed after the initial read', async () => {
    const db = nativeLeague()
    const original = db.roster.updateMany
    db.roster.updateMany = async (args: { where: Row; data: Row }) => {
      db.roster.rows.find((r: Row) => r.id === 'r2').platformUserId = 'ben'
      return original(args)
    }
    expect(await assignLeagueSeat(db, { leagueId: 'L', rosterId: 'r2', userId: 'amy' })).toMatchObject({ ok: false, code: 'ROSTER_TAKEN' })
    expect(db.roster.rows.find((r: Row) => r.id === 'r2').platformUserId).toBe('ben')
    expect(db.leagueTeam.rows.find((r: Row) => r.id === 't2').claimedByUserId).toBeNull()
    expect(db.redraftLeagueMember.rows.some((r: Row) => r.userId === 'amy')).toBe(false)
  })

  it('writes the roster, team, entry slot, membership and season roster together', async () => {
    const db = nativeLeague()
    const result = await assignLeagueSeat(db, { leagueId: 'L', rosterId: 'r3', userId: 'amy' })
    expect(result).toMatchObject({ ok: true, rosterId: 'r3', teamNumber: 3 })

    expect(db.roster.rows.find((r: Row) => r.id === 'r3')).toMatchObject({ platformUserId: 'amy' })
    expect(db.roster.rows.find((r: Row) => r.id === 'r3').playerData.foundation.openTeam).toBe(false)
    expect(db.leagueTeam.rows.find((t: Row) => t.id === 't3')).toMatchObject({
      claimedByUserId: 'amy', platformUserId: 'amy', isOrphan: false, ownerName: 'Amy', teamName: "Amy's Team",
    })
    expect(db.leagueEntrySlot.rows.find((s: Row) => s.id === 's3').status).toBe('FILLED')
    expect(db.redraftLeagueMember.rows.find((m: Row) => m.userId === 'amy')).toMatchObject({ role: 'MEMBER', teamNumber: 3 })
    expect(db.redraftRoster.rows.find((r: Row) => r.id === 'rr3')).toMatchObject({ ownerId: 'amy', ownerName: 'Amy' })
    expect(await countSeatsHeldByPeople(db, 'L')).toBe(2)
  })

  it('is safe to run after a membership row already exists (no duplicate insert)', async () => {
    const db = nativeLeague()
    db.redraftLeagueMember.rows.push({ leagueId: 'L', userId: 'amy', role: 'MEMBER', teamNumber: null })
    const result = await assignLeagueSeat(db, { leagueId: 'L', rosterId: 'r2', userId: 'amy' })
    expect(result.ok).toBe(true)
    expect(db.redraftLeagueMember.rows.filter((m: Row) => m.userId === 'amy')).toHaveLength(1)
  })

  it('refuses a seat a person holds, and a second seat for the same person', async () => {
    const db = nativeLeague()
    expect(await assignLeagueSeat(db, { leagueId: 'L', rosterId: 'r1', userId: 'amy' })).toMatchObject({ ok: false, code: 'ROSTER_TAKEN' })
    await assignLeagueSeat(db, { leagueId: 'L', rosterId: 'r2', userId: 'amy' })
    expect(await assignLeagueSeat(db, { leagueId: 'L', rosterId: 'r3', userId: 'amy' })).toMatchObject({ ok: false, code: 'ALREADY_HOLDS_ROSTER' })
  })

  it('a commissioner hand-off does not pass the commissioner flag to the new holder', async () => {
    const db = nativeLeague()
    const result = await assignLeagueSeat(db, { leagueId: 'L', rosterId: 'r1', userId: 'ben', replaceExisting: true })
    expect(result.ok).toBe(true)
    expect(db.leagueTeam.rows.find((t: Row) => t.id === 't1')).toMatchObject({ claimedByUserId: 'ben', isCommissioner: false, role: 'member' })
    // The league owner stays a member (commissioner by League.userId), just without a team.
    expect(db.redraftLeagueMember.rows.find((m: Row) => m.userId === 'commish')).toBeTruthy()
  })

  it('refuses a user id that is not a person', async () => {
    const db = nativeLeague()
    expect(await assignLeagueSeat(db, { leagueId: 'L', rosterId: 'r2', userId: 'nobody' })).toMatchObject({ ok: false, code: 'USER_NOT_FOUND' })
  })
})

describe('releaseLeagueSeat', () => {
  it('takes the person out of every record and leaves the seat open for the next join', async () => {
    const db = nativeLeague()
    await assignLeagueSeat(db, { leagueId: 'L', rosterId: 'r2', userId: 'amy' })
    const released = await releaseLeagueSeat(db, { leagueId: 'L', rosterId: 'r2' })
    expect(released).toMatchObject({ ok: true, previousOwner: 'amy' })

    expect(db.roster.rows.find((r: Row) => r.id === 'r2')).toMatchObject({ platformUserId: 'orphan-r2' })
    expect(db.roster.rows.find((r: Row) => r.id === 'r2').playerData.foundation.openTeam).toBe(true)
    expect(db.leagueTeam.rows.find((t: Row) => t.id === 't2')).toMatchObject({ claimedByUserId: null, isOrphan: true })
    expect(db.leagueEntrySlot.rows.find((s: Row) => s.id === 's2').status).toBe('OPEN')
    expect(db.redraftLeagueMember.rows.find((m: Row) => m.userId === 'amy')).toBeUndefined()
    expect(db.redraftRoster.rows.find((r: Row) => r.id === 'rr2').ownerId).toBe('roster:r2')

    // And the next person to take it inherits the season roster.
    await assignLeagueSeat(db, { leagueId: 'L', rosterId: 'r2', userId: 'ben' })
    expect(db.redraftRoster.rows.find((r: Row) => r.id === 'rr2').ownerId).toBe('ben')
  })
})
