import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Cross-feature (share-cards x weekly-loop x tribe-emblems): the immunity share card goes to the
 * managers weekly-loop actually awarded a necklace (SurvivorTribeImmunity rows), not to a recompute
 * from scores that ignores the tribe-immunity exemption; and the card's crest stays a static public
 * SVG the renderer can inline even though tribeCrestUrl now returns the composed emblem route.
 */
const h = vi.hoisted(() => ({
  created: [] as Array<Record<string, unknown>>,
  game: { weekScoringFinalAt: new Date(), mergeTriggeredAt: null as Date | null, phase: 'pre_merge', immuneTribeId: 'tribe-a' },
  immunityRows: [] as Array<Record<string, unknown>>,
  weekScores: [] as Array<Record<string, unknown>>,
  players: [] as Array<Record<string, unknown>>,
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    league: { findUnique: vi.fn(async () => ({ name: 'Blah Survivor', sport: 'NFL', season: 2026, settings: {}, survivorPhase: 'pre_merge' })) },
    survivorLeagueConfig: { findUnique: vi.fn(async () => null) },
    survivorPlayer: {
      findUnique: vi.fn(async ({ where }: { where: { leagueId_userId: { userId: string } } }) => ({
        userId: where.leagueId_userId.userId, displayName: `${where.leagueId_userId.userId} team`, tribeId: 'tribe-b', redraftRosterId: `roster-${where.leagueId_userId.userId}`, exileWeeksServed: 0,
      })),
      findFirst: vi.fn(async () => null),
      findMany: vi.fn(async () => h.players),
    },
    survivorGameState: { findUnique: vi.fn(async () => h.game) },
    survivorTribe: { findUnique: vi.fn(async () => ({ name: 'Tribe Renamed', logoUrl: null, isMerged: false, catalogId: 'anaconda' })) },
    survivorWeeklyScore: { findMany: vi.fn(async () => h.weekScores), count: vi.fn(async () => 6) },
    survivorTribeImmunity: { findMany: vi.fn(async () => h.immunityRows) },
    survivorShareMoment: {
      findUnique: vi.fn(async () => null),
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => { h.created.push(data); return { id: `id-${h.created.length}` } }),
      count: vi.fn(async () => 0),
    },
  },
}))
vi.mock('server-only', () => ({}))

import { captureImmunityShareMoment, resolveTribeCrestPath } from '@/lib/survivor/shareCards/momentCapture'

const score = (userId: string, tribeId: string, finalScore: number) => ({ userId, tribeId, finalScore, countedTowardTribeTotal: true })
const row = (tribeId: string, userId: string, s: number) => ({
  id: `imm-${tribeId}`, leagueId: 'league-1', week: 6, tribeId, immunityWinnerRosterId: `roster-${userId}`, immunityWinnerUserId: userId,
  winnerName: `${userId} team`, score: s, awardedAt: new Date(), expiresAt: null, clearedAt: null, announcedAt: new Date(),
})

beforeEach(() => {
  h.created = []
  h.game = { weekScoringFinalAt: new Date(), mergeTriggeredAt: null, phase: 'pre_merge', immuneTribeId: 'tribe-a' }
  // tribe-a won tribe immunity, so it is not at Tribal and its top scorer (a2, 140) wears no necklace.
  h.weekScores = [score('a2', 'tribe-a', 140), score('b1', 'tribe-b', 99), score('b2', 'tribe-b', 98)]
  h.players = ['a2', 'b1', 'b2'].map(userId => ({ userId, playerState: 'active', eliminatedWeek: null }))
  h.immunityRows = [row('tribe-b', 'b1', 99)]
})

describe('immunity share moment reads SurvivorTribeImmunity', () => {
  it('creates a moment only for the awarded necklace, never for the immune tribe’s top scorer', async () => {
    expect(await captureImmunityShareMoment('league-1', 6)).toBe(1)
    expect(h.created.map(r => r.subjectUserId)).toEqual(['b1'])
    expect((h.created[0].payload as Record<string, unknown>).points).toBe(99)
    expect((h.created[0].payload as Record<string, unknown>).rankScope).toBe('tribe')
  })

  it('creates nothing before the necklace is awarded, even with final scores', async () => {
    h.immunityRows = []
    expect(await captureImmunityShareMoment('league-1', 6)).toBe(0)
  })

  it('post-merge rows (tribeId "merge") become island-scope moments', async () => {
    h.game = { ...h.game, mergeTriggeredAt: new Date(), phase: 'post_merge' }
    h.immunityRows = [row('merge', 'b2', 98)]
    expect(await captureImmunityShareMoment('league-1', 9)).toBe(1)
    expect(h.created[0].subjectUserId).toBe('b2')
    expect((h.created[0].payload as Record<string, unknown>).rankScope).toBe('island')
  })
})

describe('share card crest after tribe emblems', () => {
  it('resolves a renamed catalogue tribe to its static public crest, never the emblem API route', () => {
    expect(resolveTribeCrestPath({ name: 'Tribe Renamed', logoUrl: null, catalogId: 'anaconda' }, 'NFL')).toBe('/survivor/tribes/crests/nfl/anaconda.svg')
    expect(resolveTribeCrestPath({ name: 'Anaconda', logoUrl: null }, 'NBA')).toBe('/survivor/tribes/crests/nba/anaconda.svg')
  })

  it('puts that static crest on the captured moment payload', async () => {
    await captureImmunityShareMoment('league-1', 6)
    expect((h.created[0].payload as Record<string, unknown>).crestPath).toBe('/survivor/tribes/crests/nfl/anaconda.svg')
  })
})
