/**
 * `get_player_projection` — Phase 7.2.
 *
 * The load-bearing assertions are about the TWO UNITS and about refusing. A model handed a
 * per-game rate and a season total with no labels will average them, and a model handed a bare
 * "no rows" will invent a number.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))

const h = vi.hoisted(() => ({ find: vi.fn() }))

vi.mock('@/lib/af-projections/readAfProjections', () => ({
  findAfProjectionsByName: h.find,
}))

import { buildPlayerProjectionContext } from '@/lib/chimmy/tools/playerProjectionTool'

const row = (over: Record<string, unknown> = {}) => ({
  playerId: 'p1',
  playerName: 'Test Back',
  position: 'RB',
  sport: 'NFL',
  season: 2025,
  week: 3,
  afProjection: 14.2,
  baselineProjection: 15.0,
  weatherAdjustment: -0.8,
  rosProjection: 198.8,
  rosWeeksRemaining: 14,
  confidenceLevel: 'high',
  adjustmentReason: 'Wind above 18mph at kickoff.',
  isOutdoorGame: true,
  computedAt: new Date('2026-09-02T07:53:00Z'),
  ...over,
})

beforeEach(() => {
  vi.resetAllMocks()
  h.find.mockResolvedValue({ rows: [row()], season: 2025 })
})

describe('🛑 the two units are never presented as interchangeable', () => {
  it('labels the per-game number as a rate and the ROS number as a total', async () => {
    const out = await buildPlayerProjectionContext({ playerName: 'Test Back' })
    expect(out).toMatch(/14\.2 points PER GAME/)
    expect(out).toMatch(/not a season total/i)
    expect(out).toMatch(/198\.8 points REST OF SEASON/)
    expect(out).toMatch(/not a weekly number/i)
  })

  it('states the week count the ROS total covers', async () => {
    /*
     * Without it a LOW total is indistinguishable from a LATE-SEASON one, and the model cannot
     * tell a bad player from a short remaining schedule.
     */
    const out = await buildPlayerProjectionContext({ playerName: 'Test Back' })
    expect(out).toMatch(/over 14 remaining weeks/)
  })

  it('uses the singular for a single remaining week', async () => {
    h.find.mockResolvedValue({ rows: [row({ rosWeeksRemaining: 1 })], season: 2025 })
    const out = await buildPlayerProjectionContext({ playerName: 'Test Back' })
    expect(out).toMatch(/over 1 remaining week\./)
  })
})

describe('🛑 a missing rest-of-season is said in words', () => {
  it('never reports it as 0, and forbids the model computing one', async () => {
    /*
     * Omitting the line invites the model to fill the gap; printing 0 states the player will score
     * nothing. And multiplying per-game by weeks is exactly the arithmetic the model must not do
     * — the bye and the real weeks remaining are not in the block.
     */
    h.find.mockResolvedValue({
      rows: [row({ rosProjection: null, rosWeeksRemaining: null })],
      season: 2025,
    })
    const out = await buildPlayerProjectionContext({ playerName: 'Test Back' })
    expect(out).toMatch(/NOT COMPUTED/)
    expect(out).toMatch(/Do NOT report it as 0/)
    expect(out).toMatch(/do NOT multiply the per-game number yourself/i)
    expect(out).not.toMatch(/0\.0 points REST OF SEASON/)
  })

  it('reports a genuine zero as a real projection', async () => {
    h.find.mockResolvedValue({ rows: [row({ rosProjection: 0 })], season: 2025 })
    const out = await buildPlayerProjectionContext({ playerName: 'Test Back' })
    expect(out).toMatch(/0\.0 points REST OF SEASON/)
    expect(out).not.toMatch(/NOT COMPUTED/)
  })
})

describe('🛑 refusing without inviting a fabrication', () => {
  it('a miss forbids "unprojectable" and forbids inventing a number', async () => {
    h.find.mockResolvedValue({ rows: [], season: 2025 })
    const out = await buildPlayerProjectionContext({ playerName: 'Nobody At All' })
    expect(out).toMatch(/NO ALLFANTASY PROJECTION ROW MATCHED "Nobody At All" in NFL/)
    expect(out).toMatch(/NOT a finding that the player is unprojectable/)
    expect(out).toMatch(/must NOT substitute a projection from general/i)
  })

  it('🛑 an empty SPORT is a different refusal from an empty PLAYER', async () => {
    /*
     * "Our pipeline stored nothing for this sport" is a statement about us; "we hold rows and none
     * is his" is a statement about the player. The compute cron silently wrote nothing for 13 days
     * while reporting success, so reporting that as a fact about somebody's roster is a real risk.
     */
    h.find.mockResolvedValue({ rows: [], season: null })
    const out = await buildPlayerProjectionContext({ playerName: 'Test Back' })
    expect(out).toMatch(/NO ALLFANTASY NFL PROJECTIONS ARE STORED AT ALL/)
    expect(out).toMatch(/NOT a finding about this player/)
    expect(out).not.toMatch(/ROW MATCHED/)
  })

  it('asks which player when the name is empty, without querying', async () => {
    for (const empty of ['', '   ']) {
      const out = await buildPlayerProjectionContext({ playerName: empty })
      expect(out).toMatch(/No player name was given/)
    }
    expect(h.find).not.toHaveBeenCalled()
  })

  it('refuses an unknown sport rather than looking it up', async () => {
    const out = await buildPlayerProjectionContext({ playerName: 'X', sport: 'QUIDDITCH' })
    expect(out).toMatch(/not a sport AllFantasy projects/)
    expect(h.find).not.toHaveBeenCalled()
  })
})

describe('the derivation', () => {
  it('shows baseline and the weather delta', async () => {
    const out = await buildPlayerProjectionContext({ playerName: 'Test Back' })
    expect(out).toMatch(/15\.0 baseline, -0\.8 from weather/)
    expect(out).toMatch(/Confidence: high/)
    expect(out).toMatch(/Wind above 18mph/)
  })

  it('distinguishes "weather moved it by nothing" from "indoors"', async () => {
    h.find.mockResolvedValue({ rows: [row({ weatherAdjustment: 0 })], season: 2025 })
    expect(await buildPlayerProjectionContext({ playerName: 'T' }))
      .toMatch(/considered and moved it by nothing/)

    h.find.mockResolvedValue({ rows: [row({ weatherAdjustment: 0, isOutdoorGame: false })], season: 2025 })
    expect(await buildPlayerProjectionContext({ playerName: 'T' }))
      .toMatch(/indoors, so no weather adjustment applies/)
  })

  it('tells the model to surface a stale computation', async () => {
    const out = await buildPlayerProjectionContext({ playerName: 'Test Back' })
    expect(out).toMatch(/more than about a week old, say so/)
  })

  it('names the week, or says it is the season baseline', async () => {
    expect(await buildPlayerProjectionContext({ playerName: 'T' })).toMatch(/week 3\)/)
    h.find.mockResolvedValue({ rows: [row({ week: null })], season: 2025 })
    expect(await buildPlayerProjectionContext({ playerName: 'T' })).toMatch(/season baseline\)/)
  })
})

describe('🛑 two players sharing a name', () => {
  it('lists both and refuses to choose', async () => {
    /*
     * Real case: the normalizer KEEPS generational suffixes, so a father and son are distinct — but
     * two unrelated players can still normalize alike. Picking one silently answers about somebody
     * the user did not ask for.
     */
    h.find.mockResolvedValue({
      rows: [row({ playerId: 'a', playerName: 'Chris Smith', position: 'WR' }),
             row({ playerId: 'b', playerName: 'Chris Smith', position: 'DL' })],
      season: 2025,
    })
    const out = await buildPlayerProjectionContext({ playerName: 'Chris Smith' })
    expect(out).toMatch(/2 different players match/)
    expect(out).toMatch(/ask the user which one they mean rather than picking/)
    expect(out).toMatch(/WR/)
    expect(out).toMatch(/DL/)
  })
})

describe('arguments passed through', () => {
  it('forwards the week only when it is a real number', async () => {
    await buildPlayerProjectionContext({ playerName: 'T', week: 5 })
    expect(h.find).toHaveBeenCalledWith(expect.objectContaining({ week: 5 }))

    h.find.mockClear()
    await buildPlayerProjectionContext({ playerName: 'T' })
    expect(h.find).toHaveBeenCalledWith(expect.objectContaining({ week: null }))
  })

  it('defaults the sport to NFL and uppercases it', async () => {
    await buildPlayerProjectionContext({ playerName: 'T', sport: 'nfl' })
    expect(h.find).toHaveBeenCalledWith(expect.objectContaining({ sport: 'NFL' }))
  })
})
