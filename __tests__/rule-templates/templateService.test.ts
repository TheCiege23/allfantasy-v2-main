import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))

const db = vi.hoisted(() => {
  type Row = { id: string; userId: string; name: string; description: string | null; payload: Record<string, unknown>; updatedAt: Date }
  const rows = new Map<string, Row>()
  const locks: string[] = []
  const leagueTemplate = {
    findUnique: vi.fn(async ({ where }: { where: { id: string } }) => rows.get(where.id) ?? null),
    findMany: vi.fn(async ({ where }: { where: { payload: { path: string[]; equals: unknown } } }) =>
      [...rows.values()].filter((r) => (r.payload.share as Record<string, unknown> | undefined)?.[where.payload.path[1]] === where.payload.equals),
    ),
    update: vi.fn(async ({ where, data }: { where: { id: string }; data: { payload: Record<string, unknown> } }) => {
      const r = rows.get(where.id)!
      r.payload = data.payload
      return r
    }),
  }
  const prisma = {
    leagueTemplate,
    appUser: { findMany: vi.fn(async () => [{ id: 'owner', displayName: 'Commish Carl', username: 'carl' }]) },
    $transaction: vi.fn(async (fn: (tx: unknown) => unknown) =>
      fn({ leagueTemplate, $queryRaw: vi.fn(async (s: TemplateStringsArray, id: string) => { locks.push(`${s.join('?')}|${id}`); return [] }) }),
    ),
  }
  return { rows, prisma, locks }
})
vi.mock('@/lib/prisma', () => ({ prisma: db.prisma }))

import { listPublicTemplates, setTemplatePublic, startFromTemplate } from '@/lib/rule-templates/templateService'

const recipe = { v: 2, sport: 'NFL', leagueType: 'dynasty', leagueVariant: null, teamCount: 12, scoringPresetId: null, draftType: 'snake', medianGame: false, dynasty: { taxiSlotCount: 4 }, keeper: null }

function seed(id: string, userId: string, share: Record<string, unknown>, extra: Record<string, unknown> = {}) {
  db.rows.set(id, { id, userId, name: `T ${id}`, description: null, payload: { recipe, share, templateSettingsOverrides: { dues_secret: 1 }, ...extra }, updatedAt: new Date(2026, 0, Number(id.replace(/\D/g, '')) || 1) })
}

beforeEach(() => {
  db.rows.clear()
  db.locks.length = 0
})

describe('startFromTemplate', () => {
  it('owner or public only; a private template of someone else is not found', async () => {
    seed('t1', 'owner', { public: false, uses: 0, usedBy: [] })
    expect(await startFromTemplate('t1', 'stranger')).toEqual({ ok: false, error: 'not_found' })
    const mine = await startFromTemplate('t1', 'owner')
    expect(mine.ok && mine.state.leagueType).toBe('dynasty')
  })
  it('counts a stranger\'s start once, under the row lock, and never the owner\'s', async () => {
    seed('t1', 'owner', { public: true, uses: 0, usedBy: [] })
    await startFromTemplate('t1', 'owner')
    await startFromTemplate('t1', 'u1')
    await startFromTemplate('t1', 'u1')
    expect((db.rows.get('t1')!.payload.share as { uses: number }).uses).toBe(1)
    expect(db.locks.some((l) => l.includes('league_templates') && l.includes('FOR UPDATE'))).toBe(true)
  })
})

describe('listPublicTemplates', () => {
  it('lists public templates by use, with tags and author — and never the payload', async () => {
    seed('t1', 'owner', { public: true, uses: 2, usedBy: [] })
    seed('t2', 'owner', { public: true, uses: 9, usedBy: [] })
    seed('t3', 'owner', { public: false, uses: 50, usedBy: [] })
    const list = await listPublicTemplates('owner')
    expect(list.map((c) => c.id)).toEqual(['t2', 't1'])
    expect(list[0]).toMatchObject({ author: 'Commish Carl', isMine: true, uses: 9 })
    expect(list[0].tags).toEqual(expect.arrayContaining(['NFL', 'Dynasty', '12 teams']))
    expect(JSON.stringify(list)).not.toMatch(/dues_secret|templateSettingsOverrides|payload/)
  })
  it('filters by sport', async () => {
    seed('t1', 'owner', { public: true, uses: 1, usedBy: [] })
    expect(await listPublicTemplates(null, { sport: 'NBA' })).toEqual([])
  })
})

describe('setTemplatePublic', () => {
  it('owner only, and keeps the use count', async () => {
    seed('t1', 'owner', { public: false, uses: 3, usedBy: ['a'] })
    expect(await setTemplatePublic('t1', 'stranger', true)).toEqual({ ok: false, error: 'forbidden' })
    expect(await setTemplatePublic('t1', 'owner', true)).toEqual({ ok: true, public: true })
    expect(db.rows.get('t1')!.payload.share).toEqual({ public: true, uses: 3, usedBy: ['a'] })
  })
})
