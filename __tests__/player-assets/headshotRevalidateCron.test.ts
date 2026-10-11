/**
 * Stale-while-revalidate for pre-2026-10-11 headshots: the image cron must re-resolve every
 * unstamped row (they are still served), and must re-resolve the detectably WRONG ones (which
 * readers suppress) first — ahead of the fill pass, whose backlog can eat the whole budget.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

const prismaMock = vi.hoisted(() => ({
  player: { findMany: vi.fn() },
  playerImage: { findMany: vi.fn() },
}))
const resolveOrder = vi.hoisted(() => [] as string[])
const wrongIds = vi.hoisted(() => ({ value: [] as string[] }))

vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }))
vi.mock('@/app/api/cron/_auth', () => ({ requireCronAuth: () => true }))
vi.mock('@/lib/production-health/syncJobRunTelemetry', () => ({ recordSyncJobRun: vi.fn(async () => undefined) }))
vi.mock('@/lib/sport-teams/teamImageStore', () => ({ TEAM_IMAGE_TYPE_LOGO: 'logo', writePrimaryTeamImage: vi.fn() }))
vi.mock('@/lib/player-assets/resolvePlayerHeadshot', () => ({
  createBatchPlayerHeadshotResolver: vi.fn(async () => ({
    resolve: vi.fn(async (input: { playerId: string }) => {
      resolveOrder.push(input.playerId)
      return { imageUrl: null, source: 'none', confidence: 'none' }
    }),
    stats: () => ({ clearSportsCacheSize: 0, sport: 'NFL' }),
  })),
}))
vi.mock('@/lib/player-assets/playerImageStore', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/player-assets/playerImageStore')>()),
  listDetectablyWrongPlayerImageIds: vi.fn(async () => wrongIds.value),
}))

import { GET } from '@/app/api/cron/sync-player-images/route'
import { UNSTAMPED_RESOLVER_IMAGE_WHERE } from '@/lib/player-assets/playerImageStore'

const player = (id: string) => ({ id, name: id, team: 'KC', sport: 'NFL', position: 'WR', providerIds: {} })

async function runNflPlayers() {
  const req = new Request('https://worker.invalid/api/cron/sync-player-images?sport=NFL&scope=players&limit=10')
  return GET(req as never)
}

beforeEach(() => {
  resolveOrder.length = 0
  wrongIds.value = []
  prismaMock.player.findMany.mockReset()
  prismaMock.playerImage.findMany.mockReset()
})

describe('image cron refresh pass', () => {
  it('queues ordinary unstamped pre-fix rows for re-resolution, not only expired ones', async () => {
    prismaMock.player.findMany.mockResolvedValue([])
    prismaMock.playerImage.findMany.mockResolvedValue([])
    await runNflPlayers()
    const where = (prismaMock.playerImage.findMany.mock.calls[0]?.[0] as { where: { OR: unknown[] } }).where
    expect(where.OR).toContainEqual(UNSTAMPED_RESOLVER_IMAGE_WHERE)
  })

  it('re-resolves a detectably wrong image before the fill pass and before other refreshes', async () => {
    wrongIds.value = ['wrong-1']
    prismaMock.playerImage.findMany.mockResolvedValue([{ playerId: 'stale-1' }])
    prismaMock.player.findMany.mockImplementation(async (args: { where: Record<string, unknown> }) => {
      if (args.where.imageUrl === null) return [player('fill-1')] // Pass A: no image yet
      // Refresh fetch by id: table order deliberately puts the ordinary refresh first.
      return [player('stale-1'), player('wrong-1')]
    })
    await runNflPlayers()
    expect(resolveOrder[0]).toBe('wrong-1')
    expect(resolveOrder.indexOf('fill-1')).toBeLessThan(resolveOrder.indexOf('stale-1'))
    expect(new Set(resolveOrder)).toEqual(new Set(['wrong-1', 'fill-1', 'stale-1']))
  })
})
