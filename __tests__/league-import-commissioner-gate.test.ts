import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  yahooFetchMock,
  espnFetchMock,
  mflUserLeaguesFetchMock,
  getDecryptedAuthMock,
} = vi.hoisted(() => ({
  yahooFetchMock: vi.fn(),
  espnFetchMock: vi.fn(),
  mflUserLeaguesFetchMock: vi.fn(),
  getDecryptedAuthMock: vi.fn(),
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    userProfile: {
      findFirst: vi.fn(),
    },
  },
}))

vi.mock('@/lib/league-sync-core', () => ({
  getDecryptedAuth: getDecryptedAuthMock,
}))

class YahooImportLeagueNotFoundErrorMock extends Error {}
class EspnImportLeagueNotFoundErrorMock extends Error {}
class MflImportLeagueNotFoundErrorMock extends Error {}

vi.mock('@/lib/league-import/yahoo/YahooLeagueFetchService', () => ({
  fetchYahooLeagueForImport: yahooFetchMock,
  YahooImportLeagueNotFoundError: YahooImportLeagueNotFoundErrorMock,
}))

vi.mock('@/lib/league-import/espn/EspnLeagueFetchService', () => ({
  fetchEspnLeagueForImport: espnFetchMock,
  EspnImportLeagueNotFoundError: EspnImportLeagueNotFoundErrorMock,
}))

vi.mock('@/lib/league-import/mfl/MflLeagueFetchService', () => ({
  fetchMflUserLeagues: mflUserLeaguesFetchMock,
  parseMflSourceInput: (input: string) => {
    const match = input.match(/^(\d{4}):(\d+)$/)
    return match ? { season: Number(match[1]), leagueId: match[2] } : { season: new Date().getFullYear(), leagueId: input }
  },
  MflImportLeagueNotFoundError: MflImportLeagueNotFoundErrorMock,
}))

describe('assertImportCommissioner', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('allows Yahoo import when the linked viewer team is commissioner-flagged', async () => {
    yahooFetchMock.mockResolvedValue({
      viewerTeamKey: '401.l.1.t.4',
      commissionerTeamKeys: ['401.l.1.t.4'],
      teams: [
        {
          teamKey: '401.l.1.t.4',
          managerGuid: 'guid-1',
          managerId: 'guid-1',
        },
      ],
    })

    const { assertImportCommissioner } = await import('@/lib/league-import/commissionerGate')
    await expect(
      assertImportCommissioner({
        appUserId: 'u1',
        provider: 'yahoo',
        sourceLeagueId: '401.l.1',
      })
    ).resolves.toEqual({
      ok: true,
      sourceManagerId: 'guid-1',
      verification: 'api',
      // Phase 0 (b2) — the viewer is in Yahoo's own commissioner list, so this is now
      // API-verified rather than falling through to an undetermined/attestation-requiring result.
      isCommissioner: true,
    })
  })

  it('allows Yahoo import when the viewer is a league member', async () => {
    yahooFetchMock.mockResolvedValue({
      viewerTeamKey: '401.l.1.t.7',
      commissionerTeamKeys: ['401.l.1.t.4'],
      teams: [
        {
          teamKey: '401.l.1.t.7',
          managerGuid: 'guid-7',
          managerId: 'guid-7',
        },
      ],
    })

    const { assertImportCommissioner } = await import('@/lib/league-import/commissionerGate')
    const result = await assertImportCommissioner({
      appUserId: 'u1',
      provider: 'yahoo',
      sourceLeagueId: '401.l.1',
    })

    expect(result.ok).toBe(true)
    expect(result.sourceManagerId).toBe('guid-7')
    expect(result.verification).toBe('api')
  })

  it('allows ESPN import when the viewer team belongs to a commissioner member', async () => {
    espnFetchMock.mockResolvedValue({
      viewerTeamId: '3',
      commissionerTeamIds: ['3'],
      teams: [
        {
          teamId: '3',
          managerId: 'espn-member-3',
        },
      ],
    })

    const { assertImportCommissioner } = await import('@/lib/league-import/commissionerGate')
    await expect(
      assertImportCommissioner({
        appUserId: 'u1',
        provider: 'espn',
        sourceLeagueId: '12345',
      })
    ).resolves.toEqual({
      ok: true,
      sourceManagerId: 'espn-member-3',
      verification: 'api',
      // Phase 0 (b1) — the viewer is in ESPN's own commissioner list, so this is now
      // API-verified rather than falling through to an undetermined/attestation-requiring result.
      isCommissioner: true,
    })
  })

  it('requires explicit attestation for a full-league ESPN commit — real membership alone is not enough (Import Security Closure phase)', async () => {
    espnFetchMock.mockResolvedValue({
      viewerTeamId: '3',
      commissionerTeamIds: [],
      teams: [{ teamId: '3', managerId: 'espn-member-3' }],
    })
    const { assertImportCommissioner } = await import('@/lib/league-import/commissionerGate')
    const result = await assertImportCommissioner({
      appUserId: 'u1',
      provider: 'espn',
      sourceLeagueId: '12345',
      requireCommissioner: true,
    })
    expect(result.ok).toBe(false)
    expect(result.requiresAttestation).toBe(true)
  })

  it('allows a full-league ESPN commit once the real member explicitly attests', async () => {
    espnFetchMock.mockResolvedValue({
      viewerTeamId: '3',
      commissionerTeamIds: [],
      teams: [{ teamId: '3', managerId: 'espn-member-3' }],
    })
    const { assertImportCommissioner } = await import('@/lib/league-import/commissionerGate')
    const result = await assertImportCommissioner({
      appUserId: 'u1',
      provider: 'espn',
      sourceLeagueId: '12345',
      requireCommissioner: true,
      attestation: { accepted: true },
    })
    expect(result.ok).toBe(true)
    expect(result.verification).toBe('attestation')
  })

  it('requires explicit attestation for a full-league Yahoo commit — real membership alone is not enough (Import Security Closure phase)', async () => {
    yahooFetchMock.mockResolvedValue({
      viewerTeamKey: '401.l.1.t.7',
      commissionerTeamKeys: [],
      teams: [{ teamKey: '401.l.1.t.7', managerGuid: 'guid-7', managerId: 'guid-7' }],
    })
    const { assertImportCommissioner } = await import('@/lib/league-import/commissionerGate')
    const result = await assertImportCommissioner({
      appUserId: 'u1',
      provider: 'yahoo',
      sourceLeagueId: '401.l.1',
      requireCommissioner: true,
    })
    expect(result.ok).toBe(false)
    expect(result.requiresAttestation).toBe(true)
  })

  it('allows fantrax imports for authenticated users when NOT a full-league commit (open-read provider, membership/legacy path)', async () => {
    const { assertImportCommissioner } = await import('@/lib/league-import/commissionerGate')
    const result = await assertImportCommissioner({
      appUserId: 'u1',
      provider: 'fantrax',
      sourceLeagueId: 'fantrax-1',
    })

    expect(result).toEqual({ ok: true, verification: 'api' })
  })

  it('Phase 0 (b3/b4) — requires explicit attestation for a full-league fantrax commit; real membership alone is not proven for open-read providers, closing the "any authenticated user" hole', async () => {
    const { assertImportCommissioner } = await import('@/lib/league-import/commissionerGate')
    const result = await assertImportCommissioner({
      appUserId: 'u1',
      provider: 'fantrax',
      sourceLeagueId: 'fantrax-1',
      requireCommissioner: true,
    })

    expect(result.ok).toBe(false)
    expect(result.requiresAttestation).toBe(true)
  })

  it('Phase 0 (b3/b4) — allows a full-league fantrax commit once the user explicitly attests', async () => {
    const { assertImportCommissioner } = await import('@/lib/league-import/commissionerGate')
    const result = await assertImportCommissioner({
      appUserId: 'u1',
      provider: 'fantrax',
      sourceLeagueId: 'fantrax-1',
      requireCommissioner: true,
      attestation: { accepted: true },
    })

    expect(result.ok).toBe(true)
    expect(result.verification).toBe('attestation')
  })

  it('reports notFound (maps to HTTP 404) when the Yahoo league does not exist (Yahoo certification phase — shared hardening)', async () => {
    yahooFetchMock.mockRejectedValue(new YahooImportLeagueNotFoundErrorMock('Yahoo league not found.'))
    const { assertImportCommissioner } = await import('@/lib/league-import/commissionerGate')
    const result = await assertImportCommissioner({ appUserId: 'u1', provider: 'yahoo', sourceLeagueId: 'missing' })
    expect(result.ok).toBe(false)
    expect(result.notFound).toBe(true)
  })

  it('reports notFound (maps to HTTP 404) when the ESPN league does not exist (Yahoo certification phase — shared hardening)', async () => {
    espnFetchMock.mockRejectedValue(new EspnImportLeagueNotFoundErrorMock('ESPN league not found.'))
    const { assertImportCommissioner } = await import('@/lib/league-import/commissionerGate')
    const result = await assertImportCommissioner({ appUserId: 'u1', provider: 'espn', sourceLeagueId: 'missing' })
    expect(result.ok).toBe(false)
    expect(result.notFound).toBe(true)
  })

  it('does not set notFound for a non-not-found Yahoo failure (e.g. expired/revoked token)', async () => {
    yahooFetchMock.mockRejectedValue(new Error('Yahoo refresh token unavailable; please reconnect your Yahoo account'))
    const { assertImportCommissioner } = await import('@/lib/league-import/commissionerGate')
    const result = await assertImportCommissioner({ appUserId: 'u1', provider: 'yahoo', sourceLeagueId: '401.l.1' })
    expect(result.ok).toBe(false)
    expect(result.notFound).toBeFalsy()
  })
})

describe('assertImportCommissioner — MFL real membership verification (Import Security Closure phase)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('rejects when no MFL API key is linked', async () => {
    getDecryptedAuthMock.mockResolvedValue(null)
    const { assertImportCommissioner } = await import('@/lib/league-import/commissionerGate')
    const result = await assertImportCommissioner({ appUserId: 'u1', provider: 'mfl', sourceLeagueId: '2026:12345' })
    expect(result.ok).toBe(false)
    expect(result.reason).toMatch(/Save your MFL API key/)
  })

  it('rejects an unrelated user whose API key has no franchise in the target league — closes the "any key can import any league" gap', async () => {
    getDecryptedAuthMock.mockResolvedValue({ apiKey: 'real-key' })
    mflUserLeaguesFetchMock.mockResolvedValue([{ leagueId: '99999', franchiseId: '0001' }])
    const { assertImportCommissioner } = await import('@/lib/league-import/commissionerGate')
    const result = await assertImportCommissioner({ appUserId: 'u1', provider: 'mfl', sourceLeagueId: '2026:12345' })
    expect(result.ok).toBe(false)
    expect(result.reason).toMatch(/not a member/)
  })

  it('allows preview/membership-only access for a real member, with isCommissioner left undefined (MFL cannot determine it)', async () => {
    getDecryptedAuthMock.mockResolvedValue({ apiKey: 'real-key' })
    mflUserLeaguesFetchMock.mockResolvedValue([{ leagueId: '12345', franchiseId: '0002' }])
    const { assertImportCommissioner } = await import('@/lib/league-import/commissionerGate')
    const result = await assertImportCommissioner({ appUserId: 'u1', provider: 'mfl', sourceLeagueId: '2026:12345' })
    expect(result).toEqual({ ok: true, sourceManagerId: '0002', verification: 'api', isCommissioner: undefined })
  })

  it('requires explicit attestation for a full-league commit when a real member cannot be proven commissioner', async () => {
    getDecryptedAuthMock.mockResolvedValue({ apiKey: 'real-key' })
    mflUserLeaguesFetchMock.mockResolvedValue([{ leagueId: '12345', franchiseId: '0002' }])
    const { assertImportCommissioner } = await import('@/lib/league-import/commissionerGate')
    const result = await assertImportCommissioner({
      appUserId: 'u1',
      provider: 'mfl',
      sourceLeagueId: '2026:12345',
      requireCommissioner: true,
    })
    expect(result.ok).toBe(false)
    expect(result.requiresAttestation).toBe(true)
  })

  it('allows a full-league commit once the member explicitly attests to being commissioner, stamped as attestation not api', async () => {
    getDecryptedAuthMock.mockResolvedValue({ apiKey: 'real-key' })
    mflUserLeaguesFetchMock.mockResolvedValue([{ leagueId: '12345', franchiseId: '0002' }])
    const { assertImportCommissioner } = await import('@/lib/league-import/commissionerGate')
    const result = await assertImportCommissioner({
      appUserId: 'u1',
      provider: 'mfl',
      sourceLeagueId: '2026:12345',
      requireCommissioner: true,
      attestation: { accepted: true, statement: 'I run this league' },
    })
    expect(result.ok).toBe(true)
    expect(result.verification).toBe('attestation')
  })

  it('reports notFound (maps to HTTP 404) for a real invalid MFL league', async () => {
    getDecryptedAuthMock.mockResolvedValue({ apiKey: 'real-key' })
    mflUserLeaguesFetchMock.mockRejectedValue(new MflImportLeagueNotFoundErrorMock('Invalid league ID'))
    const { assertImportCommissioner } = await import('@/lib/league-import/commissionerGate')
    const result = await assertImportCommissioner({ appUserId: 'u1', provider: 'mfl', sourceLeagueId: '2026:99999' })
    expect(result.ok).toBe(false)
    expect(result.notFound).toBe(true)
  })
})

describe('assertImportCommissioner — Sleeper commissioner gate (Phase 2.2)', () => {
  const SLEEPER_UID = '591462610482806784'
  const LEAGUE_ID = '1204903552921649152'

  async function setup(users: unknown) {
    const { prisma } = await import('@/lib/prisma')
    ;(prisma.userProfile.findFirst as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      sleeperUserId: SLEEPER_UID,
      sleeperUsername: 'theciege24',
    })
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => users,
    }) as unknown as typeof fetch
  }

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('allows full import when the requester is the Sleeper commissioner (is_owner)', async () => {
    await setup([{ user_id: SLEEPER_UID, is_owner: true }])
    const { assertImportCommissioner } = await import('@/lib/league-import/commissionerGate')
    const result = await assertImportCommissioner({
      appUserId: 'u1',
      provider: 'sleeper',
      sourceLeagueId: LEAGUE_ID,
      requireCommissioner: true,
    })
    expect(result.ok).toBe(true)
    expect(result.isCommissioner).toBe(true)
  })

  it('blocks full import when the requester is a normal manager (not owner)', async () => {
    await setup([{ user_id: SLEEPER_UID, is_owner: false }])
    const { assertImportCommissioner } = await import('@/lib/league-import/commissionerGate')
    const result = await assertImportCommissioner({
      appUserId: 'u1',
      provider: 'sleeper',
      sourceLeagueId: LEAGUE_ID,
      requireCommissioner: true,
    })
    expect(result.ok).toBe(false)
    // Phase 0 (b4) — the hard-block message is now provider-neutral (Sleeper is not the only
    // provider that can return a hard `isCommissioner === false`).
    expect(result.reason).toBe('Only the league commissioner can import this league into AllFantasy.')
  })

  it('still allows a normal manager for membership/legacy imports (no requireCommissioner)', async () => {
    await setup([{ user_id: SLEEPER_UID, is_owner: false }])
    const { assertImportCommissioner } = await import('@/lib/league-import/commissionerGate')
    const result = await assertImportCommissioner({
      appUserId: 'u1',
      provider: 'sleeper',
      sourceLeagueId: LEAGUE_ID,
    })
    expect(result.ok).toBe(true)
    expect(result.isCommissioner).toBe(false)
  })

  it('fails closed on missing/ambiguous commissioner metadata (member, no owner flag)', async () => {
    // metadata.is_commissioner is null on real Sleeper leagues — must not pass as commissioner.
    await setup([{ user_id: SLEEPER_UID, is_owner: false, metadata: {} }])
    const { assertImportCommissioner } = await import('@/lib/league-import/commissionerGate')
    const result = await assertImportCommissioner({
      appUserId: 'u1',
      provider: 'sleeper',
      sourceLeagueId: LEAGUE_ID,
      requireCommissioner: true,
    })
    expect(result.ok).toBe(false)
  })

  it('honors metadata.is_commissioner="true" as a secondary commissioner signal', async () => {
    await setup([{ user_id: SLEEPER_UID, is_owner: false, metadata: { is_commissioner: 'true' } }])
    const { assertImportCommissioner } = await import('@/lib/league-import/commissionerGate')
    const result = await assertImportCommissioner({
      appUserId: 'u1',
      provider: 'sleeper',
      sourceLeagueId: LEAGUE_ID,
      requireCommissioner: true,
    })
    expect(result.ok).toBe(true)
    expect(result.isCommissioner).toBe(true)
  })

  it('reports notFound (maps to HTTP 404) when the Sleeper league does not exist', async () => {
    const { prisma } = await import('@/lib/prisma')
    ;(prisma.userProfile.findFirst as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      sleeperUserId: SLEEPER_UID,
      sleeperUsername: 'theciege24',
    })
    global.fetch = vi.fn().mockResolvedValue({ ok: false, status: 404 }) as unknown as typeof fetch
    const { assertImportCommissioner } = await import('@/lib/league-import/commissionerGate')
    const result = await assertImportCommissioner({
      appUserId: 'u1',
      provider: 'sleeper',
      sourceLeagueId: 'deleted-league',
      requireCommissioner: true,
    })
    expect(result.ok).toBe(false)
    expect(result.notFound).toBe(true)
  })

  it('does not set notFound for a reachability failure that is not a 404', async () => {
    const { prisma } = await import('@/lib/prisma')
    ;(prisma.userProfile.findFirst as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      sleeperUserId: SLEEPER_UID,
      sleeperUsername: 'theciege24',
    })
    global.fetch = vi.fn().mockResolvedValue({ ok: false, status: 503 }) as unknown as typeof fetch
    const { assertImportCommissioner } = await import('@/lib/league-import/commissionerGate')
    const result = await assertImportCommissioner({
      appUserId: 'u1',
      provider: 'sleeper',
      sourceLeagueId: LEAGUE_ID,
      requireCommissioner: true,
    })
    expect(result.ok).toBe(false)
    expect(result.notFound).toBeFalsy()
  })
})

describe('assertImportCommissioner — attestation self-consistency check (Commissioner Import Attestation UI phase, Part 4)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('rejects an attestation whose confirmedProvider does not match this request\'s real provider', async () => {
    espnFetchMock.mockResolvedValue({
      viewerTeamId: '3',
      commissionerTeamIds: [],
      teams: [{ teamId: '3', managerId: 'espn-member-3' }],
    })
    const { assertImportCommissioner } = await import('@/lib/league-import/commissionerGate')
    const result = await assertImportCommissioner({
      appUserId: 'u1',
      provider: 'espn',
      sourceLeagueId: '12345',
      requireCommissioner: true,
      // A stale/malformed client payload claiming it was confirmed for Yahoo, not ESPN.
      attestation: { accepted: true, confirmedProvider: 'yahoo', confirmedSourceLeagueId: '12345' },
    })
    expect(result.ok).toBe(false)
    expect(result.requiresAttestation).toBe(true)
  })

  it('rejects an attestation whose confirmedSourceLeagueId does not match this request\'s real league', async () => {
    getDecryptedAuthMock.mockResolvedValue({ apiKey: 'real-key' })
    mflUserLeaguesFetchMock.mockResolvedValue([{ leagueId: '12345', franchiseId: '0002' }])
    const { assertImportCommissioner } = await import('@/lib/league-import/commissionerGate')
    const result = await assertImportCommissioner({
      appUserId: 'u1',
      provider: 'mfl',
      sourceLeagueId: '2026:12345',
      requireCommissioner: true,
      // Confirmed for a different league id than the one actually being committed.
      attestation: { accepted: true, confirmedProvider: 'mfl', confirmedSourceLeagueId: '2026:99999' },
    })
    expect(result.ok).toBe(false)
    expect(result.requiresAttestation).toBe(true)
  })

  it('accepts a real attestation whose confirmedProvider/confirmedSourceLeagueId match this request', async () => {
    getDecryptedAuthMock.mockResolvedValue({ apiKey: 'real-key' })
    mflUserLeaguesFetchMock.mockResolvedValue([{ leagueId: '12345', franchiseId: '0002' }])
    const { assertImportCommissioner } = await import('@/lib/league-import/commissionerGate')
    const result = await assertImportCommissioner({
      appUserId: 'u1',
      provider: 'mfl',
      sourceLeagueId: '2026:12345',
      requireCommissioner: true,
      attestation: { accepted: true, confirmedProvider: 'mfl', confirmedSourceLeagueId: '2026:12345' },
    })
    expect(result.ok).toBe(true)
    expect(result.verification).toBe('attestation')
  })

  it('still accepts a legacy attestation payload with no confirmed fields at all (backward compatible)', async () => {
    getDecryptedAuthMock.mockResolvedValue({ apiKey: 'real-key' })
    mflUserLeaguesFetchMock.mockResolvedValue([{ leagueId: '12345', franchiseId: '0002' }])
    const { assertImportCommissioner } = await import('@/lib/league-import/commissionerGate')
    const result = await assertImportCommissioner({
      appUserId: 'u1',
      provider: 'mfl',
      sourceLeagueId: '2026:12345',
      requireCommissioner: true,
      attestation: { accepted: true },
    })
    expect(result.ok).toBe(true)
    expect(result.verification).toBe('attestation')
  })
})

describe('providerRequiresCommissionerAttestation (client-safe shared classification)', () => {
  it('is true for mfl/espn/yahoo and false for sleeper/fantrax/fleaflicker', async () => {
    const { providerRequiresCommissionerAttestation } = await import('@/lib/league-import/attestationProviders')
    expect(providerRequiresCommissionerAttestation('mfl')).toBe(true)
    expect(providerRequiresCommissionerAttestation('espn')).toBe(true)
    expect(providerRequiresCommissionerAttestation('yahoo')).toBe(true)
    expect(providerRequiresCommissionerAttestation('sleeper')).toBe(false)
    expect(providerRequiresCommissionerAttestation('fantrax')).toBe(false)
    expect(providerRequiresCommissionerAttestation('fleaflicker')).toBe(false)
  })

  it('commissionerGate.ts re-exports the identical array, not a redefinition', async () => {
    const gate = await import('@/lib/league-import/commissionerGate')
    const shared = await import('@/lib/league-import/attestationProviders')
    expect(gate.MEMBERSHIP_VERIFIED_UNDETERMINED_COMMISSIONER).toBe(
      shared.MEMBERSHIP_VERIFIED_UNDETERMINED_COMMISSIONER
    )
  })
})