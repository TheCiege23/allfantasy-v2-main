import React from 'react'
import { render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createMockNextRequest } from './helpers/createMockNextRequest'
import {
  DraftPremiumShells,
  NflRedraftPremiumPlayerCardShells,
} from '@/components/redraft-premium'
import {
  enforceNflRedraftPremiumAccess,
  loadNflRedraftPremiumProductionEvidence,
  stripClientEntitlementForServerResolution,
} from '@/lib/redraft-premium'

const mocks = vi.hoisted(() => ({
  getServerSession: vi.fn(),
  assertLeagueMemberWithCode: vi.fn(),
  isElevatedCommissioner: vi.fn(),
  resolveSnapshot: vi.fn(),
  prisma: {
    redraftSeason: { findFirst: vi.fn() },
    redraftRoster: { findFirst: vi.fn() },
    redraftRosterPlayer: { findFirst: vi.fn() },
    redraftMatchup: { findFirst: vi.fn() },
    redraftWaiverClaim: { findMany: vi.fn() },
    redraftTradeProposal: { findMany: vi.fn() },
    redraftDraft: { findFirst: vi.fn() },
  },
}))

vi.mock('next-auth', () => ({ getServerSession: mocks.getServerSession }))
vi.mock('@/lib/auth', () => ({ authOptions: {} }))
vi.mock('@/lib/league/league-access', () => ({ assertLeagueMemberWithCode: mocks.assertLeagueMemberWithCode }))
vi.mock('@/server/services/permissionService', () => ({ isElevatedCommissioner: mocks.isElevatedCommissioner }))
vi.mock('@/lib/prisma', () => ({ prisma: mocks.prisma }))
vi.mock('@/lib/subscription/EntitlementResolver', () => ({
  EntitlementResolver: class {
    resolveSnapshot(userId: string, email?: string | null) {
      return mocks.resolveSnapshot(userId, email)
    }
  },
}))

const ACTIVE_PRO = { status: 'active' as const, plans: ['pro' as const], currentPeriodEnd: null, gracePeriodEnd: null }
const FREE = { status: 'none' as const, plans: [], currentPeriodEnd: null, gracePeriodEnd: null }

beforeEach(() => {
  vi.clearAllMocks()
  mocks.getServerSession.mockResolvedValue({ user: { id: 'user-g49e', email: 'g49e@example.com' } })
  mocks.assertLeagueMemberWithCode.mockResolvedValue({ ok: true, league: { id: 'league-g49e' } })
  mocks.isElevatedCommissioner.mockResolvedValue(true)
  mocks.resolveSnapshot.mockResolvedValue(FREE)
  mocks.prisma.redraftSeason.findFirst.mockResolvedValue(null)
  mocks.prisma.redraftRoster.findFirst.mockResolvedValue(null)
  mocks.prisma.redraftRosterPlayer.findFirst.mockResolvedValue(null)
  mocks.prisma.redraftMatchup.findFirst.mockResolvedValue(null)
  mocks.prisma.redraftWaiverClaim.findMany.mockResolvedValue([])
  mocks.prisma.redraftTradeProposal.findMany.mockResolvedValue([])
  mocks.prisma.redraftDraft.findFirst.mockResolvedValue(null)
})

afterEach(() => {
  vi.unstubAllGlobals()
})

function expectFactsOnly(value: unknown) {
  const text = JSON.stringify(value).toLowerCase()
  expect(text).not.toContain('providerpayload')
  expect(text).not.toContain('rawproviderpayload')
  expect(text).not.toContain('providerplayerid')
  expect(text).not.toContain('recommendation')
  expect(text).not.toContain('reasoning')
  expect(text).not.toContain('llm')
  expect(text).not.toContain('start this player')
  expect(text).not.toContain('waiver priority')
  expect(text).not.toContain('make this trade')
  expect(text).not.toContain('collusion')
}

describe('G49E NFL redraft premium production enforcement', () => {
  it('enforces authenticated access through the existing session boundary', async () => {
    const allowed = await enforceNflRedraftPremiumAccess({
      leagueId: 'league-g49e',
      serviceId: 'manager_brief',
    })
    expect(allowed).toMatchObject({
      ok: true,
      userId: 'user-g49e',
      isLeagueMember: true,
      isCommissioner: true,
      entitlement: FREE,
    })

    mocks.getServerSession.mockResolvedValueOnce(null)
    const denied = await enforceNflRedraftPremiumAccess({
      leagueId: 'league-g49e',
      serviceId: 'manager_brief',
    })
    expect(denied).toMatchObject({
      ok: false,
      status: 401,
      code: 'unauthenticated',
    })
  })

  it('denies non-members and commissioner-only services safely', async () => {
    mocks.assertLeagueMemberWithCode.mockResolvedValueOnce({
      ok: false,
      code: 'NOT_LEAGUE_MEMBER',
      httpStatus: 403,
    })
    const nonMember = await enforceNflRedraftPremiumAccess({
      leagueId: 'league-g49e',
      serviceId: 'manager_brief',
    })
    expect(nonMember).toMatchObject({
      ok: false,
      status: 403,
      code: 'league_membership_denied',
    })

    mocks.isElevatedCommissioner.mockResolvedValueOnce(false)
    const commissionerDenied = await enforceNflRedraftPremiumAccess({
      leagueId: 'league-g49e',
      serviceId: 'commissioner_digest',
    })
    expect(commissionerDenied).toMatchObject({
      ok: false,
      status: 403,
      code: 'commissioner_required',
    })
  })

  it('strips client tier claims before server-side entitlement resolution', () => {
    const request = stripClientEntitlementForServerResolution(
      {
        serviceType: 'war_room',
        leagueId: 'league-g49e',
        requestedTier: 'AF_WAR_ROOM',
        entitlement: { status: 'active', plans: ['war_room'] },
      },
      FREE,
    )
    expect(request).toEqual({
      serviceType: 'war_room',
      leagueId: 'league-g49e',
      entitlement: { status: 'none', plans: [] },
    })
  })

  it('route allows server-entitled requests and denies client-claimed entitlement', async () => {
    const { POST } = await import('../app/api/redraft/premium-services/route')

    mocks.resolveSnapshot.mockResolvedValueOnce(ACTIVE_PRO)
    const allowedRes = await POST(
      createMockNextRequest('http://localhost/api/redraft/premium-services', {
        method: 'POST',
        body: {
          serviceType: 'manager_brief',
          leagueId: 'league-g49e',
          teamId: 'roster-g49e',
          requestedTier: 'FREE',
        },
      }),
    )
    const allowedBody = await allowedRes.json()
    expect(allowedRes.status).toBe(200)
    expect(allowedBody).toMatchObject({
      ok: true,
      serviceType: 'manager_brief',
      accessStatus: { allowed: true, requestedTier: 'AF_PRO' },
      resolverStatus: { source: 'canonical_evidence_resolver' },
      evidenceCounts: expect.any(Object),
    })
    expectFactsOnly(allowedBody)

    mocks.resolveSnapshot.mockResolvedValueOnce(FREE)
    const deniedRes = await POST(
      createMockNextRequest('http://localhost/api/redraft/premium-services', {
        method: 'POST',
        body: {
          serviceType: 'war_room',
          leagueId: 'league-g49e',
          requestedTier: 'AF_WAR_ROOM',
          entitlement: { status: 'active', plans: ['war_room'] },
        },
      }),
    )
    const deniedBody = await deniedRes.json()
    expect(deniedRes.status).toBe(200)
    expect(deniedBody).toMatchObject({
      ok: true,
      serviceType: 'war_room',
      accessStatus: { allowed: false, requestedTier: 'FREE', requiredTier: 'AF_WAR_ROOM' },
    })
    expectFactsOnly(deniedBody)
  })

  it('route returns safe auth and membership errors with stable error shape', async () => {
    const { POST } = await import('../app/api/redraft/premium-services/route')

    mocks.getServerSession.mockResolvedValueOnce(null)
    const unauthRes = await POST(
      createMockNextRequest('http://localhost/api/redraft/premium-services', {
        method: 'POST',
        body: { serviceType: 'basic_runtime_facts', leagueId: 'league-g49e' },
      }),
    )
    const unauthBody = await unauthRes.json()
    expect(unauthRes.status).toBe(401)
    expect(unauthBody).toMatchObject({ ok: false, error: { code: 'unauthenticated', fields: ['session'] } })

    mocks.assertLeagueMemberWithCode.mockResolvedValueOnce({
      ok: false,
      code: 'NOT_LEAGUE_MEMBER',
      httpStatus: 403,
    })
    const memberRes = await POST(
      createMockNextRequest('http://localhost/api/redraft/premium-services', {
        method: 'POST',
        body: { serviceType: 'basic_runtime_facts', leagueId: 'league-g49e' },
      }),
    )
    const memberBody = await memberRes.json()
    expect(memberRes.status).toBe(403)
    expect(memberBody).toMatchObject({ ok: false, error: { code: 'league_membership_denied', fields: ['leagueId'] } })
    expectFactsOnly(unauthBody)
    expectFactsOnly(memberBody)
  })

  it('production evidence source returns packets when canonical redraft data exists', async () => {
    mocks.prisma.redraftSeason.findFirst.mockResolvedValueOnce({
      id: 'season-g49e',
      leagueId: 'league-g49e',
      sport: 'NFL',
      season: 2026,
      status: 'in_season',
      totalWeeks: 17,
      playoffStartWeek: 15,
      currentWeek: 1,
    })
    mocks.prisma.redraftRoster.findFirst.mockResolvedValueOnce({
      id: 'roster-g49e',
      seasonId: 'season-g49e',
      leagueId: 'league-g49e',
      ownerId: 'user-g49e',
      ownerName: 'Manager G49E',
      teamName: 'Facts Only FC',
      wins: 1,
      losses: 0,
      ties: 0,
      pointsFor: 123.4,
      pointsAgainst: 101.2,
      playoffSeed: 2,
      faabBalance: 88,
      waiverPriority: 5,
      players: [
        {
          id: 'rp-g49e',
          rosterId: 'roster-g49e',
          playerId: 'player-g49e',
          playerName: 'Canonical Runner',
          position: 'RB',
          team: 'NYJ',
          slotType: 'RB',
          injuryStatus: null,
          byeWeek: 9,
          addedAt: new Date('2026-09-01T00:00:00.000Z'),
          droppedAt: null,
        },
      ],
    })
    mocks.prisma.redraftMatchup.findFirst.mockResolvedValueOnce({
      id: 'matchup-g49e',
      seasonId: 'season-g49e',
      leagueId: 'league-g49e',
      week: 1,
      type: 'regular',
      homeRosterId: 'roster-g49e',
      awayRosterId: 'roster-away',
      homeScore: 123.4,
      awayScore: 101.2,
      homeProjected: 120,
      awayProjected: 103,
      status: 'final',
    })

    const packets = await loadNflRedraftPremiumProductionEvidence(
      {
        serviceId: 'manager_brief',
        canonicalIds: {
          leagueId: 'league-g49e',
          teamId: 'roster-g49e',
          managerId: 'user-g49e',
          matchupId: 'matchup-g49e',
          playerId: 'player-g49e',
          week: 1,
          season: 2026,
        },
        ingestedAtIso: '2026-09-14T00:00:00.000Z',
      },
      { prismaClient: mocks.prisma as never, now: new Date('2026-09-14T00:00:00.000Z') },
    )

    expect(packets.map((packet) => packet.evidenceType)).toEqual(
      expect.arrayContaining(['roster_context', 'player_identity', 'matchup_context']),
    )
    expect(packets.every((packet) => packet.sourceProvider === 'allfantasy')).toBe(true)
    expectFactsOnly(packets)
  })

  it('production evidence source returns missing fallback when canonical season is unavailable', async () => {
    const packets = await loadNflRedraftPremiumProductionEvidence(
      {
        serviceId: 'draft_prep',
        canonicalIds: {
          leagueId: 'league-g49e',
          teamId: null,
          managerId: null,
          matchupId: null,
          playerId: null,
          week: null,
          season: 2026,
        },
        ingestedAtIso: '2026-09-14T00:00:00.000Z',
      },
      { prismaClient: mocks.prisma as never },
    )

    expect(packets).toHaveLength(1)
    expect(packets[0]).toMatchObject({
      evidenceType: 'draft_context',
      missing: true,
      fallback: true,
      facts: { reason: 'production_redraft_season_unavailable' },
    })
  })

  it('renders draft-room and player-card premium shells without provider IDs', async () => {
    const fetchMock = vi.fn().mockImplementation((_url: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body))
      return Promise.resolve({
        ok: true,
        json: vi.fn().mockResolvedValue({
          modelVersion: 'nfl-redraft-premium-api-contract-v1',
          ok: true,
          serviceType: body.serviceType,
          serviceName: body.serviceType,
          serviceVariant: body.serviceVariant ?? 'basic',
          requiredTier: 'FREE',
          accessStatus: { allowed: true, requiredTier: 'FREE', requestedTier: 'FREE', reason: 'allowed' },
          canonicalIds: {
            leagueId: body.leagueId,
            teamId: body.teamId ?? null,
            managerId: null,
            matchupId: null,
            playerId: body.playerId ?? null,
            week: null,
            season: null,
          },
          evidencePacketIds: [],
          freshnessWarnings: { overall: 'missing', counts: { available: 0, missing: 1, stale: 0, unknown: 0 } },
          staleDataWarnings: [],
          fallbackWarnings: [],
          missingDataWarnings: ['unavailable:no_matching_canonical_evidence'],
          eligibleSurfaces: ['draft', 'player_card'],
          factualCategoryLabels: ['draft_context'],
          unavailableDataMessages: ['unavailable:no_matching_canonical_evidence'],
          resolverStatus: { status: 'empty', source: 'canonical_evidence_resolver', messages: ['no_matching_canonical_evidence'] },
          evidenceCounts: { totalAvailable: 0, selected: 0, stale: 0, fallback: 0, missing: 0, byType: {} },
          factsOnly: true,
          deterministic: true,
          generatedAtIso: '1970-01-01T00:00:00.000Z',
        }),
      })
    })
    vi.stubGlobal('fetch', fetchMock)

    render(
      <>
        <DraftPremiumShells leagueId="league-g49e" />
        <NflRedraftPremiumPlayerCardShells
          leagueId="league-g49e"
          playerId="sportsdataio:provider-123"
          teamId="roster-g49e"
        />
      </>,
    )

    await waitFor(() => expect(screen.getAllByTestId('premium-service-allowed').length).toBeGreaterThanOrEqual(3))
    const bodies = fetchMock.mock.calls.map((call) => JSON.parse(String(call[1].body)))
    expect(bodies.map((body) => body.serviceType)).toEqual([
      'draft_prep',
      'draft_prep',
      'basic_runtime_facts',
      'manager_brief',
    ])
    const playerCardBodies = bodies.slice(2)
    expect(playerCardBodies.every((body) => !('providerPlayerId' in body))).toBe(true)
    expect(playerCardBodies.every((body) => !('providerId' in body))).toBe(true)
    expect(playerCardBodies.every((body) => !('playerId' in body))).toBe(true)
    expectFactsOnly(document.body.textContent)
  })
})
