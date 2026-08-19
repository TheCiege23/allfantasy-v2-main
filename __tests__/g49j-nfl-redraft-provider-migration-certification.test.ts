import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  buildNflRedraftProviderCertificationReport,
  resolveNflRedraftCanonicalFantasyValuation,
  resolveNflRedraftCanonicalHeadshot,
  resolveNflRedraftCanonicalWeather,
  type NflRedraftProductionProviderAdapter,
  type NflRedraftProviderNodeId,
} from '@/lib/nfl-provider'

const root = resolve(__dirname, '..')

function read(rel: string): string {
  return readFileSync(resolve(root, rel), 'utf8')
}

function adapter(
  providerId: NflRedraftProviderNodeId,
  data: Record<string, unknown> | null,
  options: {
    cacheUsed?: boolean
    fallbackUsed?: boolean
    terminal?: boolean
    freshnessStatus?: 'available' | 'missing' | 'stale' | 'unknown'
  } = {},
): NflRedraftProductionProviderAdapter {
  return async (request) => ({
    providerId,
    capability: request.capability,
    canonicalData: data,
    sourceTimestampIso: '2026-09-13T18:00:00.000Z',
    fetchedAtIso: '2026-09-13T18:01:00.000Z',
    freshnessStatus: options.freshnessStatus ?? (data ? 'available' : 'missing'),
    fallbackUsed: options.fallbackUsed ?? false,
    cacheUsed: options.cacheUsed ?? false,
    healthStatus: options.fallbackUsed ? 'DEGRADED' : 'ACTIVE',
    warnings: [],
    terminal: options.terminal,
    realIntegration: true,
    integrationName: `${providerId}:g49j-test`,
  })
}

function expectNoProviderLeak(value: unknown) {
  const text = JSON.stringify(value)
    .toLowerCase()
    .replace(/rawproviderpayloadexposed":false/g, '')
    .replace(/providersecretsexposed":false/g, '')
  expect(text).not.toContain('rawproviderpayload')
  expect(text).not.toContain('api_key')
  expect(text).not.toContain('client_secret')
  expect(text).not.toContain('bearer ')
}

describe('G49J NFL redraft provider migration and certification', () => {
  it('resolves NFL headshots through the canonical G49H media resolver', async () => {
    const result = await resolveNflRedraftCanonicalHeadshot(
      { name: 'Bijan Robinson', team: 'ATL', position: 'RB' },
      {
        env: { THESPORTSDB_API_KEY: 'configured' },
        adapters: {
          thesportsdb: {
            headshots: adapter('thesportsdb', {
              headshotUrl: 'https://www.thesportsdb.com/images/media/player/cutout/bijan.png',
              rawProviderPayload: { secret: 'nope' },
            }),
          },
        },
      },
    )

    expect(result).toMatchObject({
      imageUrl: 'https://www.thesportsdb.com/images/media/player/cutout/bijan.png',
      source: 'sportsdb',
      confidence: 'name_team_position',
      selectedProvider: 'thesportsdb',
      rawProviderPayloadExposed: false,
      providerSecretsExposed: false,
    })
    expectNoProviderLeak(result)
  })

  it('returns honest default fallback when TheSportsDB media is unavailable', async () => {
    const result = await resolveNflRedraftCanonicalHeadshot(
      { name: 'Amon-Ra St. Brown', team: 'DET', position: 'WR' },
      {
        adapters: {
          default_avatar: {
            headshots: adapter('default_avatar', {
              headshotUrl: null,
              fallbackKind: 'generic-player',
            }, { fallbackUsed: true, terminal: true, freshnessStatus: 'missing' }),
          },
        },
      },
    )

    expect(result).toMatchObject({
      imageUrl: null,
      source: 'none',
      confidence: 'none',
      selectedProvider: 'default_avatar',
      fallbackUsed: true,
      evidenceReady: true,
    })
  })

  it('resolves team weather through the canonical weather resolver and hides outages safely', async () => {
    const available = await resolveNflRedraftCanonicalWeather(
      { team: 'BUF' },
      {
        env: { OPENWEATHER_API_KEY: 'configured' },
        adapters: {
          openweather: {
            weather: adapter('openweather', {
              stadium: { name: 'Highmark Stadium', roofType: 'outdoor' },
              weather: {
                condition: 'Snow showers',
                temperatureF: 31,
                windSpeedMph: 18,
                precipitationType: 'snow',
                unavailable: false,
              },
            }),
          },
        },
      },
    )
    const outage = await resolveNflRedraftCanonicalWeather(
      { team: 'BUF' },
      {
        adapters: {
          hidden: {
            weather: adapter('hidden', null, { fallbackUsed: true, terminal: true, freshnessStatus: 'missing' }),
          },
        },
      },
    )

    expect(available).toMatchObject({
      source: 'openweather',
      unavailable: false,
      weather: { condition: 'Snow showers', temperatureF: 31 },
    })
    expect(outage).toMatchObject({
      source: 'hidden',
      unavailable: true,
      fallbackUsed: true,
    })
  })

  it('resolves single-player FantasyCalc values through canonical valuation resolver with cache fallback', async () => {
    const result = await resolveNflRedraftCanonicalFantasyValuation(
      { playerName: 'CeeDee Lamb' },
      {
        adapters: {
          fantasycalc: {
            fantasy_valuations: adapter('fantasycalc', {
              fantasyValuation: { value: 9200, redraftValue: 8800, trend30Day: 120 },
              intelligence: { ranking: { adp: 4.2, fantasyRank: 5 } },
              providerPlayerId: 'fc-raw-id',
            }),
          },
        },
      },
    )

    expect(result).toMatchObject({
      source: 'fantasycalc',
      unavailable: false,
      fantasyValuation: { value: 9200, redraftValue: 8800 },
      rawProviderPayloadExposed: false,
      providerSecretsExposed: false,
    })
    expectNoProviderLeak(result)
  })

  it('keeps route migrations pointed at canonical services without changing deferred legacy shapes', () => {
    const headshot = read('lib/player-assets/resolvePlayerHeadshot.ts')
    const weather = read('app/api/sports/weather/route.ts')
    const fantasycalc = read('app/api/fantasycalc/route.ts')

    expect(headshot).toMatch(/resolveNflRedraftCanonicalHeadshot/)
    expect(headshot).toMatch(/const csPlayers = sport === 'NFL' \? \[\] : await fetchClearSportsPlayers\(sport\)/)
    expect(weather).toMatch(/resolveNflRedraftCanonicalWeather/)
    expect(weather).toMatch(/canonical: true/)
    expect(fantasycalc).toMatch(/resolveNflRedraftCanonicalFantasyValuation/)
    expect(fantasycalc).toMatch(/action === 'player'/)
    expect(fantasycalc).toMatch(/readFantasyCalcValuesFromDb/)
  })

  it('certifies provider-correct domains and outage behavior without recommendations or AI fields', () => {
    const report = buildNflRedraftProviderCertificationReport({
      generatedAtIso: '2026-09-13T18:05:00.000Z',
    })

    expect(report.providerCorrect).toBe(true)
    expect(report.checks.map((check) => check.domain)).toEqual([
      'player_identity',
      'player_metadata',
      'headshots',
      'logos',
      'schedules',
      'weather',
      'fantasy_values',
      'evidence_packets',
      'premium_services',
      'runtime',
    ])
    expect(report.checks.every((check) =>
      check.providerStage &&
      check.orchestratorStage &&
      check.canonicalModelStage &&
      check.evidenceStage &&
      check.runtimeStage &&
      check.uiStage &&
      check.certified,
    )).toBe(true)
    expect(report.outageScenarios).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ providerId: 'fantasycalc', runtimeSurvives: true, fallbackWorks: true }),
        expect.objectContaining({ providerId: 'api_sports', runtimeSurvives: true, fallbackWorks: true }),
        expect.objectContaining({ providerId: 'thesportsdb', runtimeSurvives: true, fallbackWorks: true }),
        expect.objectContaining({ providerId: 'openweather', runtimeSurvives: true, fallbackWorks: true }),
        expect.objectContaining({ providerId: 'clearsports', runtimeSurvives: true, fallbackWorks: true }),
        expect.objectContaining({ providerId: 'rolling_insights', runtimeSurvives: true, fallbackWorks: true }),
      ]),
    )
    expect(JSON.stringify(report).toLowerCase()).not.toContain('recommendation')
    expect(JSON.stringify(report).toLowerCase()).not.toContain('llm')
    expectNoProviderLeak(report)
  })
})
