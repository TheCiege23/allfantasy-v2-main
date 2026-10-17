import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * The ESPN NCAAB writer. What these pin is what a wrong face on a player card would come from:
 * a link reached by anything but the identity chain, a link that overwrites someone else's,
 * an unverified URL stored as a photo, or a 403 worked around instead of stopping.
 */

const db = vi.hoisted(() => ({
  teamProviderIdentity: { findFirst: vi.fn(), findMany: vi.fn(), create: vi.fn(), update: vi.fn() },
  playerProviderIdentity: { findMany: vi.fn(), create: vi.fn(), update: vi.fn() },
  sportsTeam: { findMany: vi.fn(), updateMany: vi.fn() },
  sportsPlayer: { findMany: vi.fn(), update: vi.fn() },
  playerIdentityMap: { updateMany: vi.fn() },
}))
const served = vi.hoisted(() => ({ isServedImage: vi.fn() }))
const canonical = vi.hoisted(() => ({ writeCanonicalHeadshot: vi.fn() }))

vi.mock('@/lib/prisma', () => ({ prisma: db }))
vi.mock('@/lib/player-assets/servedImage', () => served)
vi.mock('@/lib/player-assets/canonicalHeadshotWrite', () => canonical)

import { isNcaabRosterSeason, syncEspnNcaabRosters, syncEspnNcaabTeamMapIfDue } from '@/lib/espn/ncaabEspnIngest'

const json = (body: unknown, status = 200) =>
  ({ ok: status >= 200 && status < 300, status, json: async () => body }) as unknown as Response
const HEADSHOT = 'https://a.espncdn.com/i/headshots/mens-college-basketball/players/full/5241333.png'
const now = new Date('2026-10-01T12:00:00Z')

beforeEach(() => {
  for (const model of Object.values(db)) for (const fn of Object.values(model)) (fn as ReturnType<typeof vi.fn>).mockReset()
  db.teamProviderIdentity.create.mockResolvedValue({})
  db.teamProviderIdentity.update.mockResolvedValue({})
  db.playerProviderIdentity.create.mockResolvedValue({})
  db.playerProviderIdentity.update.mockResolvedValue({})
  db.sportsTeam.updateMany.mockResolvedValue({ count: 1 })
  db.sportsPlayer.update.mockResolvedValue({})
  db.playerIdentityMap.updateMany.mockResolvedValue({ count: 1 })
  served.isServedImage.mockReset().mockResolvedValue(true)
  canonical.writeCanonicalHeadshot.mockReset().mockResolvedValue(undefined)
})

describe('isNcaabRosterSeason', () => {
  it('is October through April', () => {
    expect(isNcaabRosterSeason(new Date('2026-10-01T00:00:00Z'))).toBe(true)
    expect(isNcaabRosterSeason(new Date('2027-04-30T00:00:00Z'))).toBe(true)
    expect(isNcaabRosterSeason(new Date('2027-05-01T00:00:00Z'))).toBe(false)
    expect(isNcaabRosterSeason(new Date('2027-09-30T00:00:00Z'))).toBe(false)
  })
})

describe('syncEspnNcaabTeamMapIfDue', () => {
  const teams = {
    sports: [{ leagues: [{ teams: [{ team: { id: '150', location: 'Duke', abbreviation: 'DUKE', displayName: 'Duke Blue Devils', logos: [{ href: 'https://a.espncdn.com/duke.png', rel: ['full', 'default'] }] } }] }] }],
  }
  const seed = () => {
    db.teamProviderIdentity.findFirst.mockResolvedValue(null)
    db.sportsTeam.findMany.mockResolvedValue([{ id: 'st-duke', externalId: '37', name: 'Duke University', shortName: 'DUKE', logo: null }])
    db.teamProviderIdentity.findMany
      .mockResolvedValueOnce([{ providerTeamId: '37', teamId: 'canon-duke' }]) // RI identities
      .mockResolvedValueOnce([]) // existing ESPN identities
  }

  it('skips while the map is under a week old, without asking ESPN', async () => {
    db.teamProviderIdentity.findFirst.mockResolvedValue({ lastSeenAt: new Date('2026-09-28T00:00:00Z') })
    const fetchImpl = vi.fn()
    expect(await syncEspnNcaabTeamMapIfDue({ now, fetchImpl: fetchImpl as never })).toMatchObject({ skipped: 'fresh' })
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('links the ESPN school to the SAME canonical team as the RI identity, and fills a missing logo', async () => {
    seed()
    const r = await syncEspnNcaabTeamMapIfDue({ now, fetchImpl: vi.fn(async () => json(teams)) as never })
    expect(r).toMatchObject({ matched: 1, created: 1, logosFilled: 1 })
    expect(db.teamProviderIdentity.create.mock.calls[0]![0].data).toMatchObject({
      provider: 'espn', sportKey: 'NCAAB', providerTeamId: '150', teamId: 'canon-duke', verified: false, lastSeenAt: now,
    })
    expect(db.sportsTeam.updateMany).toHaveBeenCalledWith({
      where: { id: 'st-duke', OR: [{ logo: null }, { logo: '' }] },
      data: { logo: 'https://a.espncdn.com/duke.png' },
    })
  })

  it('never re-points an existing ESPN school identity at a different team', async () => {
    seed()
    db.teamProviderIdentity.findMany.mockReset()
      .mockResolvedValueOnce([{ providerTeamId: '37', teamId: 'canon-duke' }])
      .mockResolvedValueOnce([{ id: 'x', providerTeamId: '150', teamId: 'canon-SOMEONE-ELSE' }])
    const r = await syncEspnNcaabTeamMapIfDue({ now, fetchImpl: vi.fn(async () => json(teams)) as never })
    expect(r.conflicts).toBe(1)
    expect(db.teamProviderIdentity.update).not.toHaveBeenCalled()
    expect(db.teamProviderIdentity.create).not.toHaveBeenCalled()
  })

  it('reports a 403 as blocked and writes nothing', async () => {
    seed()
    const r = await syncEspnNcaabTeamMapIfDue({ now, fetchImpl: vi.fn(async () => json({}, 403)) as never })
    expect(r.skipped).toBe('blocked')
    expect(db.teamProviderIdentity.create).not.toHaveBeenCalled()
  })
})

describe('syncEspnNcaabRosters', () => {
  const roster = (athletes: unknown[]) => json({ season: { year: 2027 }, athletes })
  const dillon = { id: '5241333', fullName: 'Eoin Dillon', jersey: '5', position: { abbreviation: 'F' }, headshot: { href: HEADSHOT } }
  const seedSchool = (riRow: { imageUrl: string | null }) => {
    db.teamProviderIdentity.findMany
      .mockResolvedValueOnce([{ id: 'tpi-belmont', providerTeamId: '2057', teamId: 'canon-belmont' }]) // ESPN schools
      .mockResolvedValueOnce([{ teamId: 'canon-belmont', providerTeamId: '234' }]) // RI schools
    db.sportsPlayer.findMany.mockResolvedValue([{ id: 'sp-1', externalId: '13049', name: 'Eoin Dillon', number: 5, ...riRow }])
    db.playerProviderIdentity.findMany
      .mockResolvedValueOnce([{ providerPlayerId: '13049', playerId: 'ncaab-eoin-dillon' }]) // RI identity -> canonical
      .mockResolvedValueOnce([]) // existing ESPN identities
  }
  const run = (fetchImpl: unknown) => syncEspnNcaabRosters({ deadlineAt: Date.now() + 60_000, now, fetchImpl: fetchImpl as never })

  it('links through the RI identity, records the ESPN id, and writes a verified photo to both places', async () => {
    seedSchool({ imageUrl: null })
    const r = await run(vi.fn(async () => roster([dillon])))

    expect(r).toMatchObject({ matched: 1, identitiesCreated: 1, headshotsWritten: 1, blocked: false })
    expect(db.playerProviderIdentity.create.mock.calls[0]![0].data).toMatchObject({
      provider: 'espn', sportKey: 'NCAAB', providerPlayerId: '5241333', playerId: 'ncaab-eoin-dillon', verified: false,
    })
    expect(db.playerIdentityMap.updateMany).toHaveBeenCalledWith({
      where: { sport: 'NCAAB', rollingInsightsId: '13049', espnId: null },
      data: { espnId: '5241333' },
    })
    expect(db.sportsPlayer.update).toHaveBeenCalledWith({ where: { id: 'sp-1' }, data: { imageUrl: HEADSHOT } })
    expect(canonical.writeCanonicalHeadshot).toHaveBeenCalledWith(
      expect.objectContaining({ playerId: 'ncaab-eoin-dillon', sportKey: 'NCAAB', url: HEADSHOT, previousUrl: null, provider: 'espn' }),
    )
    // Rotation: the school goes to the back of the queue.
    expect(db.teamProviderIdentity.update).toHaveBeenCalledWith({ where: { id: 'tpi-belmont' }, data: { fetchedAt: now } })
  })

  it('stores no photo the CDN does not actually serve', async () => {
    seedSchool({ imageUrl: null })
    served.isServedImage.mockResolvedValue(false)
    const r = await run(vi.fn(async () => roster([dillon])))
    expect(r.headshotsMissing).toBe(1)
    expect(db.sportsPlayer.update).not.toHaveBeenCalled()
    expect(canonical.writeCanonicalHeadshot).not.toHaveBeenCalled()
  })

  it('leaves another source’s real photo — on the row AND on the canonical player', async () => {
    seedSchool({ imageUrl: 'https://r2.thesportsdb.com/images/media/player/cutout/x.png' })
    const r = await run(vi.fn(async () => roster([dillon])))
    expect(r.headshotsKeptOther).toBe(1)
    expect(db.sportsPlayer.update).not.toHaveBeenCalled()
    expect(canonical.writeCanonicalHeadshot).not.toHaveBeenCalled()
  })

  it('replaces an api-sports URL (usually its stock picture)', async () => {
    seedSchool({ imageUrl: 'https://media.api-sports.io/american-football/players/1.png' })
    await run(vi.fn(async () => roster([dillon])))
    expect(db.sportsPlayer.update).toHaveBeenCalledWith({ where: { id: 'sp-1' }, data: { imageUrl: HEADSHOT } })
  })

  it('never re-points an ESPN athlete already linked to a different player — and writes nothing for it', async () => {
    seedSchool({ imageUrl: null })
    db.playerProviderIdentity.findMany.mockReset()
      .mockResolvedValueOnce([{ providerPlayerId: '13049', playerId: 'ncaab-eoin-dillon' }])
      .mockResolvedValueOnce([{ id: 'ppi-x', providerPlayerId: '5241333', playerId: 'ncaab-someone-else' }])
    const r = await run(vi.fn(async () => roster([dillon])))
    expect(r.identityConflicts).toBe(1)
    expect(db.playerProviderIdentity.update).not.toHaveBeenCalled()
    expect(db.playerProviderIdentity.create).not.toHaveBeenCalled()
    expect(db.sportsPlayer.update).not.toHaveBeenCalled()
    expect(canonical.writeCanonicalHeadshot).not.toHaveBeenCalled()
  })

  it('does not link a name under a different jersey', async () => {
    seedSchool({ imageUrl: null })
    const r = await run(vi.fn(async () => roster([{ ...dillon, jersey: '15' }])))
    expect(r).toMatchObject({ matched: 0, noCandidate: 1 })
    expect(db.playerProviderIdentity.create).not.toHaveBeenCalled()
  })

  it('stops the whole pass on a 403 and reports it', async () => {
    db.teamProviderIdentity.findMany
      .mockResolvedValueOnce([
        { id: 'a', providerTeamId: '150', teamId: 'canon-duke' },
        { id: 'b', providerTeamId: '2057', teamId: 'canon-belmont' },
      ])
      .mockResolvedValueOnce([])
    const fetchImpl = vi.fn(async () => json({}, 403))
    const r = await run(fetchImpl)
    expect(r).toMatchObject({ blocked: true, schoolsRemaining: 2, schoolsFetched: 0 })
    expect(fetchImpl).toHaveBeenCalledTimes(1) // never asked again after being refused
  })

  it('still rotates a school whose roster request failed, so it cannot pin the head of the queue', async () => {
    db.teamProviderIdentity.findMany
      .mockResolvedValueOnce([{ id: 'a', providerTeamId: '150', teamId: 'canon-duke' }])
      .mockResolvedValueOnce([])
    const r = await run(vi.fn(async () => json({}, 500)))
    expect(r.errors).toBe(1)
    expect(db.teamProviderIdentity.update).toHaveBeenCalledWith({ where: { id: 'a' }, data: { fetchedAt: now } })
  })

  it('starts no school past the deadline and says how many it left', async () => {
    db.teamProviderIdentity.findMany
      .mockResolvedValueOnce([{ id: 'a', providerTeamId: '150', teamId: 'canon-duke' }])
      .mockResolvedValueOnce([])
    const fetchImpl = vi.fn()
    const r = await syncEspnNcaabRosters({ deadlineAt: Date.now() + 1_000, now, fetchImpl: fetchImpl as never })
    expect(fetchImpl).not.toHaveBeenCalled()
    expect(r.schoolsRemaining).toBe(1)
  })
})
