// @vitest-environment node
/**
 * lib/canonical/getCanonicalPlayer.ts — missing-table tolerance.
 *
 * #280 landed the canonical READ path on prod, but the prod build does not run `migrate deploy`,
 * so the `sports_core_*` tables (and Phase-1 `Player` columns) do not exist until the migration is
 * applied by hand. In that window these helpers query non-existent objects. Every helper previously
 * threw; legacy/waiver/analyze reads getCanonicalPlayerMapForSport in its outer try with no local
 * catch, so that throw became a user-facing 500.
 *
 * These tests pin: a missing table/column degrades to the empty result (like the write path's
 * "never throws"), while any OTHER error still propagates.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'

const { prismaMock, mode } = vi.hoisted(() => {
  const mode = { throwCode: null as string | null }
  const maybeThrow = () => {
    if (mode.throwCode) {
      const e = new Error('db object missing') as Error & { code?: string }
      e.code = mode.throwCode
      throw e
    }
  }
  const prismaMock = {
    playerProviderIdentity: {
      findMany: vi.fn(async () => { maybeThrow(); return [] }),
      findFirst: vi.fn(async () => { maybeThrow(); return null }),
    },
    player: {
      findMany: vi.fn(async () => { maybeThrow(); return [] }),
      findUnique: vi.fn(async () => { maybeThrow(); return null }),
    },
    playerImage: { findMany: vi.fn(async () => { maybeThrow(); return [] }) },
    team: { findUnique: vi.fn(async () => { maybeThrow(); return null }) },
  }
  return { prismaMock, mode }
})

vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }))
// The image/headshot deps do their own DB work; stub so the test isolates the canonical reads.
vi.mock('@/lib/player-assets/playerImageStore', () => ({
  PLAYER_IMAGE_TYPE_HEADSHOT: 'headshot',
  readPrimaryPlayerImage: vi.fn(async () => null),
}))
vi.mock('@/lib/sport-teams/teamImageStore', () => ({ readPrimaryTeamImage: vi.fn(async () => null) }))
vi.mock('@/lib/player-assets/resolvePlayerHeadshot', () => ({ resolvePlayerHeadshot: vi.fn(async () => null) }))

const mod = await import('@/lib/canonical/getCanonicalPlayer')

beforeEach(() => {
  mode.throwCode = null
  vi.clearAllMocks()
})

describe('isMissingDatabaseObjectError', () => {
  it('recognises Prisma P2021/P2022 and raw Postgres 42P01/42703', () => {
    const offenders: string[] = []
    for (const code of ['P2021', 'P2022', '42P01', '42703']) {
      if (!mod.isMissingDatabaseObjectError({ code })) offenders.push(`missed ${code}`)
    }
    expect(offenders).toEqual([])
  })

  it('does not swallow unrelated errors', () => {
    expect(mod.isMissingDatabaseObjectError({ code: 'P2002' })).toBe(false)
    expect(mod.isMissingDatabaseObjectError(new Error('boom'))).toBe(false)
    expect(mod.isMissingDatabaseObjectError(null)).toBe(false)
  })
})

describe('getCanonicalPlayerMapForSport — the confirmed waiver/analyze 500 path', () => {
  it('returns an empty map (does NOT throw) when the table is missing', async () => {
    mode.throwCode = 'P2021'
    const result = await mod.getCanonicalPlayerMapForSport('NFL')
    expect(result).toBeInstanceOf(Map)
    expect(result.size).toBe(0)
  })

  it('still THROWS on a non-missing-object error (does not hide real failures)', async () => {
    mode.throwCode = 'P2002'
    await expect(mod.getCanonicalPlayerMapForSport('NFL')).rejects.toBeTruthy()
  })
})

describe('getCanonicalPlayersBySleeperIds — the decision-time bulk reader', () => {
  it('returns an empty map when the table is missing', async () => {
    mode.throwCode = 'P2021'
    const result = await mod.getCanonicalPlayersBySleeperIds(['123', '456'])
    expect(result.size).toBe(0)
  })

  it('still throws on an unrelated error', async () => {
    mode.throwCode = '53300' // too_many_connections — a real outage, must NOT be swallowed
    await expect(mod.getCanonicalPlayersBySleeperIds(['123'])).rejects.toBeTruthy()
  })
})
