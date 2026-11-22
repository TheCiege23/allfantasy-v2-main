/** @vitest-environment node */
/**
 * 🛑 A TEAM NOBODY HAD CLAIMED WAS "A TEAM" ON EVERY GUILLOTINE SCREEN. An open seat's roster is owned
 * by a placeholder that matches no league team and no user. Walking a league locally (2026-11-20),
 * seven of eight teams on the chop line read "A team".
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  rosters: [] as Array<{ id: string; platformUserId: string; redraftRosterId: string | null }>,
  teams: [] as Array<{ externalId: string; ownerName: string; teamName: string }>,
  users: [] as Array<{ id: string; displayName: string | null; username: string | null }>,
  seats: [] as Array<{ id: string; teamName: string | null }>,
  seatReads: 0,
}))
vi.mock('@/lib/prisma', () => ({
  prisma: {
    roster: { findMany: vi.fn(async () => h.rosters) },
    leagueTeam: { findMany: vi.fn(async () => h.teams) },
    appUser: { findMany: vi.fn(async () => h.users) },
    redraftRoster: { findMany: vi.fn(async ({ where }: { where: { id: { in: string[] } } }) => { h.seatReads += 1; return h.seats.filter((s) => where.id.in.includes(s.id)) }) },
  },
}))

import { resolveRosterDisplayNames } from '@/lib/guillotine/rosterDisplayNames'

beforeEach(() => {
  h.rosters = [
    { id: 'r1', platformUserId: 'u1', redraftRosterId: 's1' },
    { id: 'r2', platformUserId: 'open-slot-L-2', redraftRosterId: 's2' },
    { id: 'r3', platformUserId: 'open-slot-L-3', redraftRosterId: 's3' },
    { id: 'r4', platformUserId: 'open-slot-L-4', redraftRosterId: null },
  ]
  h.teams = [{ externalId: 'u1', ownerName: 'Guap', teamName: 'Blades' }]
  h.users = []
  h.seats = [{ id: 's1', teamName: 'Should not be used' }, { id: 's2', teamName: 'Open Team 2' }, { id: 's3', teamName: 'someone@example.com' }]
  h.seatReads = 0
})

describe('resolveRosterDisplayNames', () => {
  it('🛑 an unclaimed seat takes the name on its season roster', async () => {
    const names = await resolveRosterDisplayNames('L', ['r1', 'r2', 'r3', 'r4'])
    expect(names.get('r2')).toBe('Open Team 2')
  })
  it('[control] a claimed team keeps the name it always had', async () => {
    expect((await resolveRosterDisplayNames('L', ['r1', 'r2'])).get('r1')).toBe('Guap')
  })
  it('[control] an email is never used as a name, and a seat with no season roster stays unnamed', async () => {
    const names = await resolveRosterDisplayNames('L', ['r1', 'r2', 'r3', 'r4'])
    expect(names.has('r3')).toBe(false)
    expect(names.has('r4')).toBe(false)
  })
  it('a league where every seat is open is still named', async () => {
    h.rosters = h.rosters.filter((r) => r.id !== 'r1')
    h.teams = []
    expect((await resolveRosterDisplayNames('L', ['r2'])).get('r2')).toBe('Open Team 2')
  })
  it('a league where every team is claimed makes no extra read', async () => {
    h.rosters = [h.rosters[0]]
    await resolveRosterDisplayNames('L', ['r1'])
    expect(h.seatReads).toBe(0)
  })
})
