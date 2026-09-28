import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * The ONE place a Chimmy action changes anything. What must hold:
 *   - nothing runs without a valid, unexpired token minted for THIS user;
 *   - an action runs at most once, however many times the card is tapped;
 *   - every executed action is written to the league audit log.
 */

const h = vi.hoisted(() => {
  const rows = new Map<string, { cacheKey: string; data: unknown; expiresAt: Date }>()
  return {
    rows,
    create: vi.fn(async ({ data }: { data: { cacheKey: string; data: unknown; expiresAt: Date } }) => {
      if (rows.has(data.cacheKey)) throw Object.assign(new Error('Unique constraint failed'), { code: 'P2002' })
      rows.set(data.cacheKey, { ...data })
      return data
    }),
    findUnique: vi.fn(async ({ where }: { where: { cacheKey: string } }) => rows.get(where.cacheKey) ?? null),
    update: vi.fn(async ({ where, data }: { where: { cacheKey: string }; data: { data: unknown } }) => {
      const cur = rows.get(where.cacheKey)
      if (cur) cur.data = data.data
      return cur
    }),
    lineup: vi.fn(),
    trade: vi.fn(),
    audit: vi.fn(async () => ({ id: 'audit-1' })),
  }
})

vi.mock('@/lib/prisma', () => ({
  prisma: { sportsDataCache: { create: h.create, findUnique: h.findUnique, update: h.update } },
}))
vi.mock('@/server/services/auditService', () => ({ logAction: h.audit }))
vi.mock('@/lib/chimmy/actions/lineupAction', () => ({ executeLineupAction: h.lineup }))
vi.mock('@/lib/chimmy/actions/tradeAction', () => ({ executeTradeAction: h.trade }))

import { confirmChimmyAction } from '@/lib/chimmy/actions/confirmAction'
import { signChimmyActionToken } from '@/lib/chimmy/actions/actionToken'

const NOW = new Date('2026-09-25T15:00:00Z')
const prevSecret = process.env.NEXTAUTH_SECRET

const lineupToken = (userId = 'u1') =>
  signChimmyActionToken({
    userId,
    leagueId: 'L1',
    now: NOW,
    spec: { kind: 'lineup', rosterId: 'r1', week: 4, season: 2026, moves: [{ playerId: 'p1', to: 'starters' }], baseFingerprint: 'fp' },
  })!.token

const tradeToken = () =>
  signChimmyActionToken({
    userId: 'u1',
    leagueId: 'L1',
    now: NOW,
    spec: { kind: 'trade', proposerRosterId: 'r1', receiverRosterId: 'r2', week: 4, season: 2026, assets: [{ playerId: 'p1', fromRosterId: 'r1', toRosterId: 'r2' }] },
  })!.token

beforeEach(() => {
  process.env.NEXTAUTH_SECRET = 'test-secret'
  h.rows.clear()
  vi.clearAllMocks()
  h.lineup.mockResolvedValue({ ok: true, message: 'Done — started A for week 4.', before: ['x'], after: ['p1'], rosterId: 'r1' })
  h.trade.mockResolvedValue({ ok: true, message: 'Offer sent.', tradeId: 'T1' })
})
afterEach(() => {
  if (prevSecret === undefined) delete process.env.NEXTAUTH_SECRET
  else process.env.NEXTAUTH_SECRET = prevSecret
})

describe('confirmChimmyAction', () => {
  it('runs a valid lineup card once and logs it to the league audit trail', async () => {
    const r = await confirmChimmyAction({ token: lineupToken(), userId: 'u1', now: NOW })
    expect(r).toMatchObject({ ok: true, status: 'executed', kind: 'lineup' })
    expect(h.lineup).toHaveBeenCalledTimes(1)
    expect(h.audit).toHaveBeenCalledWith(
      expect.objectContaining({ leagueId: 'L1', userId: 'u1', actionType: 'chimmy_lineup_set', entityId: 'r1' }),
    )
    const claim = [...h.rows.values()][0]!
    expect(claim.cacheKey).toMatch(/^chimmy-action:/)
    expect(claim.data).toMatchObject({ status: 'executed', userId: 'u1', leagueId: 'L1' })
  })

  it('never runs the same card twice — the second tap gets the recorded outcome', async () => {
    const token = tradeToken()
    const first = await confirmChimmyAction({ token, userId: 'u1', now: NOW })
    const second = await confirmChimmyAction({ token, userId: 'u1', now: NOW })
    expect(first).toMatchObject({ ok: true, status: 'executed', tradeId: 'T1' })
    expect(second).toMatchObject({ ok: true, status: 'already_executed', tradeId: 'T1' })
    expect(h.trade).toHaveBeenCalledTimes(1)
    expect(h.audit).toHaveBeenCalledTimes(1)
  })

  it('two taps racing each other execute once', async () => {
    const token = lineupToken()
    let release: () => void = () => {}
    h.lineup.mockImplementation(
      () =>
        new Promise((resolve) => {
          release = () => resolve({ ok: true, message: 'Done.', before: [], after: [], rosterId: 'r1' })
        }),
    )
    const a = confirmChimmyAction({ token, userId: 'u1', now: NOW })
    const b = await confirmChimmyAction({ token, userId: 'u1', now: NOW })
    release()
    expect(await a).toMatchObject({ status: 'executed' })
    expect(b).toMatchObject({ ok: false, status: 'refused', retryable: true })
    expect(h.lineup).toHaveBeenCalledTimes(1)
  })

  it("refuses a card minted for someone else and runs nothing", async () => {
    const r = await confirmChimmyAction({ token: lineupToken('someone-else'), userId: 'u1', now: NOW })
    expect(r).toMatchObject({ ok: false, status: 'invalid' })
    expect(h.lineup).not.toHaveBeenCalled()
    expect(h.create).not.toHaveBeenCalled()
  })

  it('refuses when nobody is signed in', async () => {
    expect(await confirmChimmyAction({ token: lineupToken(), userId: null, now: NOW })).toMatchObject({ ok: false, status: 'invalid' })
    expect(h.lineup).not.toHaveBeenCalled()
  })

  it('refuses an expired card and runs nothing', async () => {
    const later = new Date(NOW.getTime() + 11 * 60 * 1000)
    expect(await confirmChimmyAction({ token: lineupToken(), userId: 'u1', now: later })).toMatchObject({ ok: false, status: 'expired' })
    expect(h.lineup).not.toHaveBeenCalled()
  })

  it('refuses a tampered card and runs nothing', async () => {
    const [encoded] = lineupToken().split('.')
    expect(await confirmChimmyAction({ token: `${encoded}.forged`, userId: 'u1', now: NOW })).toMatchObject({ ok: false, status: 'invalid' })
    expect(h.lineup).not.toHaveBeenCalled()
  })

  it('records a refusal, logs nothing, and burns the card', async () => {
    h.lineup.mockResolvedValue({ ok: false, message: "Nothing was changed: Bijan's game has already started." })
    const token = lineupToken()
    const r = await confirmChimmyAction({ token, userId: 'u1', now: NOW })
    expect(r).toMatchObject({ ok: false, status: 'refused', message: expect.stringMatching(/already started/) })
    expect(h.audit).not.toHaveBeenCalled()
    const again = await confirmChimmyAction({ token, userId: 'u1', now: NOW })
    expect(again).toMatchObject({ ok: false, status: 'refused', message: expect.stringMatching(/already started/) })
    expect(h.lineup).toHaveBeenCalledTimes(1)
  })

  it('refuses without running anything when the claim cannot be recorded', async () => {
    h.create.mockRejectedValueOnce(new Error('db down'))
    const r = await confirmChimmyAction({ token: lineupToken(), userId: 'u1', now: NOW })
    expect(r).toMatchObject({ ok: false, status: 'refused' })
    expect(h.lineup).not.toHaveBeenCalled()
  })
})
