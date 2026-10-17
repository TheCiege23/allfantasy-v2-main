// @vitest-environment node
import { beforeEach, expect, it, vi } from 'vitest'
const state = vi.hoisted(() => ({ rows: [] as Array<{ playerName: string; status: string | null; team?: string | null; date?: Date; expiresAt?: Date }> }))
const query = vi.hoisted(() => vi.fn(async (_args: any) => state.rows))
vi.mock('@/lib/prisma', () => ({ prisma: { sportsInjury: { findMany: query } } }))
import { readInjuryStatusById } from '@/lib/core-app/injuryStatusById'
beforeEach(() => { state.rows = []; query.mockClear() })
it('joins an IR suffix alias to the roster id and limits it to the same club', async () => {
  state.rows = [{ playerName: 'Omar Cooper Jr.', status: 'IR', team: 'New York Jets' }]
  const result = await readInjuryStatusById('NFL', new Map([['13276', ['Omar Cooper']]]), new Map([['13276', 'NYJ']]))
  expect(result.get('13276')).toBe('IR')
  expect(query.mock.calls[0][0].where.playerName.in).toContain('Omar Cooper Jr.')
  expect(query.mock.calls[0][0].where.playerName.mode).toBe('insensitive')
})
it('rejects an identically named injury from a different club', async () => {
  state.rows = [{ playerName: 'Omar Cooper Jr.', status: 'IR', team: 'DAL' }]
  expect((await readInjuryStatusById('NFL', new Map([['13276', ['Omar Cooper']]]), new Map([['13276', 'NYJ']]))).size).toBe(0)
})
it('keeps the latest designation across aliases rather than restoring an older IR tag', async () => {
  state.rows = [{ playerName: 'Omar Cooper Jr.', status: 'Active', team: 'NYJ' }, { playerName: 'Omar Cooper', status: 'IR', team: 'NYJ' }]
  expect((await readInjuryStatusById('NFL', new Map([['13276', ['Omar Cooper']]]))).get('13276')).toBe('Active')
})
it('a latest null designation does not fall through to an older alias status', async () => {
  state.rows = [{ playerName: 'Omar Cooper Jr.', status: null }, { playerName: 'Omar Cooper', status: 'IR' }]
  expect((await readInjuryStatusById('NFL', new Map([['13276', ['Omar Cooper']]]))).size).toBe(0)
})
it('does not restore expired or archival OUT reports ahead of a current cleared designation', async () => {
  const now = Date.now()
  state.rows = [
    { playerName: 'Omar Cooper Jr.', status: 'OUT', team: 'NYJ', date: new Date(now), expiresAt: new Date(now - 1000) },
    { playerName: 'Omar Cooper Jr.', status: 'IR', team: 'NYJ', date: new Date('2022-11-26'), expiresAt: new Date(now + 3600000) },
    { playerName: 'Omar Cooper Jr.', status: null, team: 'NYJ', date: new Date(now), expiresAt: new Date(now + 3600000) },
  ]
  query.mockImplementationOnce(async (args: any) => state.rows.filter(row =>
    (!args.where.expiresAt || row.expiresAt! > args.where.expiresAt.gt) &&
    (!args.where.date || row.date! >= args.where.date.gte)
  ))
  expect((await readInjuryStatusById('NFL', new Map([['13276', ['Omar Cooper']]]), new Map([['13276', 'NYJ']]))).size).toBe(0)
})
it('keeps a current long-term injury while bounding provider expiry and archival report dates', async () => {
  state.rows = [{ playerName: 'Omar Cooper Jr.', status: 'IR', team: 'NYJ' }]
  expect((await readInjuryStatusById('NFL', new Map([['13276', ['Omar Cooper']]]))).get('13276')).toBe('IR')
  const where = query.mock.calls[0][0].where
  expect(where.expiresAt.gt).toBeInstanceOf(Date)
  expect(where.date.gte.getTime()).toBe(where.expiresAt.gt.getTime() - 120 * 24 * 3600000)
})
