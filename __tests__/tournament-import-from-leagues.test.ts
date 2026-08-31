// @vitest-environment node
/**
 * Guards standing a tournament up from leagues that are already imported.
 *
 * 🛑 THIS IS THE ON-RAMP, AND WITHOUT IT THE HUB IS AN EMPTY PAGE. Nothing else
 * in the app creates `TournamentShell` → `TournamentConference` →
 * `TournamentLeague` → participants out of leagues a commissioner already has,
 * and nobody is going to hand-enter twenty leagues and 240 managers.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'

const leagueFindMany = vi.fn()
const tournamentLeagueFindMany = vi.fn()
const leagueTeamFindMany = vi.fn()
const transaction = vi.fn()
const shellCreate = vi.fn()
const roundCreate = vi.fn()
const conferenceCreateMany = vi.fn()
const tlCreateMany = vi.fn()
const participantCreateMany = vi.fn()
const lpCreateMany = vi.fn()
const auditCreate = vi.fn()

vi.mock('@/lib/prisma', () => ({
  prisma: {
    league: { findMany: (...a: unknown[]) => leagueFindMany(...a) },
    leagueTeam: { findMany: (...a: unknown[]) => leagueTeamFindMany(...a) },
    tournamentLeague: {
      findMany: (...a: unknown[]) => tournamentLeagueFindMany(...a),
      createMany: (...a: unknown[]) => tlCreateMany(...a),
    },
    tournamentShell: { create: (...a: unknown[]) => shellCreate(...a) },
    tournamentRound: { create: (...a: unknown[]) => roundCreate(...a) },
    tournamentConference: { createMany: (...a: unknown[]) => conferenceCreateMany(...a) },
    tournamentParticipant: { createMany: (...a: unknown[]) => participantCreateMany(...a) },
    tournamentLeagueParticipant: { createMany: (...a: unknown[]) => lpCreateMany(...a) },
    tournamentAuditLog: { create: (...a: unknown[]) => auditCreate(...a) },
    $transaction: (...a: unknown[]) => transaction(...a),
  },
}))

import { importTournamentFromLeagues } from '@/lib/tournament/importTournamentFromLeagues'

function team(leagueId: string, externalId: string, over: Record<string, unknown> = {}) {
  return {
    leagueId,
    externalId,
    platformUserId: `sleeper-${externalId}`,
    ownerName: `owner-${externalId}`,
    teamName: `team-${externalId}`,
    isOrphan: false,
    ...over,
  }
}

const BASE = {
  commissionerUserId: 'commish',
  name: 'King Buffalo Invitational',
  openingWeekStart: 1,
  openingWeekEnd: 9,
}

beforeEach(() => {
  vi.clearAllMocks()
  leagueFindMany.mockResolvedValue([
    { id: 'lgA', name: 'BEAST', sport: 'NFL' },
    { id: 'lgB', name: 'BEAST', sport: 'NFL' },
  ])
  tournamentLeagueFindMany.mockResolvedValue([])
  leagueTeamFindMany.mockResolvedValue([team('lgA', '1'), team('lgB', '2')])
  transaction.mockResolvedValue([])
})

const TWO_CONFERENCES = {
  ...BASE,
  conferences: [
    { name: 'BLACK', leagueIds: ['lgA'] },
    { name: 'GOLD', leagueIds: ['lgB'] },
  ],
}

/**
 * 🛑 THE SAME LEAGUE NAME IN TWO CONFERENCES IS THE NORMAL CASE HERE, NOT AN
 * EDGE ONE. KBI runs BEAST, GOAT, GRIZZ… in BOTH Black and Gold, and
 * `@@unique([tournamentId, name])` rejects the second set outright.
 */
describe('a league name used in both conferences', () => {
  it('qualifies the duplicate with its conference instead of failing', async () => {
    const out = await importTournamentFromLeagues(TWO_CONFERENCES)
    expect(out).toMatchObject({ ok: true, leagueCount: 2 })
    const names = tlCreateMany.mock.calls[0][0].data.map((l: { name: string }) => l.name)
    expect(names).toEqual(['BEAST', 'GOLD BEAST'])
  })

  /** ⚠ Reported, so the rename is visible rather than mysterious in the UI. */
  it('reports which leagues it renamed', async () => {
    const out = await importTournamentFromLeagues(TWO_CONFERENCES)
    expect((out as { renamedLeagues: unknown[] }).renamedLeagues).toEqual([
      { leagueId: 'lgB', from: 'BEAST', to: 'GOLD BEAST' },
    ])
  })

  it('keeps the slugs unique too', async () => {
    await importTournamentFromLeagues(TWO_CONFERENCES)
    const slugs = tlCreateMany.mock.calls[0][0].data.map((l: { slug: string }) => l.slug)
    expect(new Set(slugs).size).toBe(2)
  })
})

describe('what it refuses', () => {
  /**
   * ⚠ OWNERSHIP IS APPLIED TO THE QUERY. League ids arrive from a request, so
   * filtering afterwards would let someone build a tournament out of a
   * stranger's leagues and read every roster in them through the board.
   */
  it('scopes the league lookup to the commissioner', async () => {
    await importTournamentFromLeagues(TWO_CONFERENCES)
    expect(leagueFindMany.mock.calls[0][0].where.userId).toBe('commish')
  })

  it('refuses when any league is not the commissioner’s', async () => {
    leagueFindMany.mockResolvedValue([{ id: 'lgA', name: 'BEAST', sport: 'NFL' }])
    const out = await importTournamentFromLeagues(TWO_CONFERENCES)
    expect(out).toMatchObject({ ok: false, status: 404 })
    expect(transaction).not.toHaveBeenCalled()
  })

  /** 🛑 `TournamentLeague.leagueId` is globally unique — say which league, not which column. */
  it('names the league that is already in another tournament', async () => {
    tournamentLeagueFindMany.mockResolvedValue([{ leagueId: 'lgB' }])
    const out = await importTournamentFromLeagues(TWO_CONFERENCES)
    expect(out).toMatchObject({ ok: false, status: 409 })
    expect((out as { error: string }).error).toContain('BEAST')
  })

  it('refuses the same league in two conferences', async () => {
    const out = await importTournamentFromLeagues({
      ...BASE,
      conferences: [
        { name: 'BLACK', leagueIds: ['lgA'] },
        { name: 'GOLD', leagueIds: ['lgA'] },
      ],
    })
    expect(out).toMatchObject({ ok: false, status: 400 })
    expect(transaction).not.toHaveBeenCalled()
  })

  /**
   * 🛑 ONE MANAGER, ONE ENTRY. `@@unique([tournamentId, userId])` would fail the
   * insert halfway with an error naming neither the manager nor the leagues.
   * Refusing up front and NAMING them lets the commissioner pick the real entry.
   */
  it('names a manager who appears in two leagues rather than failing on a constraint', async () => {
    leagueTeamFindMany.mockResolvedValue([
      team('lgA', '1', { platformUserId: 'sleeper-dup', ownerName: 'TyT1' }),
      team('lgB', '9', { platformUserId: 'sleeper-dup', ownerName: 'TyT1' }),
    ])
    const out = await importTournamentFromLeagues(TWO_CONFERENCES)
    expect(out).toMatchObject({ ok: false, status: 409 })
    expect((out as { error: string }).error).toContain('TyT1')
    expect(transaction).not.toHaveBeenCalled()
  })

  it('refuses with no conferences or no leagues', async () => {
    expect(await importTournamentFromLeagues({ ...BASE, conferences: [] })).toMatchObject({
      ok: false,
      status: 400,
    })
    expect(
      await importTournamentFromLeagues({ ...BASE, conferences: [{ name: 'BLACK', leagueIds: [] }] }),
    ).toMatchObject({ ok: false, status: 400 })
    expect(transaction).not.toHaveBeenCalled()
  })
})

describe('what it writes', () => {
  it('creates one participant per team, identified the way the board matches', async () => {
    await importTournamentFromLeagues(TWO_CONFERENCES)
    const participants = participantCreateMany.mock.calls[0][0].data
    expect(participants).toHaveLength(2)
    expect(participants.map((p: { userId: string }) => p.userId)).toEqual([
      'sleeper-1',
      'sleeper-2',
    ])
  })

  /** ⚠ `platformUserId` is nullable; a team pointer is the fallback identity. */
  it('falls back to a team pointer when a team has no platform user id', async () => {
    /* The mock ignores the `where`, so narrow it by hand: the loader compares
       the row count it got back against the ids it asked for. */
    leagueFindMany.mockResolvedValue([{ id: 'lgA', name: 'BEAST', sport: 'NFL' }])
    leagueTeamFindMany.mockResolvedValue([team('lgA', '1', { platformUserId: null })])
    await importTournamentFromLeagues({ ...BASE, conferences: [{ name: 'BLACK', leagueIds: ['lgA'] }] })
    expect(participantCreateMany.mock.calls[0][0].data[0].userId).toBe('team:lgA:1')
  })

  /**
   * ⚠ AN ORPHAN TEAM STILL BECOMES A PARTICIPANT. It has a record and occupies a
   * slot, so dropping it would shrink the field the cut is measured against and
   * quietly promote everyone below it.
   */
  it('keeps orphan teams in the field and counts them', async () => {
    leagueTeamFindMany.mockResolvedValue([
      team('lgA', '1'),
      team('lgB', '2', { isOrphan: true }),
    ])
    const out = await importTournamentFromLeagues(TWO_CONFERENCES)
    expect(out).toMatchObject({ ok: true, participantCount: 2, orphanTeamCount: 1 })
  })

  /**
   * ⚠ ONE TRANSACTION. A half-built tournament reads on the board as one where
   * everybody is unmatched — indistinguishable from a real data problem, and it
   * would send a commissioner hunting for the wrong bug.
   */
  it('writes everything in a single transaction', async () => {
    await importTournamentFromLeagues(TWO_CONFERENCES)
    expect(transaction).toHaveBeenCalledTimes(1)
    expect(transaction.mock.calls[0][0]).toHaveLength(7)
  })

  /** KBI's cut is conference-wide: no per-league auto-advance. */
  it('passes the advancement settings through as given', async () => {
    await importTournamentFromLeagues({
      ...TWO_CONFERENCES,
      advancersPerLeague: 0,
      wildcardCount: 64,
      bubbleEnabled: true,
      bubbleSize: 6,
    })
    expect(shellCreate.mock.calls[0][0].data).toMatchObject({
      advancersPerLeague: 0,
      wildcardCount: 64,
      bubbleEnabled: true,
      bubbleSize: 6,
    })
  })

  it('links every tournament league back to its real league', async () => {
    await importTournamentFromLeagues(TWO_CONFERENCES)
    const rows = tlCreateMany.mock.calls[0][0].data
    expect(rows.map((l: { leagueId: string }) => l.leagueId)).toEqual(['lgA', 'lgB'])
  })
})
