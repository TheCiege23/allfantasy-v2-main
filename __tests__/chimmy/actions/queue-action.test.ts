import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/*
 * Chimmy editing the user's OWN draft queue through a confirm card (stage 2 of drafts, 2026-11-16).
 * Propose resolves names against the room's warm pool and dry-runs the room's own save checks; execute
 * refuses a queue or draft that changed since, then saves through the room's one writer. Never a pick.
 */

const h = vi.hoisted(() => ({
  access: vi.fn(async () => true),
  session: vi.fn(),
  queueRow: vi.fn(),
  warm: vi.fn(),
  prepare: vi.fn(),
  persist: vi.fn(async () => undefined),
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    draftSession: { findFirst: h.session },
    draftQueue: { findUnique: h.queueRow },
    league: { findUnique: vi.fn(async () => ({ name: 'Dynasty Ten', sport: 'NFL', season: 2026 })) },
  },
}))
vi.mock('@/lib/live-draft-engine/auth', () => ({ canAccessLeagueDraft: h.access, getCurrentUserRosterIdForLeague: vi.fn(async () => "qa-roster") }))
vi.mock('@/lib/draft-room/ensureDraftPoolReady', () => ({ getWarmDraftPoolSnapshotFast: h.warm }))
vi.mock('@/lib/draft-room/saveDraftQueue', () => ({ prepareDraftQueueSave: h.prepare, persistDraftQueue: h.persist }))

import { applyQueueOps, matchByName, queueFingerprint, queueNameKey } from '@/lib/chimmy/actions/queuePlan'
import { executeQueueAction, proposeDraftQueueChange } from '@/lib/chimmy/actions/queueAction'
import { verifyChimmyActionToken } from '@/lib/chimmy/actions/actionToken'
import { readActionCards } from '@/lib/chimmy-chat/actionCards'

const POOL = [
  { name: 'Jaylen Waddle', position: 'WR', team: 'MIA', playerId: 'p-waddle' },
  { name: 'Zay Flowers', position: 'WR', team: 'BAL', playerId: 'p-flowers' },
  { name: 'Sam LaPorta', position: 'TE', team: 'DET', playerId: 'p-laporta' },
  { name: 'Josh Allen', position: 'QB', team: 'BUF', playerId: 'p-allen-qb' },
  { name: 'Josh Allen', position: 'DE', team: 'JAX', playerId: 'p-allen-de' },
  { name: 'Bijan Robinson', position: 'RB', team: 'ATL', playerId: 'p-bijan' },
]
const QUEUE = [
  { playerName: 'Puka Nacua', position: 'WR', team: 'LAR', playerId: 'p-puka' },
  { playerName: 'Travis Kelce', position: 'TE', team: 'KC', playerId: 'p-kelce' },
]

const prevSecret = process.env.NEXTAUTH_SECRET
beforeEach(() => {
  vi.clearAllMocks()
  process.env.NEXTAUTH_SECRET = 'test-secret'
  h.access.mockResolvedValue(true)
  h.session.mockResolvedValue({ id: 'sess-1', status: 'in_progress', picks: [{ playerName: 'Bijan Robinson' }] })
  h.queueRow.mockResolvedValue({ order: QUEUE })
  h.warm.mockResolvedValue({ warm: true, payload: { entries: POOL } })
  h.prepare.mockImplementation(async (_leagueId: string, queue: unknown[]) => ({
    ok: true,
    prepared: { sessionId: 'sess-1', queue, removedCount: 0, queueSizeLimit: 50 },
  }))
})
afterEach(() => {
  if (prevSecret === undefined) delete process.env.NEXTAUTH_SECRET
  else process.env.NEXTAUTH_SECRET = prevSecret
})

describe('the pure queue edit', () => {
  it('adds at the top or bottom, and an add of a queued player MOVES them', () => {
    const top = applyQueueOps(QUEUE, { add: [{ playerName: 'Jaylen Waddle', position: 'WR', team: 'MIA', playerId: 'p' }], addAt: 'top', removeKeys: [] })
    expect(top.map((e) => e.playerName)).toEqual(['Jaylen Waddle', 'Puka Nacua', 'Travis Kelce'])
    const moved = applyQueueOps(QUEUE, { add: [{ playerName: 'Travis Kelce', position: 'TE', team: 'KC', playerId: 'p-kelce' }], addAt: 'top', removeKeys: [] })
    expect(moved.map((e) => e.playerName)).toEqual(['Travis Kelce', 'Puka Nacua'])
    const removed = applyQueueOps(QUEUE, { add: [], addAt: 'bottom', removeKeys: [queueNameKey('Puka Nacua')] })
    expect(removed.map((e) => e.playerName)).toEqual(['Travis Kelce'])
  })

  it('fingerprints players AND order, so a reorder counts as a change', () => {
    expect(queueFingerprint(QUEUE)).toBe(queueFingerprint([...QUEUE]))
    expect(queueFingerprint(QUEUE)).not.toBe(queueFingerprint([...QUEUE].reverse()))
    expect(queueFingerprint([])).toBe('0:1505')
  })

  it('matches exactly, then a unique partial name, and never guesses between two', () => {
    expect(matchByName("ja'marr chase", [{ n: "Ja'Marr Chase" }], (x) => x.n)).toMatchObject({ ok: true })
    expect(matchByName('Waddle', POOL, (p) => p.name)).toMatchObject({ ok: true, item: { name: 'Jaylen Waddle' } })
    expect(matchByName('Josh Allen', POOL, (p) => p.name)).toMatchObject({ ok: false, reason: 'ambiguous' })
    expect(matchByName('Al', POOL, (p) => p.name)).toMatchObject({ ok: false, reason: 'none' })
  })
})

describe('proposeDraftQueueChange', () => {
  it('builds a signed card from the pool\'s own players, skipping the drafted and the ambiguous', async () => {
    const out = await proposeDraftQueueChange({ leagueId: 'lg', userId: 'u1', add: ['waddle', 'Bijan Robinson', 'Josh Allen', 'Nobody Here'], position: 'top' })
    expect(out.ok).toBe(true)
    if (!out.ok) return
    expect(out.text).toMatch(/NOTHING has changed yet/)
    expect(out.card.kind).toBe('queue')
    expect(out.card.queue).toEqual({
      add: [{ name: 'Jaylen Waddle', position: 'WR', team: 'MIA' }],
      addAt: 'top',
      remove: [],
      resultingTop: ['Jaylen Waddle', 'Puka Nacua', 'Travis Kelce'],
    })
    expect(out.card.warnings.join(' ')).toContain('Bijan Robinson has already been drafted.')
    expect(out.card.warnings.join(' ')).toContain('"Josh Allen" matches more than one player')
    expect(out.card.warnings.join(' ')).toContain('"Nobody Here" is not in this draft\'s player pool.')
    expect(out.card.warnings).toContain('Your queue only: this never makes a pick.')

    const v = verifyChimmyActionToken(out.card.token)
    expect(v.ok).toBe(true)
    if (!v.ok) return
    expect(v.payload.spec).toEqual({
      kind: 'queue',
      sessionId: 'sess-1',
      add: [{ playerName: 'Jaylen Waddle', position: 'WR', team: 'MIA', playerId: 'p-waddle' }],
      addAt: 'top',
      removeKeys: [],
      rosterId: "qa-roster",
      baseFingerprint: queueFingerprint(QUEUE),
    })
    // The client reader accepts it (so the tray and drawer render it).
    expect(readActionCards({ actionCards: [out.card] })).toHaveLength(1)
    expect(h.persist).not.toHaveBeenCalled()
  })

  it('removes only players who are actually queued', async () => {
    const out = await proposeDraftQueueChange({ leagueId: 'lg', userId: 'u1', remove: ['Kelce', 'Someone Else'] })
    expect(out.ok && out.card.queue?.remove).toEqual([{ name: 'Travis Kelce', position: 'TE', team: 'KC' }])
    expect(out.ok && out.card.warnings.join(' ')).toContain('"Someone Else" is not in their queue.')
  })

  it('refuses rather than starting a cold pool build mid-chat', async () => {
    h.warm.mockResolvedValue({ warm: false })
    const out = await proposeDraftQueueChange({ leagueId: 'lg', userId: 'u1', add: ['Waddle'] })
    expect(out).toMatchObject({ ok: false })
    expect(out.text).toMatch(/player list isn't loaded yet/)
  })

  it('never shows a card the room\'s own save would refuse, or one that would overflow the queue', async () => {
    h.prepare.mockResolvedValueOnce({ ok: false, status: 400, error: 'Queue contains players with positions not starter-eligible for this draft: TE.' })
    expect((await proposeDraftQueueChange({ leagueId: 'lg', userId: 'u1', add: ['LaPorta'] })).text).toMatch(/could not be saved \(Queue contains players with positions not starter-eligible/)

    h.prepare.mockImplementationOnce(async (_l: string, queue: Array<{ playerName: string }>) => ({
      ok: true,
      prepared: { sessionId: 'sess-1', queue: queue.slice(0, 2), removedCount: 0, queueSizeLimit: 2 },
    }))
    expect((await proposeDraftQueueChange({ leagueId: 'lg', userId: 'u1', add: ['Waddle'] })).text).toMatch(/queue is full \(this league allows 2\), so Jaylen Waddle would not fit/)
  })

  it('refuses without draft-room access, after the draft, and when nothing would change', async () => {
    h.access.mockResolvedValueOnce(false)
    expect((await proposeDraftQueueChange({ leagueId: 'lg', userId: 'u1', add: ['Waddle'] })).ok).toBe(false)
    h.session.mockResolvedValueOnce({ id: 'sess-1', status: 'completed', picks: [] })
    expect((await proposeDraftQueueChange({ leagueId: 'lg', userId: 'u1', add: ['Waddle'] })).text).toMatch(/draft is over/)
    expect((await proposeDraftQueueChange({ leagueId: 'lg', userId: 'u1', add: ['Puka'], position: 'bottom' })).ok).toBe(false)
    expect(h.persist).not.toHaveBeenCalled()
  })
})

describe('executeQueueAction', () => {
  async function card() {
    const out = await proposeDraftQueueChange({ leagueId: 'lg', userId: 'u1', add: ['Waddle'], position: 'top' })
    if (!out.ok) throw new Error(out.text)
    const v = verifyChimmyActionToken(out.card.token)
    if (!v.ok) throw new Error('token')
    return v.payload
  }

  it('saves through the room\'s one writer, in the order the card showed', async () => {
    const payload = await card()
    const r = await executeQueueAction(payload, 'u1')
    expect(r).toEqual({ ok: true, message: 'Queue saved — Jaylen Waddle at the top.' })
    expect(h.persist).toHaveBeenCalledTimes(1)
    const [userId, prepared] = h.persist.mock.calls[0] as unknown as [string, { queue: Array<{ playerName: string }> }]
    expect(userId).toBe('u1')
    expect(prepared.queue.map((e) => e.playerName)).toEqual(['Jaylen Waddle', 'Puka Nacua', 'Travis Kelce'])
  })

  it('🛑 refuses when the queue changed since the card was made — a card never applies to a queue the user did not see', async () => {
    const payload = await card()
    h.queueRow.mockResolvedValue({ order: [...QUEUE].reverse() })
    expect(await executeQueueAction(payload, 'u1')).toMatchObject({ ok: false, message: expect.stringMatching(/queue changed since this card was made/) })
    expect(h.persist).not.toHaveBeenCalled()
  })

  it('refuses when another draft is current, or the draft has ended', async () => {
    const payload = await card()
    h.session.mockResolvedValueOnce({ id: 'sess-2', status: 'in_progress' })
    expect((await executeQueueAction(payload, 'u1')).message).toMatch(/different draft is current/)
    h.session.mockResolvedValueOnce({ id: 'sess-1', status: 'completed' })
    expect((await executeQueueAction(payload, 'u1')).message).toMatch(/draft is over/)
    expect(h.persist).not.toHaveBeenCalled()
  })
})
