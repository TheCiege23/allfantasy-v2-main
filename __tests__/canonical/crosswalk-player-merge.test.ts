// @vitest-environment node
/**
 * Rolling Insights copies of NFL players: rows whose ONLY identity is a Rolling Insights id,
 * folded into the player `PlayerIdentityMap` links that id to through a Sleeper id. Measured on
 * production 2026-11-09: 402 such rows, 372 linked to exactly one player, among them Travis
 * Etienne (RI 6211 -> Sleeper 7543) and Kenneth Walker III (RI 6943 -> Sleeper 8151). The
 * dedupe script and the backfill share this rule, so a re-run cannot rebuild the copy.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const db = vi.hoisted(() => ({
  sportsPlayer: { findMany: vi.fn() },
  sportsTeam: { findMany: vi.fn(async () => []) },
  player: { findMany: vi.fn() },
  playerProviderIdentity: { findMany: vi.fn() },
  playerIdentityMap: { findMany: vi.fn() },
  $executeRawUnsafe: vi.fn(async () => 0),
}))
vi.mock('@/lib/prisma', () => ({ prisma: db }))

import { planCrosswalkMerges } from '@/lib/canonical/duplicatePlayerMerge'
import { backfillCanonicalPlayers } from '@/lib/canonical/backfillCanonical'

// Travis Etienne, as measured.
const keep = { id: 'nfl-travis-etienne-49cfa0de', name: 'Travis Etienne', birthDate: '1999-01-26', providerIds: { sleeper: 'sleeper:7543' } }
const copy = { id: 'nfl-travis-etienne-034e59ff', name: 'Travis Etienne Jr.', birthDate: null, providerIds: { rolling_insights: '6211' } }
const ident = (playerId: string, provider: string, providerPlayerId: string) => ({ playerId, provider, providerPlayerId })
const sleeper = ident(keep.id, 'sleeper', '7543')
const ri = ident(copy.id, 'rolling_insights', '6211')
const link = { rollingInsightsId: '6211', sleeperId: '7543' }

describe('planCrosswalkMerges', () => {
  it('folds a Rolling Insights copy into the player its identity-map link names', () => {
    expect(planCrosswalkMerges([keep, copy], [sleeper, ri], [link]).merges).toEqual([{ dupId: copy.id, keepId: keep.id }])
  })

  it('needs no name match: a nickname is fine (Camryn / Cam Bynum)', () => {
    const plan = planCrosswalkMerges([{ ...keep, name: 'Cam Bynum' }, { ...copy, name: 'Camryn Bynum' }], [sleeper, ri], [link])
    expect(plan.merges).toHaveLength(1)
  })

  it('without an identity-map link nothing happens', () => {
    expect(planCrosswalkMerges([keep, copy], [sleeper, ri], [])).toMatchObject({ merges: [], noLink: 1, skipped: [] })
  })

  it('a row holding any other provider is not a Rolling Insights copy', () => {
    const plan = planCrosswalkMerges([keep, copy], [sleeper, ri, ident(copy.id, 'thesportsdb', 't1')], [link])
    expect(plan).toMatchObject({ merges: [], skipped: [], noLink: 0 })
  })

  it('the backfill’s own bookkeeping provider does not disqualify a copy', () => {
    expect(planCrosswalkMerges([keep, copy], [sleeper, ri, ident(copy.id, 'backfill', '6211')], [link]).merges).toHaveLength(1)
  })

  it('refuses a copy holding two Rolling Insights ids', () => {
    const plan = planCrosswalkMerges([keep, copy], [sleeper, ri, ident(copy.id, 'rolling_insights', '9999')], [link])
    expect(plan.skipped).toEqual([expect.objectContaining({ reason: 'two_crosswalk_ids' })])
  })

  it('refuses when the identity map links the id to two Sleeper ids', () => {
    const plan = planCrosswalkMerges([keep, copy], [sleeper, ri], [link, { rollingInsightsId: '6211', sleeperId: '9999' }])
    expect(plan.skipped).toEqual([expect.objectContaining({ reason: 'ambiguous_twin' })])
  })

  it('refuses when two players hold the Sleeper id', () => {
    const other = { ...keep, id: 'nfl-other' }
    const plan = planCrosswalkMerges([keep, other, copy], [sleeper, ident(other.id, 'sleeper', '7543'), ri], [link])
    expect(plan.skipped).toEqual([expect.objectContaining({ reason: 'ambiguous_twin' })])
  })

  it('a stated birthday on both sides must agree; one side missing is fine', () => {
    const contradicts = planCrosswalkMerges([keep, { ...copy, birthDate: '1999-01-27' }], [sleeper, ri], [link])
    expect(contradicts.skipped).toEqual([expect.objectContaining({ reason: 'birthday_contradicts' })])
    expect(planCrosswalkMerges([keep, { ...copy, birthDate: '1999-01-26' }], [sleeper, ri], [link]).merges).toHaveLength(1)
  })

  it('refuses when the target already holds a different Rolling Insights id; the same one is fine', () => {
    const clash = planCrosswalkMerges([keep, copy], [sleeper, ri, ident(keep.id, 'rolling_insights', '1234')], [link])
    expect(clash.skipped).toEqual([expect.objectContaining({ reason: 'provider_clash' })])
    expect(planCrosswalkMerges([keep, copy], [sleeper, ri, ident(keep.id, 'rolling_insights', '6211')], [link]).merges).toHaveLength(1)
  })

  it('drops both when two copies with different ids land on one player', () => {
    const copy2 = { ...copy, id: 'nfl-travis-etienne-third' }
    const plan = planCrosswalkMerges(
      [keep, copy, copy2],
      [sleeper, ident(keep.id, 'sleeper', '8000'), ri, ident(copy2.id, 'rolling_insights', '7000')],
      [link, { rollingInsightsId: '7000', sleeperId: '8000' }],
    )
    expect(plan.merges).toEqual([])
    expect(plan.skipped.map((s) => s.reason)).toEqual(['provider_clash', 'provider_clash'])
  })

  it('never treats a Sleeper-backed row as a copy', () => {
    const plan = planCrosswalkMerges([keep, { ...copy, providerIds: { sleeper: 's', rolling_insights: '6211' } }], [sleeper, ri], [link])
    expect(plan.merges).toEqual([])
  })
})

describe('backfillCanonicalPlayers follows the same link', () => {
  const fetchedAt = new Date('2026-07-21T00:00:00Z')
  const sleeperRow = {
    id: 'sp1', name: 'Travis Etienne', sport: 'NFL', position: 'RB', team: 'NO', externalId: 'sleeper:7543', source: 'sleeper',
    sleeperId: '7543', imageUrl: null, height: null, weight: null, status: 'Active', fetchedAt, expiresAt: null, dob: '1999-01-26',
  }
  const riRow = { ...sleeperRow, id: 'sp2', name: 'Travis Etienne Jr.', externalId: '6211', source: 'rolling_insights', sleeperId: null, dob: null }

  let links: Array<{ rollingInsightsId: string; sleeperId: string }>
  let dbPlayers: Array<{ id: string; name: string; birthDate: string | null; providerIds: Record<string, string> }>
  let dbIdentities: Array<{ playerId: string; provider: string; providerPlayerId: string }>

  beforeEach(() => {
    vi.clearAllMocks()
    links = [link]
    dbPlayers = []
    dbIdentities = []
    db.playerIdentityMap.findMany.mockImplementation(async ({ where }: any) => {
      if (where?.rollingInsightsId) return links.filter((l) => where.rollingInsightsId.in.includes(l.rollingInsightsId))
      return []
    })
    db.player.findMany.mockImplementation(async ({ where }: any) =>
      where?.id ? dbPlayers.filter((p) => where.id.in.includes(p.id)) : dbPlayers.filter((p) => p.birthDate),
    )
    db.playerProviderIdentity.findMany.mockImplementation(async ({ where }: any) =>
      dbIdentities.filter((i) => {
        if (where?.provider && i.provider !== where.provider) return false
        if (where?.providerPlayerId?.in && !where.providerPlayerId.in.includes(i.providerPlayerId)) return false
        if (where?.playerId?.in && !where.playerId.in.includes(i.playerId)) return false
        return true
      }),
    )
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

  it('folds a Rolling Insights row into the Sleeper player in the same run', async () => {
    db.sportsPlayer.findMany.mockResolvedValue([sleeperRow, riRow])
    const out = await backfillCanonicalPlayers({ sport: 'NFL' })
    const { players, identities } = writes()
    expect(players).toHaveLength(1)
    expect(identities).toContainEqual([players[0], 'rolling_insights', '6211'])
    expect(out).toMatchObject({ canonicalPlayers: 1, foldedIntoSleeperTwin: 1 })
  })

  it('a run that sees only the Rolling Insights row writes its identity to the existing player', async () => {
    db.sportsPlayer.findMany.mockResolvedValue([riRow])
    dbIdentities = [{ playerId: keep.id, provider: 'sleeper', providerPlayerId: '7543' }]
    dbPlayers = [{ id: keep.id, name: 'Travis Etienne', birthDate: '1999-01-26', providerIds: { sleeper: 'sleeper:7543' } }]
    const out = await backfillCanonicalPlayers({ sport: 'NFL' })
    expect(writes()).toEqual({ players: [], identities: [[keep.id, 'rolling_insights', '6211']] })
    expect(out).toMatchObject({ canonicalPlayers: 0, foldedIntoSleeperTwin: 1 })
  })

  it('without an identity-map link the row keeps its own player, as before', async () => {
    links = []
    db.sportsPlayer.findMany.mockResolvedValue([sleeperRow, riRow])
    const out = await backfillCanonicalPlayers({ sport: 'NFL' })
    expect(writes().players).toHaveLength(2)
    expect(out).toMatchObject({ foldedIntoSleeperTwin: 0 })
  })

  it('does not fold onto a player already holding a different Rolling Insights id', async () => {
    db.sportsPlayer.findMany.mockResolvedValue([riRow])
    dbIdentities = [
      { playerId: keep.id, provider: 'sleeper', providerPlayerId: '7543' },
      { playerId: keep.id, provider: 'rolling_insights', providerPlayerId: '1234' },
    ]
    dbPlayers = [{ id: keep.id, name: 'Travis Etienne', birthDate: '1999-01-26', providerIds: { sleeper: 'sleeper:7543' } }]
    const out = await backfillCanonicalPlayers({ sport: 'NFL' })
    expect(writes().players).toHaveLength(1)
    expect(out).toMatchObject({ foldedIntoSleeperTwin: 0 })
  })

  it('folds neither of two Rolling Insights rows with different ids that link to one player', async () => {
    const riRow2 = { ...riRow, id: 'sp3', name: 'T. Etienne', externalId: '7000' }
    links = [link, { rollingInsightsId: '7000', sleeperId: '7543' }]
    db.sportsPlayer.findMany.mockResolvedValue([sleeperRow, riRow, riRow2])
    const out = await backfillCanonicalPlayers({ sport: 'NFL' })
    expect(writes().players).toHaveLength(3)
    expect(out).toMatchObject({ foldedIntoSleeperTwin: 0 })
  })
})
