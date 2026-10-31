import { beforeEach, describe, expect, it, vi } from 'vitest'

const { auth, leagues } = vi.hoisted(() => ({ auth: vi.fn(), leagues: vi.fn() }))

vi.mock('@/lib/prisma', () => ({ prisma: {} }))
vi.mock('@/lib/league-sync-core', () => ({ getDecryptedAuth: auth }))
vi.mock('@/lib/league-import/fantrax/fantraxApi', () => ({ getFantraxLeagues: leagues }))

import { assertImportCommissioner } from '@/lib/league-import/commissionerGate'
import { fantraxTeamSourceId } from '@/lib/league-import/fantrax/fantraxTeamSelection'

const leagueId = '51isdapqmt6atvdz'
const request = (teamId: string) => ({
  appUserId: 'staging-member',
  provider: 'fantrax' as const,
  sourceLeagueId: fantraxTeamSourceId(leagueId, teamId),
  requireCommissioner: true,
})

describe('public Fantrax league import ownership gate', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    auth.mockResolvedValue({ apiKey: 'stored-secret-only' })
    leagues.mockResolvedValue({ ok: true, data: [{
      leagueId, leagueName: 'Public NBA League',
      teamIds: ['team-1', 'team-2'], teamNames: ['First Team', 'Second Team'],
    }] })
  })

  it('accepts either team owned by the same connected account without a commissioner claim', async () => {
    const first = await assertImportCommissioner(request('team-1'))
    const second = await assertImportCommissioner(request('team-2'))
    expect(first).toMatchObject({ ok: true, verification: 'member', sourceManagerId: 'First Team' })
    expect(second).toMatchObject({ ok: true, verification: 'member', sourceManagerId: 'Second Team' })
    expect(leagues).toHaveBeenCalledWith('stored-secret-only')
  })

  it('does not treat a different public team as owned by the connected account', async () => {
    const result = await assertImportCommissioner(request('team-3'))
    expect(result).toMatchObject({ ok: false, requiresAttestation: true })
    expect(result.sourceManagerId).toBeUndefined()
  })

  it('requires a commissioner attestation when the public ID has no connected account', async () => {
    auth.mockResolvedValue(null)
    const result = await assertImportCommissioner(request('team-1'))
    expect(result).toMatchObject({ ok: false, requiresAttestation: true })
    expect(leagues).not.toHaveBeenCalled()
  })
})
