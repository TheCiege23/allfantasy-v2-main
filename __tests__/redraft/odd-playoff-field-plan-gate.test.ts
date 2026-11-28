/**
 * An odd redraft playoff field is AF Commissioner (owner, 2026-11-25). The settings save already refused
 * it; the two bracket routes took a `playoffTeams` override and built the bracket with a commissioner
 * check only, so an odd bracket could be generated without the plan. Both now go through
 * lib/league/oddPlayoffFieldPlanGate.ts, which gates only CHOOSING a new odd field.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const m = vi.hoisted(() => ({
  hasPlan: false,
  league: { leagueType: 'redraft', playoffTeams: 6 } as { leagueType: string; playoffTeams: number },
  generate: vi.fn(async () => ({ ok: true })),
}))

vi.mock('next-auth', () => ({ getServerSession: vi.fn(async () => ({ user: { id: 'u1' } })) }))
vi.mock('@/lib/auth', () => ({ authOptions: {} }))
vi.mock('@/lib/entitlements/afCommissionerPlan', () => ({ hasAfCommissionerPlan: vi.fn(async () => m.hasPlan) }))
vi.mock('@/lib/league/league-access', () => ({
  assertLeagueMember: vi.fn(async () => ({ ok: true })),
  assertLeagueCommissioner: vi.fn(async () => ({ ok: true })),
}))
vi.mock('@/lib/league/permissions', () => ({ hasLeagueCommissionerRights: vi.fn(async () => true) }))
vi.mock('@/lib/playoff-runtime', () => ({
  generateNflRedraftPlayoffRuntimeBracket: m.generate,
  advanceNflRedraftPlayoffRuntimeRound: vi.fn(),
  finalizeNflRedraftPlayoffRuntimeSeason: vi.fn(),
  overrideNflRedraftPlayoffMatchup: vi.fn(),
  resolveNflRedraftPlayoffRuntime: vi.fn(),
}))
vi.mock('@/lib/decision-os/league-os', () => ({ createLeagueOsLoaders: vi.fn(() => ({})) }))
vi.mock('@/lib/decision-os/core/parity', () => ({ emitFeedOutcomes: vi.fn() }))
vi.mock('@/lib/prisma', () => ({
  prisma: {
    league: { findUnique: vi.fn(async () => m.league) },
    appUser: { findUnique: vi.fn(async () => ({ email: 'x@example.test', username: 'x' })) },
    redraftSeason: {
      findUnique: vi.fn(async () => ({ id: 's1', leagueId: 'L' })),
      findFirst: vi.fn(async () => ({ id: 's1', leagueId: 'L', rosters: [], playoffBracket: null, playoffRounds: [] })),
    },
  },
}))

const post = (body: Record<string, unknown>) =>
  new Request('http://localhost/x', { method: 'POST', body: JSON.stringify(body), headers: { 'content-type': 'application/json' } })

async function runtime(playoffTeams?: number) {
  const { POST } = await import('@/app/api/redraft/playoff-runtime/route')
  return POST(post({ action: 'generate_bracket', seasonId: 's1', ...(playoffTeams != null ? { playoffTeams } : {}) }))
}
async function generate(playoffTeams?: number) {
  const { POST } = await import('@/app/api/redraft/playoffs/generate/route')
  return POST(post({ seasonId: 's1', ...(playoffTeams != null ? { playoffTeams } : {}) }) as never)
}

beforeEach(() => {
  vi.clearAllMocks()
  m.hasPlan = false
  m.league = { leagueType: 'redraft', playoffTeams: 6 }
})

describe.each([
  ['POST /api/redraft/playoff-runtime', runtime],
  ['POST /api/redraft/playoffs/generate', generate],
])('%s', (_label, call) => {
  it('🛑 without the plan, a new odd field is refused and no bracket is built', async () => {
    const res = await call(7)
    expect(res.status).toBe(403)
    expect(((await res.json()) as { code?: string }).code).toBe('ODD_PLAYOFF_TEAMS_REQUIRES_AF_COMMISSIONER')
    expect(m.generate).not.toHaveBeenCalled()
  })

  it('[control] with the plan, the odd field is built', async () => {
    m.hasPlan = true
    expect((await call(7)).status).toBe(200)
    expect(m.generate).toHaveBeenCalledWith(expect.objectContaining({ playoffTeams: 7 }))
  })

  it('[control] an even field, no override, or the odd size the league already has all build without the plan', async () => {
    expect((await call(8)).status).toBe(200)
    expect((await call()).status).toBe(200)
    m.league = { leagueType: 'redraft', playoffTeams: 7 }
    expect((await call(7)).status).toBe(200)
    expect(m.generate).toHaveBeenCalledTimes(3)
  })

  it('[control] a non-redraft league is not gated (the rule is redraft only)', async () => {
    m.league = { leagueType: 'dynasty', playoffTeams: 6 }
    expect((await call(7)).status).toBe(200)
  })
})
