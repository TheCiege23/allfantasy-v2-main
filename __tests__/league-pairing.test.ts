// @vitest-environment node
/**
 * Guards the two-league franchise pairing.
 *
 * 🛑 THE FEATURE EXISTED AND HAD NO WAY IN. `FranchiseLink` /
 * `FranchiseLeagueMember` model a two-league franchise with roles `pro` and
 * `college`, and `loadFranchiseDetail` already renders both halves as one team.
 * But `/api/legacy/franchise`'s only attach action hardcoded `role: 'college'`
 * and `platform: 'fantrax'`, so nothing could ever attach the pro side — and no
 * screen in the app called the route at all.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'

const leagueFindMany = vi.fn()
const leagueFindUnique = vi.fn()
const leagueFindFirst = vi.fn()
const fantraxFindMany = vi.fn()
const fantraxFindUnique = vi.fn()
const memberFindMany = vi.fn()
const memberFindFirst = vi.fn()
const teamFindFirst = vi.fn()
const rosterFindFirst = vi.fn()

const draftHqAll = vi.fn()
/* The panel reads drafts through the SAME aggregator the league home uses, so
   the two cannot disagree about one league. Mocked here to return no rows —
   which is the production case for both halves and the one the inference below
   exists for. */
const leagueActivity = vi.fn()
/* Transactions come from the same aggregator the league home uses. Mocked so the
   resolver runs without a DecisionOS activity table. */
vi.mock('@/lib/core-app/leagueActivity', () => ({
  getLeagueActivity: (...a: unknown[]) => leagueActivity(...a),
}))

vi.mock('@/lib/core-app/draftHqAll', () => ({
  getDraftHqAll: (...a: unknown[]) => draftHqAll(...a),
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    league: {
      findMany: (...a: unknown[]) => leagueFindMany(...a),
      findUnique: (...a: unknown[]) => leagueFindUnique(...a),
      findFirst: (...a: unknown[]) => leagueFindFirst(...a),
    },
    fantraxLeague: {
      findMany: (...a: unknown[]) => fantraxFindMany(...a),
      findUnique: (...a: unknown[]) => fantraxFindUnique(...a),
    },
    franchiseLeagueMember: {
      findMany: (...a: unknown[]) => memberFindMany(...a),
      findFirst: (...a: unknown[]) => memberFindFirst(...a),
    },
    leagueTeam: { findFirst: (...a: unknown[]) => teamFindFirst(...a) },
    roster: { findFirst: (...a: unknown[]) => rosterFindFirst(...a) },
  },
}))

import { listPairableLeagues, collapseFantraxDuplicates } from '@/lib/franchise/pairableLeagues'
import { resolvePairedHalf } from '@/lib/core-app/leaguePairing'

const USER = 'user-1'

beforeEach(() => {
  vi.clearAllMocks()
  leagueFindMany.mockResolvedValue([])
  fantraxFindMany.mockResolvedValue([])
  memberFindMany.mockResolvedValue([])
  draftHqAll.mockResolvedValue({ rows: [], counts: {}, withoutDraft: 0 })
  leagueActivity.mockResolvedValue({ items: [], counts: { trade: 0, waiver: 0, rosterMove: 0 }, newest: null, unattributed: 0 })
  memberFindFirst.mockResolvedValue(null)
  teamFindFirst.mockResolvedValue(null)
  rosterFindFirst.mockResolvedValue(null)
})

describe('which half a league would be', () => {
  /**
   * ⚠ INFERRED FROM THE SPORT, NOT THE PLATFORM. Fantrax hosts NFL leagues too —
   * `importFantraxLeague` measures which player map names more of the roster
   * precisely because hardcoding CFB made every NFL Fantrax league look empty.
   */
  it('files a Fantrax NFL league as the PRO half, not college', async () => {
    fantraxFindMany.mockResolvedValue([
      { id: 'fx-1', leagueName: 'Cream Bowl NFL', season: 2026, sport: 'nfl', isDevy: false },
    ])
    const out = await listPairableLeagues(USER)
    expect(out.pro.map((l) => l.id)).toEqual(['fx-1'])
    expect(out.college).toEqual([])
  })

  it('files a Fantrax CFB league as the college half', async () => {
    fantraxFindMany.mockResolvedValue([
      { id: 'fx-2', leagueName: 'Cream Bowl', season: 2026, sport: 'cfb', isDevy: true },
    ])
    const out = await listPairableLeagues(USER)
    expect(out.college.map((l) => l.id)).toEqual(['fx-2'])
  })

  /**
   * 🛑 DEVY IS NOT COLLEGE. A devy league is a PRO league that also rosters
   * college prospects — its scoring, matchups and championship are NFL. Filing
   * it as the college half pairs two pro leagues and calls one of them college.
   */
  it('files a devy NFL league as PRO despite the prospects', async () => {
    fantraxFindMany.mockResolvedValue([
      { id: 'fx-3', leagueName: 'Devy league', season: 2026, sport: 'nfl', isDevy: true },
    ])
    const out = await listPairableLeagues(USER)
    expect(out.pro.map((l) => l.id)).toEqual(['fx-3'])
    expect(out.pro[0].roleReason).toMatch(/devy/i)
  })

  /**
   * ⚠ A COMPLETE FRANCHISE'S LEAGUES ARE CONTEXT, NOT CANDIDATES. Re-pairing one
   * would empty the franchise it is in, which is what the unique (platform,
   * leagueId) is protecting.
   */
  it('reports a league in a COMPLETE franchise separately, never as a candidate', async () => {
    leagueFindMany.mockResolvedValue([
      { id: 'lg-1', name: 'Peach Bowl', platform: 'sleeper', season: 2026, sport: 'nfl', isDynasty: true, leagueType: 'dynasty' },
    ])
    memberFindMany.mockResolvedValue([
      /*
       * ⚠ THE MOCK MUST CARRY `link.ownerUserId` AND `link.members`. The query
       * selects both: ownerUserId decides MINE vs another account's claim, and
       * members is how "complete" is counted. A mock missing them makes a
       * complete franchise of the viewer's look unclaimed and half-built.
       */
      { platform: 'sleeper', leagueId: 'lg-1', linkId: 'link-1', link: { name: 'My franchise', ownerUserId: USER, members: [{ id: 'm1' }, { id: 'm2' }] } },
      { platform: 'fantrax', leagueId: 'fx-1', linkId: 'link-1', link: { name: 'My franchise', ownerUserId: USER, members: [{ id: 'm1' }, { id: 'm2' }] } },
    ])
    const out = await listPairableLeagues(USER)
    expect(out.pro).toEqual([])
    expect(out.alreadyLinked.map((l) => l.linkedTo)).toEqual(['My franchise'])
  })

  /**
   * 🛑 A HALF-BUILT FRANCHISE IS THE CASE THIS SCREEN EXISTS FOR. LeagueHome
   * sends a one-sided league here under "Add the other half"; filtering that same
   * league out of its own list leaves the user only OTHER leagues to pick, which
   * is how a pairing attempt ends on "that league is already part of another
   * franchise" about a franchise they own.
   */
  it('still offers a league whose franchise has only one half, carrying its link', async () => {
    leagueFindMany.mockResolvedValue([
      { id: 'lg-1', name: 'Peach Bowl', platform: 'sleeper', season: 2026, sport: 'nfl', isDynasty: true, leagueType: 'dynasty' },
    ])
    memberFindMany.mockResolvedValue([
      { platform: 'sleeper', leagueId: 'lg-1', linkId: 'link-1', link: { name: 'My franchise', ownerUserId: USER, members: [{ id: 'm1' }] } },
    ])
    const out = await listPairableLeagues(USER)
    expect(out.pro.map((l) => l.id)).toEqual(['lg-1'])
    expect(out.pro[0]).toMatchObject({ linkedTo: 'My franchise', linkId: 'link-1' })
    expect(out.alreadyLinked).toEqual([])
  })
})

/**
 * 🛑 A FANTRAX IMPORT WRITES TWO ROWS FOR ONE REAL LEAGUE — a `FantraxLeague`
 * snapshot and a `League` whose `platformLeagueId` is that snapshot's uuid. Offer
 * both and the user cannot tell which to pick; worse, pairing the two to each
 * other "connects" a league to itself and passes every uniqueness check in the
 * schema.
 */
describe('the same Fantrax league appearing twice', () => {
  it('drops the mirror League row and keeps the snapshot', () => {
    const rows = {
      pro: [],
      college: [
        { id: 'fx-1', platform: 'fantrax', name: 'Cream Bowl', season: 2026, role: 'college' as const, roleReason: '', linkedTo: null, linkId: null },
        { id: 'lg-9', platform: 'fantrax', name: 'Cream Bowl', season: 2026, role: 'college' as const, roleReason: '', linkedTo: null, linkId: null },
      ],
      alreadyLinked: [],
    }
    const out = collapseFantraxDuplicates(rows, [
      { id: 'lg-9', platform: 'fantrax', platformLeagueId: 'fx-1' },
    ])
    expect(out.college.map((l) => l.id)).toEqual(['fx-1'])
  })

  it('leaves non-Fantrax leagues alone', () => {
    const rows = {
      pro: [{ id: 'lg-1', platform: 'sleeper', name: 'Peach Bowl', season: 2026, role: 'pro' as const, roleReason: '', linkedTo: null, linkId: null }],
      college: [],
      alreadyLinked: [],
    }
    expect(collapseFantraxDuplicates(rows, []).pro).toHaveLength(1)
  })
})

describe('resolving the other half from a league', () => {
  /**
   * 🛑 FANTRAX IS STORED UNDER THE SNAPSHOT ID, NOT THE LEAGUE ID.
   * `FranchiseLeagueMember.leagueId` holds `League.id` for the pro side and
   * `FantraxLeague.id` for the college side. Looking up a Fantrax league by its
   * `League.id` finds no membership, and the league reports itself unpaired
   * while it is paired — silently, because "not paired" is a normal state.
   */
  it('looks a Fantrax league up by its snapshot id, not its League id', async () => {
    leagueFindUnique.mockResolvedValue({ id: 'lg-fx', platform: 'fantrax', platformLeagueId: 'fx-1' })
    memberFindFirst.mockResolvedValue(null)

    await resolvePairedHalf('lg-fx', USER)

    const where = memberFindFirst.mock.calls[0][0].where
    expect(where.leagueId).toBe('fx-1')
    expect(where.leagueId).not.toBe('lg-fx')
  })

  it('uses the League id for a non-Fantrax league', async () => {
    leagueFindUnique.mockResolvedValue({ id: 'lg-1', platform: 'sleeper', platformLeagueId: 'sleeper-999' })
    memberFindFirst.mockResolvedValue(null)

    await resolvePairedHalf('lg-1', USER)

    expect(memberFindFirst.mock.calls[0][0].where.leagueId).toBe('lg-1')
  })

  /** ⚠ A franchise read says which teams belong to someone — always owner-gated. */
  it('gates the lookup on franchise ownership', async () => {
    leagueFindUnique.mockResolvedValue({ id: 'lg-1', platform: 'sleeper', platformLeagueId: null })
    memberFindFirst.mockResolvedValue(null)

    await resolvePairedHalf('lg-1', USER)

    expect(memberFindFirst.mock.calls[0][0].where.link).toEqual({ ownerUserId: USER })
  })

  it('returns null for a league in no franchise — the ordinary case, not an error', async () => {
    leagueFindUnique.mockResolvedValue({ id: 'lg-1', platform: 'sleeper', platformLeagueId: null })
    memberFindFirst.mockResolvedValue(null)
    expect(await resolvePairedHalf('lg-1', USER)).toBeNull()
  })

  /**
   * ⚠ A FRANCHISE WITH ONE HALF IS A REAL STATE. The older `connect-league`
   * action only ever attached a college side, so half-built franchises exist.
   * Rendering one as a combined view shows a single league labelled as two.
   */
  it('reports a one-sided franchise as having no other half', async () => {
    leagueFindUnique.mockResolvedValue({ id: 'lg-1', platform: 'sleeper', platformLeagueId: null })
    memberFindFirst.mockResolvedValue({
      role: 'pro',
      link: { id: 'link-1', name: 'My franchise', members: [{ platform: 'sleeper', leagueId: 'lg-1', role: 'pro' }] },
    })
    const out = await resolvePairedHalf('lg-1', USER)
    expect(out).toMatchObject({ viewingRole: 'pro', other: null })
  })

  it('resolves the Fantrax half from a pro league, and links to its mirror', async () => {
    leagueFindUnique.mockResolvedValue({ id: 'lg-1', platform: 'sleeper', platformLeagueId: null })
    memberFindFirst.mockResolvedValue({
      role: 'pro',
      link: {
        id: 'link-1',
        name: 'Cream & Peach',
        members: [
          { platform: 'sleeper', leagueId: 'lg-1', role: 'pro', teamExternalId: '4' },
          { platform: 'fantrax', leagueId: 'fx-1', role: 'college', teamExternalId: 'Ciege82' },
        ],
      },
    })
    fantraxFindUnique.mockResolvedValue({
      id: 'fx-1',
      leagueName: 'Cream Bowl',
      season: 2026,
      userTeam: 'Ciege82',
      roster: [{ name: 'A' }, { name: 'B' }],
    })
    leagueFindFirst.mockResolvedValue({ id: 'lg-fx' })

    const out = await resolvePairedHalf('lg-1', USER)

    expect(out).toMatchObject({
      viewingRole: 'pro',
      franchiseName: 'Cream & Peach',
      other: { role: 'college', platform: 'fantrax', name: 'Cream Bowl', playerCount: 2, leagueId: 'lg-fx' },
    })
  })

  /**
   * ⚠ NULL PLAYER COUNT IS NOT ZERO. A roster that cannot be read must not
   * render as a manager who owns nobody — the screen prints the reason instead.
   */
  it('reports an unreadable Fantrax roster as a reason, not as zero players', async () => {
    leagueFindUnique.mockResolvedValue({ id: 'lg-1', platform: 'sleeper', platformLeagueId: null })
    memberFindFirst.mockResolvedValue({
      role: 'pro',
      link: {
        id: 'link-1',
        name: 'F',
        members: [
          { platform: 'sleeper', leagueId: 'lg-1', role: 'pro' },
          { platform: 'fantrax', leagueId: 'fx-1', role: 'college', teamExternalId: null },
        ],
      },
    })
    fantraxFindUnique.mockResolvedValue({ id: 'fx-1', leagueName: 'Cream Bowl', season: 2026, userTeam: 'X', roster: null })
    leagueFindFirst.mockResolvedValue(null)

    const out = await resolvePairedHalf('lg-1', USER)
    expect(out?.other?.playerCount).toBeNull()
    expect(out?.other?.unavailableReason).toMatch(/no roster/i)
  })

  /**
   * 🛑 `Roster` KEYS ON `platformUserId`, NOT the team's `externalId`. Querying
   * the wrong column returns null for a team with a full roster, which renders
   * as "no roster on file" and reads as broken ingestion.
   */
  it('reads the pro roster by platformUserId, and only for the claimed team', async () => {
    leagueFindUnique.mockResolvedValue({ id: 'fx-lg', platform: 'fantrax', platformLeagueId: 'fx-1' })
    memberFindFirst.mockResolvedValue({
      role: 'college',
      link: {
        id: 'link-1',
        name: 'F',
        members: [
          { platform: 'fantrax', leagueId: 'fx-1', role: 'college' },
          { platform: 'sleeper', leagueId: 'lg-1', role: 'pro', teamExternalId: '4' },
        ],
      },
    })
    leagueFindUnique.mockResolvedValueOnce({ id: 'fx-lg', platform: 'fantrax', platformLeagueId: 'fx-1' })
    leagueFindUnique.mockResolvedValue({ id: 'lg-1', name: 'Peach Bowl', season: 2026 })
    teamFindFirst.mockResolvedValue({ teamName: 'Ciege82', ownerName: null, externalId: '4', platformUserId: 'sleeper-user-77' })
    rosterFindFirst.mockResolvedValue({ playerData: { players: ['a', 'b', 'c'] } })

    const out = await resolvePairedHalf('fx-lg', USER)

    expect(teamFindFirst.mock.calls[0][0].where.claimedByUserId).toBe(USER)
    /*
     * ⚠ BOTH ID SPACES, VIEWER FIRST. `Roster.platformUserId` holds the PLATFORM
     * id for managers we imported but the AllFantasy `AppUser.id` for the team
     * the viewer has CLAIMED. Measured on production: 12 teams, 11 keys matched
     * and the one that did not was the viewer's, whose 50-player roster sat
     * under the AppUser id. Asserting a single key here is what let that ship —
     * the panel reported "no roster on file" for a roster that existed.
     */
    expect(rosterFindFirst.mock.calls[0][0].where.platformUserId).toEqual({
      in: [USER, 'sleeper-user-77'],
    })
    /* Still scoped to a team the viewer actually claimed — this is what stops
       the fallback picking up a stranger's squad. */
    expect(teamFindFirst.mock.calls[0][0].where.claimedByUserId).toBe(USER)
    expect(out?.other?.playerCount).toBe(3)
    expect(out?.viewingRole).toBe('college')
  })

  /**
   * ⚠ NO CLAIMED TEAM MEANS NO ROSTER TO READ. Falling back to "any roster in
   * the league" would attribute a stranger's squad to the viewer — the same
   * guess `importFantraxLeague` refuses to make.
   */
  it('does not read a roster at all when no team is claimed', async () => {
    leagueFindUnique.mockResolvedValueOnce({ id: 'fx-lg', platform: 'fantrax', platformLeagueId: 'fx-1' })
    leagueFindUnique.mockResolvedValue({ id: 'lg-1', name: 'Peach Bowl', season: 2026 })
    memberFindFirst.mockResolvedValue({
      role: 'college',
      link: {
        id: 'link-1',
        name: 'F',
        members: [
          { platform: 'fantrax', leagueId: 'fx-1', role: 'college' },
          { platform: 'sleeper', leagueId: 'lg-1', role: 'pro', teamExternalId: null },
        ],
      },
    })
    teamFindFirst.mockResolvedValue(null)

    const out = await resolvePairedHalf('fx-lg', USER)

    expect(rosterFindFirst).not.toHaveBeenCalled()
    expect(out?.other?.playerCount).toBeNull()
  })

  /**
   * 🛑 NO DRAFT ROW ON A LEAGUE WITH FULL ROSTERS IS A GAP IN OUR DATA, NOT A
   * FACT ABOUT THE LEAGUE. Measured on production: neither half of the paired
   * franchise has a DraftSession, yet both have full rosters and obviously
   * drafted. Rendering silence would imply otherwise, and the league home one
   * panel down already says so in as many words — two different stories about
   * one league on one screen is the failure this prevents.
   */
  it('infers a finished draft from a populated roster when no draft row exists', async () => {
    leagueFindUnique.mockResolvedValue({ id: 'lg-1', platform: 'sleeper', platformLeagueId: null })
    memberFindFirst.mockResolvedValue({
      role: 'pro',
      link: {
        id: 'link-1',
        name: 'F',
        members: [
          { platform: 'sleeper', leagueId: 'lg-1', role: 'pro', teamExternalId: '4' },
          { platform: 'fantrax', leagueId: 'fx-1', role: 'college', teamExternalId: 'Ciege82' },
        ],
      },
    })
    fantraxFindUnique.mockResolvedValue({ id: 'fx-1', leagueName: 'C', season: 2026, userTeam: 'Ciege82', roster: [{ name: 'A' }] })
    leagueFindFirst.mockResolvedValue({ id: 'lg-fx' })
    teamFindFirst.mockResolvedValue({ teamName: 'T', ownerName: null, externalId: '4', platformUserId: 'sleeper-77' })
    rosterFindFirst.mockResolvedValue({ playerData: { players: [1, 2, 3] } })
    draftHqAll.mockResolvedValue({ rows: [], counts: {}, withoutDraft: 2 })

    const out = await resolvePairedHalf('lg-1', USER)

    expect(out?.self?.draft?.headline).toContain('draft has ended')
    expect(out?.self?.draft?.detail).toContain('did not capture the board')
    /* Inferred, so there is no board to open — a link would 404 into an empty HQ. */
    expect(out?.self?.draft?.href).toBeNull()
  })

  /**
   * ⚠ AND IT MUST NOT INFER FROM A ROSTER WE NEVER READ. `playerCount` is null
   * exactly when the roster is unreadable; guessing a draft from that would be a
   * guess dressed as a finding.
   */
  it('does not infer a draft when the roster could not be read', async () => {
    leagueFindUnique.mockResolvedValue({ id: 'lg-1', platform: 'sleeper', platformLeagueId: null })
    memberFindFirst.mockResolvedValue({
      role: 'pro',
      link: {
        id: 'link-1',
        name: 'F',
        members: [
          { platform: 'sleeper', leagueId: 'lg-1', role: 'pro', teamExternalId: '4' },
          { platform: 'fantrax', leagueId: 'fx-1', role: 'college', teamExternalId: null },
        ],
      },
    })
    fantraxFindUnique.mockResolvedValue({ id: 'fx-1', leagueName: 'C', season: 2026, userTeam: 'Ciege82', roster: null })
    leagueFindFirst.mockResolvedValue(null)
    teamFindFirst.mockResolvedValue(null)
    rosterFindFirst.mockResolvedValue(null)
    draftHqAll.mockResolvedValue({ rows: [], counts: {}, withoutDraft: 2 })

    const out = await resolvePairedHalf('lg-1', USER)

    expect(out?.other?.playerCount).toBeNull()
    expect(out?.other?.draft).toBeNull()
  })

  /**
   * 🛑 "NO TRADES" AND "WE CANNOT READ TRADES" ARE DIFFERENT CLAIMS ABOUT A
   * LEAGUE. Fantrax publishes no transactions endpoint — the word does not
   * appear in its documentation, as fantraxApi.ts records — so its half must
   * report the REASON rather than a zero. Measured on production: this
   * franchise's Sleeper half has 181 activity rows and its Fantrax half 0, and
   * the difference is the vendor's API rather than how active the manager is.
   */
  it('reports a Fantrax half as unable to read transactions, never as zero trades', async () => {
    leagueFindUnique.mockResolvedValue({ id: 'lg-1', platform: 'sleeper', platformLeagueId: null })
    memberFindFirst.mockResolvedValue({
      role: 'pro',
      link: {
        id: 'link-1',
        name: 'F',
        members: [
          { platform: 'sleeper', leagueId: 'lg-1', role: 'pro', teamExternalId: '4' },
          { platform: 'fantrax', leagueId: 'fx-1', role: 'college', teamExternalId: 'Ciege82' },
        ],
      },
    })
    fantraxFindUnique.mockResolvedValue({ id: 'fx-1', leagueName: 'C', season: 2026, userTeam: 'Ciege82', roster: [{ name: 'A' }] })
    leagueFindFirst.mockResolvedValue({ id: 'lg-fx' })
    teamFindFirst.mockResolvedValue({ teamName: 'T', ownerName: null, externalId: '4', platformUserId: 'sleeper-77' })
    rosterFindFirst.mockResolvedValue({ playerData: { players: [1, 2, 3] } })
    leagueActivity.mockResolvedValue({ items: [], counts: { trade: 2, waiver: 44, rosterMove: 14 }, newest: new Date('2026-08-19'), unattributed: 0 })

    const out = await resolvePairedHalf('lg-1', USER)

    /* The Sleeper half carries real counts. */
    expect(out?.self?.activity).toMatchObject({ available: true, trades: 2, waivers: 44 })
    /* The Fantrax half carries a reason, and never a zero that reads as a fact
       about the manager. */
    expect(out?.other?.activity?.available).toBe(false)
    expect((out?.other?.activity as { reason: string }).reason).toContain('no transactions endpoint')
    expect(out?.other?.activity).not.toHaveProperty('trades')
  })
})
