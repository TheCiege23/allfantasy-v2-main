import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * N4 — news recipient matching was incomplete and could be far too broad.
 *
 * The pending dispatcher selected recipients with a case-insensitive NAME SUBSTRING against
 * `redraftRosterPlayer`, with no sport, no season and no identity:
 *
 *     where: { playerName: { contains: row.playerName, mode: 'insensitive' }, droppedAt: null }
 *     take: 500
 *
 * `lib/workers/x-news-ingestion.ts` explicitly permits an unattributed headline and stores an
 * empty player name, so `contains: ''` matched every roster row and dispatched to the owners of
 * the first 500. No production misdelivery was measured; the input is reachable.
 *
 * ⚠ THE FIRST FIX FOR THIS INTRODUCED A SECOND WAY TO REACH THE WRONG ATHLETE, and these tests
 * pin the corrected contract. It matched the news `playerId` with
 * `OR: [{ sleeperId }, { rollingInsightsId }, { apiSportsId }, { espnId }, …]` — independent id
 * spaces of small integers, so Sleeper 4984 and Rolling Insights 4984 are different people and
 * the OR matches whichever row carries that number in any column.
 */

const h = vi.hoisted(() => ({
  identityFindFirst: vi.fn(),
  identityFindMany: vi.fn(),
  rosterPlayerFindMany: vi.fn(),
  profileFindMany: vi.fn(),
  rawQuery: vi.fn(),
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    playerIdentityMap: { findFirst: h.identityFindFirst, findMany: h.identityFindMany },
    redraftRosterPlayer: { findMany: h.rosterPlayerFindMany },
    userProfile: { findMany: h.profileFindMany },
    $queryRawUnsafe: h.rawQuery,
  },
}))

import {
  resolvePlayerNewsIdentity,
  resolvePlayerNewsRecipients,
  importedRosterHoldsPlayer,
  type ResolvedPlayerIdentity,
} from '@/lib/notifications/playerNewsRecipients'

const identityRow = (over: Record<string, unknown> = {}) => ({
  id: 'idn-1',
  sport: 'NFL',
  canonicalName: 'Bijan Robinson',
  currentTeam: 'ATL',
  sleeperId: '11560',
  rollingInsightsId: '101',
  apiSportsId: null,
  espnId: null,
  fantraxId: null,
  mflId: null,
  fleaflickerId: null,
  cfbdId: null,
  fantasyCalcId: null,
  ...over,
})

const identity = (over: Partial<ResolvedPlayerIdentity> = {}): ResolvedPlayerIdentity => ({
  identityId: 'idn-1',
  sport: 'NFL',
  canonicalName: 'Bijan Robinson',
  currentTeam: 'ATL',
  sleeperId: '11560',
  rollingInsightsId: '101',
  apiSportsId: null,
  espnId: null,
  fantraxId: null,
  mflId: null,
  fleaflickerId: null,
  cfbdId: null,
  fantasyCalcId: null,
  ...over,
})

const nativeRow = (ownerId: string, leagueId: string) => ({ roster: { ownerId, leagueId } })

const importedRow = (over: Record<string, unknown> = {}) => ({
  leagueId: 'league-imported',
  platformUserId: 'sleeper-99',
  playerData: { players: ['11560'] },
  redraftOwnerId: null,
  ...over,
})

beforeEach(() => {
  h.identityFindFirst.mockReset().mockResolvedValue(null)
  h.identityFindMany.mockReset().mockResolvedValue([identityRow()])
  h.rosterPlayerFindMany.mockReset().mockResolvedValue([])
  h.profileFindMany.mockReset().mockResolvedValue([])
  h.rawQuery.mockReset().mockResolvedValue([])
})

// ── Identity ────────────────────────────────────────────────────────────────

describe('empty and unresolvable subjects are held before any recipient query', () => {
  it('holds an empty player name and never queries', async () => {
    // The reproduction. `contains: ''` used to select the first 500 roster rows in the table.
    const res = await resolvePlayerNewsIdentity({ sport: 'NFL', playerName: '' })

    expect(res).toMatchObject({ status: 'held', reason: 'empty-identity' })
    expect(h.identityFindMany).not.toHaveBeenCalled()
    expect(h.identityFindFirst).not.toHaveBeenCalled()
    expect(h.rosterPlayerFindMany).not.toHaveBeenCalled()
  })

  it('holds whitespace-only and null names the same way', async () => {
    for (const playerName of ['   ', null, undefined]) {
      const res = await resolvePlayerNewsIdentity({ sport: 'NFL', playerName })
      expect(res).toMatchObject({ status: 'held', reason: 'empty-identity' })
    }
  })

  it('holds an item with no sport, because identity is only resolvable inside one', async () => {
    const res = await resolvePlayerNewsIdentity({ sport: '', playerName: 'Bijan Robinson' })
    expect(res).toMatchObject({ status: 'held', reason: 'empty-identity' })
  })

  it('holds a name that matches no identity row rather than falling back to a substring', async () => {
    h.identityFindMany.mockResolvedValue([])

    const res = await resolvePlayerNewsIdentity({ sport: 'NFL', playerName: 'Nobody Here' })

    expect(res).toMatchObject({ status: 'held', reason: 'no-identity-row' })
  })
})

describe('the id is looked up in its OWN namespace', () => {
  it('resolves the news playerId as a canonical PlayerIdentityMap id', async () => {
    // `resolveNewsPlayer` writes `PlayerIdentityMap.id`; `news-importer` says so in its own
    // comment: the canonical id wins because a provider id is a foreign namespace.
    h.identityFindFirst.mockResolvedValue(identityRow())

    const res = await resolvePlayerNewsIdentity({
      sport: 'NFL',
      playerId: 'idn-1',
      playerName: 'Bijan Robinson',
    })

    expect(res.status).toBe('resolved')
    expect(h.identityFindFirst.mock.calls[0][0].where).toMatchObject({ id: 'idn-1' })
  })

  it('NEVER fans a bare id across provider id columns', async () => {
    /*
     * The correction. Sleeper 4984 and Rolling Insights 4984 are different athletes; an OR over
     * every id column matches whichever row happens to carry that number in any of them.
     */
    h.identityFindFirst.mockResolvedValue(null)
    h.identityFindMany.mockResolvedValue([identityRow()])

    await resolvePlayerNewsIdentity({ sport: 'NFL', playerId: '4984', playerName: 'Josh Allen' })

    for (const call of h.identityFindFirst.mock.calls) {
      expect(call[0].where).not.toHaveProperty('OR')
    }
    for (const call of h.identityFindMany.mock.calls) {
      expect(call[0].where).not.toHaveProperty('OR')
      expect(call[0].where).toHaveProperty('normalizedName')
    }
  })

  it('falls back to the normalized name when the id is a foreign-namespace leftover', async () => {
    h.identityFindFirst.mockResolvedValue(null)
    h.identityFindMany.mockResolvedValue([identityRow()])

    const res = await resolvePlayerNewsIdentity({
      sport: 'NFL',
      playerId: '4984',
      playerName: 'Bijan Robinson',
    })

    expect(res.status).toBe('resolved')
  })

  it('holds when the id and the name disagree about who this is', async () => {
    // Two claims, no basis to prefer either. Choosing silently notifies the wrong manager.
    h.identityFindFirst.mockResolvedValue(identityRow({ canonicalName: 'Drake London' }))

    const res = await resolvePlayerNewsIdentity({
      sport: 'NFL',
      playerId: 'idn-1',
      playerName: 'Bijan Robinson',
    })

    expect(res).toMatchObject({ status: 'held', reason: 'conflicting-evidence' })
  })

  it('accepts a generational-suffix difference, because the normalizer folds it', async () => {
    h.identityFindFirst.mockResolvedValue(identityRow({ canonicalName: 'Michael Penix Jr.' }))

    const res = await resolvePlayerNewsIdentity({
      sport: 'NFL',
      playerId: 'idn-1',
      playerName: 'Michael Penix',
    })

    expect(res.status).toBe('resolved')
  })
})

describe('ambiguity is held, never broadcast', () => {
  it('refuses to choose between two athletes with the same normalized name', async () => {
    // 178 NFL duplicate groups are recorded in this repo as deliberately unmerged.
    h.identityFindMany.mockResolvedValue([
      identityRow({ id: 'a', canonicalName: 'Josh Allen', currentTeam: 'BUF', sleeperId: '4984' }),
      identityRow({ id: 'b', canonicalName: 'Josh Allen', currentTeam: 'JAX', sleeperId: '5045' }),
    ])

    const res = await resolvePlayerNewsIdentity({ sport: 'NFL', playerName: 'Josh Allen' })

    expect(res).toMatchObject({ status: 'held', reason: 'ambiguous-identity', candidates: 2 })
  })

  it('uses team as corroboration to narrow a duplicate group to exactly one', async () => {
    h.identityFindMany.mockResolvedValue([
      identityRow({ id: 'a', canonicalName: 'Josh Allen', currentTeam: 'BUF', sleeperId: '4984' }),
      identityRow({ id: 'b', canonicalName: 'Josh Allen', currentTeam: 'JAX', sleeperId: '5045' }),
    ])

    const res = await resolvePlayerNewsIdentity({
      sport: 'NFL',
      playerName: 'Josh Allen',
      team: 'BUF',
    })

    expect(res.status).toBe('resolved')
    expect(res.status === 'resolved' && res.identity.identityId).toBe('a')
  })

  it('stays held when the team narrows to zero — a contradiction is weaker than no team', async () => {
    h.identityFindMany.mockResolvedValue([
      identityRow({ id: 'a', currentTeam: 'BUF', canonicalName: 'Josh Allen' }),
      identityRow({ id: 'b', currentTeam: 'JAX', canonicalName: 'Josh Allen' }),
    ])

    const res = await resolvePlayerNewsIdentity({
      sport: 'NFL',
      playerName: 'Josh Allen',
      team: 'KC',
    })

    expect(res).toMatchObject({ status: 'held', reason: 'ambiguous-identity' })
  })
})

describe('identity is scoped to one sport', () => {
  it('passes the news item sport into the lookup', async () => {
    await resolvePlayerNewsIdentity({ sport: 'NCAAB', playerName: 'Duplicate Name' })

    expect(h.identityFindMany.mock.calls[0][0].where.sport).toMatchObject({ equals: 'NCAAB' })
  })

  it('compares sport case-insensitively, because the writers store "nfl"', async () => {
    await resolvePlayerNewsIdentity({ sport: 'nfl', playerName: 'Bijan Robinson' })
    expect(h.identityFindMany.mock.calls[0][0].where.sport).toMatchObject({ mode: 'insensitive' })
  })

  it('scopes the canonical-id lookup by sport too', async () => {
    h.identityFindFirst.mockResolvedValue(identityRow())
    await resolvePlayerNewsIdentity({ sport: 'NFL', playerId: 'idn-1', playerName: 'Bijan Robinson' })
    expect(h.identityFindFirst.mock.calls[0][0].where.sport).toMatchObject({ equals: 'NFL' })
  })
})

// ── Roster shapes ───────────────────────────────────────────────────────────

describe('importedRosterHoldsPlayer covers every stored shape', () => {
  it('matches a bare id array — what league-sync-core writes', () => {
    expect(importedRosterHoldsPlayer(['11560', '4984'], '11560')).toBe(true)
  })

  it('matches a players key', () => {
    expect(importedRosterHoldsPlayer({ players: ['11560'] }, '11560')).toBe(true)
  })

  it('matches object entries under playerId, player_id and id', () => {
    // JSONB containment cannot express this shape at all — it is why SQL over-selects and JS
    // confirms.
    expect(importedRosterHoldsPlayer([{ playerId: '11560' }], '11560')).toBe(true)
    expect(importedRosterHoldsPlayer({ players: [{ player_id: '11560' }] }, '11560')).toBe(true)
    expect(importedRosterHoldsPlayer({ players: [{ id: 11560 }] }, '11560')).toBe(true)
  })

  it('does not match a different id, or a malformed blob', () => {
    expect(importedRosterHoldsPlayer(['4984'], '11560')).toBe(false)
    expect(importedRosterHoldsPlayer(null, '11560')).toBe(false)
    expect(importedRosterHoldsPlayer({ nothing: true }, '11560')).toBe(false)
  })
})

// ── Recipients ──────────────────────────────────────────────────────────────

describe('native roster ownership', () => {
  it('scopes to current ownership: not dropped, active season, right sport', async () => {
    await resolvePlayerNewsRecipients(identity())

    const where = h.rosterPlayerFindMany.mock.calls[0][0].where
    expect(where.droppedAt).toBeNull()
    expect(where.sport).toMatchObject({ equals: 'NFL' })
    /*
     * 🛑 EXCLUDES FINISHED SEASONS; DOES NOT REQUIRE `'active'`.
     *
     * Filtering FOR `'active'` excluded every imported league: imports materialize as
     * `'in_season'`, Sleeper passes `pre_draft|drafting|in_season|complete` straight through,
     * and the schema default is `'setup'`. Only `finalizeDraftToRedraftSeason` writes
     * `'active'`. The whole imported population silently answered "nobody rosters them" — and
     * the caller stamped that terminally.
     */
    expect(where.roster.season.status).toHaveProperty('notIn')
    expect(where.roster.season.status.notIn).toContain('complete')
    expect(where.roster.season.status.notIn).not.toContain('in_season')
    expect(where.roster.season.status.notIn).not.toContain('setup')
  })

  it('reaches an imported league whose season is in_season', async () => {
    // The reproduction: this returned nobody before, for the majority of leagues.
    h.rosterPlayerFindMany.mockResolvedValue([nativeRow('user-1', 'league-imported')])

    const res = await resolvePlayerNewsRecipients(identity())

    expect(res.byUser.get('user-1')).toEqual(['league-imported'])
    expect(res.searchedAnything).toBe(true)
    expect(res.degraded).toBe(false)
  })

  it('reports degraded rather than empty when the roster query throws', async () => {
    // An empty audience from a failed query must not be stamped as "nobody rosters them".
    h.rosterPlayerFindMany.mockRejectedValue(new Error('statement timeout'))

    const res = await resolvePlayerNewsRecipients(identity())

    expect(res.byUser.size).toBe(0)
    expect(res.degraded).toBe(true)
  })

  it('reports searchedAnything=false when no id is searchable', async () => {
    const res = await resolvePlayerNewsRecipients(
      identity({ sleeperId: null, cfbdId: null, fantraxId: null }),
    )

    expect(res.searchedAnything).toBe(false)
    expect(res.degraded).toBe(false)
  })

  it('queries a NARROW id set — the draft-pool namespaces only, never every column', async () => {
    /*
     * A native roster row's `playerId` comes from the draft pool: Sleeper for pro, CFBD or
     * Fantrax for college (0 of 73,883 NCAAF SportsPlayer rows carry a sleeperId). Including
     * Rolling Insights or API-Sports ids here re-opens the cross-namespace collision.
     */
    await resolvePlayerNewsRecipients(identity())

    const ids = h.rosterPlayerFindMany.mock.calls[0][0].where.playerId.in
    expect(ids).toContain('11560')
    expect(ids).not.toContain('101')
  })

  it('returns one entry per user carrying every affected league', async () => {
    h.rosterPlayerFindMany.mockResolvedValue([
      nativeRow('user-1', 'league-a'),
      nativeRow('user-1', 'league-b'),
      nativeRow('user-2', 'league-a'),
    ])

    const res = await resolvePlayerNewsRecipients(identity())

    expect(res.byUser.size).toBe(2)
    expect(res.byUser.get('user-1')).toEqual(['league-a', 'league-b'])
    expect(res.byUser.get('user-2')).toEqual(['league-a'])
  })

  it('does not duplicate a league for the same user', async () => {
    h.rosterPlayerFindMany.mockResolvedValue([
      nativeRow('user-1', 'league-a'),
      nativeRow('user-1', 'league-a'),
    ])

    const res = await resolvePlayerNewsRecipients(identity())
    expect(res.byUser.get('user-1')).toEqual(['league-a'])
  })

  it('resolves nobody when the identity carries no draft-pool id', async () => {
    const res = await resolvePlayerNewsRecipients(
      identity({ sleeperId: null, cfbdId: null, fantraxId: null }),
    )

    expect(h.rosterPlayerFindMany).not.toHaveBeenCalled()
    expect(res.byUser.size).toBe(0)
  })
})

describe('imported rosters', () => {
  it('resolves a Sleeper owner through the linked AF profile', async () => {
    h.rawQuery.mockImplementation((_sql: string, platform: string) =>
      Promise.resolve(platform === 'sleeper' ? [importedRow()] : []),
    )
    h.profileFindMany.mockResolvedValue([{ userId: 'af-user-9', sleeperUserId: 'sleeper-99' }])

    const res = await resolvePlayerNewsRecipients(identity())

    expect(res.byUser.get('af-user-9')).toEqual(['league-imported'])
    expect(res.importedLinked).toBe(1)
  })

  it('reads the bare-array shape that league-sync-core writes', async () => {
    h.rawQuery.mockImplementation((_sql: string, platform: string) =>
      Promise.resolve(platform === 'sleeper' ? [importedRow({ playerData: ['11560', '4984'] })] : []),
    )
    h.profileFindMany.mockResolvedValue([{ userId: 'af-user-9', sleeperUserId: 'sleeper-99' }])

    const res = await resolvePlayerNewsRecipients(identity())
    expect(res.byUser.get('af-user-9')).toEqual(['league-imported'])
  })

  it('reads object-shaped roster entries', async () => {
    h.rawQuery.mockImplementation((_sql: string, platform: string) =>
      Promise.resolve(
        platform === 'sleeper' ? [importedRow({ playerData: [{ playerId: '11560' }] })] : [],
      ),
    )
    h.profileFindMany.mockResolvedValue([{ userId: 'af-user-9', sleeperUserId: 'sleeper-99' }])

    const res = await resolvePlayerNewsRecipients(identity())
    expect(res.byUser.get('af-user-9')).toEqual(['league-imported'])
  })

  it('discards a SQL row whose blob does not actually hold the player', async () => {
    // The `$.**` predicate deliberately over-selects; JS is the decision.
    h.rawQuery.mockImplementation((_sql: string, platform: string) =>
      Promise.resolve(
        platform === 'sleeper' ? [importedRow({ playerData: { faabRemaining: '11560' } })] : [],
      ),
    )
    h.profileFindMany.mockResolvedValue([{ userId: 'af-user-9', sleeperUserId: 'sleeper-99' }])

    const res = await resolvePlayerNewsRecipients(identity())
    expect(res.byUser.size).toBe(0)
  })

  it('links an ESPN team through Roster.redraftRosterId — never by guessing from the team id', async () => {
    /*
     * ESPN/Fantrax/Yahoo `platformUserId` is a TEAM identifier and names no person. The only
     * honest person-link is the real foreign key to the AF-native roster.
     */
    h.rawQuery.mockImplementation((_sql: string, platform: string) =>
      Promise.resolve(
        platform === 'espn'
          ? [
              importedRow({
                leagueId: 'league-espn',
                platformUserId: 'espn-team-4',
                playerData: ['espn-77'],
                redraftOwnerId: 'af-user-3',
              }),
            ]
          : [],
      ),
    )

    const res = await resolvePlayerNewsRecipients(identity({ espnId: 'espn-77' }))

    expect(res.byUser.get('af-user-3')).toEqual(['league-espn'])
  })

  it('NEVER resolves a non-Sleeper team id through sleeperUserId', async () => {
    /*
     * 🛑 The OR ran for every platform. A Fleaflicker TEAM id that happens to equal some
     * unrelated user's Sleeper USER id resolved to that person, and they were notified about a
     * league they have no connection to — counted as `importedLinked`, so it read as success.
     */
    h.rawQuery.mockImplementation((_sql: string, platform: string) =>
      Promise.resolve(
        platform === 'fleaflicker'
          ? [importedRow({ platformUserId: '864213', playerData: ['ff-9'] })]
          : [],
      ),
    )
    h.profileFindMany.mockResolvedValue([{ userId: 'af-stranger', sleeperUserId: '864213' }])

    const res = await resolvePlayerNewsRecipients(identity({ fleaflickerId: 'ff-9' }))

    expect(res.byUser.size).toBe(0)
    expect(res.importedUnlinked).toBe(1)
    // The query itself must not even ask about sleeperUserId for a non-Sleeper platform.
    const nonSleeperCalls = h.profileFindMany.mock.calls.filter(
      (c) => !JSON.stringify(c[0].where).includes('sleeperUserId'),
    )
    expect(nonSleeperCalls.length).toBeGreaterThan(0)
  })

  it('counts an unlinkable imported team instead of guessing a person from it', async () => {
    h.rawQuery.mockImplementation((_sql: string, platform: string) =>
      Promise.resolve(
        platform === 'espn'
          ? [importedRow({ platformUserId: 'espn-team-4', playerData: ['espn-77'] })]
          : [],
      ),
    )
    h.profileFindMany.mockResolvedValue([])

    const res = await resolvePlayerNewsRecipients(identity({ espnId: 'espn-77' }))

    expect(res.byUser.size).toBe(0)
    expect(res.importedUnlinked).toBe(1)
  })

  it('resolves a roster whose platformUserId is already an AF user id', async () => {
    // 23 imported rosters were measured carrying an app uuid rather than a platform id.
    h.rawQuery.mockImplementation((_sql: string, platform: string) =>
      Promise.resolve(
        platform === 'sleeper'
          ? [importedRow({ platformUserId: 'af-user-7', playerData: ['11560'] })]
          : [],
      ),
    )
    h.profileFindMany.mockResolvedValue([{ userId: 'af-user-7', sleeperUserId: null }])

    const res = await resolvePlayerNewsRecipients(identity())
    expect(res.byUser.get('af-user-7')).toEqual(['league-imported'])
  })

  it('includes linked co-managers when the stored blob preserved them', async () => {
    h.rawQuery.mockImplementation((_sql: string, platform: string) =>
      Promise.resolve(
        platform === 'sleeper'
          ? [importedRow({ playerData: { players: ['11560'], co_owners: ['sleeper-100'] } })]
          : [],
      ),
    )
    h.profileFindMany.mockResolvedValue([
      { userId: 'af-user-9', sleeperUserId: 'sleeper-99' },
      { userId: 'af-user-10', sleeperUserId: 'sleeper-100' },
    ])

    const res = await resolvePlayerNewsRecipients(identity())

    expect([...res.byUser.keys()].sort()).toEqual(['af-user-10', 'af-user-9'])
  })

  it('pins imported leagues to the current season', async () => {
    await resolvePlayerNewsRecipients(identity(), { season: 2026 })

    const sql = String(h.rawQuery.mock.calls[0][0])
    expect(sql).toContain('l.season')
    expect(h.rawQuery.mock.calls[0][4]).toBe(2026)
  })

  it('pins the season PER LEAGUE LINEAGE, not globally', async () => {
    /*
     * 🛑 The subquery was `MAX(season) WHERE platform = $1 AND sport = $2` — the newest season
     * anywhere in the table. One Sleeper league rolled over to 2027 pinned the predicate to
     * 2027 and excluded every 2026 league, silently, with the row then stamped `no-roster`.
     */
    await resolvePlayerNewsRecipients(identity())

    const sql = String(h.rawQuery.mock.calls[0][0])
    expect(sql).toContain('MAX(l2.season)')
    expect(sql).toContain('l2."platformLeagueId" = l."platformLeagueId"')
    expect(sql).toContain('l2."userId" = l."userId"')
    expect(h.rawQuery.mock.calls[0][4]).toBeNull()
  })

  it('asks ONE query that covers all three roster shapes at once', async () => {
    /*
     * 🛑 SPLITTING THIS INTO TWO SEQUENTIAL QUERIES WAS A CORRECTNESS BUG. The fallback was
     * gated on `rosters.length === 0`, but the three stored shapes are per-LEAGUE, not
     * per-athlete: Sleeper league A can store a bare array while league B stores object
     * entries. Containment matched A, the fallback never ran, and league B's manager was
     * silently dropped — then the row was stamped terminally.
     */
    h.rawQuery.mockResolvedValue([importedRow()])
    h.profileFindMany.mockResolvedValue([{ userId: 'af-user-9', sleeperUserId: 'sleeper-99' }])

    await resolvePlayerNewsRecipients(identity())

    const sleeperCalls = h.rawQuery.mock.calls.filter((c) => c[1] === 'sleeper')
    expect(sleeperCalls).toHaveLength(1)
    const sql = String(sleeperCalls[0][0])
    expect(sql).toContain('@>')
    expect(sql).toContain("->'players'")
    expect(sql).toContain('jsonb_path_exists')
  })

  it('binds every parameter its SQL references, and references every one it binds', async () => {
    /*
     * 🛑 THE SPLIT BOUND FIVE ARGUMENTS TO A STATEMENT NAMING ONLY $1, $2, $4 AND $5, leaving
     * $3 with no inferable type. One statement that uses all five removes the class of bug
     * rather than patching the instance.
     */
    await resolvePlayerNewsRecipients(identity())

    const call = h.rawQuery.mock.calls.find((c) => c[1] === 'sleeper')!
    const sql = String(call[0])
    const boundCount = call.length - 1
    for (let i = 1; i <= boundCount; i++) {
      expect(sql).toContain(`$${i}`)
    }
    const referenced = new Set((sql.match(/\$\d+/g) ?? []).map((m) => Number(m.slice(1))))
    expect(Math.max(...referenced)).toBe(boundCount)
  })

  it('returns BOTH leagues when one stores a bare array and the other object entries', async () => {
    // The exact miss the split produced.
    h.rawQuery.mockImplementation((_sql: string, platform: string) =>
      Promise.resolve(
        platform === 'sleeper'
          ? [
              importedRow({ leagueId: 'league-a', playerData: ['11560'] }),
              importedRow({
                leagueId: 'league-b',
                platformUserId: 'sleeper-100',
                playerData: [{ playerId: '11560' }],
              }),
            ]
          : [],
      ),
    )
    h.profileFindMany.mockResolvedValue([
      { userId: 'af-user-9', sleeperUserId: 'sleeper-99' },
      { userId: 'af-user-10', sleeperUserId: 'sleeper-100' },
    ])

    const res = await resolvePlayerNewsRecipients(identity())

    expect(res.byUser.get('af-user-9')).toEqual(['league-a'])
    expect(res.byUser.get('af-user-10')).toEqual(['league-b'])
  })

  it('scopes the imported query by platform and sport', async () => {
    await resolvePlayerNewsRecipients(identity({ sport: 'NCAAF', cfbdId: 'c-1' }))

    const sleeperCall = h.rawQuery.mock.calls.find((c) => c[1] === 'sleeper')
    expect(sleeperCall?.[2]).toBe('NCAAF')
    expect(sleeperCall?.[3]).toBe(JSON.stringify(['11560']))
  })

  it('reports platforms it could NOT search, distinctly from finding nobody', async () => {
    // Yahoo has no player-id column in PlayerIdentityMap at all.
    const res = await resolvePlayerNewsRecipients(identity())

    expect(res.unsearchedPlatforms).toContain('yahoo')
    expect(res.unsearchedPlatforms).toContain('espn')
    expect(res.unsearchedPlatforms).not.toContain('sleeper')
  })

  it('does not attempt an imported lookup for a platform with no id', async () => {
    await resolvePlayerNewsRecipients(identity({ sleeperId: null }))
    expect(h.rawQuery).not.toHaveBeenCalled()
  })

  it('keeps native recipients when the imported query throws', async () => {
    h.rosterPlayerFindMany.mockResolvedValue([nativeRow('user-1', 'league-a')])
    h.rawQuery.mockRejectedValue(new Error('jsonb_path_exists missing'))

    const res = await resolvePlayerNewsRecipients(identity())

    expect(res.byUser.get('user-1')).toEqual(['league-a'])
  })
})

describe('duplicate names across sports', () => {
  it('an NCAAB news item cannot reach an NFL roster row holding the same numeric id', async () => {
    const res = await resolvePlayerNewsRecipients(identity({ sport: 'NCAAB' }))

    expect(h.rosterPlayerFindMany.mock.calls[0][0].where.sport).toMatchObject({ equals: 'NCAAB' })
    expect(res.byUser.size).toBe(0)
  })
})
