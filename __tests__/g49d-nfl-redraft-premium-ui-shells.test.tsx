import React from 'react'
import { render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  NflRedraftPremiumServiceShell,
  NflRedraftPremiumSurfaceRail,
  NFL_REDRAFT_PREMIUM_SURFACE_SERVICES,
} from '@/components/redraft-premium'
import {
  buildNflRedraftPremiumProductContract,
  type NflRedraftPremiumProductContractResult,
  type NflRedraftPremiumProductPacket,
} from '@/lib/redraft-premium'

const NOW = '2026-07-03T12:00:00.000Z'

function packet(overrides: Partial<NflRedraftPremiumProductPacket> = {}): NflRedraftPremiumProductPacket {
  return {
    modelVersion: 'nfl-redraft-premium-api-contract-v1',
    ok: true,
    serviceType: 'manager_brief',
    serviceName: 'Manager Brief Service',
    serviceVariant: 'basic',
    requiredTier: 'AF_PRO',
    accessStatus: {
      allowed: true,
      requiredTier: 'AF_PRO',
      requestedTier: 'AF_PRO',
      reason: 'allowed',
    },
    canonicalIds: {
      leagueId: 'league-g49d',
      teamId: 'team-g49d',
      managerId: 'manager-g49d',
      matchupId: 'matchup-g49d',
      playerId: 'player-g49d',
      week: 1,
      season: 2026,
    },
    evidencePacketIds: ['evidence-g49d-1', 'evidence-g49d-2'],
    freshnessWarnings: {
      overall: 'available',
      counts: { available: 2, missing: 0, stale: 0, unknown: 0 },
    },
    staleDataWarnings: [],
    fallbackWarnings: [],
    missingDataWarnings: [],
    eligibleSurfaces: ['team', 'roster', 'player_card'],
    factualCategoryLabels: ['identity_context', 'projection_context', 'freshness_review'],
    unavailableDataMessages: [],
    resolverStatus: {
      status: 'resolved',
      source: 'canonical_evidence_resolver',
      messages: ['selected_2_canonical_evidence_packets'],
    },
    evidenceCounts: {
      totalAvailable: 2,
      selected: 2,
      stale: 0,
      fallback: 0,
      missing: 0,
      byType: { projection: 1, injury: 1 },
    },
    factsOnly: true,
    deterministic: true,
    generatedAtIso: NOW,
    ...overrides,
  }
}

function mockFetchResult(result: NflRedraftPremiumProductContractResult, ok = true) {
  const fetchMock = vi.fn().mockResolvedValue({
    ok,
    json: vi.fn().mockResolvedValue(result),
  })
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.clearAllMocks()
})

describe('G49D NFL redraft premium UI shells', () => {
  it('renders loading state while the premium contract request is pending', () => {
    vi.stubGlobal('fetch', vi.fn(() => new Promise(() => undefined)))

    render(<NflRedraftPremiumServiceShell serviceType="manager_brief" leagueId="league-g49d" />)

    expect(screen.getByTestId('premium-service-loading')).toHaveTextContent('AF Manager Brief')
    expect(screen.getByText('Loading service packet')).toBeInTheDocument()
  })

  it('renders allowed packets with evidence counts, surfaces, categories, and warnings', async () => {
    mockFetchResult(
      packet({
        staleDataWarnings: ['stale:projection'],
        fallbackWarnings: ['fallback:weather'],
        missingDataWarnings: ['missing:injury'],
        unavailableDataMessages: ['unavailable:news'],
        evidenceCounts: {
          totalAvailable: 4,
          selected: 4,
          stale: 1,
          fallback: 1,
          missing: 1,
          byType: { projection: 1, injury: 1, weather: 1, news: 1 },
        },
      }),
    )

    render(<NflRedraftPremiumServiceShell serviceType="manager_brief" leagueId="league-g49d" requestedTier="AF_PRO" />)

    const shell = await screen.findByTestId('premium-service-allowed')
    expect(shell).toHaveTextContent('AF Manager Brief')
    expect(shell).toHaveTextContent('Access available')
    expect(shell).toHaveTextContent('Evidence Count')
    expect(shell).toHaveTextContent('4')
    expect(shell).toHaveTextContent('stale projection')
    expect(shell).toHaveTextContent('fallback weather')
    expect(shell).toHaveTextContent('missing injury')
    expect(shell).toHaveTextContent('unavailable news')
    expect(shell).toHaveTextContent('team')
    expect(shell).toHaveTextContent('projection context')
  })

  it('renders locked state from accessStatus without checkout or advice copy', async () => {
    mockFetchResult(
      packet({
        accessStatus: {
          allowed: false,
          requiredTier: 'AF_PRO',
          requestedTier: 'FREE',
          reason: 'tier_required',
        },
      }),
    )

    render(<NflRedraftPremiumServiceShell serviceType="manager_brief" leagueId="league-g49d" requestedTier="FREE" />)

    const shell = await screen.findByTestId('premium-service-locked')
    expect(shell).toHaveTextContent('Requires AF Pro')
    expect(shell).toHaveTextContent('AF Pro is needed for this service.')
    expect(shell).not.toHaveTextContent(/checkout|stripe|subscribe now/i)
  })

  it('renders empty evidence state honestly', async () => {
    mockFetchResult(
      packet({
        evidencePacketIds: [],
        resolverStatus: {
          status: 'empty',
          source: 'canonical_evidence_resolver',
          messages: ['no_matching_canonical_evidence'],
        },
        evidenceCounts: {
          totalAvailable: 0,
          selected: 0,
          stale: 0,
          fallback: 0,
          missing: 0,
          byType: {},
        },
      }),
    )

    render(<NflRedraftPremiumServiceShell serviceType="basic_runtime_facts" leagueId="league-g49d" requestedTier="FREE" />)

    expect(await screen.findByTestId('premium-service-empty')).toHaveTextContent('No canonical evidence is available')
  })

  it('renders a safe error state for route errors', async () => {
    mockFetchResult(
      {
        modelVersion: 'nfl-redraft-premium-api-contract-v1',
        ok: false,
        error: {
          code: 'invalid_request',
          message: 'leagueId is required.',
          fields: ['leagueId'],
        },
      },
      false,
    )

    render(<NflRedraftPremiumServiceShell serviceType="manager_brief" leagueId="league-g49d" />)

    const error = await screen.findByTestId('premium-service-error')
    expect(error).toHaveTextContent('AF Manager Brief')
    expect(error).toHaveTextContent('leagueId is required.')
    expect(error).not.toHaveTextContent(/secret|providerPayload|rawProviderPayload/i)
  })

  it('uses the G49C route contract and sends canonical identifiers only', async () => {
    const fetchMock = mockFetchResult(packet())

    render(
      <NflRedraftPremiumServiceShell
        serviceType="matchup_prep"
        leagueId="league-g49d"
        teamId="team-g49d"
        managerId="manager-g49d"
        matchupId="matchup-g49d"
        playerId="player-g49d"
        week={2}
        season={2026}
        requestedTier="AF_PRO"
      />,
    )

    await screen.findByTestId('premium-service-allowed')
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/redraft/premium-services',
      expect.objectContaining({
        method: 'POST',
        headers: { 'content-type': 'application/json' },
      }),
    )
    const body = JSON.parse(fetchMock.mock.calls[0][1].body)
    expect(body).toEqual({
      serviceType: 'matchup_prep',
      leagueId: 'league-g49d',
      teamId: 'team-g49d',
      managerId: 'manager-g49d',
      matchupId: 'matchup-g49d',
      playerId: 'player-g49d',
      week: 2,
      season: 2026,
      requestedTier: 'AF_PRO',
    })
    expect(Object.keys(body)).not.toContain('providerId')
    expect(Object.keys(body)).not.toContain('providerPayload')
  })

  it('renders product packets built by the route contract helper', async () => {
    const routePacket = buildNflRedraftPremiumProductContract({
      serviceType: 'basic_runtime_facts',
      leagueId: 'league-g49d',
      requestedTier: 'FREE',
      generatedAtIso: NOW,
    })
    mockFetchResult(routePacket)

    render(<NflRedraftPremiumServiceShell serviceType="basic_runtime_facts" leagueId="league-g49d" requestedTier="FREE" />)

    const shell = await screen.findByTestId('premium-service-allowed')
    expect(shell).toHaveTextContent('Basic Runtime Facts')
    expect(screen.getByTestId('premium-service-empty')).toBeInTheDocument()
  })

  it('maps all requested redraft surfaces to premium service shells', async () => {
    const fetchMock = vi.fn().mockImplementation((_url: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body))
      return Promise.resolve({
        ok: true,
        json: vi.fn().mockResolvedValue(
          packet({
            serviceType: body.serviceType,
            serviceVariant: body.serviceVariant ?? 'basic',
            serviceName: body.serviceType,
          }),
        ),
      })
    })
    vi.stubGlobal('fetch', fetchMock)

    render(
      <NflRedraftPremiumSurfaceRail
        surface="trade_center"
        leagueId="league-g49d"
        teamId="team-g49d"
        week={3}
        season={2026}
        requestedTier="AF_SUPREME"
      />,
    )

    const rail = screen.getByTestId('premium-service-surface-rail')
    expect(rail).toHaveAttribute('data-surface', 'trade_center')
    expect(NFL_REDRAFT_PREMIUM_SURFACE_SERVICES.trade_center).toHaveLength(2)
    await waitFor(() => expect(screen.getAllByTestId('premium-service-allowed')).toHaveLength(2))
    expect(fetchMock).toHaveBeenCalledTimes(2)
    const serviceTypes = fetchMock.mock.calls.map((call) => JSON.parse(String(call[1].body)).serviceType)
    expect(serviceTypes).toEqual(['trade_review', 'trade_review'])
  })

  it('does not render provider payload, provider ID, advice, or reasoning fields', async () => {
    mockFetchResult(packet())

    const { container } = render(
      <NflRedraftPremiumServiceShell serviceType="manager_brief" leagueId="league-g49d" requestedTier="AF_PRO" />,
    )

    const shell = await screen.findByTestId('premium-service-allowed')
    expect(within(shell).getByText('Access available')).toBeInTheDocument()

    const text = container.textContent?.toLowerCase() ?? ''
    expect(text).not.toContain('providerpayload')
    expect(text).not.toContain('rawproviderpayload')
    expect(text).not.toContain('providerplayerid')
    expect(text).not.toContain('sportsdataio')
    expect(text).not.toContain('recommendation')
    expect(text).not.toContain('reasoning')
    expect(text).not.toContain('llm')
    expect(text).not.toContain('start this player')
    expect(text).not.toContain('waiver priority')
    expect(text).not.toContain('make this trade')
    expect(text).not.toContain('collusion')
  })
})
