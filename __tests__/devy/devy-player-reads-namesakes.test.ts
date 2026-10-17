import { beforeEach, describe, expect, it, vi } from 'vitest'

/*
 * The devy by-name reads took the first row per normalized name. Production rows, 2026-10-12:
 * "Austin Simmons" is QB Missouri (CFBD 5141684, the only one with stats and a passing profile) and
 * TE Washington (5210429) — two people. "James Johnson" is QB Middle Tennessee and QB USC under ONE
 * CFBD id (5386508) — one transferred man, who must still resolve.
 */

vi.mock('server-only', () => ({}))
vi.mock('@/lib/devy-classification', () => ({ getEligibleDevyPlayers: vi.fn(async () => []) }))
vi.mock('@/lib/devy/devyValueBoard', () => ({ buildDevyValueBoard: vi.fn(() => ({ entries: [] })) }))

const findMany = vi.fn()
vi.mock('@/lib/prisma', () => ({ prisma: { devyPlayer: { findMany: (...a: unknown[]) => findMany(...a) } } }))

const base = {
  classYear: 3,
  heightInches: null,
  weightLbs: null,
  jerseyNumber: null,
  devyValue: 0,
  draftProjectionScore: null,
  recruitingComposite: null,
  breakoutAge: null,
  devyAdp: null,
  projectedNFLValue: null,
  projectedDraftRound: null,
  draftEligibleYear: 2027,
  trend: 'stable',
  passingYards: null,
  passingTDs: null,
  rushingYards: null,
  rushingTDs: null,
  receivingYards: null,
  receivingTDs: null,
  receptions: null,
  statSeason: null,
  passingProfileSeason: null,
}
const SIMMONS_QB = { ...base, id: 'a1', name: 'Austin Simmons', normalizedName: 'austin simmons', position: 'QB', school: 'Missouri', cfbdId: '5141684', statSeason: 2026, passingYards: 2100, passingProfileSeason: 2026, passAttempts: 300, adot: 8.1, airYardsAttempts: 250 }
const SIMMONS_TE = { ...base, id: 'a2', name: 'Austin Simmons', normalizedName: 'austin simmons', position: 'TE', school: 'Washington', cfbdId: '5210429' }
const JOHNSON_MTSU = { ...base, id: 'j1', name: 'James Johnson', normalizedName: 'james johnson', position: 'QB', school: 'Middle Tennessee', cfbdId: '5386508', statSeason: 2025, passingYards: 900 }
const JOHNSON_USC = { ...base, id: 'j2', name: 'James Johnson', normalizedName: 'james johnson', position: 'QB', school: 'USC', cfbdId: '5386508', statSeason: 2025, passingYards: 900 }
const POOL = [SIMMONS_QB, SIMMONS_TE, JOHNSON_MTSU, JOHNSON_USC]

/** A tiny where-evaluator: enough for the four reads under test. */
function applyWhere(where: Record<string, any>) {
  return POOL.filter((r: Record<string, any>) => {
    if (where.normalizedName?.in && !where.normalizedName.in.includes(r.normalizedName)) return false
    if (where.statSeason?.not === null && r.statSeason == null) return false
    if (where.passingProfileSeason?.not === null && r.passingProfileSeason == null) return false
    if (where.school?.in && !where.school.in.includes(r.school)) return false
    return true
  })
}

async function reads() {
  return import('@/lib/devy/devyPlayerReads')
}

beforeEach(() => {
  findMany.mockReset().mockImplementation(async ({ where }: { where: Record<string, any> }) => applyWhere(where))
})

describe('devy by-name reads refuse a name two prospects share', () => {
  it('values: Austin Simmons resolves to nobody; a transferred James Johnson still resolves', async () => {
    const { getDevyValuesForNamesFromDb } = await reads()
    const [simmons, johnson] = await getDevyValuesForNamesFromDb(['Austin Simmons', 'James Johnson'])
    expect(simmons).toBeNull()
    expect(johnson).not.toBeNull()
  })

  it('stats: the QB is the only Simmons with a line, and the name still does not bind', async () => {
    const { getDevyStatsByNameFromDb } = await reads()
    const byName = await getDevyStatsByNameFromDb()
    expect(byName.has('austin simmons')).toBe(false)
    expect(byName.has('james johnson')).toBe(true)
  })

  it('passing: a passing-only index would call Simmons unique — the pool census does not', async () => {
    const { getDevyPassingProfilesByNameFromDb } = await reads()
    const byName = await getDevyPassingProfilesByNameFromDb()
    expect(byName.has('austin simmons')).toBe(false)
  })

  it('passing: narrowing by school does not narrow the census either', async () => {
    const { getDevyPassingProfilesByNameFromDb } = await reads()
    const byName = await getDevyPassingProfilesByNameFromDb(['Missouri'])
    expect(byName.has('austin simmons')).toBe(false)
  })
})
