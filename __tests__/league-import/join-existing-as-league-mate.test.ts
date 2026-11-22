// @vitest-environment node
/**
 * One copy per league: a team-less league mate joins the copy that is already here
 * (lib/league-import/joinExistingLeagueAsLeagueMate.ts, lib/league/importViewers.ts).
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  other: null as null | { id: string; name: string; sport: string; userId: string; settings: unknown },
  rosters: [] as Array<{ id: string; platformUserId: string; playerData: unknown }>,
  coOwner: null as null | { rosterId: string; acceptedAt: Date | null },
  upsert: vi.fn(async (_a: unknown) => ({})),
  update: vi.fn(async (_a: unknown) => ({})),
}))
vi.mock('@/lib/prisma', () => {
  const league = { findFirst: vi.fn(async () => h.other), findUnique: vi.fn(async () => (h.other ? { settings: h.other.settings } : null)), update: h.update }
  return {
    prisma: {
      league,
      roster: { findMany: vi.fn(async () => h.rosters) },
      teamCoOwner: { findUnique: vi.fn(async () => h.coOwner), upsert: h.upsert },
      $transaction: vi.fn(async (fn: (tx: { league: typeof league }) => unknown) => fn({ league })),
    },
  }
})

import { coOwnedSourceTeamId, joinExistingLeagueAsLeagueMate } from '@/lib/league-import/joinExistingLeagueAsLeagueMate'
import { importViewerIds, isImportViewer } from '@/lib/league/importViewers'

const args = { userId: 'af-sam', provider: 'sleeper', platformLeagueId: 'L9', seasonYear: 2026, sourceManagerId: 'sl-sam' }
const sheet = [
  { source_team_id: '1', co_owner_ids: [] },
  { source_team_id: '2', co_owner_ids: ['sl-sam', 'sl-other'] },
]

beforeEach(() => {
  h.other = { id: 'kept', name: 'Dynasty Bros', sport: 'NFL', userId: 'af-owner', settings: { importViewerIds: ['af-zed'] } }
  h.rosters = [{ id: 'r1', platformUserId: 'sl-ana', playerData: { source_team_id: '1' } }, { id: 'r2', platformUserId: 'af-ben', playerData: { source_team_id: '2' } }]
  h.coOwner = null
  h.upsert.mockClear()
  h.update.mockClear()
})

describe('coOwnedSourceTeamId', () => {
  it('finds the team whose co-owner list names this manager, and nothing otherwise', () => {
    expect(coOwnedSourceTeamId(sheet, 'sl-sam')).toBe('2')
    expect(coOwnedSourceTeamId(sheet, 'sl-nobody')).toBeNull()
    expect(coOwnedSourceTeamId(sheet, ' ')).toBeNull()
    expect(coOwnedSourceTeamId(null, 'sl-sam')).toBeNull()
  })
})

describe('joinExistingLeagueAsLeagueMate', () => {
  it('no other account holds the league: nothing happens, an ordinary first import follows', async () => {
    h.other = null
    expect(await joinExistingLeagueAsLeagueMate({ ...args, rosters: sheet })).toBeNull()
    expect(h.upsert).not.toHaveBeenCalled()
    expect(h.update).not.toHaveBeenCalled()
  })

  it('🛑 a co-owner joins the same team in the existing copy, as an accepted co-owner', async () => {
    const out = await joinExistingLeagueAsLeagueMate({ ...args, rosters: sheet })
    expect(out).toEqual({ leagueId: 'kept', name: 'Dynasty Bros', sport: 'NFL', joinedAs: 'co_owner', alreadyJoined: false })
    const call = h.upsert.mock.calls[0][0] as { where: unknown; create: Record<string, unknown> }
    expect(call.where).toEqual({ leagueId_userId: { leagueId: 'kept', userId: 'af-sam' } })
    expect(call.create).toMatchObject({ leagueId: 'kept', userId: 'af-sam', rosterId: 'r2', rosterOwnerKey: 'af-ben', invitedByUserId: 'af-owner', claimedOwnerId: null })
    expect(call.create.acceptedAt).toBeInstanceOf(Date)
    expect(h.update).not.toHaveBeenCalled()
  })

  it('a repeat import by that co-owner changes nothing', async () => {
    h.coOwner = { rosterId: 'r2', acceptedAt: new Date() }
    expect((await joinExistingLeagueAsLeagueMate({ ...args, rosters: sheet }))?.alreadyJoined).toBe(true)
    expect(h.upsert).not.toHaveBeenCalled()
  })

  it('🛑 a member with no team (chopped, voted out) joins as a viewer, kept beside the other viewers', async () => {
    const out = await joinExistingLeagueAsLeagueMate({ ...args, sourceManagerId: 'sl-chopped', rosters: sheet })
    expect(out).toMatchObject({ joinedAs: 'viewer', alreadyJoined: false })
    expect(h.update).toHaveBeenCalledWith({ where: { id: 'kept' }, data: { settings: { importViewerIds: ['af-sam', 'af-zed'] } } })
    expect(h.upsert).not.toHaveBeenCalled()
  })

  it('someone already a viewer is not written twice', async () => {
    h.other!.settings = { importViewerIds: ['af-sam'] }
    expect(await joinExistingLeagueAsLeagueMate({ ...args, sourceManagerId: 'sl-chopped', rosters: sheet })).toMatchObject({ joinedAs: 'viewer', alreadyJoined: true })
    expect(h.update).not.toHaveBeenCalled()
  })
})

describe('a viewer is a member for reading, and nothing more', () => {
  const read = (p: string) => readFileSync(join(process.cwd(), p), 'utf8')
  it('reads the list safely', () => {
    expect(importViewerIds({ importViewerIds: ['a', 'a', '', 3] })).toEqual(['a'])
    expect(isImportViewer({ importViewerIds: ['a'] }, 'a')).toBe(true)
    expect(isImportViewer({ importViewerIds: ['a'] }, 'b')).toBe(false)
    expect(isImportViewer(null, 'a')).toBe(false)
  })
  it('membership reads admit a viewer; the commissioner and roster checks never read the list', () => {
    expect(read('lib/league/league-access.ts').match(/isImportViewer\(league\.settings, userId\)/g)?.length).toBe(2)
    expect(read('lib/live-draft-engine/auth.ts')).toMatch(/^\s*if \(isImportViewer\(viewerLeague\?\.settings, userId\)\) return true$/m)
    expect(read('lib/dashboard/get-dashboard-league-list.ts').match(/path: \[IMPORT_VIEWERS_KEY\], array_contains: \[userId\]/g)?.length).toBe(2)
    for (const p of ['lib/league/commissionerAccess.ts', 'lib/league/permissions.ts', 'lib/team-coowners/access.ts', 'lib/league/rosterManager.ts']) {
      expect(read(p)).not.toContain('importViewer')
    }
  })
})

describe('the import uses it, and refuses a second copy for anyone it cannot place', () => {
  const read = (p: string) => readFileSync(join(process.cwd(), p), 'utf8')
  const svc = read('lib/league-import/ImportedLeagueCommitService.ts')
  it('runs after the team claim and the commissioner join, only when this account has no copy', () => {
    const mate = svc.indexOf('const mate = await joinExistingLeagueAsLeagueMate({')
    expect(mate).toBeGreaterThan(svc.indexOf('if (joinedAsCo) return joinedAsCo'))
    expect(mate).toBeLessThan(svc.indexOf('const resolvedSport = resolveImportedLeagueSport(normalized)'))
  })
  it('an importer the provider did not vouch for is pointed at the invite link, from the import route only', () => {
    expect(svc).toMatch(/\} else if \(options\.refuseSecondCopy && await otherAccountsCopy\(/)
    expect(svc).toContain("'This league is already on AllFantasy. Ask its commissioner for the league invite link to join it.'")
    const route = read('app/api/leagues/import/commit/route.ts')
    expect(route).toMatch(/^\s*refuseSecondCopy: true,$/m)
    expect(route).toContain("code: 'LEAGUE_ALREADY_HERE'")
  })
  it('the Sleeper mapper carries the co-owner ids the join reads', () => {
    expect(read('lib/league-import/adapters/sleeper/SleeperRosterMapper.ts')).toMatch(/^\s*co_owner_ids: Array\.isArray\(roster\.co_owners\)/m)
  })
})
