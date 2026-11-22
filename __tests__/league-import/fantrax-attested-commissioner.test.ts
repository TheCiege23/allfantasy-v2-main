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

import {
  applyAttestedCommissioner,
  assertImportCommissioner,
  attestationFromRequestBody,
  gateAllowsCommissionerConfirm,
} from '@/lib/league-import/commissionerGate'

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

describe('the import screen is told when it can offer "I am the commissioner"', () => {
  it('offers it to a proven Fantrax member whose commissioner status is unknown', () => {
    expect(gateAllowsCommissionerConfirm({ ok: true, verification: 'member' }, 'fantrax')).toBe(true)
    expect(gateAllowsCommissionerConfirm({ ok: true, verification: 'member' }, 'fleaflicker')).toBe(true)
  })

  it('does not offer it when status is already known, the gate failed, or the provider reports it', () => {
    expect(gateAllowsCommissionerConfirm({ ok: true, verification: 'api' }, 'fantrax')).toBe(false)
    expect(
      gateAllowsCommissionerConfirm({ ok: true, verification: 'member', isCommissioner: false }, 'fantrax'),
    ).toBe(false)
    expect(gateAllowsCommissionerConfirm({ ok: false, verification: 'member' }, 'fantrax')).toBe(false)
    expect(gateAllowsCommissionerConfirm({ ok: true, verification: 'member' }, 'sleeper')).toBe(false)
  })
})

describe('a route keeps the league an attestation was made for', () => {
  it('passes confirmedProvider and confirmedSourceLeagueId through to the gate', () => {
    expect(
      attestationFromRequestBody({
        accepted: true,
        statement: 's',
        confirmedProvider: 'fantrax',
        confirmedSourceLeagueId: ' fantrax-league:abc|T ',
      }),
    ).toEqual({
      accepted: true,
      statement: 's',
      confirmedProvider: 'fantrax',
      confirmedSourceLeagueId: 'fantrax-league:abc|T',
    })
  })

  it('reads nothing unaccepted or malformed as an attestation', () => {
    expect(attestationFromRequestBody(undefined)).toBeUndefined()
    expect(attestationFromRequestBody({ accepted: false })).toBeUndefined()
    expect(attestationFromRequestBody({ accepted: 'true' })).toBeUndefined()
    expect(attestationFromRequestBody({ accepted: true, confirmedProvider: 7 })).toEqual({ accepted: true })
  })
})
