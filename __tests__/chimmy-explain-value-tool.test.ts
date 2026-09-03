/**
 * `explain_value` — Phase 7.3, the derivation chain.
 *
 * 🛑 An invented explanation is worse than an invented number, because it looks like evidence. So
 * the assertions here are about what the tool refuses to do as much as what it produces.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))

const h = vi.hoisted(() => ({ findProj: vi.fn(), boardFind: vi.fn() }))

vi.mock('@/lib/af-projections/readAfProjections', () => ({ findAfProjectionsByName: h.findProj }))
vi.mock('@/lib/prisma', () => ({
  prisma: { allFantasyMarketPlayerValue: { findMany: h.boardFind } },
}))

import { buildExplainValueContext } from '@/lib/chimmy/tools/explainValueTool'
import { explainPlayerValue } from '@/lib/trade-value/valueEngine'

const projRow = (over: Record<string, unknown> = {}) => ({
  playerId: 'p1',
  playerName: 'Test Receiver',
  position: 'WR',
  sport: 'NFL',
  season: 2025,
  week: null,
  afProjection: 14.2,
  baselineProjection: 15,
  weatherAdjustment: -0.8,
  rosProjection: 240,
  rosWeeksRemaining: 17,
  confidenceLevel: 'high',
  adjustmentReason: null,
  isOutdoorGame: true,
  computedAt: new Date('2026-09-02T07:53:00Z'),
  ...over,
})

beforeEach(() => {
  vi.resetAllMocks()
  h.findProj.mockResolvedValue({ rows: [projRow()], season: 2025 })
  h.boardFind.mockResolvedValue([])
})

describe('🛑 the explanation matches the engine exactly', () => {
  it('reports the same number the engine produces for the same inputs', async () => {
    const out = await buildExplainValueContext({ playerName: 'Test Receiver' })
    const expected = explainPlayerValue({
      projection: 240, position: 'WR', adp: null, marketValue: null, idpValue: null,
    })
    expect(out).toMatch(new RegExp(`Result: ${expected.value.toLocaleString()}`))
    expect(out).toMatch(/priced from projection/)
  })

  it('renders every step with its label and its sentence', async () => {
    const out = await buildExplainValueContext({ playerName: 'Test Receiver' })
    expect(out).toMatch(/1\. Projection → 240/)
    expect(out).toMatch(/2\. × 26 → /)
    expect(out).toMatch(/scarcity → /)
    // The reason is the deliverable, not the arithmetic.
    expect(out).toMatch(/projected points for the rest of the season/)
  })
})

describe('🛑 only the rest-of-season number feeds the engine', () => {
  it('refuses to convert a per-game figure, and says why', async () => {
    /*
     * The engine expects a rest-of-season total. Substituting the per-game number understates a
     * player by roughly the weeks remaining — the 17× error this audit began with. A row without a
     * ROS total is reported as missing, not converted against a guessed horizon.
     */
    h.findProj.mockResolvedValue({
      rows: [projRow({ rosProjection: null, rosWeeksRemaining: null })],
      season: 2025,
    })
    const out = await buildExplainValueContext({ playerName: 'Test Receiver' })
    expect(out).toMatch(/NO rest-of-season total/)
    expect(out).toMatch(/Do NOT multiply the per-game figure yourself/)
    expect(out).toMatch(/used no projection/)
  })

  it('a per-game-only player is not silently priced from 14.2', async () => {
    h.findProj.mockResolvedValue({ rows: [projRow({ rosProjection: null })], season: 2025 })
    const out = await buildExplainValueContext({ playerName: 'Test Receiver' })
    // 14.2 * 26 ≈ 369 — that number must appear nowhere as a result.
    expect(out).not.toMatch(/Result: 369/)
  })
})

describe('🛑 the published board and the derivation can disagree', () => {
  it('reports BOTH and says which is which', async () => {
    /*
     * The board is a stored snapshot; the derivation is current inputs run now. Presenting one, or
     * quietly preferring one, hides a staleness signal the user can act on.
     */
    h.boardFind.mockResolvedValue([
      { playerName: 'Test Receiver', position: 'WR', marketValue: 9000, leagueConcept: 'dynasty' },
    ])
    const out = await buildExplainValueContext({ playerName: 'Test Receiver' })
    expect(out).toMatch(/PUBLISHED market value for him is 9,000/)
    expect(out).toMatch(/Both are real/)
    expect(out).toMatch(/rather than picking one/)
  })

  it('says nothing when they agree', async () => {
    const expected = explainPlayerValue({
      projection: 240, position: 'WR', adp: null, marketValue: null, idpValue: null,
    })
    h.boardFind.mockResolvedValue([
      { playerName: 'Test Receiver', position: 'WR', marketValue: expected.value, leagueConcept: 'dynasty' },
    ])
    const out = await buildExplainValueContext({ playerName: 'Test Receiver' })
    expect(out).not.toMatch(/PUBLISHED market value/)
  })

  it('ignores a board row for a different player with a similar name', async () => {
    h.boardFind.mockResolvedValue([
      { playerName: 'Someone Else', position: 'WR', marketValue: 9000, leagueConcept: 'dynasty' },
    ])
    const out = await buildExplainValueContext({ playerName: 'Test Receiver' })
    expect(out).not.toMatch(/9,000/)
  })
})

describe('🛑 refusing without inviting a fabrication', () => {
  it('says an invented derivation is worse than an invented value', async () => {
    h.findProj.mockResolvedValue({ rows: [], season: 2025 })
    h.boardFind.mockResolvedValue([])
    const out = await buildExplainValueContext({ playerName: 'Nobody' })
    expect(out).toMatch(/NOTHING TO EXPLAIN FOR "Nobody"/)
    expect(out).toMatch(/must NOT invent a derivation/)
    expect(out).toMatch(/looks like evidence/)
    expect(out).toMatch(/NOT a finding that the player is worthless/)
  })

  it('asks which player when the name is empty, without querying', async () => {
    const out = await buildExplainValueContext({ playerName: '   ' })
    expect(out).toMatch(/No player name was given/)
    expect(h.findProj).not.toHaveBeenCalled()
    expect(h.boardFind).not.toHaveBeenCalled()
  })

  it('refuses an unknown sport before looking anything up', async () => {
    const out = await buildExplainValueContext({ playerName: 'X', sport: 'QUIDDITCH' })
    expect(out).toMatch(/not a sport AllFantasy values/)
    expect(h.findProj).not.toHaveBeenCalled()
  })

  it('survives a failing projection lookup and still uses the board', async () => {
    h.findProj.mockRejectedValue(new Error('db down'))
    h.boardFind.mockResolvedValue([
      { playerName: 'Test Receiver', position: 'WR', marketValue: 5400, leagueConcept: 'dynasty' },
    ])
    const out = await buildExplainValueContext({ playerName: 'Test Receiver' })
    expect(out).toMatch(/priced from market/)
    expect(out).toMatch(/Result: 5,400/)
  })
})

describe('🛑 the limit that most changes the answer is stated', () => {
  it('says the scarcity term is a default because there is no league', async () => {
    /*
     * Without a league the scarcity multiplier falls back to the default, so a superflex QB or a
     * TE-premium tight end is under-priced here relative to the user's actual league. Burying that
     * would make the number look more authoritative than it is.
     */
    const out = await buildExplainValueContext({ playerName: 'Test Receiver' })
    expect(out).toMatch(/NOTE THE LIMIT/)
    expect(out).toMatch(/default positional scarcity/)
    expect(out).toMatch(/superflex, 2QB or TE-premium/)
  })

  it('queries only PUBLISHED rows for the requested sport', async () => {
    await buildExplainValueContext({ playerName: 'Test Receiver', sport: 'ncaaf' })
    expect(h.boardFind.mock.calls[0][0].where).toEqual({ published: true, sport: 'NCAAF' })
  })
})
