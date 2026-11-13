// @vitest-environment node
/**
 * Canonical NFL `Player` copies: a TheSportsDB row with no Sleeper id, folded into the ONE
 * Sleeper-backed row with the same name and birthday. Measured on production 2026-11-09:
 * 479 such copies, 454 mergeable, 25 refused because TheSportsDB itself holds two records.
 * The dedupe script and the canonical backfill share this rule, so a re-run cannot rebuild
 * what the dedupe removed.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const db = vi.hoisted(() => ({
  sportsPlayer: { findMany: vi.fn() },
  sportsTeam: { findMany: vi.fn(async () => []) },
  player: { findMany: vi.fn() },
  playerProviderIdentity: { findMany: vi.fn() },
  playerIdentityMap: { findMany: vi.fn(async () => []) },
  $executeRawUnsafe: vi.fn(async () => 0),
}))
vi.mock('@/lib/prisma', () => ({ prisma: db }))

import {
  foldTargetsForUnkeyedGroups,
  mergedProviderIds,
  planDuplicatePlayerMerges,
  twinKey,
} from '@/lib/canonical/duplicatePlayerMerge'
import { backfillCanonicalPlayers } from '@/lib/canonical/backfillCanonical'

// James Cook, as measured: two identical rows, only one with a Sleeper id.
const keep = { id: 'nfl-james-cook-b73b6c59', name: 'James Cook', birthDate: '1999-09-25', providerIds: { sleeper: 'sleeper:8138' } }
const copy = { id: 'nfl-james-cook-ca4a051b', name: 'James Cook', birthDate: '1999-09-25', providerIds: { thesportsdb: 'tsdb_1' } }
const ident = (playerId: string, provider: string, providerPlayerId: string) => ({ playerId, provider, providerPlayerId })

describe('planDuplicatePlayerMerges', () => {
  it('folds a copy with no Sleeper id into its only Sleeper-backed twin', () => {
    const plan = planDuplicatePlayerMerges([keep, copy], [ident(keep.id, 'sleeper', '8138'), ident(copy.id, 'thesportsdb', 'tsdb_1')])
    expect(plan.merges).toEqual([{ dupId: copy.id, keepId: keep.id }])
  })

  it('matches across a generational suffix, as the measured pairs do (Aaron Jones Sr. / Aaron Jones)', () => {
    const k = { ...keep, name: 'Aaron Jones' }
    const c = { ...copy, name: 'Aaron Jones Sr.' }
    expect(twinKey(k.name, k.birthDate)).toBe(twinKey(c.name, c.birthDate))
    expect(planDuplicatePlayerMerges([k, c], []).merges).toHaveLength(1)
  })

  it('a different birthday is a different person', () => {
    const plan = planDuplicatePlayerMerges([keep, { ...copy, birthDate: '1999-09-26' }], [])
    expect(plan).toMatchObject({ merges: [], noTwin: 1 })
  })

  it('no birthday means no attempt', () => {
    const plan = planDuplicatePlayerMerges([keep, { ...copy, birthDate: null }], [])
    expect(plan).toMatchObject({ merges: [], noEvidence: 1 })
  })

  it('refuses when two Sleeper-backed rows share the name and birthday', () => {
    const other = { ...keep, id: 'nfl-james-cook-other', providerIds: { sleeper: 'sleeper:9999' } }
    const plan = planDuplicatePlayerMerges([keep, other, copy], [])
    expect(plan.merges).toEqual([])
    expect(plan.skipped).toEqual([expect.objectContaining({ dupId: copy.id, reason: 'ambiguous_twin' })])
  })

  it('never merges two Sleeper-backed rows: that is Sleeper’s own duplicate, a separate question', () => {
    const other = { ...keep, id: 'nfl-james-cook-other', providerIds: { sleeper: 'sleeper:9999' } }
    expect(planDuplicatePlayerMerges([keep, other], []).merges).toEqual([])
  })

  it('refuses a merge that would give the survivor two ids from one provider', () => {
    // Albert Okwuegbunam, as measured: Rolling Insights 5469 on the real row, 9580 on the copy.
    const plan = planDuplicatePlayerMerges([keep, copy], [ident(keep.id, 'rolling_insights', '5469'), ident(copy.id, 'rolling_insights', '9580')])
    expect(plan.merges).toEqual([])
    expect(plan.skipped).toEqual([expect.objectContaining({ reason: 'provider_clash', providers: ['rolling_insights'] })])
  })

  it('refuses two copies that would fold into one survivor with different ids from one provider', () => {
    const copy2 = { ...copy, id: 'nfl-james-cook-third' }
    const plan = planDuplicatePlayerMerges([keep, copy, copy2], [ident(copy.id, 'rolling_insights', '1'), ident(copy2.id, 'rolling_insights', '2')])
    expect(plan.merges).toEqual([])
    expect(plan.skipped.map((s) => s.reason)).toEqual(['provider_clash', 'provider_clash'])
  })

  it('allows a second TheSportsDB id, which TheSportsDB itself holds for the stars (James Cook, as measured)', () => {
    const plan = planDuplicatePlayerMerges(
      [keep, copy],
      [ident(keep.id, 'thesportsdb', 'tsdb_34201045'), ident(copy.id, 'thesportsdb', 'tsdb_34434889'), ident(copy.id, 'rolling_insights', '6572')],
    )
    expect(plan.merges).toEqual([{ dupId: copy.id, keepId: keep.id }])
  })

  it('a TheSportsDB pair never excuses a clash in another provider', () => {
    const plan = planDuplicatePlayerMerges(
      [keep, copy],
      [ident(keep.id, 'thesportsdb', 't0'), ident(copy.id, 'thesportsdb', 't1'), ident(keep.id, 'rolling_insights', '5469'), ident(copy.id, 'rolling_insights', '9580')],
    )
    expect(plan.skipped).toEqual([expect.objectContaining({ reason: 'provider_clash', providers: ['rolling_insights'] })])
  })

  it('two copies with different TheSportsDB ids may fold into one survivor', () => {
    const copy2 = { ...copy, id: 'nfl-james-cook-third' }
    const plan = planDuplicatePlayerMerges([keep, copy, copy2], [ident(copy.id, 'thesportsdb', 't1'), ident(copy2.id, 'thesportsdb', 't2')])
    expect(plan.merges).toHaveLength(2)
  })

  it('a provider only the copy holds moves over (Rolling Insights, ESPN)', () => {
    const plan = planDuplicatePlayerMerges([keep, copy], [ident(keep.id, 'sleeper', '8138'), ident(copy.id, 'rolling_insights', '7415'), ident(copy.id, 'espn', '4379399')])
    expect(plan.merges).toHaveLength(1)
  })
})

describe('mergedProviderIds', () => {
  it('adds the copy’s providers and keeps the survivor’s value wherever both have one', () => {
    expect(mergedProviderIds({ sleeper: 's:1', thesportsdb: 'a' }, { thesportsdb: 'b', backfill: '9' })).toEqual({
      sleeper: 's:1',
      thesportsdb: 'a',
      backfill: '9',
    })
  })
})

describe('foldTargetsForUnkeyedGroups (the backfill’s side of the same rule)', () => {
  const key = twinKey('James Cook', '1999-09-25')

  it('folds onto the one candidate with the key', () => {
    const out = foldTargetsForUnkeyedGroups([{ groupId: 'g', keys: [key], providerIds: [['thesportsdb', 't1']] }], [{ id: 'k', key, providerIds: [] }])
    expect([...out]).toEqual([['g', 'k']])
  })

  it('refuses a group whose own rows disagree about the birthday, even with one candidate', () => {
    const other = twinKey('James Cook', '1999-09-26')
    const out = foldTargetsForUnkeyedGroups(
      [{ groupId: 'disagree', keys: [key, other], providerIds: [] }],
      [{ id: 'k', key, providerIds: [] }, { id: 'k-other', key: other, providerIds: [] }],
    )
    expect(out.size).toBe(0)
  })

  it('refuses two candidates, no birthday, and a provider clash', () => {
    const groups = [
      { groupId: 'two', keys: [key], providerIds: [] },
      { groupId: 'none', keys: [null], providerIds: [] },
    ]
    expect(foldTargetsForUnkeyedGroups(groups, [{ id: 'k1', key, providerIds: [] }, { id: 'k2', key, providerIds: [] }]).size).toBe(0)
    const clash = foldTargetsForUnkeyedGroups(
      [{ groupId: 'g', keys: [key], providerIds: [['rolling_insights', '9580']] }],
      [{ id: 'k', key, providerIds: [] }, { id: 'k', key: null, providerIds: [['rolling_insights', '5469']] }],
    )
    expect(clash.size).toBe(0)
  })

  it('folds even when the candidate already holds a different TheSportsDB id', () => {
    const out = foldTargetsForUnkeyedGroups(
      [{ groupId: 'g', keys: [key], providerIds: [['thesportsdb', 't1']] }],
      [{ id: 'k', key, providerIds: [] }, { id: 'k', key: null, providerIds: [['thesportsdb', 't0']] }],
    )
    expect([...out]).toEqual([['g', 'k']])
  })
})

describe('backfillCanonicalPlayers no longer rebuilds the copy', () => {
  const fetchedAt = new Date('2026-07-21T00:00:00Z')
  const sleeperRow = {
    id: 'sp1', name: 'James Cook', sport: 'NFL', position: 'RB', team: 'BUF', externalId: 'sleeper:8138', source: 'sleeper',
    sleeperId: '8138', imageUrl: null, height: null, weight: null, status: 'Active', fetchedAt, expiresAt: null, dob: '1999-09-25',
  }
  // TheSportsDB spells the team differently and carries a headshot the Sleeper row lacks.
  const tsdbRow = {
    ...sleeperRow, id: 'sp2', team: 'Buffalo Bills', externalId: 'tsdb_1', source: 'thesportsdb', sleeperId: null,
    imageUrl: 'https://img/x.png', name: 'James Cook III',
  }

  beforeEach(() => {
    vi.clearAllMocks()
    db.player.findMany.mockResolvedValue([])
    db.playerProviderIdentity.findMany.mockResolvedValue([])
  })

  function writes() {
    const calls = db.$executeRawUnsafe.mock.calls as unknown as Array<[string, ...unknown[]]>
    const players = calls.filter(([sql]) => sql.includes('INSERT INTO "Player"')).flatMap(([, ...p]) => p.filter((_, i) => i % 17 === 0))
    const identities = calls
      .filter(([sql]) => sql.includes('INSERT INTO sports_core_player_provider_identities'))
      .flatMap(([, ...p]) => {
        const out: Array<[unknown, unknown, unknown]> = []
        for (let i = 0; i < p.length; i += 5) out.push([p[i], p[i + 2], p[i + 3]])
        return out
      })
    return { players, identities }
  }

  it('folds a TheSportsDB row into the Sleeper player in the same run, without letting its headshot win', async () => {
    db.sportsPlayer.findMany.mockResolvedValue([sleeperRow, tsdbRow])
    const out = await backfillCanonicalPlayers({ sport: 'NFL' })
    const { players, identities } = writes()
    expect(players).toHaveLength(1)
    const playerId = players[0]
    expect(identities).toContainEqual([playerId, 'thesportsdb', 'tsdb_1'])
    expect(identities).toContainEqual([playerId, 'sleeper', '8138'])
    expect(out).toMatchObject({ canonicalPlayers: 1, foldedIntoSleeperTwin: 1 })
    const playerCall = (db.$executeRawUnsafe.mock.calls as unknown as Array<[string, ...unknown[]]>).find(([sql]) => sql.includes('INSERT INTO "Player"'))!
    expect(playerCall[1 + 6]).toBe('BUF') // team from the Sleeper row, not 'Buffalo Bills'
  })

  it('a run that sees only the TheSportsDB row writes its identity to the existing Sleeper player and no new row', async () => {
    db.sportsPlayer.findMany.mockResolvedValue([tsdbRow])
    db.player.findMany.mockResolvedValue([{ id: 'nfl-james-cook-b73b6c59', name: 'James Cook', birthDate: new Date('1999-09-25T00:00:00Z'), providerIds: { sleeper: 'sleeper:8138' } }])
    const out = await backfillCanonicalPlayers({ sport: 'NFL' })
    const { players, identities } = writes()
    expect(players).toEqual([])
    expect(identities).toEqual([['nfl-james-cook-b73b6c59', 'thesportsdb', 'tsdb_1']])
    expect(out).toMatchObject({ canonicalPlayers: 0, foldedIntoSleeperTwin: 1 })
  })

  it('without a birthday match it behaves exactly as before: the row gets its own player', async () => {
    db.sportsPlayer.findMany.mockResolvedValue([sleeperRow, { ...tsdbRow, dob: '1999-09-26' }])
    const out = await backfillCanonicalPlayers({ sport: 'NFL' })
    expect(writes().players).toHaveLength(2)
    expect(out).toMatchObject({ canonicalPlayers: 2, foldedIntoSleeperTwin: 0 })
  })

  it('does not fold when the Sleeper player already holds a different Rolling Insights id', async () => {
    const riRow = { ...tsdbRow, source: 'rolling_insights', externalId: '9580' }
    db.sportsPlayer.findMany.mockResolvedValue([riRow])
    db.player.findMany.mockResolvedValue([{ id: 'nfl-james-cook-b73b6c59', name: 'James Cook', birthDate: '1999-09-25', providerIds: { sleeper: 'sleeper:8138' } }])
    db.playerProviderIdentity.findMany.mockResolvedValue([{ playerId: 'nfl-james-cook-b73b6c59', provider: 'rolling_insights', providerPlayerId: '5469' }])
    const out = await backfillCanonicalPlayers({ sport: 'NFL' })
    expect(writes().players).toHaveLength(1)
    expect(out).toMatchObject({ foldedIntoSleeperTwin: 0 })
  })

  it('still folds when the Sleeper player already holds a different TheSportsDB id, so a merged star is not rebuilt', async () => {
    db.sportsPlayer.findMany.mockResolvedValue([tsdbRow])
    db.player.findMany.mockResolvedValue([{ id: 'nfl-james-cook-b73b6c59', name: 'James Cook', birthDate: '1999-09-25', providerIds: { sleeper: 'sleeper:8138' } }])
    db.playerProviderIdentity.findMany.mockResolvedValue([{ playerId: 'nfl-james-cook-b73b6c59', provider: 'thesportsdb', providerPlayerId: 'tsdb_0' }])
    const out = await backfillCanonicalPlayers({ sport: 'NFL' })
    expect(writes().players).toEqual([])
    expect(writes().identities).toEqual([['nfl-james-cook-b73b6c59', 'thesportsdb', 'tsdb_1']])
    expect(out).toMatchObject({ foldedIntoSleeperTwin: 1 })
  })
})
