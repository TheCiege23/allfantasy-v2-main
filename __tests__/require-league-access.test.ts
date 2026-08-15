import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * The gate now stands in front of ~45 league endpoints, so its failure modes
 * matter more than its success path.
 *
 * The dangerous one is not "lets someone in" — it is "keeps everyone out". These
 * routes take `[leagueId]` in two different id spaces: the canonical League.id
 * uuid, and the provider's own league id (a Sleeper numeric string). A gate that
 * only understands uuids would 403 every real member of a provider-id route
 * while looking entirely correct in review, and the fix for that looks like
 * "remove the gate".
 */

const findFirst = vi.fn()
const resolveLeagueMembership = vi.fn()
const getServerSession = vi.fn()

vi.mock('next-auth', () => ({ getServerSession: (...a: unknown[]) => getServerSession(...a) }))
vi.mock('@/lib/auth', () => ({ authOptions: {} }))
vi.mock('@/lib/prisma', () => ({ prisma: { league: { findFirst: (...a: unknown[]) => findFirst(...a) } } }))
vi.mock('@/lib/league-access', () => ({
  resolveLeagueMembership: (...a: unknown[]) => resolveLeagueMembership(...a),
}))

const UUID = '3146ae38-fb3b-4de8-b4dc-0c0945ec52d8'
const SLEEPER_ID = '1321701751111315456'

async function subject() {
  const mod = await import('@/lib/api/require-league-access')
  return mod.requireLeagueApiAccess
}

beforeEach(() => {
  vi.resetModules()
  findFirst.mockReset()
  resolveLeagueMembership.mockReset()
  getServerSession.mockReset()
  getServerSession.mockResolvedValue({ user: { id: 'u1' } })
  resolveLeagueMembership.mockResolvedValue({ ok: true, access: { leagueId: UUID } })
})
afterEach(() => vi.restoreAllMocks())

describe('it does not lock out the people it protects', () => {
  it('maps a provider league id to the canonical id before checking membership', async () => {
    // Without this, resolveLeagueMembership is asked about a league id it has
    // never seen, returns not_found, and every member of that league is refused.
    findFirst.mockResolvedValue({ id: UUID })
    const requireLeagueApiAccess = await subject()

    const result = await requireLeagueApiAccess(SLEEPER_ID)

    expect(findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { platformLeagueId: SLEEPER_ID } })
    )
    expect(resolveLeagueMembership).toHaveBeenCalledWith(UUID, 'u1')
    expect(result.ok).toBe(true)
  })

  it('does not waste a lookup on an id that is already canonical', async () => {
    const requireLeagueApiAccess = await subject()

    const result = await requireLeagueApiAccess(UUID)

    expect(findFirst).not.toHaveBeenCalled()
    expect(resolveLeagueMembership).toHaveBeenCalledWith(UUID, 'u1')
    expect(result.ok).toBe(true)
  })
})

describe('it refuses in the right order', () => {
  it('rejects an anonymous caller before touching the database', async () => {
    // Otherwise response timing and status differ for real vs invented league
    // ids, which hands an unauthenticated caller a league-existence oracle.
    getServerSession.mockResolvedValue(null)
    const requireLeagueApiAccess = await subject()

    const result = await requireLeagueApiAccess(SLEEPER_ID)

    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.response.status).toBe(401)
    expect(findFirst).not.toHaveBeenCalled()
    expect(resolveLeagueMembership).not.toHaveBeenCalled()
  })

  it('passes through not-found and not-member statuses unchanged', async () => {
    const requireLeagueApiAccess = await subject()

    resolveLeagueMembership.mockResolvedValue({ ok: false, reason: 'not_found', status: 404 })
    const missing = await requireLeagueApiAccess(UUID)
    expect(missing.ok).toBe(false)
    if (!missing.ok) expect(missing.response.status).toBe(404)

    resolveLeagueMembership.mockResolvedValue({ ok: false, reason: 'not_member', status: 403 })
    const outsider = await requireLeagueApiAccess(UUID)
    expect(outsider.ok).toBe(false)
    if (!outsider.ok) expect(outsider.response.status).toBe(403)
  })

  it('rejects a missing league id as a bad request, not a 500', async () => {
    const requireLeagueApiAccess = await subject()
    for (const bad of ['', '   ', undefined, null]) {
      const result = await requireLeagueApiAccess(bad as string)
      expect(result.ok).toBe(false)
      if (!result.ok) expect(result.response.status).toBe(400)
    }
  })

  it('still refuses when a provider id matches no league', async () => {
    // Unmapped ids fall through to the membership check rather than being
    // treated as valid — the gate must not fail open on a lookup miss.
    findFirst.mockResolvedValue(null)
    resolveLeagueMembership.mockResolvedValue({ ok: false, reason: 'not_found', status: 404 })
    const requireLeagueApiAccess = await subject()

    const result = await requireLeagueApiAccess('not-a-real-league')

    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.response.status).toBe(404)
  })
})
