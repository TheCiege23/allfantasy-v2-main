// @vitest-environment node
/**
 * LeagueSafe phase 3: a parsed notice is filed under the one league with that name, written to the
 * ledger once, and marks a team paid only after the commissioner has confirmed who the payer is.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

type Row = Record<string, any>
const db = vi.hoisted(() => ({
  emails: [] as Row[], connections: [] as Row[], members: [] as Row[], ledger: [] as Row[], league: {} as Row,
}))
const uniqueViolation = vi.hoisted(() => ({ make: null as null | (() => Error) }))

vi.mock('server-only', () => ({}))
vi.mock('@prisma/client', () => {
  class PrismaClientKnownRequestError extends Error {
    code: string
    constructor(message: string, opts: { code: string }) { super(message); this.code = opts.code }
  }
  uniqueViolation.make = () => new PrismaClientKnownRequestError('unique', { code: 'P2002' })
  return { Prisma: { PrismaClientKnownRequestError } }
})
vi.mock('@/lib/prisma', () => {
  const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase()
  const withEntries = (m: Row) => ({ ...m, ledgerEntries: db.ledger.filter((e) => e.memberId === m.id) })
  const fullConnection = (c: Row | undefined) => (c ? { ...c, members: db.members.filter((m) => m.connectionId === c.id).map(withEntries) } : null)
  const prisma: Row = {
    leagueSafeRawEmail: {
      findUnique: async ({ where }: Row) => db.emails.find((e) => e.id === where.id) ?? null,
      findMany: async () => db.emails.filter((e) => e.processingStatus === 'parsed' && !e.leagueConnectionId),
      updateMany: async ({ where, data }: Row) => {
        const hit = db.emails.filter((e) => e.id === where.id && e.leagueConnectionId == null)
        hit.forEach((e) => Object.assign(e, data))
        return { count: hit.length }
      },
    },
    leagueSafeConnection: {
      findMany: async ({ where }: Row) => db.connections.filter((c) => c.status !== 'disconnected' && same(c.lsLeagueName, where.lsLeagueName.equals)),
      findUnique: async ({ where }: Row) => fullConnection(db.connections.find((c) => (where.id ? c.id === where.id : c.afLeagueId === where.afLeagueId))),
      update: async ({ where, data }: Row) => Object.assign(db.connections.find((c) => c.id === where.id)!, data),
      updateMany: async ({ where, data }: Row) => {
        const hit = db.connections.filter((c) => c.afLeagueId === where.afLeagueId)
        hit.forEach((c) => Object.assign(c, data))
        return { count: hit.length }
      },
      create: async ({ data }: Row) => { const c = { id: `c${db.connections.length + 1}`, status: 'pending_invite', lastEmailAt: null, currency: 'usd', ...data }; db.connections.push(c); return c },
    },
    leagueSafeMember: {
      findFirst: async ({ where }: Row) =>
        db.members.find((m) =>
          m.connectionId === where.connectionId &&
          (where.id ? m.id === where.id : true) &&
          (where.lsDisplayName ? same(m.lsDisplayName, where.lsDisplayName.equals) : true) &&
          (where.afTeamId ? m.afTeamId === where.afTeamId && m.id !== where.NOT?.id : true),
        ) ?? null,
      create: async ({ data }: Row) => { const m = { id: `m${db.members.length + 1}`, afTeamId: null, matchMethod: null, confirmedByCommish: false, duesAmountCents: null, ...data }; db.members.push(m); return m },
      update: async ({ where, data }: Row) => Object.assign(db.members.find((m) => m.id === where.id)!, data),
    },
    duesLedgerEntry: {
      create: async ({ data }: Row) => {
        if (db.ledger.some((e) => e.dedupeKey === data.dedupeKey)) throw uniqueViolation.make!()
        db.ledger.push(data)
        return data
      },
    },
    leagueTeam: { findMany: async () => db.league.teams },
    league: {
      findUnique: async () => db.league,
      update: async ({ data }: Row) => Object.assign(db.league, data),
    },
    $queryRaw: async () => [],
  }
  prisma.$transaction = async (fn: (tx: Row) => Promise<unknown>) => fn(prisma)
  return { prisma }
})

import { applyParsedLeagueSafeEmail, connectLeagueSafe, loadLeagueSafeView, setLeagueSafeMemberTeam } from '@/lib/leaguesafe/league-connection'
import { readDuesConfig } from '@/lib/dues/duesTracker'

const payment = (id: string, league: string, payer: string, amountCents: number): Row => ({
  id, processingStatus: 'parsed', leagueConnectionId: null, receivedAt: new Date('2026-11-10T12:00:00Z'),
  parsedPayload: {
    schemaVersion: 1, dedupeKey: `leaguesafe:transaction:${id}`,
    details: { type: 'payment_received', league: { name: league, id: null }, payerDisplayName: payer, payerEmail: null, amountCents, leagueBalanceCents: 0, ownersPaid: 1 },
  },
})
const paidTeams = () => readDuesConfig(db.league.settings.dues_tracker).entries.filter((e) => e.paid).map((e) => e.teamId).sort()

beforeEach(() => {
  db.emails.length = 0; db.connections.length = 0; db.members.length = 0; db.ledger.length = 0
  db.league = {
    id: 'L1', season: 2026, isDynasty: false, leagueVariant: null, settings: {},
    teams: [
      { id: 't1', teamName: 'Aces', ownerName: 'Pat Jones', claimedByUserId: 'u1' },
      { id: 't2', teamName: 'Bears', ownerName: 'Sam Lee', claimedByUserId: 'u2' },
      { id: 't3', teamName: 'Colts', ownerName: 'Sam Lee Two', claimedByUserId: 'u2' },
    ],
  }
})

describe('filing a LeagueSafe notice', () => {
  it('goes nowhere until a league has connected under that name', async () => {
    db.emails.push(payment('e1', 'Road To Glory', 'Pat Jones', 10000))
    expect(await applyParsedLeagueSafeEmail('e1')).toBe('no_connection')
    expect(db.ledger).toHaveLength(0)
  })

  it('is left for a person when two leagues share the LeagueSafe name', async () => {
    db.connections.push({ id: 'c1', afLeagueId: 'L1', lsLeagueName: 'Road To Glory', status: 'pending_invite', duesAmountCents: 10000 })
    db.connections.push({ id: 'c2', afLeagueId: 'L2', lsLeagueName: 'road to glory', status: 'pending_invite', duesAmountCents: 10000 })
    db.emails.push(payment('e1', 'Road To Glory', 'Pat Jones', 10000))
    expect(await applyParsedLeagueSafeEmail('e1')).toBe('ambiguous_connection')
    expect(db.emails[0]!.leagueConnectionId).toBeNull()
  })

  it('connecting picks up notices that were already waiting, marks the league connected, and records each payment once', async () => {
    db.emails.push(payment('e1', 'road to GLORY', 'Pat Jones', 10000))
    const out = await connectLeagueSafe('L1', 'commish', { lsLeagueName: 'Road To Glory', duesAmountCents: 10000, dueAt: null })
    expect(out.filed).toBe(1)
    expect(db.connections[0]).toMatchObject({ status: 'active', lastEmailAt: new Date('2026-11-10T12:00:00Z') })
    expect(db.ledger).toHaveLength(1)
    expect(db.ledger[0]).toMatchObject({ type: 'payment', amountCents: 10000, sourceType: 'email', sourceRawEmailId: 'e1' })
    // The same notice again changes nothing.
    expect(await applyParsedLeagueSafeEmail('e1')).toBe('duplicate')
    expect(db.ledger).toHaveLength(1)
  })
})

describe('crediting a team', () => {
  beforeEach(async () => {
    db.emails.push(payment('e1', 'Road To Glory', 'Pat Jones', 10000))
    await connectLeagueSafe('L1', 'commish', { lsLeagueName: 'Road To Glory', duesAmountCents: 10000, dueAt: null })
  })

  it('a payer whose name matches a team is only SUGGESTED: nobody is marked paid until the commissioner confirms', async () => {
    const view = await loadLeagueSafeView('L1')
    expect(view.members[0]).toMatchObject({ name: 'Pat Jones', teamId: null, confirmed: false, suggestedTeamId: 't1', paidCents: 10000 })
    expect(paidTeams()).toEqual([])

    const result = await setLeagueSafeMemberTeam('L1', view.members[0]!.id, 't1')
    expect(result).toMatchObject({ ok: true, marked: 1 })
    expect(paidTeams()).toEqual(['t1'])
    expect(readDuesConfig(db.league.settings.dues_tracker)).toMatchObject({ amount: 100 })
    expect(db.members[0]).toMatchObject({ matchMethod: 'name_exact', confirmedByCommish: true })
  })

  it('dues are per team: a manager with two teams is not paid up after paying for one', async () => {
    db.emails.push(payment('e2', 'Road To Glory', 'Sammy', 10000))
    await applyParsedLeagueSafeEmail('e2')
    const sammy = db.members.find((m) => m.lsDisplayName === 'Sammy')!
    await setLeagueSafeMemberTeam('L1', sammy.id, 't2')
    let view = await loadLeagueSafeView('L1')
    expect(view.members.find((m) => m.name === 'Sammy')).toMatchObject({ teamsCovered: ['t2', 't3'], dueCents: 20000, paidCents: 10000, status: 'partial' })
    expect(paidTeams()).toEqual([])

    // The second payment covers the second team; both are marked.
    db.emails.push(payment('e3', 'Road To Glory', 'Sammy', 10000))
    expect(await applyParsedLeagueSafeEmail('e3')).toBe('recorded')
    view = await loadLeagueSafeView('L1')
    expect(view.members.find((m) => m.name === 'Sammy')).toMatchObject({ status: 'paid', owedCents: 0 })
    expect(paidTeams()).toEqual(['t2', 't3'])
  })

  it('refuses a team from another league, and a team already matched to someone else', async () => {
    const [pat] = db.members
    expect(await setLeagueSafeMemberTeam('L1', pat!.id, 'elsewhere')).toMatchObject({ ok: false })
    await setLeagueSafeMemberTeam('L1', pat!.id, 't1')
    db.emails.push(payment('e2', 'Road To Glory', 'Someone Else', 10000))
    await applyParsedLeagueSafeEmail('e2')
    const other = db.members.find((m) => m.lsDisplayName === 'Someone Else')!
    expect(await setLeagueSafeMemberTeam('L1', other.id, 't1')).toMatchObject({ ok: false, error: 'Another LeagueSafe member is already matched to that team.' })
  })
})
