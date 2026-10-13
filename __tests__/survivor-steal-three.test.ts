import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ db: {} as any, tx: {} as any, locks: vi.fn(), transfer: vi.fn() }))
vi.mock('@/lib/prisma', () => ({ prisma: mocks.db }))
vi.mock('@/lib/redraft/lineupLock', () => ({ hydrateRedraftLineupLocksForRosters: mocks.locks }))
vi.mock('@/lib/survivor/playerBoundIdolTransfer', () => ({ movePlayerBoundIdolsInTransaction: mocks.transfer }))
import { getStealThreePreview, playStealThree } from '@/lib/survivor/survivorStealThree'

const input = { idolId: 'idol', playerRowIds: ['a', 'b', 'c'], dropRowIds: [] as string[] }
const settings = { roster: { config: { sections: [{ slots: { QB: 1, BN: 3 } }] } } }
let players: any[], owner: any, idol: any, phase: any, season: any, effects: any[], committed: any[]
function row(id: string, rosterId = 'victim', slotType = 'BN') { return { id, rosterId, playerId: `player-${id}`, playerName: `Player ${id}`, position: 'QB', team: 'GB', sport: 'NFL', slotType, isLocked: false, injuryStatus: null, droppedAt: null } }
function delegate(reads: Record<string, unknown> = {}) {
  return { ...reads, create: vi.fn(async (value: any) => { effects.push(value.data); return value.data }), update: vi.fn(async (value: any) => { effects.push(value); return value }), updateMany: vi.fn(async (value: any) => { effects.push(value); return { count: 1 } }) }
}
beforeEach(() => {
  vi.clearAllMocks()
  players = [row('a'), row('b'), row('c'), row('ir', 'victim', 'IR'), row('locked')]
  players[4].isLocked = true
  owner = { playerState: 'active', redraftRosterId: 'my-link', displayName: 'Raider', idolIds: ['idol', 'secret-other'] }
  idol = { id: 'idol', powerType: 'triple_steal', rosterId: 'my-link' }
  phase = { currentWeek: 6, activePlayerCount: 10, phase: 'pre_merge', pausedSnapshot: null }
  effects = []; committed = []
  season = { id: 'season', sport: 'NFL', season: 2026, playoffStartWeek: 14, rosters: [] }
  const refreshRosters = () => { season.rosters = ['mine', 'victim', 'other'].map(id => ({ id, ownerId: `${id}-user`, teamName: id === 'victim' ? 'Raided team' : id, pointsFor: 600, wins: 3, losses: 2, ties: 0, players: players.filter(player => player.rosterId === id && !player.droppedAt) })); return season }
  const readDb = () => ({
    survivorIdol: delegate({ findFirst: vi.fn(async () => idol?.isUsed ? null : idol), findUnique: vi.fn(async () => idol) }),
    survivorGameState: delegate({ findUnique: vi.fn(async () => phase) }),
    leagueWaiverSettings: delegate({ findUnique: vi.fn(async () => ({ processingDayOfWeek: 3, processingTimeUtc: '08:00' })) }),
    league: delegate({ findUnique: vi.fn(async () => ({ settings, sport: 'NFL' })) }),
    survivorPlayer: delegate({ findUnique: vi.fn(async () => owner), findMany: vi.fn(async () => [{ redraftRosterId: 'my-link', tribe: null }, { redraftRosterId: 'victim-link', tribe: { name: 'Koa', logoUrl: '/survivor/tribes/marks/shark.svg' } }, { redraftRosterId: 'other-link', tribe: null }]) }),
    roster: delegate({ findUnique: vi.fn(async () => ({ redraftRosterId: 'mine' })), findMany: vi.fn(async () => ['mine', 'victim', 'other'].map(id => ({ id: id === 'mine' ? 'my-link' : `${id}-link`, redraftRosterId: id }))) }),
    redraftSeason: delegate({ findFirst: vi.fn(async () => refreshRosters()) }),
    playerWeeklyScore: delegate({ findMany: vi.fn(async () => [{ playerId: 'player-c', fantasyPts: 50 }, { playerId: 'player-b', fantasyPts: 20 }, { playerId: 'player-a', fantasyPts: 10 }]) }),
    redraftRoster: delegate({ findMany: vi.fn(async () => [{ id: 'victim', ownerId: 'victim-user', waiverPriority: 9 }]), findFirst: vi.fn(async () => ({ waiverPriority: 1 })) }),
    redraftLeagueTransaction: delegate(), redraftRosterPlayer: delegate(), survivorAuditEntry: delegate(), survivorIdolLedgerEntry: delegate(),
    notificationOutbox: delegate(), platformNotification: delegate(), leagueChatMessage: delegate(),
    survivorChatChannel: delegate({ findFirst: vi.fn(async () => ({ id: 'chat' })) }), survivorChatMessage: delegate(),
  })
  Object.assign(mocks.db, readDb())
  Object.assign(mocks.tx, readDb(), { $queryRaw: vi.fn(async () => []) })
  mocks.tx.survivorIdol.updateMany.mockImplementation(async (value: any) => { idol = { ...idol, ...value.data }; effects.push(value); return { count: 1 } })
  mocks.tx.redraftRosterPlayer.updateMany.mockImplementation(async (value: any) => { const player = players.find(player => player.id === value.where.id && player.rosterId === value.where.rosterId && !player.droppedAt); if (!player) return { count: 0 }; Object.assign(player, value.data); effects.push(value); return { count: 1 } })
  mocks.tx.survivorPlayer.update.mockImplementation(async (value: any) => { Object.assign(owner, value.data); effects.push(value); return owner })
  mocks.db.$transaction = vi.fn(async (fn: any) => {
    const snapshot = structuredClone({ players, owner, idol })
    try { const result = await fn(mocks.tx); committed = [...effects]; return result }
    catch (error) { players = snapshot.players; owner = snapshot.owner; idol = snapshot.idol; effects = []; throw error }
  })
  mocks.locks.mockImplementation(async (_db: any, args: any) => ({ players: args.players.map((player: any) => ({ ...player })), warnings: [] }))
  mocks.transfer.mockResolvedValue(0)
})

describe('Steal 3 validation and settlement', () => {
  it('moves 3 to the bench, consumes the idol, audits, posts AF Host, DMs and queues a push in one transaction', async () => {
    const result = await playStealThree('league', 'me', input)
    expect(result).toEqual({ ok: true, value: { raidedUserIds: ['victim-user'], playerNames: ['Player a', 'Player b', 'Player c'], dropNames: [], week: 6 } })
    expect(players.filter(player => player.rosterId === 'mine').map(player => [player.id, player.slotType])).toEqual([['a', 'BN'], ['b', 'BN'], ['c', 'BN']])
    expect(idol).toMatchObject({ isUsed: true, status: 'played' })
    expect(owner.idolIds).toEqual(['secret-other'])
    expect(mocks.db.$transaction).toHaveBeenCalledTimes(1)
    expect(mocks.db.$transaction.mock.calls[0][1]).toMatchObject({ isolationLevel: 'Serializable' })
    expect(mocks.locks.mock.calls[0][0]).toBe(mocks.tx)
    expect(mocks.db.redraftSeason.findFirst).not.toHaveBeenCalled()
    expect(mocks.tx.redraftRoster.update).toHaveBeenCalledWith({ where: { id: 'victim' }, data: { waiverPriority: 0 } })
    expect(mocks.tx.notificationOutbox.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ userId: 'victim-user', channel: 'push', eventType: 'survivor_steal_three' }) }))
    expect(mocks.tx.leagueChatMessage.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ isPrivate: true, visibleToUserId: 'victim-user' }) }))
    expect(mocks.tx.survivorChatMessage.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ senderName: 'AF Host', content: expect.stringContaining('Raider played Steal 3') }) }))
    expect(mocks.tx.survivorAuditEntry.create.mock.calls.map((call: any) => call[0].data.action)).toEqual(['steal_three_waiver_boost', 'steal_three_played'])
    expect(mocks.tx.survivorChatMessage.create.mock.calls[0][0].data.content).toContain('Raided team')
    expect(mocks.tx.survivorChatMessage.create.mock.calls[0][0].data.content).not.toContain('secret-other')
    expect(mocks.transfer).toHaveBeenCalledTimes(3)
    expect(committed.length).toBeGreaterThan(5)
  })
  it('rejects a kickoff between preview and confirmation without consuming or moving anything', async () => {
    const preview = await getStealThreePreview('league', 'me', 'idol')
    expect(preview.ok && preview.value.teams[0].players.find(player => player.id === 'a')?.disabled).toBe(false)
    players[0].isLocked = true
    const result = await playStealThree('league', 'me', input)
    expect(result).toMatchObject({ ok: false, code: 'player_locked', status: 409 })
    expect(effects).toEqual([])
    expect(players[0].rosterId).toBe('victim')
    expect(idol.isUsed).toBeUndefined()
  })
  it('rejects a player that locks during the transaction before any writes', async () => {
    mocks.locks.mockImplementationOnce(async (_db: any, args: any) => ({ players: args.players.map((player: any) => ({ ...player })), warnings: [] }))
    mocks.locks.mockImplementationOnce(async (_db: any, args: any) => ({ players: args.players.map((player: any) => ({ ...player, isLocked: player.id === 'a' })), warnings: [] }))
    expect(await playStealThree('league', 'me', input)).toMatchObject({ ok: false, code: 'player_locked' })
    expect(effects).toEqual([])
    expect(idol.isUsed).toBeUndefined()
    expect(mocks.locks.mock.calls[1][0]).toBe(mocks.tx)
  })
  it.each(['IR', 'RESERVE'])('rejects a player in the %s slot', async slot => {
    players[0].slotType = slot
    expect(await playStealThree('league', 'me', input)).toMatchObject({ ok: false, code: 'player_ir' })
    expect(effects).toEqual([])
  })
  it('rejects an IR designation even when the player is on the bench', async () => {
    players[0].injuryStatus = 'IR'
    expect(await playStealThree('league', 'me', input)).toMatchObject({ ok: false, code: 'player_ir' })
    expect(effects).toEqual([])
  })
  it('requires exactly 3 bench drops when full, and drops them atomically', async () => {
    players.push(row('starter', 'mine', 'QB'), row('d', 'mine'), row('e', 'mine'), row('f', 'mine'))
    const preview = await getStealThreePreview('league', 'me', 'idol')
    expect(preview.ok && preview.value.requiredDrops).toBe(3)
    expect(await playStealThree('league', 'me', input)).toMatchObject({ ok: false, code: 'incorrect_drops' })
    expect(effects).toEqual([])
    expect((await playStealThree('league', 'me', { ...input, dropRowIds: ['d', 'e', 'f'] })).ok).toBe(true)
    expect(players.filter(player => player.droppedAt).map(player => player.id)).toEqual(['d', 'e', 'f'])
    expect(players.filter(player => player.rosterId === 'mine' && !player.droppedAt).map(player => player.id)).toEqual(['a', 'b', 'c', 'starter'])
    expect(mocks.tx.survivorAuditEntry.create.mock.calls.find((call: any) => call[0].data.action === 'steal_three_played')?.[0].data.data.waiversClearAt).toMatch(/^\d{4}-\d{2}-\d{2}T/)
    expect(mocks.transfer.mock.calls.filter((call: any) => call[1].reason === 'waiver_drop')).toHaveLength(3)
  })
  it('returns 0 required drops when there is room so the UI can skip make room', async () => {
    const result = await getStealThreePreview('league', 'me', 'idol')
    expect(result.ok && result.value.requiredDrops).toBe(0)
    expect((await playStealThree('league', 'me', input)).ok).toBe(true)
    expect(players.some(player => player.droppedAt)).toBe(false)
  })
  it('returns tribe, weekly average and ranked top 3 without other idols or owners', async () => {
    const result = await getStealThreePreview('league', 'me', 'idol')
    expect(result.ok && result.value.teams[0]).toMatchObject({ tribe: { name: 'Koa' }, weeklyAverage: 120, topPlayers: ['Player c', 'Player b', 'Player a'] })
    expect(result.ok && result.value.teams[0].players.find(player => player.id === 'ir')).toMatchObject({ disabled: true, unavailableReason: 'On IR' })
    expect(JSON.stringify(result)).not.toContain('secret-other')
    expect(JSON.stringify(result)).not.toContain('victim-user')
  })
  it('requires all three players from one active opposing team', async () => {
    players[2].rosterId = 'other'
    expect(await playStealThree('league', 'me', input)).toMatchObject({ ok: false, code: 'one_team_required' })
    expect(effects).toEqual([])
  })
  it('rejects duplicates and wrong pick counts before starting a transaction', async () => {
    for (const ids of [['a', 'a', 'c'], ['a', 'b'], ['a', 'b', 'c', 'ir']]) expect(await playStealThree('league', 'me', { ...input, playerRowIds: ids })).toMatchObject({ ok: false, code: 'exactly_three' })
    expect(mocks.db.$transaction).not.toHaveBeenCalled()
  })
  it('does not permit starter drops or locked bench drops', async () => {
    players.push(row('d', 'mine'), row('e', 'mine'), row('f', 'mine'), row('starter', 'mine', 'QB'))
    expect(await playStealThree('league', 'me', { ...input, dropRowIds: ['d', 'e', 'starter'] })).toMatchObject({ ok: false, code: 'drop_unavailable' })
    players.find(player => player.id === 'f').isLocked = true
    expect(await playStealThree('league', 'me', { ...input, dropRowIds: ['d', 'e', 'f'] })).toMatchObject({ ok: false, code: 'drop_unavailable' })
    expect(effects).toEqual([])
  })
  it('rolls back roster moves and idol consumption if any later write fails', async () => {
    mocks.tx.survivorChatMessage.create.mockRejectedValueOnce(new Error('sensitive connection detail'))
    expect(await playStealThree('league', 'me', input)).toMatchObject({ ok: false, code: 'settlement_failed' })
    expect(players.slice(0, 3).map(player => player.rosterId)).toEqual(['victim', 'victim', 'victim'])
    expect(idol.isUsed).toBeUndefined()
    expect(owner.idolIds).toContain('idol')
    expect(committed).toEqual([])
  })
  it('rolls back when a conditional roster update loses a race', async () => {
    mocks.tx.redraftRosterPlayer.updateMany.mockResolvedValueOnce({ count: 0 })
    expect(await playStealThree('league', 'me', input)).toMatchObject({ ok: false, code: 'settlement_failed' })
    expect(idol.isUsed).toBeUndefined()
    expect(committed).toEqual([])
  })
  it('blocks replay, playoff play, inactive ownership and missing schedule', async () => {
    idol.isUsed = true
    expect(await playStealThree('league', 'me', input)).toMatchObject({ ok: false, code: 'idol_unavailable' })
    idol.isUsed = false; phase.currentWeek = 14
    expect(await playStealThree('league', 'me', input)).toMatchObject({ ok: false, code: 'idol_expired' })
    phase.currentWeek = 6; owner.playerState = 'exile'
    expect(await playStealThree('league', 'me', input)).toMatchObject({ ok: false, code: 'not_active_manager' })
    owner.playerState = 'active'; mocks.locks.mockResolvedValue({ players, warnings: ['missing schedule'] })
    expect(await playStealThree('league', 'me', input)).toMatchObject({ ok: false, code: 'schedule_unavailable' })
    expect(effects).toEqual([])
  })
})
