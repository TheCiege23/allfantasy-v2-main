/**
 * Draft as me's youth lean (phase 8, 2026-10-29): a manager who drafts younger than the room gets the
 * younger of two close players; a manager with no lean, or no ages on file, is picked for exactly as before.
 */
import { describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))
vi.mock('@/lib/prisma', () => ({ prisma: {} }))

import { buildDraftStyle, measureYouthLean, MIN_STYLE_SAMPLE, pickLikeManager, type DraftStyle, type StylePick } from '@/lib/draft-room/draftAsMe'
import { describeDraftStyle } from '@/lib/draft-room/draftAsMeAutopick'
import { draftMeanAges } from '@/lib/draft-room/draftPlayerAges'

// Twelve picks right on ADP, alternating RB / WR, each `lean` years younger than its draft's average.
const history = (lean: number | null): StylePick[] =>
  Array.from({ length: 12 }, (_, i) => ({
    overall: 20 + i * 10,
    adpAtPick: 20 + i * 10,
    position: i % 2 ? 'WR' : 'RB',
    ...(lean == null ? {} : { age: 26 - lean, draftMeanAge: 26 }),
  }))

// Two WRs one pick apart: the veteran is a hair closer to ADP, the young one a hair further.
const board = [
  { playerName: 'Vet WR', position: 'WR', adp: 30, age: 30 },
  { playerName: 'Young WR', position: 'WR', adp: 31, age: 22 },
  { playerName: 'Mid RB', position: 'RB', adp: 40, age: 26 },
  { playerName: 'Mid WR', position: 'WR', adp: 44, age: 26 },
]
const pick = (style: DraftStyle, b: typeof board = board) => pickLikeManager({ style, overall: 30, board: b, ownPositions: [] })!.player.playerName

describe('measuring the lean', () => {
  it('is the mean of (room average − player age), and needs the same sample as the rest of the style', () => {
    expect(measureYouthLean(history(2))).toBe(2)
    expect(measureYouthLean(history(-3))).toBe(-3)
    expect(measureYouthLean(history(2).slice(0, MIN_STYLE_SAMPLE - 1))).toBeNull()
    expect(measureYouthLean(history(null))).toBeNull()
  })

  it('a pick with no age on file is left out, not counted as zero', () => {
    const mixed = [...history(2), ...Array.from({ length: 20 }, () => ({ overall: 50, adpAtPick: 50, position: 'RB', age: null, draftMeanAge: 26 }))]
    expect(measureYouthLean(mixed)).toBe(2)
  })

  it('the room average comes only from drafts with enough ages on file', () => {
    const room = [
      ...Array.from({ length: 10 }, (_, i) => ({ sessionId: 'S1', playerId: `p${i}` })),
      ...Array.from({ length: 3 }, (_, i) => ({ sessionId: 'S2', playerId: `p${i}` })),
    ]
    const ages = new Map(Array.from({ length: 10 }, (_, i) => [`p${i}`, 20 + i] as const))
    expect(draftMeanAges(room, ages)).toEqual(new Map([['S1', 24.5]]))
  })
})

describe('the pick', () => {
  it('a manager who drafts young takes the younger of two close players', () => {
    expect(pick(buildDraftStyle(history(2))!)).toBe('Young WR')
  })

  it('with no lean, or a lean too small to be a habit, nothing changes', () => {
    expect(pick(buildDraftStyle(history(null))!)).toBe('Vet WR')
    expect(pick(buildDraftStyle(history(0.2))!)).toBe('Vet WR')
  })

  it('a manager who drafts old keeps the veteran', () => {
    expect(pick(buildDraftStyle(history(-2))!)).toBe('Vet WR')
  })

  it('never reaches far past ADP for youth: closeness still wins against a big gap', () => {
    const far = [{ playerName: 'Vet WR', position: 'WR', adp: 30, age: 31 }, { playerName: 'Young WR', position: 'WR', adp: 45, age: 21 }, { playerName: 'Other', position: 'RB', adp: 35, age: 27 }]
    expect(pick(buildDraftStyle(history(3))!, far)).not.toBe('Young WR')
  })

  it('without ages on the board, the lean tilts nothing', () => {
    const noAges = board.map(({ age: _a, ...p }) => p)
    expect(pickLikeManager({ style: buildDraftStyle(history(3))!, overall: 30, board: noAges, ownPositions: [] })!.player.playerName).toBe('Vet WR')
  })
})

describe('the reason the manager sees', () => {
  it('names the lean once it is a year or more', () => {
    expect(describeDraftStyle(buildDraftStyle(history(2))!)).toContain('you draft about 2 years younger than the room')
    expect(describeDraftStyle(buildDraftStyle(history(-1))!)).toContain('about 1 year older than the room')
    expect(describeDraftStyle(buildDraftStyle(history(null))!)).not.toContain('than the room')
  })
})
