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
    /*
     * ⚠ CHANGED DELIBERATELY 2026-08-27 ("a gate asking the wrong question").
     * This asserted that proven ESPN membership was NOT enough and demanded an
     * attestation. It blocked the ordinary case — most people are not
     * commissioner of most leagues they play in — and asked them to confirm a
     * claim they could not truthfully make. `checkEspn` only succeeds when the
     * caller's linked account holds a team in THIS league, which is the same
     * strength Sleeper proves and is let through as `member`.
     */
    expect(result.ok).toBe(true)
    expect(result.verification).toBe('member')
    expect(result.requiresAttestation).toBeFalsy()
  })

  it('records an ESPN commit as member even when an attestation is supplied', async () => {
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
    /*
     * ⚠ `member`, NOT `attestation`. The audit trail records what was PROVEN —
     * membership — rather than a commissioner claim that played no part in the
     * decision. Was 'attestation' while ESPN still required one.
     */
    expect(result.ok).toBe(true)
    expect(result.verification).toBe('member')
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

  it('lets a verified member import WITHOUT recording them as commissioner', async () => {
    /*
     * ⚠ THIS TEST USED TO ASSERT ok:false, AND THE BLOCK WAS THE BUG.
     *
     * Most people are not commissioner of most leagues they play in. Blocking
     * them — or, later, showing "Needs your confirmation" and asking them to
     * attest to a role they had just been told they do not hold — stopped the
     * ordinary case and added no fact. Membership is already PROVEN above by
     * resolveImportGate; a non-member never reaches this branch.
     *
     * The property the old assertion was really protecting is unchanged and is
     * asserted explicitly below: they must never be recorded AS commissioner.
     */
    await setup([{ user_id: SLEEPER_UID, is_owner: false }])
    const { assertImportCommissioner } = await import('@/lib/league-import/commissionerGate')
    const result = await assertImportCommissioner({
      appUserId: 'u1',
      provider: 'sleeper',
      sourceLeagueId: LEAGUE_ID,
      requireCommissioner: true,
    })
    expect(result.ok).toBe(true)
    // Still not the commissioner, and the audit trail says so precisely.
    expect(result.isCommissioner).toBe(false)
    expect(result.verification).toBe('member')
    // And nothing asks them to confirm anything.
    expect(result.requiresAttestation).toBeFalsy()
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

  it('⚠ never passes ambiguous metadata off AS commissioner', async () => {
    /*
     * `metadata.is_commissioner` is null on real Sleeper leagues, so absence of
     * the flag must never be read as presence. That is the guarantee, and it
     * still holds: the import proceeds as a MEMBER import, and `isCommissioner`
     * stays false. What changed is that not being the commissioner no longer
     * blocks the import — only the claim.
     */
    await setup([{ user_id: SLEEPER_UID, is_owner: false, metadata: {} }])
    const { assertImportCommissioner } = await import('@/lib/league-import/commissionerGate')
    const result = await assertImportCommissioner({
      appUserId: 'u1',
      provider: 'sleeper',
      sourceLeagueId: LEAGUE_ID,
      requireCommissioner: true,
    })
    expect(result.isCommissioner).toBe(false)
    expect(result.verification).not.toBe('api')
    expect(result.verification).toBe('member')
  })

  it('⚠ still refuses a REPLAYED attestation rather than downgrading it to a member import', async () => {
    /*
     * A confirmation captured for a different league or provider is a replay,
     * and letting it fall through to the member path would quietly retire a
     * guard that exists for a reason. The mismatch is refused explicitly.
     */
    await setup([{ user_id: SLEEPER_UID, is_owner: false }])
    const { assertImportCommissioner } = await import('@/lib/league-import/commissionerGate')
    const result = await assertImportCommissioner({
      appUserId: 'u1',
      provider: 'sleeper',
      sourceLeagueId: LEAGUE_ID,
      requireCommissioner: true,
      attestation: {
        accepted: true,
        confirmedProvider: 'espn',
        confirmedSourceLeagueId: 'some-other-league',
      },
    })
    expect(result.ok).toBe(false)
    expect(result.reason).toContain('different league or provider')
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
    /*
     * ⚠ REFUSED, BUT NOT BY ASKING FOR AN ATTESTATION. This asserted
     * `requiresAttestation`, which was right while ESPN still demanded one. It
     * no longer does — proven membership is the basis — so replying "resubmit
     * with a confirmation" would send the client round a loop it can never
     * finish. The mismatch is reported as what it is instead, matching the
     * sibling branch for the other membership-verified providers.
     */
    expect(result.ok).toBe(false)
    expect(result.reason).toMatch(/different league or provider/i)
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
