import { beforeEach, describe, expect, it, vi } from 'vitest'
const db = vi.hoisted(() => ({
  verify: vi.fn(), transaction: vi.fn(), create: vi.fn(), log: vi.fn(), shell: vi.fn(), update: vi.fn(), lock: vi.fn(),
  grant: vi.fn(), audit: vi.fn(), grants: vi.fn(), users: vi.fn(), user: vi.fn(), upsert: vi.fn(), remove: vi.fn(),
}))
const tx = {
  tournamentShell: { create: db.create, findUnique: db.shell, update: db.update, updateMany: db.lock },
  tournamentShellGrant: { findUnique: db.grant, findMany: db.grants, upsert: db.upsert, deleteMany: db.remove },
  tournamentAuditLog: { create: db.log, findFirst: db.audit },
  appUser: { findFirst: db.user, findMany: db.users },
}
vi.mock('@/lib/prisma', () => ({ prisma: {
  $transaction: db.transaction, tournamentShell: { findUnique: db.shell },
  tournamentShellGrant: { findUnique: db.grant, findMany: db.grants },
  tournamentAuditLog: { findFirst: db.audit }, appUser: { findMany: db.users },
} }))
vi.mock('@/lib/tournament/seasonCalendarVerification', () => ({ verifySeasonCalendar: db.verify, seasonContractHash: () => 'contract-hash' }))
import { completeConfig } from './helpers/seasonTournamentFixture'
import {
  checkBlueprintCalendar, publishSeasonRules, loadSeasonBlueprint, saveSeasonBlueprint, updateSeasonBlueprint, setBlueprintStaff, removeBlueprintStaff,
} from '@/lib/tournament/seasonBlueprintStore'
import { defaultSeasonBlueprint } from '@/lib/tournament/seasonBlueprint'
const config = () => ({ ...defaultSeasonBlueprint(), name: 'NBA Cup' })
const shell = () => ({ id: 'saved', status: 'blueprint', commissionerId: 'owner', updatedAt: new Date('2026-10-12T12:00:00Z') })
beforeEach(() => {
  vi.restoreAllMocks()
  vi.resetAllMocks()
  db.transaction.mockImplementation(async fn => fn(tx))
  db.create.mockResolvedValue({ id: 'saved' })
  db.shell.mockResolvedValue(shell())
  db.lock.mockResolvedValue({ count: 1 })
  db.audit.mockResolvedValue({ id: 'revision-1', createdAt: new Date('2026-10-12T12:00:00Z'), data: config() })
  db.log.mockResolvedValue({ id: 'revision-2' })
  db.grants.mockResolvedValue([])
  db.users.mockResolvedValue([])
  db.user.mockResolvedValue({ id: 'helper' })
  db.remove.mockResolvedValue({ count: 1 })
})
describe('saved tournament plans', () => {
  it('validates before touching persistence', async () => {
    await expect(saveSeasonBlueprint('owner', {})).rejects.toThrow()
    expect(db.transaction).not.toHaveBeenCalled()
  })
  it('stores shell and full config in the same transaction', async () => {
    expect(await saveSeasonBlueprint('owner', config())).toBe('saved')
    expect(db.transaction).toHaveBeenCalledOnce()
    expect(db.create.mock.calls[0]![0].data.status).toBe('blueprint')
    expect(db.log.mock.calls[0]![0].data.data).toEqual(config())
  })
  it('does not load configuration without an owner or grant', async () => {
    db.grant.mockResolvedValue(null)
    expect(await loadSeasonBlueprint('saved', 'stranger')).toBeNull()
    expect(db.audit).not.toHaveBeenCalled()
  })
  it('allows a granted reviewer to read but hides the staff roster', async () => {
    db.grant.mockResolvedValue({ userId: 'reviewer', canEditSettings: false })
    const result = await loadSeasonBlueprint('saved', 'reviewer')
    expect(result?.isOwner).toBe(false)
    expect(result?.canEditSettings).toBe(false)
    expect(result?.revision).toBe('revision-1')
    expect(db.grants).not.toHaveBeenCalled()
    expect(db.users).not.toHaveBeenCalled()
  })
  it('loads staff names and actual granted editing capability for the owner', async () => {
    db.grants.mockResolvedValue([{ userId: 'helper', canEditSettings: true }])
    db.users.mockResolvedValue([{ id: 'helper', username: 'Helper', displayName: 'Co Commish' }])
    const result = await loadSeasonBlueprint('saved', 'owner')
    expect(result?.canEditSettings).toBe(true)
    expect(result?.staff).toEqual([{ userId: 'helper', username: 'Helper', displayName: 'Co Commish', role: 'co_commissioner' }])
  })
})
describe('audited rule edits', () => {
  it.each(['owner', 'helper'])('allows an authorized %s and returns the new revision', async userId => {
    db.grant.mockResolvedValue({ userId: 'helper', canEditSettings: true })
    expect(await updateSeasonBlueprint(userId, 'saved', 'revision-1', { ...config(), name: 'New Name' })).toEqual({ tournamentId: 'saved', revision: 'revision-2' })
    expect(db.update.mock.calls[0]![0].data.name).toBe('New Name')
    expect(db.log.mock.calls[0]![0].data.action).toBe('season_blueprint_updated')
    expect(db.log.mock.calls[0]![0].data.actorId).toBe(userId)
  })
  it('checks a grant after acquiring the row lock', async () => {
    db.grant.mockResolvedValue({ userId: 'helper', canEditSettings: true })
    await updateSeasonBlueprint('helper', 'saved', 'revision-1', config())
    expect(db.lock.mock.invocationCallOrder[0]).toBeLessThan(db.grant.mock.invocationCallOrder[0]!)
  })
  it.each([null, { userId: 'helper', role: 'co_commissioner', canEditSettings: false }])('blocks missing or read-only editing grants', async grant => {
    db.grant.mockResolvedValue(grant)
    await expect(updateSeasonBlueprint('helper', 'saved', 'revision-1', config())).rejects.toMatchObject({ status: 403 })
    expect(db.update).not.toHaveBeenCalled()
    expect(db.log).not.toHaveBeenCalled()
  })
  it('rejects a stale revision without replacing rules or history', async () => {
    await expect(updateSeasonBlueprint('owner', 'saved', 'revision-0', config())).rejects.toMatchObject({ status: 409 })
    expect(db.update).not.toHaveBeenCalled()
    expect(db.log).not.toHaveBeenCalled()
  })
  it('compares the shell timestamp and status to reject concurrent writers', async () => {
    db.lock.mockResolvedValue({ count: 0 })
    await expect(updateSeasonBlueprint('owner', 'saved', 'revision-1', config())).rejects.toMatchObject({ status: 409 })
    expect(db.lock.mock.calls[0]![0].where).toEqual({ id: 'saved', status: 'blueprint', updatedAt: shell().updatedAt })
    expect(db.update).not.toHaveBeenCalled()
  })
  it('rejects rules after the tournament leaves planning', async () => {
    db.shell.mockResolvedValue({ ...shell(), status: 'registering' })
    await expect(updateSeasonBlueprint('owner', 'saved', 'revision-1', config())).rejects.toMatchObject({ status: 409 })
    expect(db.lock).not.toHaveBeenCalled()
  })
  it('gives every rule event a later timestamp even in the same clock tick', async () => {
    const now = new Date()
    db.shell.mockResolvedValue({ ...shell(), updatedAt: now })
    db.audit.mockResolvedValue({ id: 'revision-1', createdAt: new Date(now.getTime() + 2), data: config() })
    await updateSeasonBlueprint('owner', 'saved', 'revision-1', config())
    const eventTime = db.log.mock.calls[0]![0].data.createdAt as Date
    expect(eventTime.getTime()).toBeGreaterThan(now.getTime() + 2)
    expect(db.update.mock.calls[0]![0].data.updatedAt).toEqual(eventTime)
  })
})
describe('owner-managed planning staff', () => {
  it.each(['viewer', 'co_commissioner'] as const)('sets %s with explicitly bounded privileges and an audit entry', async role => {
    await setBlueprintStaff('owner', 'saved', 'Helper', role)
    expect(db.upsert.mock.calls[0]![0].create).toEqual({
      tournamentId: 'saved', userId: 'helper', grantedByUserId: 'owner', role,
      canEditSettings: role === 'co_commissioner', canBroadcast: false, canAdvance: false,
    })
    expect(db.upsert.mock.calls[0]![0].update.canEditSettings).toBe(role === 'co_commissioner')
    expect(db.log.mock.calls[0]![0].data.action).toBe('blueprint_staff_assigned')
  })
  it('does not let editors delegate or remove colleagues', async () => {
    db.grant.mockResolvedValue({ userId: 'helper', canEditSettings: true })
    await expect(setBlueprintStaff('helper', 'saved', 'Other', 'co_commissioner')).rejects.toMatchObject({ status: 403 })
    await expect(removeBlueprintStaff('helper', 'saved', 'other')).rejects.toMatchObject({ status: 403 })
    expect(db.upsert).not.toHaveBeenCalled(); expect(db.remove).not.toHaveBeenCalled()
  })
  it('cannot replace the owner with a staff grant', async () => {
    db.user.mockResolvedValue({ id: 'owner' })
    await expect(setBlueprintStaff('owner', 'saved', 'Owner', 'viewer')).rejects.toMatchObject({ status: 409 })
    expect(db.upsert).not.toHaveBeenCalled()
  })
  it('cannot remove the owner', async () => {
    await expect(removeBlueprintStaff('owner', 'saved', 'owner')).rejects.toMatchObject({ status: 409 })
    expect(db.remove).not.toHaveBeenCalled()
  })
  it('removes only the selected account in this tournament and audits it', async () => {
    await removeBlueprintStaff('owner', 'saved', 'helper')
    expect(db.remove).toHaveBeenCalledWith({ where: { tournamentId: 'saved', userId: 'helper' } })
    expect(db.log.mock.calls[0]![0].data.targetId).toBe('helper')
  })
  it('handles repeat removals without creating a false removal event', async () => {
    db.remove.mockResolvedValue({ count: 0 })
    await removeBlueprintStaff('owner', 'saved', 'helper')
    expect(db.log).not.toHaveBeenCalled()
  })
})


describe('calendar verification and frozen publication', () => {
  beforeEach(() => {
    const ready = completeConfig()
    db.audit.mockResolvedValue({ id: 'revision-1', createdAt: new Date('2026-10-12T12:00:00Z'), data: ready })
    db.verify.mockResolvedValue({ ready: true, digest: 'a'.repeat(64), blockers: [], excludedGames: [], pendingGames: 0, regularGames: 1230, checkedAt: '2026-10-12T12:00:00Z', periods: [], assignments: [], warnings: [], provider: 'rolling_insights', season: 2026 })
    vi.spyOn(Date, 'now').mockReturnValue(Date.parse('2026-10-12T12:00:00Z'))
  })
  it('authenticates verification before requesting the provider', async () => {
    db.grant.mockResolvedValue(null)
    await expect(checkBlueprintCalendar('stranger', 'saved', 'revision-1')).rejects.toMatchObject({ status: 404 })
    expect(db.verify).not.toHaveBeenCalled()
  })
  it('rejects a stale verification revision', async () => {
    await expect(checkBlueprintCalendar('owner', 'saved', 'old')).rejects.toMatchObject({ status: 409 })
    expect(db.verify).not.toHaveBeenCalled()
  })
  it('rejects co-commissioner publication before requesting the provider', async () => {
    db.grant.mockResolvedValue({ canEditSettings: true })
    await expect(publishSeasonRules('helper', 'saved', 'revision-1', 'a'.repeat(64), false, false)).rejects.toMatchObject({ status: 403 })
    expect(db.verify).not.toHaveBeenCalled()
  })
  it('publishes the server-loaded configuration and evidence atomically', async () => {
    expect(await publishSeasonRules('owner', 'saved', 'revision-1', 'a'.repeat(64), false, false)).toMatchObject({ publicationId: 'revision-2', hash: 'contract-hash' })
    const log = db.log.mock.calls[0]![0].data
    expect(log.action).toBe('season_rules_published')
    expect(log.data.sourceRevision).toBe('revision-1')
    expect(log.data.config).toMatchObject({ name: 'NBA Pilot' })
    expect(db.update).toHaveBeenCalledWith({ where: { id: 'saved' }, data: expect.objectContaining({ status: 'rules_published' }) })
    expect(db.transaction).toHaveBeenCalledOnce()
  })
  it.each(['schedule changed', 'coverage blocked', 'pending unacknowledged', 'excluded unacknowledged', 'provider unavailable', 'draft in past'])('blocks %s without publication writes', async kind => {
    if (kind === 'schedule changed') db.verify.mockResolvedValue({ digest: 'b'.repeat(64) })
    if (kind === 'coverage blocked') db.verify.mockResolvedValue({ digest: 'a'.repeat(64), ready: false, blockers: ['Missing games'] })
    if (kind === 'pending unacknowledged') db.verify.mockResolvedValue({ digest: 'a'.repeat(64), ready: true, excludedGames: [], pendingGames: 30 })
    if (kind === 'excluded unacknowledged') db.verify.mockResolvedValue({ digest: 'a'.repeat(64), ready: true, excludedGames: [{}], pendingGames: 0 })
    if (kind === 'provider unavailable') db.verify.mockRejectedValue(new Error('Schedule unavailable'))
    if (kind === 'draft in past') vi.spyOn(Date, 'now').mockReturnValue(Date.parse('2100-01-01T00:00:00Z'))
    await expect(publishSeasonRules('owner', 'saved', 'revision-1', 'a'.repeat(64), false, false)).rejects.toMatchObject({ status: 409 })
    expect(db.log).not.toHaveBeenCalled()
    expect(db.update).not.toHaveBeenCalled()
  })
  it('records explicit acceptance of known gaps and pending games', async () => {
    db.verify.mockResolvedValue({ digest: 'a'.repeat(64), ready: true, excludedGames: [{ gameId: 'gap' }], pendingGames: 30 })
    await publishSeasonRules('owner', 'saved', 'revision-1', 'a'.repeat(64), true, true)
    expect(db.log.mock.calls[0]![0].data.data).toMatchObject({ acceptExcludedGames: true, acceptPendingGames: true })
  })
  it('rejects a revision that changes after provider verification', async () => {
    db.audit.mockResolvedValueOnce({ id: 'revision-1', data: completeConfig() }).mockResolvedValueOnce({ id: 'revision-1', data: completeConfig() }).mockResolvedValueOnce({ id: 'newer', data: completeConfig() })
    await expect(publishSeasonRules('owner', 'saved', 'revision-1', 'a'.repeat(64), false, false)).rejects.toMatchObject({ status: 409 })
    expect(db.log).not.toHaveBeenCalled()
  })
  it('prevents edits to a published shell', async () => {
    db.shell.mockResolvedValue({ ...shell(), status: 'rules_published' })
    await expect(updateSeasonBlueprint('owner', 'saved', 'revision-1', config())).rejects.toMatchObject({ status: 409 })
  })
})


describe('published contract loading and recovery', () => {
  function frozen() {
    db.shell.mockResolvedValue({ ...shell(), status: 'rules_published' })
    const publication = { id: 'publication-1', createdAt: new Date('2026-10-12T13:00:00Z'), data: { config: completeConfig(), hash: 'frozen-hash', sourceRevision: 'revision-1', calendar: { digest: 'a'.repeat(64), checkedAt: '2026-10-12T12:30:00Z', regularGames: 1200, pendingGames: 30, excludedGames: [] } } }
    db.audit.mockImplementation(async input => input.where.action === 'season_rules_published' ? publication : { id: 'revision-1', data: config() })
  }
  it('loads the published snapshot read-only instead of the latest editable defaults', async () => {
    frozen()
    const plan = await loadSeasonBlueprint('saved', 'owner')
    expect(plan?.config.name).toBe('NBA Pilot')
    expect(plan?.revision).toBe('publication-1')
    expect(plan?.publication?.hash).toBe('frozen-hash')
    expect(plan?.canEditSettings).toBe(false)
  })
  it('recovers a repeat request with the original source revision and reviewed digest', async () => {
    frozen()
    expect(await publishSeasonRules('owner', 'saved', 'revision-1', 'a'.repeat(64), false, true)).toEqual({ tournamentId: 'saved', publicationId: 'publication-1', hash: 'frozen-hash' })
    expect(db.transaction).not.toHaveBeenCalled()
    expect(db.verify).not.toHaveBeenCalled()
  })
  it('allows owner staff maintenance after publication without reopening rule editing', async () => {
    frozen()
    await setBlueprintStaff('owner', 'saved', 'Helper', 'viewer')
    expect(db.lock).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ status: 'rules_published' }) }))
    expect(db.update).not.toHaveBeenCalled()
  })
})
