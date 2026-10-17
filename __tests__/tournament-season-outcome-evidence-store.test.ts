import { beforeEach, describe, expect, it, vi } from 'vitest'
import { seasonContractHash } from '@/lib/tournament/seasonCalendarVerification'

const mocks = vi.hoisted(() => ({ contract: vi.fn(), locked: vi.fn(), shell: vi.fn(), find: vi.fn(), create: vi.fn(), transaction: vi.fn() }))
vi.mock('@/lib/prisma', () => ({ prisma: { tournamentAuditLog: { findMany: mocks.find }, $transaction: mocks.transaction } }))
vi.mock('@/lib/tournament/seasonScheduleReview', () => ({ loadPublishedScheduleContract: mocks.contract }))
vi.mock('@/lib/tournament/seasonScoreLedger', () => ({ readSeasonOpeningLockedProviderPairs: mocks.locked }))
import { recordSeasonOutcomeCandidate, readSeasonOutcomeCandidates } from '@/lib/tournament/seasonOutcomeEvidenceStore'

const artifact = { game_ID: 'g1', player_box: { away_team: { p1: { status: 'DNP' } } } }
const source = { provider: 'rolling_insights' as const, reference: 'live/NBA/2026-10-20/g1', artifactDigest: seasonContractHash(artifact), observedAt: '2026-10-21T02:00:00Z', contract: 'unverified' as const }
let saved: Array<{ id: string; action: string; actorType: string; targetType: string; targetId: string; data: unknown }> = []

beforeEach(() => {
  vi.resetAllMocks()
  saved = []
  mocks.contract.mockResolvedValue({ manifest: { manifestHash: 'a'.repeat(64), rulesHash: 'b'.repeat(64), config: { rules: { calendar: { periods: [{ number: 1 }] } } }, leagues: [{ key: 'alpha' }] }, calendar: { assignments: [{ gameId: 'g1', period: 1 }, { gameId: 'g2', period: 1 }] } })
  mocks.locked.mockResolvedValue({ gameBindings: [{ gameId: 'g1', providerGameId: 'g1' }],
    pairs: [{ providerGameId: 'g1', providerPlayerId: 'p1' }], draftedWithoutLockedGamePlayerIds: ['canonical-p2'] })
  mocks.shell.mockResolvedValue({ commissionerId: 'owner', status: 'rules_published' })
  mocks.find.mockImplementation(async () => saved)
  mocks.create.mockImplementation(async ({ data }: { data: typeof saved[number] }) => { saved.push(data); return data })
  mocks.transaction.mockImplementation(async (run: (tx: unknown) => Promise<unknown>) => run({ tournamentShell: { findUnique: mocks.shell }, tournamentAuditLog: { findMany: mocks.find, create: mocks.create } }))
})

describe('server-only candidate outcome audit', () => {
  it('saves raw source evidence, retries idempotently and appends a correction', async () => {
    const dnp = { subject: { kind: 'player_game' as const, providerGameId: 'g1', providerPlayerId: 'p1' }, outcome: 'dnp' as const, source }
    expect(await recordSeasonOutcomeCandidate('owner', 't1', 'f1', 'alpha', 1, 'capture-1', dnp, artifact)).toMatchObject({ revision: 1, existing: false, scoringCertified: false })
    expect(saved[0]!.data).toMatchObject({ artifact, source, previousDigest: null })
    expect(await recordSeasonOutcomeCandidate('owner', 't1', 'f1', 'alpha', 1, 'capture-1', dnp, artifact)).toMatchObject({ revision: 1, existing: true })
    const correctedArtifact = { game_ID: 'g1', player_box: { away_team: { p1: { minutes: 1 } } } }
    const played = { ...dnp, outcome: 'played' as const, source: { ...source, artifactDigest: seasonContractHash(correctedArtifact) } }
    expect(await recordSeasonOutcomeCandidate('owner', 't1', 'f1', 'alpha', 1, 'capture-2', played, correctedArtifact)).toMatchObject({ revision: 2, existing: false })
    expect(saved).toHaveLength(2)
    expect((await readSeasonOutcomeCandidates('owner', 't1', 'f1', 'alpha', 1)).claims.map(row => row.outcome)).toEqual(['dnp', 'played'])
  })

  it('rejects identities outside locked scope and changed owner access before writing', async () => {
    const claim = { subject: { kind: 'player_game' as const, providerGameId: 'g1', providerPlayerId: 'other' }, outcome: 'dnp' as const, source }
    await expect(recordSeasonOutcomeCandidate('owner', 't1', 'f1', 'alpha', 1, 'capture-1', claim, artifact)).rejects.toThrow('verified locked receipt')
    mocks.shell.mockResolvedValue({ commissionerId: 'other', status: 'rules_published' })
    await expect(recordSeasonOutcomeCandidate('owner', 't1', 'f1', 'alpha', 1, 'capture-1', { ...claim, subject: { ...claim.subject, providerPlayerId: 'p1' } }, artifact)).rejects.toThrow('access changed')
    expect(mocks.create).not.toHaveBeenCalled()
  })

  it('does not accept a no-player game claim while a locked game identity is unresolved', async () => {
    mocks.locked.mockResolvedValue({ gameBindings: [{ gameId: 'g1', providerGameId: null }],
      pairs: [{ providerGameId: null, providerPlayerId: 'p1' }], draftedWithoutLockedGamePlayerIds: [] })
    const noPlayers = { subject: { kind: 'game_period' as const, providerGameId: 'g2' }, outcome: 'no_drafted_players' as const, source }
    await expect(recordSeasonOutcomeCandidate('owner', 't1', 'f1', 'alpha', 1, 'capture-1', noPlayers, artifact)).rejects.toThrow('published game without a locked player receipt')
    expect(mocks.create).not.toHaveBeenCalled()
  })

  it('rejects a tampered prior receipt and accepts only in-scope no-game and no-player candidates', async () => {
    const noGame = { subject: { kind: 'player_period' as const, playerId: 'canonical-p2' }, outcome: 'no_game' as const, source }
    await recordSeasonOutcomeCandidate('owner', 't1', 'f1', 'alpha', 1, 'capture-1', noGame, artifact)
    const noPlayers = { subject: { kind: 'game_period' as const, providerGameId: 'g2' }, outcome: 'no_drafted_players' as const, source }
    await recordSeasonOutcomeCandidate('owner', 't1', 'f1', 'alpha', 1, 'capture-2', noPlayers, artifact)
    saved[0]!.data = { ...(saved[0]!.data as object), outcome: 'game_expected' }
    await expect(readSeasonOutcomeCandidates('owner', 't1', 'f1', 'alpha', 1)).rejects.toThrow('checksum')
    expect(mocks.create).toHaveBeenCalledTimes(2)
  })

  it('accepts a verified provider game ID linked to the published canonical game and rejects an unlinked one', async () => {
    mocks.locked.mockResolvedValue({ gameBindings: [{ gameId: 'g1', providerGameId: 'ri-g1' }],
      pairs: [{ providerGameId: 'ri-g1', providerPlayerId: 'p1' }], draftedWithoutLockedGamePlayerIds: [] })
    const claim = { subject: { kind: 'player_game' as const, providerGameId: 'ri-g1', providerPlayerId: 'p1' },
      outcome: 'box_line_present' as const, source: { ...source, reference: 'live/NBA/2026-10-20/ri-g1', artifactDigest: seasonContractHash(artifact) } }
    await expect(recordSeasonOutcomeCandidate('owner', 't1', 'f1', 'alpha', 1, 'capture-1', claim, artifact)).resolves.toMatchObject({ revision: 1 })
    mocks.locked.mockResolvedValue({ gameBindings: [{ gameId: 'outside', providerGameId: 'ri-g1' }],
      pairs: [{ providerGameId: 'ri-g1', providerPlayerId: 'p1' }], draftedWithoutLockedGamePlayerIds: [] })
    await expect(recordSeasonOutcomeCandidate('owner', 't1', 'f1', 'alpha', 1, 'capture-2', claim, artifact)).rejects.toThrow('verified locked receipt')
  })
})
