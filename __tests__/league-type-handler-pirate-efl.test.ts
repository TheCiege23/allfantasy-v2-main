import { beforeEach, describe, expect, it, vi } from 'vitest'

/*
 * GET/PATCH /api/leagues/[leagueId]/league-type, round-tripped through the REAL
 * confirmation module against an in-memory League row.
 *
 * User decision 2026-09-16: Pirate and EFL join the league-type picker. Pirate
 * must also say whether rosters carry over, and that answer decides the value
 * book. Confirming Pirate must switch on the existing pirate trade notes, which
 * `readFormatRules` derives from the `leagueType` COLUMN — so the column the
 * PATCH writes is asserted here, not assumed.
 */

const h = vi.hoisted(() => ({
  getServerSession: vi.fn(),
  canAccessLeagueDraft: vi.fn(),
  isCommissioner: vi.fn(),
  row: null as Record<string, unknown> | null,
}))

vi.mock('next-auth', () => ({
  getServerSession: (...args: unknown[]) => h.getServerSession(...args),
}))
vi.mock('@/lib/auth', () => ({ authOptions: {} }))
vi.mock('@/lib/live-draft-engine/auth', () => ({
  canAccessLeagueDraft: (...args: unknown[]) => h.canAccessLeagueDraft(...args),
}))
vi.mock('@/lib/commissioner/permissions', () => ({
  isCommissioner: (...args: unknown[]) => h.isCommissioner(...args),
}))
vi.mock('@/lib/prisma', () => ({
  prisma: {
    league: {
      findUnique: async () => (h.row ? { ...h.row } : null),
      update: async ({ data }: { data: Record<string, unknown> }) => {
        h.row = { ...(h.row ?? {}), ...data }
        return h.row
      },
    },
  },
}))

import { GET, PATCH } from '@/app/api/leagues/[leagueId]/league-type/handler'
import { readFormatRules } from '@/lib/trade-intel/leagueFormatRules'
import { valueBookFor } from '@/lib/core-app/valueBook'
import { resolveLeagueRules } from '@/lib/league-rules'

const ctx = { params: Promise.resolve({ leagueId: 'L1' }) }
const url = 'http://localhost/api/leagues/L1/league-type'

const patch = (body: unknown) =>
  PATCH(
    new Request(url, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }) as never,
    { params: Promise.resolve({ leagueId: 'L1' }) },
  )
const get = () => GET(new Request(url) as never, ctx)

beforeEach(() => {
  vi.clearAllMocks()
  h.getServerSession.mockResolvedValue({ user: { id: 'commish' } })
  h.canAccessLeagueDraft.mockResolvedValue(true)
  h.isCommissioner.mockResolvedValue(true)
  h.row = {
    id: 'L1',
    name: 'Seven Seas',
    leagueType: 'redraft',
    isDynasty: false,
    guillotineMode: false,
    keeperCount: 3,
    keeperCostSystem: 'round_based',
    keeperRoundPenalty: 1,
    settings: { roster_positions: ['QB', 'RB', 'WR', 'TE', 'FLEX'] },
  }
})

describe('Pirate', () => {
  it('round-trips the dynasty/redraft answer through PATCH and GET', async () => {
    const saved = await patch({ type: 'pirate', baseFormat: 'redraft' })
    expect(saved.status).toBe(200)
    const savedBody = await saved.json()
    expect(savedBody.confirmation).toMatchObject({ type: 'pirate', baseFormat: 'redraft', confirmedByUserId: 'commish' })

    const read = await get()
    expect(read.status).toBe(200)
    const body = await read.json()
    expect(body.confirmation).toMatchObject({ type: 'pirate', baseFormat: 'redraft' })
    // The column holds the base; the specialty lives only in the confirmation.
    expect(body.storedType).toBe('redraft')
    expect(body.canConfirm).toBe(true)
  })

  it('switches on the pirate trade notes and prices on the book the commissioner chose', async () => {
    await patch({ type: 'pirate', baseFormat: 'redraft' })
    expect(h.row!.leagueType).toBe('redraft')
    const rules = readFormatRules(h.row as never)
    expect(rules.concept).toBe('pirate')
    expect(rules.notes.join(' ')).toContain('only your 3 protected players are safe')
    expect(valueBookFor(h.row!.settings, h.row!.leagueType as string).format).toBe('REDRAFT')

    await patch({ type: 'pirate', baseFormat: 'dynasty' })
    expect(h.row!.leagueType).toBe('dynasty')
    expect(readFormatRules(h.row as never).concept).toBe('pirate')
    expect(valueBookFor(h.row!.settings, h.row!.leagueType as string).format).toBe('DYNASTY')
  })

  it('keeps the pirate notes and the chosen book after an importer rewrites the column', async () => {
    await patch({ type: 'pirate', baseFormat: 'redraft' })
    // A re-import writes its own guess to the column and carries the confirmation forward.
    h.row = { ...h.row!, leagueType: 'dynasty' }
    expect(readFormatRules(h.row as never).concept).toBe('pirate')
    expect(valueBookFor(h.row!.settings, h.row!.leagueType as string).format).toBe('REDRAFT')
  })

  it('returns 400 when the answer is missing or invalid, and writes nothing', async () => {
    const before = JSON.stringify(h.row)
    for (const body of [{ type: 'pirate' }, { type: 'pirate', baseFormat: 'keeper' }, { type: 'pirate', baseFormat: null }]) {
      const res = await patch(body)
      expect(res.status).toBe(400)
      expect((await res.json()).error).toMatch(/baseFormat/)
    }
    expect(JSON.stringify(h.row)).toBe(before)
  })

  it('stays commissioner-only', async () => {
    h.isCommissioner.mockResolvedValue(false)
    const res = await patch({ type: 'pirate', baseFormat: 'dynasty' })
    expect(res.status).toBe(403)
    expect(h.row!.leagueType).toBe('redraft')
  })
})

describe('EFL', () => {
  it('is accepted, reads back as EFL, and prices on the dynasty book with no bogus notes', async () => {
    const saved = await patch({ type: 'efl' })
    expect(saved.status).toBe(200)

    const body = await (await get()).json()
    expect(body.confirmation).toMatchObject({ type: 'efl', baseFormat: null })
    // The column carries the base format, so column readers still see dynasty.
    expect(body.storedType).toBe('dynasty')

    const rules = readFormatRules(h.row as never)
    expect(rules.concept).toBe('dynasty')
    expect(rules.notes).toEqual([])
    expect(valueBookFor(h.row!.settings, h.row!.leagueType as string).format).toBe('DYNASTY')
  })

  it('ignores a stray baseFormat rather than storing one', async () => {
    await patch({ type: 'efl', baseFormat: 'redraft' })
    const body = await (await get()).json()
    expect(body.confirmation.baseFormat).toBeNull()
    expect(valueBookFor(h.row!.settings, h.row!.leagueType as string).format).toBe('DYNASTY')
  })

  it('still reads as dynasty after an importer rewrites the column to redraft', async () => {
    await patch({ type: 'efl' })
    h.row = { ...h.row!, leagueType: 'redraft' }
    const rules = readFormatRules(h.row as never)
    expect(rules.concept).toBe('dynasty')
    expect(rules.notes).toEqual([])
  })
})

describe('Survivor Guillotine', () => {
  it('round-trips as one format, with the guillotine chassis in the column', async () => {
    const saved = await patch({ type: 'survivor_guillotine' })
    expect(saved.status).toBe(200)

    const body = await (await get()).json()
    expect(body.confirmation).toMatchObject({ type: 'survivor_guillotine', baseFormat: null })
    expect(body.storedType).toBe('guillotine')
  })

  it('reads as guillotine with the survivor-guillotine marker, on the redraft book', async () => {
    await patch({ type: 'survivor_guillotine' })
    const rules = readFormatRules(h.row as never)
    expect(rules.concept).toBe('guillotine')
    expect(rules.variant).toBe('survivor_guillotine')
    expect(rules.futurePicksTradeable).toBe(false)
    expect(valueBookFor(h.row!.settings, h.row!.leagueType as string).format).toBe('REDRAFT')
  })

  it('resolves to its own catalog entry, where trades are illegal', async () => {
    await patch({ type: 'survivor_guillotine' })
    const resolved = resolveLeagueRules(h.row as never)
    expect(resolved.concept?.id).toBe('survivor_guillotine')
    expect(resolved.pricingBaseFormat).toBe('guillotine')
    expect(resolved.concept?.actions.find((a) => a.id === 'trade')?.legalInFormat).toBe(false)
  })

  it('a plain Guillotine confirmation carries no marker and resolves as guillotine', async () => {
    await patch({ type: 'guillotine' })
    expect(h.row!.leagueType).toBe('guillotine')
    const rules = readFormatRules(h.row as never)
    expect(rules.concept).toBe('guillotine')
    expect(rules.variant).toBeNull()
    expect(resolveLeagueRules(h.row as never).concept?.id).toBe('guillotine')
  })
})
