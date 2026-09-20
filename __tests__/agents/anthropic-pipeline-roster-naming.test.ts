// @vitest-environment node
/**
 * `/api/chimmy`'s roster naming — the id-as-name regression guard.
 *
 * This pipeline used to end `resolvePlayerNamesById` with
 *
 *     map.set(playerId, { name: playerId, position: null })
 *
 * so every id the lookup missed was handed to the model as a PERSON. And the lookup was
 * `PlayerIdentityMap where sport, sleeperId in ids`, which for a Fantrax / ESPN / MFL / Yahoo /
 * Fleaflicker roster matched ZERO rows — so the WHOLE roster was renamed after itself and Chimmy
 * was asked to advise on someone called "6804".
 *
 * The assertions that actually catch it are (a) the id space passed across the seam and (b) that
 * an unresolved id produces neither a name nor silence. Asserting only "a name came back" would
 * pass with the platform hardcoded again, because the mock answers whatever it is asked.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ resolveIdentities: vi.fn() }))

vi.mock('server-only', () => ({}))
vi.mock('@/lib/player-identity/resolveRosterPlayerIdentities', () => ({
  resolveRosterPlayerIdentities: mocks.resolveIdentities,
}))

import {
  countUnidentified,
  resolvePlayerNamesById,
  summarizeRosterNames,
} from '@/lib/agents/anthropic-pipeline'

beforeEach(() => {
  vi.clearAllMocks()
  mocks.resolveIdentities.mockResolvedValue(new Map())
})

describe('resolvePlayerNamesById', () => {
  it('🛑 passes the ROSTER’s id space through, not a hardcoded "sleeper"', async () => {
    await resolvePlayerNamesById(['06k5m', '05jxr'], 'fantrax', 'NCAAF')

    expect(mocks.resolveIdentities).toHaveBeenCalledTimes(1)
    const [platform, sport, ids] = mocks.resolveIdentities.mock.calls[0]
    expect(platform).toBe('fantrax')
    expect(sport).toBe('NCAAF')
    expect(ids).toEqual(['06k5m', '05jxr'])
  })

  it('🛑 leaves an unresolvable id OUT of the map — never names him after himself', async () => {
    mocks.resolveIdentities.mockResolvedValue(
      new Map([['06k5m', { name: 'Arch Manning', position: 'QB', team: 'Texas' }]]),
    )

    const map = await resolvePlayerNamesById(['06k5m', '05jxr'], 'fantrax', 'NCAAF')

    expect(map.get('06k5m')).toEqual({ name: 'Arch Manning', position: 'QB' })
    // The regression, stated directly: absent, and specifically NOT { name: '05jxr' }.
    expect(map.has('05jxr')).toBe(false)
    expect(map.get('05jxr')).toBeUndefined()
  })

  it('treats a resolver row with a null name as unresolved rather than as a blank player', async () => {
    mocks.resolveIdentities.mockResolvedValue(
      new Map([['05jxr', { name: null, position: 'WR', team: 'Ohio State' }]]),
    )
    const map = await resolvePlayerNamesById(['05jxr'], 'fantrax', 'NCAAF')
    expect(map.has('05jxr')).toBe(false)
  })

  it('de-duplicates and skips the lookup entirely for an empty roster', async () => {
    await resolvePlayerNamesById(['x', 'x'], 'sleeper', 'NFL')
    expect(mocks.resolveIdentities.mock.calls[0][2]).toEqual(['x'])

    mocks.resolveIdentities.mockClear()
    const map = await resolvePlayerNamesById([], 'sleeper', 'NFL')
    expect(mocks.resolveIdentities).not.toHaveBeenCalled()
    expect(map.size).toBe(0)
  })
})

describe('summarizeRosterNames', () => {
  const nameMap = new Map([
    ['06k5m', { name: 'Arch Manning', position: 'QB' as string | null }],
    ['a1b2c', { name: 'Jeremiah Smith', position: 'WR' as string | null }],
  ])

  it('🛑 never emits a player id as a name', () => {
    const out = summarizeRosterNames(['06k5m', '05jxr', 'a1b2c'], nameMap)
    expect(out).toEqual(['Arch Manning', 'Jeremiah Smith'])
    expect(out).not.toContain('05jxr')
  })

  it('returns an empty list when nothing resolved, rather than the ids back', () => {
    expect(summarizeRosterNames(['05jxr', 'zzz'], new Map())).toEqual([])
  })
})

describe('countUnidentified', () => {
  /*
   * ⚠ THE COUNT IS THE OTHER HALF OF THE FIX AND IS EASY TO DROP. Filtering unresolvable players
   * out of the lists without reporting how many were removed trades a fabricated team-mate for a
   * MISSING one — a model would then advise on a partial squad believing it whole.
   */
  it('reports how many of the roster could not be named', () => {
    const nameMap = new Map([['06k5m', { name: 'Arch Manning', position: null as string | null }]])
    expect(countUnidentified(['06k5m', '05jxr', 'zzz'], nameMap)).toBe(2)
  })

  it('is zero for a fully-resolved roster, so the key can be omitted entirely', () => {
    const nameMap = new Map([['06k5m', { name: 'Arch Manning', position: null as string | null }]])
    expect(countUnidentified(['06k5m'], nameMap)).toBe(0)
  })
})
