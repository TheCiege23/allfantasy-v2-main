import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
const mocks = vi.hoisted(() => ({
  checkCalendar: vi.fn(), publish: vi.fn(), session: vi.fn(), save: vi.fn(), edit: vi.fn(), staff: vi.fn(), remove: vi.fn(), assert: vi.fn(),
  shell: vi.fn(), build: vi.fn(), launch: vi.fn(),
}))
vi.mock('next-auth', () => ({ getServerSession: mocks.session }))
vi.mock('@/lib/auth', () => ({ authOptions: {} }))
vi.mock('@/lib/tournament/seasonBlueprintStore', () => ({
  checkBlueprintCalendar: mocks.checkCalendar, publishSeasonRules: mocks.publish, saveSeasonBlueprint: mocks.save, updateSeasonBlueprint: mocks.edit, setBlueprintStaff: mocks.staff,
  removeBlueprintStaff: mocks.remove,
  BlueprintOperationError: class extends Error { constructor(message: string, public status: number) { super(message) } },
}))
vi.mock('@/lib/tournament/shellAccess', () => ({ assertTournamentCommissioner: mocks.assert }))
vi.mock('@/lib/prisma', () => ({ prisma: { tournamentShell: { findUnique: mocks.shell } } }))
vi.mock('@/lib/tournament/setupEngine', () => ({ buildConferencesAndLeagues: mocks.build, launchTournamentShell: mocks.launch, assignParticipantsToLeagues: vi.fn(), openRegistration: vi.fn() }))
import { POST } from '@/app/api/tournament/setup/route'
import { BlueprintOperationError } from '@/lib/tournament/seasonBlueprintStore'
const request = (body: unknown) => new NextRequest('https://allfantasy.test/api/tournament/setup', { method: 'POST', body: JSON.stringify(body) })
beforeEach(() => {
  vi.resetAllMocks()
  mocks.session.mockResolvedValue({ user: { id: 'owner' } })
  mocks.shell.mockResolvedValue({ id: 't1', status: 'blueprint' })
  mocks.assert.mockResolvedValue(undefined)
})
describe('blueprint setup boundary', () => {
  it('requires authentication before saving', async () => {
    mocks.session.mockResolvedValue(null)
    expect((await POST(request({ action: 'save_blueprint', config: {} }))).status).toBe(401)
    expect(mocks.save).not.toHaveBeenCalled()
  })
  it('saves only under the authenticated owner', async () => {
    mocks.save.mockResolvedValue('t1')
    const response = await POST(request({ action: 'save_blueprint', config: { name: 'Cup' }, userId: 'intruder' }))
    expect(response.status).toBe(201)
    expect(mocks.save).toHaveBeenCalledWith('owner', { name: 'Cup' })
  })
  it.each(['launch', 'build_leagues', 'open_registration', 'assign_participants'])('blocks live action %s for a plan', async action => {
    expect((await POST(request({ tournamentId: 't1', action }))).status).toBe(409)
    expect(mocks.build).not.toHaveBeenCalled(); expect(mocks.launch).not.toHaveBeenCalled()
  })
  it('allows the settings service to authorize a co-commissioner save', async () => {
    mocks.session.mockResolvedValue({ user: { id: 'editor' } })
    mocks.edit.mockResolvedValue({ tournamentId: 't1', revision: 'new' })
    const response = await POST(request({ action: 'blueprint_update', tournamentId: 't1', revision: 'old', config: {} }))
    expect(response.status).toBe(200)
    expect(mocks.edit).toHaveBeenCalledWith('editor', 't1', 'old', {})
    expect(mocks.assert).not.toHaveBeenCalled()
  })
  it.each([403, 409] as const)('surfaces service permission/conflict status %i', async status => {
    mocks.edit.mockRejectedValue(new BlueprintOperationError('Access or version changed.', status))
    const response = await POST(request({ action: 'blueprint_update', tournamentId: 't1', revision: 'old', config: {} }))
    expect(response.status).toBe(status)
  })
  it('defaults staff to reviewer and ignores client-provided privileges', async () => {
    const response = await POST(request({ tournamentId: 't1', action: 'blueprint_add_staff', username: ' Helper ', canAdvance: true }))
    expect(response.status).toBe(200)
    expect(mocks.staff).toHaveBeenCalledWith('owner', 't1', 'Helper', 'viewer')
  })
  it('accepts explicit co-commissioner editing access', async () => {
    expect((await POST(request({ tournamentId: 't1', action: 'blueprint_add_staff', username: 'Helper', role: 'co_commissioner' }))).status).toBe(200)
    expect(mocks.staff).toHaveBeenCalledWith('owner', 't1', 'Helper', 'co_commissioner')
  })
  it('rejects unknown staff roles and missing rule revisions before the service', async () => {
    expect((await POST(request({ tournamentId: 't1', action: 'blueprint_add_staff', username: 'Helper', role: 'owner' }))).status).toBe(400)
    expect((await POST(request({ tournamentId: 't1', action: 'blueprint_update', config: {} }))).status).toBe(400)
    expect(mocks.staff).not.toHaveBeenCalled(); expect(mocks.edit).not.toHaveBeenCalled()
  })
  it('removes staff only through the owner-authorized service', async () => {
    expect((await POST(request({ tournamentId: 't1', action: 'blueprint_remove_staff', assigneeId: 'helper' }))).status).toBe(200)
    expect(mocks.remove).toHaveBeenCalledWith('owner', 't1', 'helper')
  })
  it('returns a safe server error if persistence fails', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    mocks.staff.mockRejectedValue(new Error('internal persistence detail'))
    const response = await POST(request({ tournamentId: 't1', action: 'blueprint_add_staff', username: 'Helper' }))
    expect(response.status).toBe(500)
    expect(JSON.stringify(await response.json())).not.toContain('internal persistence')
    spy.mockRestore()
  })
  it('rejects null and malformed ids without throwing', async () => {
    expect((await POST(request(null))).status).toBe(400)
    expect((await POST(request({ tournamentId: 3 }))).status).toBe(400)
  })
})


describe('calendar and publication API', () => {
  it('checks only the authenticated saved revision', async () => {
    mocks.checkCalendar.mockResolvedValue({ ready: true })
    const result = await POST(request({ action: 'blueprint_check_calendar', tournamentId: 't1', revision: 'r1', games: [{ forged: true }] }))
    expect(result.status).toBe(200)
    expect(mocks.checkCalendar).toHaveBeenCalledWith('owner', 't1', 'r1')
  })
  it('requires explicit exception choices and a valid schedule digest', async () => {
    expect((await POST(request({ action: 'blueprint_publish_rules', tournamentId: 't1', revision: 'r1', digest: 'bad' }))).status).toBe(400)
    expect(mocks.publish).not.toHaveBeenCalled()
  })
  it('passes validated publication choices without client configurations', async () => {
    mocks.publish.mockResolvedValue({ publicationId: 'pub1' })
    const result = await POST(request({ action: 'blueprint_publish_rules', tournamentId: 't1', revision: 'r1', digest: 'a'.repeat(64), acceptExcludedGames: false, acceptPendingGames: true, config: { forged: true } }))
    expect(result.status).toBe(200)
    expect(mocks.publish).toHaveBeenCalledWith('owner', 't1', 'r1', 'a'.repeat(64), false, true)
  })
  it('blocks the legacy launch path for frozen rules', async () => {
    mocks.shell.mockResolvedValue({ id: 't1', status: 'rules_published' })
    expect((await POST(request({ tournamentId: 't1', action: 'open_registration' }))).status).toBe(409)
  })
})
