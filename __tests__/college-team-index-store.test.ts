import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))

/**
 * The store sits on a READ path — the live scoreboard's cached branch — so its
 * failure modes matter more than its happy path. It must never fetch, never
 * throw, and never turn "we cannot identify this team" into a wrong crest.
 */
const findUnique = vi.fn()

vi.mock('@/lib/prisma', () => ({
  prisma: { sportsDataCache: { findUnique: (...a: unknown[]) => findUnique(...a) } },
}))

const TEAMS = [
  { id: 2005, school: 'Air Force', mascot: 'Falcons', abbreviation: 'AF', alternateNames: ['AF', 'Air Force'], classification: 'fbs', logo: 'https://cdn.collegefootballdata.com/logos/500/2005.png' },
  { id: 238, school: 'Vanderbilt', mascot: 'Commodores', abbreviation: 'VAN', alternateNames: ['VAN'], classification: 'fbs', logo: 'https://cdn.collegefootballdata.com/logos/500/238.png' },
]

async function load() {
  const mod = await import('@/lib/sport-teams/collegeTeamIndexStore')
  mod.resetCollegeTeamIndexMemo()
  return mod
}

describe('college team index store', () => {
  beforeEach(() => {
    vi.resetModules()
    findUnique.mockReset()
  })

  it('builds an index from the stored directory', async () => {
    findUnique.mockResolvedValue({ data: TEAMS, expiresAt: new Date(Date.now() + 1000) })
    const { loadCollegeTeamIndex } = await load()
    const { resolveCollegeTeamLogo } = await import('@/lib/sport-teams/collegeTeamIdentity')

    const index = await loadCollegeTeamIndex()
    expect(index).not.toBeNull()
    // The three conventions the slate actually uses.
    expect(resolveCollegeTeamLogo('Air Force', index!)).toContain('2005.png')
    expect(resolveCollegeTeamLogo('Air Force Falcons', index!)).toContain('2005.png')
    expect(resolveCollegeTeamLogo('AF', index!)).toContain('2005.png')
    expect(resolveCollegeTeamLogo('Vanderbilt University', index!)).toContain('238.png')
  })

  it('returns null when the directory has never been ingested', async () => {
    findUnique.mockResolvedValue(null)
    const { loadCollegeTeamIndex } = await load()
    // Null means "we cannot say", which callers must not collapse into "no logo".
    expect(await loadCollegeTeamIndex()).toBeNull()
  })

  it('USES an expired row rather than blanking every crest', async () => {
    // Teams change once a year. Refusing a month-old directory would leave the
    // scoreboard bare until the next ingest, which is worse than slightly stale.
    findUnique.mockResolvedValue({ data: TEAMS, expiresAt: new Date(Date.now() - 86_400_000) })
    const { loadCollegeTeamIndex } = await load()
    expect(await loadCollegeTeamIndex()).not.toBeNull()
  })

  it('never throws when the store itself fails', async () => {
    findUnique.mockRejectedValue(new Error('connection reset'))
    const { loadCollegeTeamIndex } = await load()
    // A database blip must not take the scoreboard down with it.
    await expect(loadCollegeTeamIndex()).resolves.toBeNull()
  })

  it('survives a malformed payload instead of throwing on a read path', async () => {
    findUnique.mockResolvedValue({ data: { nope: true }, expiresAt: new Date() })
    const { loadCollegeTeamIndex } = await load()
    expect(await loadCollegeTeamIndex()).toBeNull()
  })

  it('skips junk entries but keeps the good ones', async () => {
    findUnique.mockResolvedValue({
      data: [{ id: 'not-a-number', school: 'X' }, { id: 7, school: '' }, TEAMS[0]],
      expiresAt: new Date(),
    })
    const { loadCollegeTeamIndex } = await load()
    const { resolveCollegeTeam } = await import('@/lib/sport-teams/collegeTeamIdentity')
    const index = await loadCollegeTeamIndex()
    expect(resolveCollegeTeam('Air Force', index!)?.id).toBe(2005)
  })

  it('reads the store once and reuses the built index', async () => {
    findUnique.mockResolvedValue({ data: TEAMS, expiresAt: new Date(Date.now() + 1000) })
    const { loadCollegeTeamIndex } = await load()
    await loadCollegeTeamIndex()
    await loadCollegeTeamIndex()
    // Rebuilding ~1,900 teams per scoreboard render would be the wrong trade.
    expect(findUnique).toHaveBeenCalledTimes(1)
  })
})
