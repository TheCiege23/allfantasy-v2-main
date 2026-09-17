/**
 * The single enforcement point for `Roster.redraftRosterId`.
 *
 * 🛑 WHY THIS IS ONE FUNCTION AND WHY IT NEEDS REAL COVERAGE. `Roster` is created in at least
 * twelve places and `RedraftRoster` in eight. Setting the link at each would be twenty copies of one
 * rule, and the next site added breaks the invariant with nothing failing — which is precisely how
 * the two guillotine engines came to disagree about what a team is. The rule lives in one place, so
 * that place carries the whole burden of being right.
 *
 * ⚠ AND THE COLUMN DECAYS WITHOUT THE LAZY PATH. The migration backfilled 2,737 of 3,267 rosters on
 * 2026-09-04. Nothing else writes it, so every roster created afterwards holds NULL — and measured
 * that same day, the newest 45 rows linked at 36% against 84% for the established population. A
 * consumer reading the raw column would serve fewer and fewer teams while looking correct. That is
 * the `ingestCFBDStats` failure, and `resolveRedraftRosterId` is what stops it.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  rosterFindMany: vi.fn(),
  rosterFindUnique: vi.fn(),
  rosterUpdate: vi.fn(),
  redraftFindMany: vi.fn(),
  leagueTeamFindMany: vi.fn(),
}))

vi.mock('server-only', () => ({}))
vi.mock('@/lib/prisma', () => ({
  prisma: {
    roster: { findMany: h.rosterFindMany, findUnique: h.rosterFindUnique, update: h.rosterUpdate },
    redraftRoster: { findMany: h.redraftFindMany },
    leagueTeam: { findMany: h.leagueTeamFindMany },
  },
}))

import {
  reconcileRosterRedraftLinks,
  resolveRedraftRosterId,
} from '@/lib/league-runtime/reconcileRosterRedraftLinks'

beforeEach(() => {
  vi.resetAllMocks()
  h.rosterUpdate.mockResolvedValue({})
  h.rosterFindMany.mockResolvedValue([])
  h.redraftFindMany.mockResolvedValue([])
  h.leagueTeamFindMany.mockResolvedValue([])
})

describe('reconcileRosterRedraftLinks', () => {
  it('links a roster to the redraft roster with the same owner', async () => {
    h.rosterFindMany
      .mockResolvedValueOnce([{ id: 'r1', platformUserId: '111', redraftRosterId: null }])
      .mockResolvedValueOnce([]) // the already-taken query
    h.redraftFindMany.mockResolvedValue([{ id: 'rr1', ownerId: '111' }])

    const out = await reconcileRosterRedraftLinks('L1')

    expect(out).toEqual({ linked: 1, unlinked: 0, alreadyLinked: 0 })
    expect(h.rosterUpdate).toHaveBeenCalledWith({
      where: { id: 'r1' },
      data: { redraftRosterId: 'rr1' },
    })
  })

  it('🛑 leaves an unresolvable roster NULL and counts it rather than guessing', async () => {
    h.rosterFindMany
      .mockResolvedValueOnce([{ id: 'r1', platformUserId: 'app-uuid', redraftRosterId: null }])
      .mockResolvedValueOnce([])
    h.redraftFindMany.mockResolvedValue([]) // no counterpart

    const out = await reconcileRosterRedraftLinks('L1')

    expect(out).toEqual({ linked: 0, unlinked: 1, alreadyLinked: 0 })
    expect(h.rosterUpdate).not.toHaveBeenCalled()
  })

  it('is idempotent — a second run writes nothing', async () => {
    h.rosterFindMany.mockResolvedValue([
      { id: 'r1', platformUserId: '111', redraftRosterId: 'rr1' },
    ])

    const out = await reconcileRosterRedraftLinks('L1')

    expect(out).toEqual({ linked: 0, unlinked: 0, alreadyLinked: 1 })
    expect(h.rosterUpdate).not.toHaveBeenCalled()
    // Nothing to resolve, so it must not even ask.
    expect(h.redraftFindMany).not.toHaveBeenCalled()
  })

  it('🛑 never lets two rosters claim one redraft roster', async () => {
    /*
     * `redraftRosterId` is UNIQUE, so a double-claim would throw. The right response is to leave
     * both alone and let the count show it, not to pick a winner. Production had zero double-claims
     * when the constraint was added, so this is a guard rather than a workaround — but a guard that
     * is never exercised is not a guard.
     */
    h.rosterFindMany
      .mockResolvedValueOnce([
        { id: 'r1', platformUserId: '111', redraftRosterId: null },
        { id: 'r2', platformUserId: '111', redraftRosterId: null },
      ])
      .mockResolvedValueOnce([])
    h.redraftFindMany.mockResolvedValue([{ id: 'rr1', ownerId: '111' }])

    const out = await reconcileRosterRedraftLinks('L1')

    expect(out.linked).toBe(1)
    expect(out.unlinked).toBe(1)
    expect(h.rosterUpdate).toHaveBeenCalledTimes(1)
  })

  it('🛑 scopes the match by league, so a manager is not linked across leagues', async () => {
    h.rosterFindMany
      .mockResolvedValueOnce([{ id: 'r1', platformUserId: '111', redraftRosterId: null }])
      .mockResolvedValueOnce([])
    h.redraftFindMany.mockResolvedValue([{ id: 'rr1', ownerId: '111' }])

    await reconcileRosterRedraftLinks('L1')

    /*
     * A platform user id is unique only WITHIN a league — the same manager appears in many. The
     * migration's backfill carried this guard and produced cross_league_links = 0; dropping it here
     * would wire a roster to that manager's team in a different league, which no test of the happy
     * path would notice.
     */
    expect(h.redraftFindMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ leagueId: 'L1' }) }),
    )
    expect(h.rosterFindMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ leagueId: 'L1' }) }),
    )
  })

  it('does nothing on a league with no rosters', async () => {
    h.rosterFindMany.mockResolvedValue([])
    const out = await reconcileRosterRedraftLinks('L1')
    expect(out).toEqual({ linked: 0, unlinked: 0, alreadyLinked: 0 })
  })
})

describe('resolveRedraftRosterId — the guard against decay', () => {
  it('returns the stored link without reconciling', async () => {
    h.rosterFindUnique.mockResolvedValue({ redraftRosterId: 'rr1' })

    expect(await resolveRedraftRosterId('L1', 'r1')).toBe('rr1')
    // The whole point of storing it: no reconcile when the column already answers.
    expect(h.rosterFindMany).not.toHaveBeenCalled()
  })

  it('🛑 reconciles when the column is null, then returns the new link', async () => {
    /*
     * The decay guard. A roster created after the backfill holds NULL forever unless something
     * fills it, and this is that something — on the read path, where it cannot be forgotten.
     */
    h.rosterFindUnique
      .mockResolvedValueOnce({ redraftRosterId: null })
      .mockResolvedValueOnce({ redraftRosterId: 'rr-new' })
    h.rosterFindMany
      .mockResolvedValueOnce([{ id: 'r1', platformUserId: '111', redraftRosterId: null }])
      .mockResolvedValueOnce([])
    h.redraftFindMany.mockResolvedValue([{ id: 'rr-new', ownerId: '111' }])

    expect(await resolveRedraftRosterId('L1', 'r1')).toBe('rr-new')
    expect(h.rosterFindMany).toHaveBeenCalled()
  })

  it('returns null when there is genuinely no counterpart, even after reconciling', async () => {
    h.rosterFindUnique.mockResolvedValue({ redraftRosterId: null })
    h.rosterFindMany
      .mockResolvedValueOnce([{ id: 'r1', platformUserId: 'app-uuid', redraftRosterId: null }])
      .mockResolvedValueOnce([])
    h.redraftFindMany.mockResolvedValue([])

    // Null means "no known counterpart" — a caller must not read it as "not eliminated".
    expect(await resolveRedraftRosterId('L1', 'r1')).toBeNull()
  })

  it('returns null for a roster that does not exist', async () => {
    h.rosterFindUnique.mockResolvedValue(null)
    h.rosterFindMany.mockResolvedValue([])
    expect(await resolveRedraftRosterId('L1', 'nope')).toBeNull()
  })
})

// ── A CLAIMED ROSTER IS FOUND THROUGH ITS IMPORT RECORD ─────────────────────────────────────────

/*
 * Fakes that honour `where`, so a reconciler that asks the wrong question gets the wrong rows rather
 * than every fixture row regardless. The call SHAPE decides the answer here, not the call ORDER.
 */
type RosterRow = {
  id: string
  leagueId: string
  platformUserId: string
  redraftRosterId: string | null
  playerData?: unknown
}
type RedraftRow = { id: string; leagueId: string; ownerId: string }
type TeamRow = { id: string; leagueId: string; externalId: string; platformUserId: string | null }

function world(rosters: RosterRow[], redraft: RedraftRow[], teams: TeamRow[] = []) {
  h.rosterFindMany.mockImplementation(
    async (args: { where: Record<string, any>; select: Record<string, boolean> }) => {
      const w = args.where
      let rows = rosters
      if (w.leagueId !== undefined) rows = rows.filter((r) => r.leagueId === w.leagueId)
      if (w.id?.in) rows = rows.filter((r) => w.id.in.includes(r.id))
      if (w.redraftRosterId?.not === null) rows = rows.filter((r) => r.redraftRosterId != null)
      return rows.map((r) =>
        Object.fromEntries(Object.keys(args.select).map((k) => [k, (r as any)[k]])),
      )
    },
  )
  h.leagueTeamFindMany.mockImplementation(async (args: { where: Record<string, any> }) => {
    const w = args.where
    let rows = teams
    if (w.leagueId !== undefined) rows = rows.filter((t) => t.leagueId === w.leagueId)
    if (w.externalId?.in) rows = rows.filter((t) => w.externalId.in.includes(t.externalId))
    return rows.map(({ id, externalId, platformUserId }) => ({ id, externalId, platformUserId }))
  })
  h.redraftFindMany.mockImplementation(async (args: { where: Record<string, any> }) => {
    const w = args.where
    let rows = redraft
    if (w.leagueId !== undefined) rows = rows.filter((r) => r.leagueId === w.leagueId)
    if (w.ownerId?.in) rows = rows.filter((r) => w.ownerId.in.includes(r.ownerId))
    return rows.map(({ id, ownerId }) => ({ id, ownerId }))
  })
}

const AF_USER = '651c92f9-e89f-45c5-a7f3-7c4a1af4a858'
const SLEEPER_USER = '266066723277377536'
const imported = (sourceManagerId: unknown) => ({
  players: ['9225'],
  import: { sourceManagerId, sourceTeamId: '5' },
})
const linkedTo = () =>
  h.rosterUpdate.mock.calls.map(([a]) => [a.where.id, a.data.redraftRosterId])

describe('reconcileRosterRedraftLinks — a claimed roster links through playerData.import.sourceManagerId', () => {
  /*
   * THE REGRESSION. Claiming rewrites `Roster.platformUserId` to the AF user id, while
   * `RedraftRoster.ownerId` keeps the Sleeper id. Measured 2026-09-12: 333 of 333 claimed Sleeper
   * rosters unlinked, so every claimed team's RedraftRoster stayed empty. The import record still
   * carries the Sleeper id (equal to `LeagueTeam.platformUserId` on 333 of 333), on the roster itself.
   */
  it('links a claimed roster whose platformUserId is an AF user id', async () => {
    world(
      [
        {
          id: 'r-claimed',
          leagueId: 'L1',
          platformUserId: AF_USER,
          redraftRosterId: null,
          playerData: imported(SLEEPER_USER),
        },
      ],
      [{ id: 'rr-claimed', leagueId: 'L1', ownerId: SLEEPER_USER }],
    )
    const out = await reconcileRosterRedraftLinks('L1')
    expect(linkedTo()).toEqual([['r-claimed', 'rr-claimed']])
    expect(out).toEqual({ linked: 1, unlinked: 0, alreadyLinked: 0 })
  })

  it('🛑 the platform id still wins: a direct owner takes its redraft roster before any import record', async () => {
    /*
     * A stale import record naming the same manager as a roster that owns it directly must not take
     * the target first. Direct matches are settled in full before the fallback runs, so this does not
     * depend on row order: the claimed roster is listed FIRST on purpose.
     */
    world(
      [
        {
          id: 'r-stale',
          leagueId: 'L1',
          platformUserId: AF_USER,
          redraftRosterId: null,
          playerData: imported('111'),
        },
        { id: 'r-direct', leagueId: 'L1', platformUserId: '111', redraftRosterId: null },
      ],
      [{ id: 'rr1', leagueId: 'L1', ownerId: '111' }],
    )
    const out = await reconcileRosterRedraftLinks('L1')
    expect(linkedTo()).toEqual([['r-direct', 'rr1']])
    expect(out).toEqual({ linked: 1, unlinked: 1, alreadyLinked: 0 })
  })

  it('🛑 excludes a target another roster already holds, rather than overwriting it', async () => {
    world(
      [
        { id: 'r-holder', leagueId: 'L1', platformUserId: '999', redraftRosterId: 'rr-claimed' },
        {
          id: 'r-claimed',
          leagueId: 'L1',
          platformUserId: AF_USER,
          redraftRosterId: null,
          playerData: imported(SLEEPER_USER),
        },
      ],
      [{ id: 'rr-claimed', leagueId: 'L1', ownerId: SLEEPER_USER }],
    )
    const out = await reconcileRosterRedraftLinks('L1')
    expect(h.rosterUpdate).not.toHaveBeenCalled()
    expect(out).toEqual({ linked: 0, unlinked: 1, alreadyLinked: 1 })
  })

  it('🛑 refuses when two rosters carry the same import record: neither links, no winner is picked', async () => {
    world(
      [
        {
          id: 'r-a',
          leagueId: 'L1',
          platformUserId: AF_USER,
          redraftRosterId: null,
          playerData: imported(SLEEPER_USER),
        },
        {
          id: 'r-b',
          leagueId: 'L1',
          platformUserId: 'other-af-user',
          redraftRosterId: null,
          playerData: imported(SLEEPER_USER),
        },
      ],
      [{ id: 'rr-claimed', leagueId: 'L1', ownerId: SLEEPER_USER }],
    )
    const out = await reconcileRosterRedraftLinks('L1')
    expect(h.rosterUpdate).not.toHaveBeenCalled()
    expect(out.unlinked).toBe(2)
  })

  it('🛑 refuses when the import record names an owner with more than one redraft roster', async () => {
    world(
      [
        {
          id: 'r-claimed',
          leagueId: 'L1',
          platformUserId: AF_USER,
          redraftRosterId: null,
          playerData: imported(SLEEPER_USER),
        },
      ],
      [
        { id: 'rr-2025', leagueId: 'L1', ownerId: SLEEPER_USER },
        { id: 'rr-2026', leagueId: 'L1', ownerId: SLEEPER_USER },
      ],
    )
    await reconcileRosterRedraftLinks('L1')
    expect(h.rosterUpdate).not.toHaveBeenCalled()
  })

  it('🛑 scopes the fallback by league, so an import record never reaches another league', async () => {
    world(
      [
        {
          id: 'r-claimed',
          leagueId: 'L1',
          platformUserId: AF_USER,
          redraftRosterId: null,
          playerData: imported(SLEEPER_USER),
        },
      ],
      [{ id: 'rr-elsewhere', leagueId: 'L2', ownerId: SLEEPER_USER }],
    )
    const out = await reconcileRosterRedraftLinks('L1')
    expect(h.rosterUpdate).not.toHaveBeenCalled()
    expect(out).toEqual({ linked: 0, unlinked: 1, alreadyLinked: 0 })
  })

  it.each([
    ['no playerData', undefined],
    ['no import record', { players: [] }],
    ['an empty sourceManagerId', imported('')],
    ['a whitespace sourceManagerId', imported('   ')],
    ['a non-string sourceManagerId', imported(266066723277377536)],
  ])('leaves a roster with %s unlinked', async (_label, playerData) => {
    world(
      [{ id: 'r-claimed', leagueId: 'L1', platformUserId: AF_USER, redraftRosterId: null, playerData }],
      [
        { id: 'rr-claimed', leagueId: 'L1', ownerId: SLEEPER_USER },
        { id: 'rr-blank', leagueId: 'L1', ownerId: '' },
        { id: 'rr-space', leagueId: 'L1', ownerId: '   ' },
      ],
    )
    const out = await reconcileRosterRedraftLinks('L1')
    expect(h.rosterUpdate).not.toHaveBeenCalled()
    expect(out.unlinked).toBe(1)
  })

  it('does not read playerData when every roster resolves by platform id', async () => {
    // playerData carries the whole roster blob; the fallback must cost nothing when it is not needed.
    world(
      [{ id: 'r1', leagueId: 'L1', platformUserId: '111', redraftRosterId: null, playerData: imported('111') }],
      [{ id: 'rr1', leagueId: 'L1', ownerId: '111' }],
    )
    await reconcileRosterRedraftLinks('L1')
    const selects = h.rosterFindMany.mock.calls.map(([a]) => Object.keys(a.select))
    expect(selects.flat()).not.toContain('playerData')
    expect(linkedTo()).toEqual([['r1', 'rr1']])
  })
})

// ── AN ORPHAN TEAM LINKS THROUGH THE TEAM, BECAUSE NEITHER SIDE HAS A MANAGER ──────────────────

/*
 * 🛑 THE LAST GAP. A managerless team's redraft roster is keyed by `LeagueTeam.id` (the season
 * materializer's fallback) and its `Roster` by `orphan-<provider>-<teamId>` (#1005). No manager id
 * exists on either side, so no owner rule can join them — and an unlinked roster is skipped when
 * players are materialized, leaving those teams empty for good. Measured in production 2026-09-17:
 * 280 unlinked imported rosters, 240 with exactly one free redraft roster for their team (183 of
 * them orphan rosters), 0 ambiguous.
 */
const orphanRoster = (over: Partial<RosterRow> = {}): RosterRow => ({
  id: 'r-orphan',
  leagueId: 'L1',
  platformUserId: 'orphan-sleeper-7',
  redraftRosterId: null,
  playerData: { players: ['9225'], source_team_id: '7' },
  ...over,
})
const team = (over: Partial<TeamRow> = {}): TeamRow => ({
  id: 'team-row-7',
  leagueId: 'L1',
  externalId: '7',
  platformUserId: null,
  ...over,
})

describe('reconcileRosterRedraftLinks — an orphan team links through its team', () => {
  it('links the orphan roster to the redraft roster keyed by the team row', async () => {
    world([orphanRoster()], [{ id: 'rr-7', leagueId: 'L1', ownerId: 'team-row-7' }], [team()])
    const out = await reconcileRosterRedraftLinks('L1')
    expect(linkedTo()).toEqual([['r-orphan', 'rr-7']])
    expect(out).toEqual({ linked: 1, unlinked: 0, alreadyLinked: 0 })
  })

  it('reads the team id from the import record too', async () => {
    world(
      [orphanRoster({ playerData: { players: [], import: { sourceTeamId: '7' } } })],
      [{ id: 'rr-7', leagueId: 'L1', ownerId: 'team-row-7' }],
      [team()],
    )
    expect(await reconcileRosterRedraftLinks('L1')).toMatchObject({ linked: 1 })
  })

  it('🛑 a manager match still wins the target first', async () => {
    // The orphan roster is listed FIRST, so this cannot pass on row order.
    world(
      [orphanRoster(), { id: 'r-direct', leagueId: 'L1', platformUserId: '111', redraftRosterId: null }],
      [{ id: 'rr-111', leagueId: 'L1', ownerId: '111' }],
      [team({ platformUserId: '111' })],
    )
    const out = await reconcileRosterRedraftLinks('L1')
    expect(linkedTo()).toEqual([['r-direct', 'rr-111']])
    expect(out).toEqual({ linked: 1, unlinked: 1, alreadyLinked: 0 })
  })

  it('🛑 refuses when two rosters name one team', async () => {
    world(
      [orphanRoster(), orphanRoster({ id: 'r-dup', platformUserId: 'orphan-sleeper-7b' })],
      [{ id: 'rr-7', leagueId: 'L1', ownerId: 'team-row-7' }],
      [team()],
    )
    const out = await reconcileRosterRedraftLinks('L1')
    expect(linkedTo()).toEqual([])
    expect(out).toEqual({ linked: 0, unlinked: 2, alreadyLinked: 0 })
  })

  it('🛑 refuses when the team has two free redraft rosters', async () => {
    world(
      [orphanRoster()],
      [
        { id: 'rr-7', leagueId: 'L1', ownerId: 'team-row-7' },
        { id: 'rr-7b', leagueId: 'L1', ownerId: '111' },
      ],
      [team({ platformUserId: '111' })],
    )
    expect(await reconcileRosterRedraftLinks('L1')).toEqual({ linked: 0, unlinked: 1, alreadyLinked: 0 })
    expect(linkedTo()).toEqual([])
  })

  it('🛑 never takes a redraft roster another roster already holds', async () => {
    world(
      [orphanRoster(), { id: 'r-holder', leagueId: 'L1', platformUserId: '999', redraftRosterId: 'rr-7' }],
      [{ id: 'rr-7', leagueId: 'L1', ownerId: 'team-row-7' }],
      [team()],
    )
    const out = await reconcileRosterRedraftLinks('L1')
    expect(linkedTo()).toEqual([])
    expect(out).toEqual({ linked: 0, unlinked: 1, alreadyLinked: 1 })
  })

  it('leaves a roster with no team id alone', async () => {
    world(
      [orphanRoster({ playerData: { players: [] } })],
      [{ id: 'rr-7', leagueId: 'L1', ownerId: 'team-row-7' }],
      [team()],
    )
    expect(await reconcileRosterRedraftLinks('L1')).toEqual({ linked: 0, unlinked: 1, alreadyLinked: 0 })
  })

  it('🛑 asks for the team in THIS league only', async () => {
    world([orphanRoster()], [{ id: 'rr-7', leagueId: 'L1', ownerId: 'team-row-7' }], [team()])
    await reconcileRosterRedraftLinks('L1')
    expect(h.leagueTeamFindMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ leagueId: 'L1' }) }),
    )
  })

  it('does not read teams when every roster is already placed', async () => {
    world([{ id: 'r1', leagueId: 'L1', platformUserId: '111', redraftRosterId: null }], [{ id: 'rr1', leagueId: 'L1', ownerId: '111' }], [team()])
    await reconcileRosterRedraftLinks('L1')
    expect(h.leagueTeamFindMany).not.toHaveBeenCalled()
  })
})

it('🛑 a roster placed by its import record is not placed again by its team', async () => {
  /*
   * The import-record stage and the team stage can both name the same roster. If the first does not
   * record what it placed, the second links it a second time — to a different redraft roster.
   */
  world(
    [
      {
        id: 'r-claimed',
        leagueId: 'L1',
        platformUserId: AF_USER,
        redraftRosterId: null,
        playerData: { players: [], source_team_id: '7', import: { sourceManagerId: SLEEPER_USER, sourceTeamId: '7' } },
      },
    ],
    [
      { id: 'rr-by-manager', leagueId: 'L1', ownerId: SLEEPER_USER },
      { id: 'rr-by-team', leagueId: 'L1', ownerId: 'team-row-7' },
    ],
    [team()],
  )
  const out = await reconcileRosterRedraftLinks('L1')
  expect(linkedTo()).toEqual([['r-claimed', 'rr-by-manager']])
  expect(out).toEqual({ linked: 1, unlinked: 0, alreadyLinked: 0 })
})
