// @vitest-environment node
/**
 * NCAAF identity rows must carry the provider id they were built from.
 *
 * 🛑 On 2026-08-31 the widening wrote 38,904 NCAAF identity rows with NO provider id — it selected
 * name, team and position from SportsPlayer and never the id sitting in the same row. 38,792 of
 * them matched exactly one Rolling Insights row by (name, team). Reachable by name, joined to
 * nothing by id: the stat importer, projections and the mapping audit all key on the id.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

const db = vi.hoisted(() => ({
  identity: [] as Array<Record<string, unknown>>,
  players: [] as Array<Record<string, unknown>>,
  executeRaw: vi.fn(),
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    playerIdentityMap: {
      findMany: vi.fn(async () => db.identity),
      findFirst: vi.fn(async () => null),
    },
    sportsPlayer: { findMany: vi.fn(async () => db.players) },
    $executeRaw: db.executeRaw,
  },
}))

import { planWidening, repairNcaafIdentityProviderIds } from '@/lib/devy/ingestNcaafIdentitiesFromSportsPlayer'

const ID_COLUMNS = {
  sleeperId: null,
  fantasyCalcId: null,
  rollingInsightsId: null,
  apiSportsId: null,
  mflId: null,
  espnId: null,
  fleaflickerId: null,
  clearSportsId: null,
  cfbdId: null,
  fantraxId: null,
}

function identity(id: string, name: string, team: string, ids: Record<string, string> = {}) {
  return { id, normalizedName: name.toLowerCase(), currentTeam: team, ...ID_COLUMNS, ...ids }
}

function player(name: string, team: string, source: string, externalId: string) {
  return { name, team, position: 'WR', source, externalId }
}

describe('planWidening — carries the provider id it was built from', () => {
  it('puts the Rolling Insights and CFBD ids on the planned row', () => {
    const { plan } = planWidening(
      [player('Liu Aumavae', 'San Diego State', 'rolling_insights', '63183'), player('Liu Aumavae', 'San Diego State', 'cfbd', '5296210')],
      new Set(),
    )
    expect(plan).toHaveLength(1)
    expect(plan[0].providerIds).toEqual({ rollingInsightsId: '63183', cfbdId: '5296210' })
  })

  it('writes no id when one (name, team) key holds two different people from one provider', () => {
    const { plan } = planWidening(
      [player('Ryan Davis', 'Auburn', 'rolling_insights', '1'), player('Ryan Davis', 'Auburn', 'rolling_insights', '2')],
      new Set(),
    )
    expect(plan[0].providerIds).toEqual({})
  })

  it('keeps a TheSportsDB-only row name-keyed, since the registry has no column for it', () => {
    const { plan } = planWidening([player('Kyle Crum', 'San Diego State', 'thesportsdb', '999')], new Set())
    expect(plan[0].providerIds).toEqual({})
  })
})

describe('repairNcaafIdentityProviderIds', () => {
  beforeEach(() => {
    db.identity = []
    db.players = []
    db.executeRaw.mockReset().mockResolvedValue(0)
  })

  it('fills the id into a row that has none, and writes nothing on a dry run', async () => {
    db.identity = [identity('a', 'Liu Aumavae', 'San Diego State')]
    db.players = [player('Liu Aumavae', 'San Diego State', 'rolling_insights', '63183')]

    const dry = await repairNcaafIdentityProviderIds()
    expect(dry.dryRun).toBe(true)
    expect(dry.idless).toBe(1)
    expect(dry.written.rollingInsightsId).toBe(1)
    expect(db.executeRaw).not.toHaveBeenCalled()

    db.executeRaw.mockResolvedValue(1)
    const applied = await repairNcaafIdentityProviderIds({ dryRun: false })
    expect(applied.written.rollingInsightsId).toBe(1)
    expect(db.executeRaw).toHaveBeenCalledTimes(1)
  })

  it('never touches a row that already carries any provider id', async () => {
    db.identity = [identity('a', 'Liu Aumavae', 'San Diego State', { sleeperId: '777' })]
    db.players = [player('Liu Aumavae', 'San Diego State', 'rolling_insights', '63183')]
    const r = await repairNcaafIdentityProviderIds()
    expect(r.idless).toBe(0)
    expect(r.written.rollingInsightsId).toBe(0)
  })

  it('refuses an id another identity row already owns — same person, other spelling', async () => {
    db.identity = [
      identity('a', 'Liu Aumavae', 'San Diego State'),
      identity('b', 'Liu Aumavae-Laulu', 'San Diego State', { rollingInsightsId: '63183' }),
    ]
    db.players = [player('Liu Aumavae', 'San Diego State', 'rolling_insights', '63183')]
    const r = await repairNcaafIdentityProviderIds()
    expect(r.ownedElsewhere).toBe(1)
    expect(r.written.rollingInsightsId).toBe(0)
  })

  it('refuses when the key holds two different provider ids — two people, not guessed', async () => {
    db.identity = [identity('a', 'Ryan Davis', 'Auburn')]
    db.players = [
      player('Ryan Davis', 'Auburn', 'rolling_insights', '1'),
      player('Ryan Davis', 'Auburn', 'rolling_insights', '2'),
    ]
    const r = await repairNcaafIdentityProviderIds()
    expect(r.ambiguousSource).toBe(1)
    expect(r.written.rollingInsightsId).toBe(0)
  })

  it('refuses when two identity rows share the key, so the id cannot go to one of them', async () => {
    db.identity = [identity('a', 'Ryan Davis', 'Auburn'), identity('b', 'Ryan Davis', 'Auburn')]
    db.players = [player('Ryan Davis', 'Auburn', 'rolling_insights', '1')]
    const r = await repairNcaafIdentityProviderIds()
    expect(r.sharedKey).toBe(2)
    expect(r.written.rollingInsightsId).toBe(0)
  })

  it('keys on name AND team: a namesake at another school is not a match', async () => {
    db.identity = [identity('a', 'Ryan Davis', 'Auburn')]
    db.players = [player('Ryan Davis', 'Utah', 'rolling_insights', '1')]
    const r = await repairNcaafIdentityProviderIds()
    expect(r.noSource).toBe(1)
    expect(r.written.rollingInsightsId).toBe(0)
  })

  it('matches through the shared name normalizer (generational suffix)', async () => {
    db.identity = [identity('a', 'Danny Lockhart', 'Tennessee State')]
    db.players = [player('Danny Lockhart Jr.', 'Tennessee State', 'rolling_insights', '42')]
    const r = await repairNcaafIdentityProviderIds()
    expect(r.written.rollingInsightsId).toBe(1)
  })
})
