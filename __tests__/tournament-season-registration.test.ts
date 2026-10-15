import { beforeEach, describe, expect, it, vi } from 'vitest'
import { completeConfig } from './helpers/seasonTournamentFixture'
const mock = vi.hoisted(() => ({ transaction: vi.fn(), shellRead: vi.fn(), shellLock: vi.fn(), shellUpdate: vi.fn(), auditRead: vi.fn(), audits: vi.fn(), auditCreate: vi.fn(), memberRead: vi.fn(), memberFirst: vi.fn(), members: vi.fn(), count: vi.fn(), create: vi.fn(), update: vi.fn(), user: vi.fn() }))
const db = {
  tournamentShell: { findUnique: mock.shellRead, updateMany: mock.shellLock, update: mock.shellUpdate },
  tournamentAuditLog: { findFirst: mock.auditRead, findMany: mock.audits, create: mock.auditCreate },
  tournamentParticipant: { findUnique: mock.memberRead, findFirst: mock.memberFirst, findMany: mock.members, count: mock.count, create: mock.create, update: mock.update },
  appUser: { findUnique: mock.user },
}
vi.mock('@/lib/prisma', () => ({ prisma: { $transaction: mock.transaction, tournamentShell: { findUnique: mock.shellRead }, tournamentAuditLog: { findFirst: mock.auditRead }, tournamentParticipant: { findUnique: mock.memberRead, findFirst: mock.memberFirst, findMany: mock.members, count: mock.count, create: mock.create, update: mock.update } } }))
import { freezeSeasonOpeningField, openSeasonRegistration, pauseSeasonRegistration, joinSeasonTournament, changeSeasonEntry, loadSeasonEntry, loadSeasonRegistration } from '@/lib/tournament/seasonRegistration'
type Member = { id: string; tournamentId: string; userId: string; displayName: string; status: string; updatedAt: Date }
let state: { shell: { id: string; commissionerId: string; status: string; updatedAt: Date; currentParticipantCount: number }; members: Member[]; logs: any[] }
let sequence: number
let token: string
const clone = <T,>(v: T): T => structuredClone(v)
const matches = (row: any, where: any) => Object.entries(where ?? {}).every(([key, value]: any) => value?.in ? value.in.includes(row[key]) : row[key] === value)
const sorted = (rows: any[]) => [...rows].sort((a, b) => a.updatedAt.getTime() - b.updatedAt.getTime() || a.id.localeCompare(b.id))
beforeEach(async () => {
  vi.restoreAllMocks(); vi.resetAllMocks()
  vi.spyOn(Date, 'now').mockReturnValue(Date.parse('2026-10-12T12:00:00Z'))
  sequence = 0
  state = { shell: { id: 't1', commissionerId: 'owner', status: 'rules_published', updatedAt: new Date('2026-10-12T12:00:00Z'), currentParticipantCount: 0 }, members: [], logs: [{ id: 'pub1', tournamentId: 't1', action: 'season_rules_published', createdAt: new Date('2026-10-12T11:00:00Z'), data: { config: completeConfig(), hash: 'frozen-hash', calendar: { pendingGames: 0, excludedGames: [] } } }] }
  mock.shellRead.mockImplementation(async ({ where }) => where.id === 't1' ? clone(state.shell) : null)
  mock.shellLock.mockImplementation(async ({ where, data }) => {
    if (where.updatedAt.getTime() !== state.shell.updatedAt.getTime() || where.status !== state.shell.status) return { count: 0 }
    Object.assign(state.shell, data); return { count: 1 }
  })
  mock.shellUpdate.mockImplementation(async ({ data }) => { Object.assign(state.shell, data); return clone(state.shell) })
  mock.auditRead.mockImplementation(async ({ where }) => clone([...state.logs].filter(row => matches(row, where)).sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime() || b.id.localeCompare(a.id))[0] ?? null))
  mock.audits.mockImplementation(async ({ where }) => clone([...state.logs].filter(row => matches(row, where)).sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime() || b.id.localeCompare(a.id))))
  mock.auditCreate.mockImplementation(async ({ data }) => { const row = { id: 'event-' + (++sequence), ...data }; state.logs.push(clone(row)); return clone(row) })
  mock.memberRead.mockImplementation(async ({ where }) => clone(state.members.find(row => matches(row, where.tournamentId_userId)) ?? null))
  mock.memberFirst.mockImplementation(async ({ where }) => clone(sorted(state.members.filter(row => matches(row, where)))[0] ?? null))
  mock.members.mockImplementation(async ({ where }) => clone(sorted(state.members.filter(row => matches(row, where)))))
  mock.count.mockImplementation(async ({ where }) => state.members.filter(row => matches(row, where)).length)
  mock.create.mockImplementation(async ({ data }) => { if (state.members.some(m => m.tournamentId === data.tournamentId && m.userId === data.userId)) throw new Error('Unique constraint'); const row = { id: 'member-' + (++sequence), ...data }; state.members.push(row); return clone(row) })
  mock.update.mockImplementation(async ({ where, data }) => { const row = state.members.find(r => r.id === where.id)!; Object.assign(row, data); return clone(row) })
  mock.user.mockImplementation(async ({ where }) => ({ username: where.id, displayName: 'Manager ' + where.id, avatarUrl: null }))
  // Models commit/rollback and row-serialized DB transactions. CAS conflict retries are exercised separately.
  let tail = Promise.resolve()
  mock.transaction.mockImplementation(async run => {
    const prior = tail; let release!: () => void; tail = new Promise<void>(resolve => { release = resolve }); await prior
    const snapshot = clone(state)
    try { return await run(db) } catch (e) { state = snapshot; throw e } finally { release() }
  })
  const opened = await openSeasonRegistration('owner', 't1', 'pub1', '2026-10-17T12:00:00Z', 64)
  token = opened.invitePath.split('invite=')[1]!
  vi.clearAllMocks()
})
const join = (user: string) => joinSeasonTournament(user, 't1', token, 'pub1', 'frozen-hash')

describe('season tournament registration', () => {
  it('stores only a token hash and binds acceptance to the immutable publication', async () => {
    expect(token).toHaveLength(64)
    expect(JSON.stringify(state.logs)).not.toContain(token)
    const result = await join('one')
    expect(result.status).toBe('registered')
    expect(state.logs.find(e => e.action === 'season_entry_joined').data).toMatchObject({ publicationId: 'pub1', hash: 'frozen-hash' })
    expect(state.shell.currentParticipantCount).toBe(1)
  })
  it('deduplicates a repeated join without creating another acceptance or consuming capacity', async () => {
    const first = await join('one')
    expect(await join('one')).toEqual(first)
    expect(state.members).toHaveLength(1)
    expect(state.logs.filter(e => e.action === 'season_entry_joined')).toHaveLength(1)
  })
  it('keeps concurrent joins to the final seat within capacity and puts the other entrant on the waitlist', async () => {
    for (let i = 0; i < 63; i++) await join('u' + i)
    const results = await Promise.all([join('last-a'), join('last-b')])
    expect(results.map(r => r.status).sort()).toEqual(['registered', 'waitlisted'])
    expect(state.shell.currentParticipantCount).toBe(64)
    expect(state.members.filter(m => m.status === 'registered')).toHaveLength(64)
  })
  it('promotes the oldest waitlisted entrant after withdrawal, with no queue jumping', async () => {
    for (let i = 0; i < 66; i++) await join('u' + i)
    await changeSeasonEntry('u0', 't1', 'withdraw')
    expect(state.members.find(m => m.userId === 'u64')?.status).toBe('registered')
    expect(state.members.find(m => m.userId === 'u65')?.status).toBe('waitlisted')
    expect(state.shell.currentParticipantCount).toBe(64)
    expect((await loadSeasonEntry('u65', 't1'))?.waitlistPosition).toBe(1)
  })
  it('puts a withdrawn person at the back when they rejoin', async () => {
    for (let i = 0; i < 66; i++) await join('u' + i)
    await changeSeasonEntry('u64', 't1', 'withdraw')
    await join('u64')
    expect((await loadSeasonEntry('u64', 't1'))?.waitlistPosition).toBe(2)
  })
  it('does not overfill a disabled waitlist', async () => {
    const opened = await openSeasonRegistration('owner', 't1', 'pub1', '2026-10-17T12:00:00Z', 0)
    token = opened.invitePath.split('invite=')[1]!
    for (let i = 0; i < 64; i++) await join('u' + i)
    await expect(join('overflow')).rejects.toMatchObject({ status: 409 })
    expect(state.members).toHaveLength(64)
  })
  it('invalidates old links on rotation and pause while retaining existing member access', async () => {
    await join('one')
    await openSeasonRegistration('owner', 't1', 'pub1', '2026-10-17T12:00:00Z', 64)
    await expect(join('new')).rejects.toMatchObject({ status: 404 })
    expect(await loadSeasonEntry('one', 't1')).not.toBeNull()
    await pauseSeasonRegistration('owner', 't1')
    await changeSeasonEntry('one', 't1', 'withdraw')
    expect(state.members[0]!.status).toBe('withdrawn')
  })
  it.each(['wrong rules', 'wrong token', 'expired'])('rejects %s without membership changes', async kind => {
    if (kind === 'expired') vi.spyOn(Date, 'now').mockReturnValue(Date.parse('2026-10-17T13:00:00Z'))
    await expect(joinSeasonTournament('new', 't1', kind === 'wrong token' ? 'b'.repeat(64) : token, 'pub1', kind === 'wrong rules' ? 'forged' : 'frozen-hash')).rejects.toThrow()
    expect(state.members).toHaveLength(0)
  })
  it('prevents removal through another tournament and protects owner-only controls', async () => {
    const entrant = await join('one')
    await expect(changeSeasonEntry('other', 't1', 'remove', entrant.participantId, 'Reason')).rejects.toMatchObject({ status: 403 })
    await expect(changeSeasonEntry('owner', 't1', 'remove', 'foreign-id', 'Reason')).rejects.toMatchObject({ status: 404 })
    await expect(openSeasonRegistration('other', 't1', 'pub1', '2026-10-17T12:00:00Z', 64)).rejects.toMatchObject({ status: 403 })
  })
  it('requires audited removal, blocks rejoining and makes restoration require new consent', async () => {
    const entrant = await join('one')
    await expect(changeSeasonEntry('owner', 't1', 'remove', entrant.participantId, '')).rejects.toThrow()
    await changeSeasonEntry('owner', 't1', 'remove', entrant.participantId, 'Duplicate account review')
    await expect(join('one')).rejects.toMatchObject({ status: 403 })
    await changeSeasonEntry('owner', 't1', 'restore', entrant.participantId)
    expect(state.members[0]!.status).toBe('withdrawn')
    await join('one')
    expect(state.members[0]!.status).toBe('registered')
    expect(state.logs.filter(e => e.action === 'season_entry_joined')).toHaveLength(2)
  })
  it('locks withdrawals at the deadline and all changes at the opening draft', async () => {
    await join('one')
    vi.spyOn(Date, 'now').mockReturnValue(Date.parse('2026-10-17T12:00:00Z'))
    await expect(changeSeasonEntry('one', 't1', 'withdraw')).rejects.toMatchObject({ status: 409 })
    vi.spyOn(Date, 'now').mockReturnValue(Date.parse('2026-10-18T00:00:00Z'))
    await expect(pauseSeasonRegistration('owner', 't1')).rejects.toMatchObject({ status: 409 })
  })
  it('rejects a deadline after the draft or a publication without transaction rules', async () => {
    await expect(openSeasonRegistration('owner', 't1', 'pub1', '2026-10-19T00:00:00Z', 64)).rejects.toThrow()
    delete state.logs[0].data.config.rules.transactionPolicy
    await expect(openSeasonRegistration('owner', 't1', 'pub1', '2026-10-17T12:00:00Z', 64)).rejects.toThrow('transaction policy')
  })
  it('retries CAS contention with a fresh transaction and refuses repeated contention', async () => {
    mock.shellLock.mockResolvedValueOnce({ count: 0 })
    await join('one')
    expect(mock.transaction).toHaveBeenCalledTimes(2)
    mock.shellLock.mockResolvedValue({ count: 0 })
    await expect(join('two')).rejects.toMatchObject({ status: 409 })
    expect(state.members).toHaveLength(1)
  })
  it('preserves a strictly increasing lock timestamp when updating counts', async () => {
    const previous = state.shell.updatedAt.getTime()
    await join('one')
    expect(state.shell.updatedAt.getTime()).toBeGreaterThan(previous)
    expect(mock.shellUpdate.mock.calls[0]![0].data.updatedAt).toEqual(state.shell.updatedAt)
  })
  it('hides the participant list from outsiders and exposes no secret token to the owner board', async () => {
    await join('one')
    expect(await loadSeasonEntry('outsider', 't1')).toBeNull()
    await expect(loadSeasonRegistration('outsider', 't1')).rejects.toMatchObject({ status: 403 })
    const board = await loadSeasonRegistration('owner', 't1')
    expect(board?.registered).toBe(1)
    expect(JSON.stringify(board)).not.toContain(token)
    expect(JSON.stringify(board)).not.toContain('tokenHash')
  })
  it('rolls back a failed membership write and its capacity counter', async () => {
    mock.auditCreate.mockRejectedValueOnce(new Error('DB unavailable'))
    await expect(join('one')).rejects.toThrow('DB unavailable')
    expect(state.members).toHaveLength(0)
    expect(state.shell.currentParticipantCount).toBe(0)
  })
})


describe('opening field freeze', () => {
  const fill = async () => { for (let i = 0; i < 65; i++) await join('u' + i) }
  it('requires owner, current publication and exact full field', async () => {
    await expect(freezeSeasonOpeningField('other', 't1', 'pub1')).rejects.toMatchObject({ status: 403 })
    await expect(freezeSeasonOpeningField('owner', 't1', 'stale')).rejects.toMatchObject({ status: 409 })
    await expect(freezeSeasonOpeningField('owner', 't1', 'pub1')).rejects.toMatchObject({ status: 409 })
    expect(state.logs.some(e => e.action === 'season_opening_field_frozen')).toBe(false)
  })
  it('freezes accepted registered entrants only and persists one assignment across retries', async () => {
    await fill()
    const result = await freezeSeasonOpeningField('owner', 't1', 'pub1')
    const event = state.logs.find(e => e.id === result.freezeId)
    const members = event.data.leagues.flatMap((l: any) => l.members)
    expect(members).toHaveLength(64)
    expect(new Set(members.map((e: any) => e.userId)).size).toBe(64)
    expect(members.some((e: any) => e.userId === 'u64')).toBe(false)
    expect(members.some((e: any) => e.userId === 'owner')).toBe(false)
    expect(event.data.manifestHash).toMatch(/^[a-f0-9]{64}$/)
    expect(event.data.config.rules).toEqual(completeConfig().rules)
    expect(await freezeSeasonOpeningField('owner', 't1', 'pub1')).toEqual(result)
    expect(state.logs.filter(e => e.action === 'season_opening_field_frozen')).toHaveLength(1)
    const board = await loadSeasonRegistration('owner', 't1')
    expect(board?.state).toBe('field_frozen')
    expect(board?.frozenField?.id).toBe(result.freezeId)
  })
  it('shows only a matched, audited opening draft link to its assigned manager', async () => {
    for (let i = 0; i < 64; i++) await join('u' + i)
    const { freezeId } = await freezeSeasonOpeningField('owner', 't1', 'pub1')
    const frozen = state.logs.find(e => e.id === freezeId)
    const league = frozen.data.leagues.find((l: any) => l.members.some((m: any) => m.userId === 'u0'))
    const other = frozen.data.leagues.find((l: any) => l.key !== league.key).members[0].userId
    expect((await loadSeasonEntry('u0', 't1'))?.assignment?.draftId).toBeUndefined()
    state.logs.push({ id: 'provision', tournamentId: 't1', action: 'season_opening_league_provisioned', targetType: 'opening_league', targetId: league.key, createdAt: new Date('2026-10-12T13:00:00Z'), data: { freezeId, manifestHash: frozen.data.manifestHash, leagueId: 'native-one', draftId: 'draft-one' } })
    state.logs.push({ id: 'wrong-release', tournamentId: 't1', action: 'season_opening_draft_released', targetType: 'league', targetId: 'native-one', createdAt: new Date('2026-10-12T14:00:00Z'), data: { freezeId, manifestHash: frozen.data.manifestHash, publicationId: 'pub1', key: league.key, leagueId: 'native-one', draftId: 'different-draft', seasonLaunchReady: false } })
    expect((await loadSeasonEntry('u0', 't1'))?.assignment?.draftId).toBeUndefined()
    state.logs.push({ id: 'release', tournamentId: 't1', action: 'season_opening_draft_released', targetType: 'league', targetId: 'native-one', createdAt: new Date('2026-10-12T15:00:00Z'), data: { freezeId, manifestHash: frozen.data.manifestHash, publicationId: 'pub1', key: league.key, leagueId: 'native-one', draftId: 'draft-one', seasonLaunchReady: false } })
    expect((await loadSeasonEntry('u0', 't1'))?.assignment?.draftId).toBe('draft-one')
    expect((await loadSeasonEntry(other, 't1'))?.assignment?.draftId).toBeUndefined()
    expect(await loadSeasonEntry('outsider', 't1')).toBeNull()
  })
  it('blocks every membership/control write and disables entrant actions after freeze', async () => {
    await fill(); await freezeSeasonOpeningField('owner', 't1', 'pub1')
    await expect(join('new')).rejects.toMatchObject({ status: 409 })
    await expect(changeSeasonEntry('u0', 't1', 'withdraw')).rejects.toMatchObject({ status: 409 })
    await expect(changeSeasonEntry('owner', 't1', 'remove', state.members[0]!.id, 'Review')).rejects.toMatchObject({ status: 409 })
    await expect(changeSeasonEntry('owner', 't1', 'restore', state.members[0]!.id)).rejects.toMatchObject({ status: 409 })
    await expect(pauseSeasonRegistration('owner', 't1')).rejects.toMatchObject({ status: 409 })
    await expect(openSeasonRegistration('owner', 't1', 'pub1', '2026-10-17T12:00:00Z', 64)).rejects.toMatchObject({ status: 409 })
    expect(await loadSeasonEntry('u0', 't1')).toMatchObject({ fieldFrozen: true, canJoin: false, canWithdraw: false })
  })
  it('rejects missing or mismatched latest consent atomically', async () => {
    await fill()
    state.logs.filter(e => e.action === 'season_entry_joined')[0].data.hash = 'wrong'
    await expect(freezeSeasonOpeningField('owner', 't1', 'pub1')).rejects.toThrow('exact published')
    expect(state.logs.some(e => e.action === 'season_opening_field_frozen')).toBe(false)
    expect((await join('another')).status).toBe('waitlisted')
  })
  it('serializes two simultaneous freeze requests to the same event', async () => {
    await fill()
    const [a, b] = await Promise.all([freezeSeasonOpeningField('owner', 't1', 'pub1'), freezeSeasonOpeningField('owner', 't1', 'pub1')])
    expect(a).toEqual(b)
    expect(state.logs.filter(e => e.action === 'season_opening_field_frozen')).toHaveLength(1)
  })
  it('recovers a frozen field after the draft starts but refuses a new late freeze', async () => {
    await fill()
    const result = await freezeSeasonOpeningField('owner', 't1', 'pub1')
    vi.spyOn(Date, 'now').mockReturnValue(Date.parse('2026-10-19T00:00:00Z'))
    expect(await freezeSeasonOpeningField('owner', 't1', 'pub1')).toEqual(result)
    state.logs = state.logs.filter(e => e.action !== 'season_opening_field_frozen')
    await expect(freezeSeasonOpeningField('owner', 't1', 'pub1')).rejects.toMatchObject({ status: 409 })
  })
  it('keeps a concurrent withdrawal from changing an already frozen assignment', async () => {
    await fill()
    const results = await Promise.allSettled([freezeSeasonOpeningField('owner', 't1', 'pub1'), changeSeasonEntry('u0', 't1', 'withdraw')])
    expect(results[0]!.status).toBe('fulfilled')
    expect(results[1]!.status).toBe('rejected')
    expect(state.members.find(m => m.userId === 'u0')?.status).toBe('registered')
    expect(state.shell.currentParticipantCount).toBe(64)
  })
  it('rolls back failed audit persistence and allows a clean retry', async () => {
    await fill(); const before = state.shell.updatedAt
    mock.auditCreate.mockRejectedValueOnce(new Error('storage failure'))
    await expect(freezeSeasonOpeningField('owner', 't1', 'pub1')).rejects.toThrow('storage failure')
    expect(state.shell.updatedAt).toEqual(before)
    expect(state.logs.some(e => e.action === 'season_opening_field_frozen')).toBe(false)
    await expect(freezeSeasonOpeningField('owner', 't1', 'pub1')).resolves.toHaveProperty('freezeId')
  })
  it('reveals only the signed-in frozen entrant assignment and refuses a tampered manifest', async () => {
    await fill(); await freezeSeasonOpeningField('owner', 't1', 'pub1')
    const view = await loadSeasonEntry('u0', 't1')
    expect(view?.assignment).toMatchObject({ teams: 8, art: { sideId: 'gold', emblemId: 'basketball' } })
    expect(Object.keys(view!.assignment!).sort()).toEqual(['art', 'division', 'draftSlot', 'key', 'name', 'startsAt', 'teams'])
    expect(JSON.stringify(view)).not.toContain('"members"')
    expect(await loadSeasonEntry('outsider', 't1')).toBeNull()
    state.logs.find(e => e.action === 'season_opening_field_frozen')!.data.leagues[0].members[0].draftSlot = 99
    await expect(loadSeasonEntry('u0', 't1')).rejects.toMatchObject({ status: 409 })
  })

})
