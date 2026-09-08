/**
 * The API-Sports injury upsert key.
 *
 * 🛑 WHY THIS EXISTS. `SportsInjury` is unique on (sport, externalId, source), so the externalId
 * decides whether a repeat run UPDATES a player's row or INSERTS a new one. The old key fell back
 * to `${playerId}:${teamId}:${date}:${arrayIndex}` whenever the row had no top-level `id` — which
 * is ALWAYS, because the vendor's documented response has no such field.
 *
 * Array position moves whenever a team-mate above you recovers, so the same player got a fresh
 * key on the next run and the upsert inserted. Nothing errored: the unique constraint was doing
 * its job perfectly on a key that was never stable.
 *
 * MEASURED IN PRODUCTION 2026-09-08: 2,953 NFL `api_sports` rows across 450 distinct players —
 * 6.6 each, 21 for the worst — with keys reading `14653:1:2026-03-02:0`, `...:1`, `...:2`.
 *
 * So the assertion is that the key depends ONLY on player identity: same player at a different
 * position, on a different date, with a different injury, must produce the same externalId.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { upsert, canCall, recordCall } = vi.hoisted(() => ({
  upsert: vi.fn(),
  canCall: vi.fn(),
  recordCall: vi.fn(),
}))

vi.mock('@/lib/prisma', () => ({ prisma: { sportsInjury: { upsert } } }))
vi.mock('./prisma', () => ({ prisma: { sportsInjury: { upsert } } }))
vi.mock('@/lib/workers/rate-limit-manager', () => ({
  rateLimitManager: { canCall, recordCall },
}))

import { normalizeApiSportsInjuryStatus, syncAPISportsInjuriesToDb } from '@/lib/api-sports'

/** Verbatim from the vendor's documented `GET /injuries` response. */
const HOBBS = {
  player: { id: 53, name: 'Nate Hobbs', image: 'https://media.api-sports.io/x.png' },
  team: { id: 1, name: 'Las Vegas Raiders', logo: 'https://media.api-sports.io/y.png' },
  date: '2022-09-26',
  status: 'Questionable',
  description: 'Concussion',
}

const TEAMS = [{ id: 1, name: 'Las Vegas Raiders', logo: null }]

/** `injuries` payload varies per call so we can move the player's position and date. */
function mockApi(injuriesByCall: unknown[][]) {
  let injuryCall = 0
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      const isInjuries = String(url).includes('/injuries')
      const body = isInjuries ? (injuriesByCall[injuryCall++] ?? []) : TEAMS
      return {
        ok: true,
        status: 200,
        headers: { get: () => null },
        json: async () => ({ errors: [], results: body.length, response: body }),
      } as unknown as Response
    })
  )
}

function externalIdsFrom() {
  return upsert.mock.calls.map((c) => c[0].where.sport_externalId_source.externalId as string)
}

beforeEach(() => {
  upsert.mockReset().mockResolvedValue({})
  canCall.mockReset().mockResolvedValue(true)
  recordCall.mockReset().mockResolvedValue(undefined)
  process.env.APISPORTS_API_KEY = 'test-key'
})

describe('api_sports injury externalId', () => {
  it('keys on the player id, not on array position', async () => {
    // Same player, moved from position 1 to position 0 by a team-mate recovering.
    const OTHER = { ...HOBBS, player: { id: 99, name: 'Other Guy', image: null } }
    mockApi([[OTHER, HOBBS]])
    await syncAPISportsInjuriesToDb({ sport: 'NFL', season: '2026' })
    const firstRun = externalIdsFrom()

    upsert.mockClear()
    mockApi([[HOBBS]])
    await syncAPISportsInjuriesToDb({ sport: 'NFL', season: '2026' })
    const secondRun = externalIdsFrom()

    expect(firstRun).toContain('53')
    expect(secondRun).toEqual(['53'])

    /*
     * 🛑 THE ASSERTION THAT MATTERS. With the old key these differ ('53:1:2022-09-26:1' vs
     * '...:0'), the upsert inserts, and the table accumulates a row per run per player.
     */
    expect(secondRun[0]).toBe(firstRun.find((id) => id === '53'))
    expect(externalIdsFrom().some((id) => id.includes(':'))).toBe(false)
  })

  it('is stable when the injury date or body part changes', async () => {
    mockApi([[HOBBS]])
    await syncAPISportsInjuriesToDb({ sport: 'NFL', season: '2026' })
    const before = externalIdsFrom()

    upsert.mockClear()
    mockApi([[{ ...HOBBS, date: '2026-09-01', description: 'Hamstring', status: 'Out' }]])
    await syncAPISportsInjuriesToDb({ sport: 'NFL', season: '2026' })

    // A new diagnosis must UPDATE the player's row, not open a second one beside it.
    expect(externalIdsFrom()).toEqual(before)
  })

  it('writes a normalized status, not the vendor’s roster-list notation', async () => {
    mockApi([[{ ...HOBBS, status: 'I.L.', description: 'I.L. - Groin' }]])
    await syncAPISportsInjuriesToDb({ sport: 'NFL', season: '2026' })

    const written = upsert.mock.calls[0]![0].create as {
      type: string | null
      status: string | null
      description: string | null
    }
    expect(written.status).toBe('IR')
    // The full vendor string is preserved; only the designation is translated.
    expect(written.description).toBe('I.L. - Groin')
    /*
     * `type` stays null on purpose. The body part sits on OPPOSITE sides of the dash depending on
     * the designation ("Knee - Questionable for Week 1" vs "I.L. - Ankle"), so any split rule is
     * silently wrong for half the feed.
     */
    expect(written.type).toBeNull()
  })
})

/**
 * The exact vocabulary a full 32-team sweep returned on 2026-09-08, with counts. 226 of these 430
 * rows carried a designation nothing downstream understands.
 */
describe('normalizeApiSportsInjuryStatus', () => {
  it.each([
    ['Questionable', 'Questionable', 204],
    ['I.L.', 'IR', 177],
    ['PUP', 'Out', 30],
    ['NFI', 'Out', 8],
    ['Suspension', 'Suspended', 8],
  ])('maps %s -> %s (%i rows in the measured sweep)', (raw, expected) => {
    expect(normalizeApiSportsInjuryStatus(raw)).toBe(expected)
  })

  it('preserves an unrecognised designation rather than nulling it', () => {
    // Matches the ESPN normalizer's decision: the vendor did publish something, and dropping it
    // invents an absence. These three appeared once each in the sweep.
    for (const raw of ['Personal', 'Sidelined', 'Undisclosed']) {
      expect(normalizeApiSportsInjuryStatus(raw)).toBe(raw)
    }
  })

  it('returns null only for genuinely empty input', () => {
    expect(normalizeApiSportsInjuryStatus(null)).toBeNull()
    expect(normalizeApiSportsInjuryStatus('   ')).toBeNull()
  })

  it('does not let a generic "out" shadow a more specific designation', () => {
    // 'out' is tested last on purpose; these must not collapse to Out.
    expect(normalizeApiSportsInjuryStatus('Doubtful')).toBe('Doubtful')
    expect(normalizeApiSportsInjuryStatus('Questionable')).toBe('Questionable')
    expect(normalizeApiSportsInjuryStatus('Out')).toBe('Out')
  })
})
