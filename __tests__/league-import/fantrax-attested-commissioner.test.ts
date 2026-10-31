/**
 * @vitest-environment node
 *
 * 🛑 A FANTRAX COMMISSIONER'S ATTESTATION WAS RECORDED AND NEVER APPLIED. Fantrax has no
 * commissioner field, so on production (2026-10-31) a 140-team league whose importer had confirmed
 * they were commissioner had zero commissioner teams — no C on the league list, no hub.
 *
 * Two halves are pinned here:
 *   - `applyAttestedCommissioner` writes the flags the C and the hub read, scoped to the caller's
 *     own league row and own claimed team;
 *   - a Fantrax member proven by their Secret ID can still attest, instead of the attestation
 *     being silently dropped on the `member` path.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  leagueUpdateMany: vi.fn(),
  teamUpdateMany: vi.fn(),
  getDecryptedAuth: vi.fn(),
  getFantraxLeagues: vi.fn(),
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    league: { updateMany: h.leagueUpdateMany },
    leagueTeam: { updateMany: h.teamUpdateMany },
    userProfile: { findFirst: vi.fn() },
  },
}))
vi.mock('@/lib/league-sync-core', () => ({ getDecryptedAuth: h.getDecryptedAuth }))
vi.mock('@/lib/league-import/fantrax/fantraxApi', () => ({ getFantraxLeagues: h.getFantraxLeagues }))

import { applyAttestedCommissioner, assertImportCommissioner } from '@/lib/league-import/commissionerGate'

beforeEach(() => {
  vi.clearAllMocks()
  h.leagueUpdateMany.mockResolvedValue({ count: 1 })
  h.teamUpdateMany.mockResolvedValue({ count: 1 })
})

describe('applyAttestedCommissioner', () => {
  it('marks the league row and the importer’s claimed team as commissioner', async () => {
    const out = await applyAttestedCommissioner({ leagueId: 'lg-1', appUserId: 'u1' })

    expect(h.leagueUpdateMany).toHaveBeenCalledWith({
      where: { id: 'lg-1', userId: 'u1' },
      data: { isCommissioner: true },
    })
    expect(h.teamUpdateMany).toHaveBeenCalledWith({
      where: { leagueId: 'lg-1', claimedByUserId: 'u1' },
      data: { isCommissioner: true },
    })
    expect(out.teamsUpdated).toBe(1)
  })

  it('touches no team when the league row is not this user’s', async () => {
    h.leagueUpdateMany.mockResolvedValue({ count: 0 })

    const out = await applyAttestedCommissioner({ leagueId: 'lg-other', appUserId: 'u1' })

    expect(h.teamUpdateMany).not.toHaveBeenCalled()
    expect(out.teamsUpdated).toBe(0)
  })

  it('a failed write does not throw — the import has already succeeded', async () => {
    h.leagueUpdateMany.mockRejectedValue(new Error('db down'))
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})

    await expect(applyAttestedCommissioner({ leagueId: 'lg-1', appUserId: 'u1' })).resolves.toEqual({
      teamsUpdated: 0,
    })
    warn.mockRestore()
  })
})

describe('🛑 a Secret-ID-verified Fantrax member can still attest', () => {
  const SOURCE = 'fantrax-league:abc123|Maryland Terrapins'

  beforeEach(() => {
    h.getDecryptedAuth.mockResolvedValue({ apiKey: 'secret-id' })
    h.getFantraxLeagues.mockResolvedValue({
      ok: true,
      data: [{ leagueId: 'abc123', teamNames: ['Maryland Terrapins'] }],
    })
  })

  it('without an attestation: a plain member, never asked to swear anything', async () => {
    const gate = await assertImportCommissioner({
      appUserId: 'u1',
      provider: 'fantrax',
      sourceLeagueId: SOURCE,
      requireCommissioner: true,
    })

    expect(gate).toMatchObject({ ok: true, verification: 'member', sourceManagerId: 'Maryland Terrapins' })
  })

  it('with an accepted attestation: recorded as an attestation, so the role is applied', async () => {
    const gate = await assertImportCommissioner({
      appUserId: 'u1',
      provider: 'fantrax',
      sourceLeagueId: SOURCE,
      requireCommissioner: true,
      attestation: { accepted: true },
    })

    expect(gate).toMatchObject({ ok: true, verification: 'attestation', sourceManagerId: 'Maryland Terrapins' })
  })

  it('an attestation confirmed for a different league is not honoured', async () => {
    const gate = await assertImportCommissioner({
      appUserId: 'u1',
      provider: 'fantrax',
      sourceLeagueId: SOURCE,
      requireCommissioner: true,
      attestation: { accepted: true, confirmedSourceLeagueId: 'fantrax-league:other|X' },
    })

    expect(gate).toMatchObject({ ok: true, verification: 'member' })
  })
})
