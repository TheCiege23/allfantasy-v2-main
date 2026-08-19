import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  fetchImportPreview,
  submitImportCreation,
} from '@/lib/league-import/LeagueCreationImportSubmissionService'
import * as providerUiConfig from '@/lib/league-import/provider-ui-config'

describe('LeagueCreationImportSubmissionService', () => {
  const fetchMock = vi.fn()
  let availabilitySpy: ReturnType<typeof vi.spyOn> | null = null

  beforeEach(() => {
    fetchMock.mockReset()
    vi.stubGlobal('fetch', fetchMock)
  })

  afterEach(() => {
    availabilitySpy?.mockRestore()
    availabilitySpy = null
    vi.unstubAllGlobals()
  })

  it('routes espn preview through the unified preview endpoint', async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ league: { name: 'ESPN Test' } }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    )

    const result = await fetchImportPreview('espn', ' 12345 ')
    expect(result.ok).toBe(true)
    expect(fetchMock).toHaveBeenCalledTimes(1)

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('/api/leagues/import/preview')
    expect(init.method).toBe('POST')
    expect(JSON.parse(String(init.body))).toEqual({
      provider: 'espn',
      sourceId: '12345',
    })
  })

  it('routes yahoo create through import commit endpoint', async () => {
    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({
          league: { id: 'y1', name: 'Yahoo League', sport: 'NHL' },
        }),
        {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }
      )
    )

    const result = await submitImportCreation('yahoo', ' 461.l.12345 ', 'user-1')
    expect(result.ok).toBe(true)
    expect(fetchMock).toHaveBeenCalledTimes(1)

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('/api/leagues/import/commit')
    expect(init.method).toBe('POST')
    expect(JSON.parse(String(init.body))).toEqual({
      provider: 'yahoo',
      sourceId: '461.l.12345',
    })
  })

  it('routes sleeper preview through the unified preview endpoint', async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ league: { name: 'Sleeper Test' } }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    )

    const result = await fetchImportPreview('sleeper', ' 123456 ')
    expect(result.ok).toBe(true)
    expect(fetchMock).toHaveBeenCalledTimes(1)

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('/api/leagues/import/preview')
    expect(init.method).toBe('POST')
    expect(JSON.parse(String(init.body))).toEqual({
      provider: 'sleeper',
      sourceId: '123456',
    })
  })

  it('routes sleeper create through /api/league/create import flags', async () => {
    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({
          league: { id: 'l1', name: 'Sleeper League', sport: 'NFL' },
        }),
        {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }
      )
    )

    const result = await submitImportCreation('sleeper', ' 123456 ', 'user-1')
    expect(result.ok).toBe(true)
    expect(fetchMock).toHaveBeenCalledTimes(1)

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('/api/league/create')
    expect(init.method).toBe('POST')
    expect(JSON.parse(String(init.body))).toEqual({
      platform: 'sleeper',
      createFromSleeperImport: true,
      sleeperLeagueId: '123456',
    })
  })

  it('routes mfl create through import commit endpoint', async () => {
    // mfl's sourceId format ("year:id") is worth its own case even though
    // provider-ui-config.ts now marks mfl unavailable pending a credential UI
    // (docs/redraft/G61_IMPORT_PROVIDER_AVAILABILITY_RECONCILIATION.md) — this
    // test is about routing/serialization, not availability policy.
    availabilitySpy = vi.spyOn(providerUiConfig, 'isImportProviderAvailable').mockReturnValue(true)
    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({
          league: { id: 'm1', name: 'MFL League', sport: 'NCAAF' },
        }),
        {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }
      )
    )

    const result = await submitImportCreation('mfl', ' 2026:12345 ', 'user-1')
    expect(result.ok).toBe(true)
    expect(fetchMock).toHaveBeenCalledTimes(1)

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('/api/leagues/import/commit')
    expect(init.method).toBe('POST')
    expect(JSON.parse(String(init.body))).toEqual({
      provider: 'mfl',
      sourceId: '2026:12345',
    })
  })

  it('fails gracefully when preview provider is unavailable', async () => {
    availabilitySpy = vi.spyOn(providerUiConfig, 'isImportProviderAvailable').mockReturnValue(false)

    const result = await fetchImportPreview('sleeper', '12345')
    expect(result.ok).toBe(false)
    expect(result.error).toMatch(/not yet available/i)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('fails gracefully when submit provider is unavailable', async () => {
    availabilitySpy = vi.spyOn(providerUiConfig, 'isImportProviderAvailable').mockReturnValue(false)

    const result = await submitImportCreation('sleeper', '12345', 'user-1')
    expect(result.ok).toBe(false)
    expect(result.error).toMatch(/not yet available/i)
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
