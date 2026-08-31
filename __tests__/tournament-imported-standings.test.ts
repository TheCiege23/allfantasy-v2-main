// @vitest-environment node
/**
 * Guards the join between a tournament's participants and the team rows an
 * IMPORT committed.
 *
 * 🛑 THE ENGINE WAS READING ITS OWN LAST ANSWER. `calculateLeagueStandings`
 * sources records from `RedraftRoster` (native leagues only) and otherwise falls
 * back to the values stored on `TournamentLeagueParticipant` — which nothing
 * refreshes for an imported league. So an imported tournament recomputed from a
 * stale copy of itself and reported no movement, which looks exactly like a week
 * in which nobody played. That is why a 240-manager tournament is recomputed by
 * hand every week beside an engine that would do it.
 */
import { describe, it, expect, vi } from 'vitest'

/*
 * 🛑 THE MODULE UNDER TEST IS `server-only` AND IMPORTS PRISMA AT MODULE SCOPE,
 * SO IMPORTING IT BUILDS A CLIENT BEFORE A SINGLE ASSERTION RUNS. That needs a
 * DATABASE_URL, and CI has none -- the whole file died on "DATABASE_URL is not
 * set" while passing locally, because importing `@prisma/client` in a dev
 * checkout loads `.env` as a side effect and a runner with no `.env` gets
 * nothing. A green local run is not evidence about CI here.
 *
 * Only the PURE helpers are exercised below -- none of them touches the
 * database -- so the client is stubbed rather than built. Anything that did
 * reach prisma would fail loudly on the empty stub, which is deliberate: this
 * must not become a way to test a query without a database.
 */
vi.mock('@/lib/prisma', () => ({ prisma: {} }))

import {
  matchParticipantsToRecords,
  parseTeamIdentity,
  teamIdentity,
  type ImportedTeamRecord,
} from '@/lib/tournament/importedStandingsSource'

function team(over: Partial<ImportedTeamRecord> & { externalId: string }): ImportedTeamRecord {
  return {
    platformUserId: null,
    ownerName: '',
    teamName: '',
    wins: 0,
    losses: 0,
    ties: 0,
    pointsFor: 0,
    pointsAgainst: 0,
    lastUpdatedAt: new Date('2025-09-01T00:00:00Z'),
    ...over,
  }
}

describe('matching participants to imported team rows', () => {
  /**
   * 🛑 `TournamentParticipant.userId` IS A BARE STRING WITH NO FOREIGN KEY, and
   * that is what makes an imported tournament representable: KBI has ~240
   * managers and most have never signed up for AllFantasy. For an imported
   * tournament the column holds the platform's owner id, which is exactly what
   * `LeagueTeam.platformUserId` stores.
   */
  it('matches on the platform user id, which is an identity rather than a label', () => {
    const rows = [team({ externalId: '1', platformUserId: 'sleeper-77', ownerName: 'TyT1', wins: 6 })]
    const out = matchParticipantsToRecords([{ userId: 'sleeper-77', displayName: 'renamed' }], rows)
    expect(out[0].matchedBy).toBe('platformUserId')
    expect(out[0].record?.wins).toBe(6)
  })

  /** Older imports did not always capture an owner id, so a name is the fallback. */
  it('falls back to the owner name, and says that is what it did', () => {
    const rows = [team({ externalId: '1', ownerName: 'emmae', wins: 4 })]
    const out = matchParticipantsToRecords([{ userId: 'no-id-on-file', displayName: 'EMMAE' }], rows)
    expect(out[0].matchedBy).toBe('ownerName')
    expect(out[0].record?.wins).toBe(4)
  })

  /**
   * 🛑 EVERY ID MATCH SETTLES BEFORE ANY NAME MATCH IS ATTEMPTED. Interleaving
   * them lets a participant with a stale display name claim by name the row that
   * another participant would have claimed by id — the id match then finds
   * nothing and the WRONG manager is credited with that team's season.
   */
  it('never lets a name match steal a row that an id match owns', () => {
    const rows = [team({ externalId: '1', platformUserId: 'sleeper-77', ownerName: 'Spokee', wins: 9 })]
    const out = matchParticipantsToRecords(
      [
        { userId: 'someone-else', displayName: 'Spokee' },
        { userId: 'sleeper-77', displayName: 'zedlav' },
      ],
      rows,
    )
    const byId = out.find((m) => m.participant.userId === 'sleeper-77')
    const byName = out.find((m) => m.participant.userId === 'someone-else')
    expect(byId?.matchedBy).toBe('platformUserId')
    expect(byId?.record?.wins).toBe(9)
    expect(byName?.record).toBeNull()
  })

  /**
   * ⚠ ONE ROW IS CLAIMED ONCE. Two participants credited with the same team both
   * inflate their conference's points total and can advance a manager over
   * someone who really outscored them.
   */
  it('does not credit two participants with the same team', () => {
    const rows = [team({ externalId: '1', ownerName: 'A1Saucy', teamName: 'A1Saucy', pointsFor: 1200 })]
    const out = matchParticipantsToRecords(
      [
        { userId: 'u1', displayName: 'A1Saucy' },
        { userId: 'u2', displayName: 'A1Saucy' },
      ],
      rows,
    )
    expect(out.filter((m) => m.record != null)).toHaveLength(1)
  })

  /**
   * 🛑 AN UNMATCHED PARTICIPANT IS REPORTED, NEVER GUESSED AT. A near-miss is two
   * different managers in a 240-person field, and the cost of a wrong guess is
   * ending the wrong person's season.
   */
  it('reports a near-miss as unmatched rather than guessing', () => {
    const rows = [team({ externalId: '1', ownerName: 'TyT1' })]
    const out = matchParticipantsToRecords([{ userId: 'u1', displayName: 'TyT11' }], rows)
    expect(out[0].record).toBeNull()
    expect(out[0].matchedBy).toBeNull()
  })

  /**
   * 🛑 A COMMISSIONER'S EXPLICIT LINK OUTRANKS EVERY AUTOMATIC ROUTE. It exists
   * precisely because the automatic ones got that manager wrong, so a platform id
   * that still points elsewhere must not win over it.
   */
  it('honours a commissioner link over the platform id, and says so', () => {
    const rows = [
      team({ externalId: '7', platformUserId: 'sleeper-77', ownerName: 'someone else', pointsFor: 900 }),
    ]
    const out = matchParticipantsToRecords(
      [{ userId: teamIdentity('lg1', '7'), displayName: 'TyT1' }],
      rows,
    )
    expect(out[0].matchedBy).toBe('commissionerLink')
    expect(out[0].record?.pointsFor).toBe(900)
  })

  /** ⚠ A team pointer must never be mistaken for a real platform id. */
  it('round-trips a team pointer and ignores a real platform id', () => {
    expect(parseTeamIdentity(teamIdentity('lg1', '7'))).toEqual({ leagueId: 'lg1', externalId: '7' })
    expect(parseTeamIdentity('sleeper-77')).toBeNull()
    expect(parseTeamIdentity('team:')).toBeNull()
    expect(parseTeamIdentity('team:lg1:')).toBeNull()
  })

  it('leaves a participant unmatched when the league has no imported rows at all', () => {
    const out = matchParticipantsToRecords([{ userId: 'u1', displayName: 'TyT1' }], [])
    expect(out).toHaveLength(1)
    expect(out[0].record).toBeNull()
  })
})
