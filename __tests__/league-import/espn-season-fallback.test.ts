// @vitest-environment node
/**
 * ESPN keys an NFL fantasy league on the year its season STARTS. Sync and the legacy guest read used
 * to ask for the calendar year only, so an un-renewed league 404'd for most of the offseason and
 * January read the wrong season. Both now try the importer's season candidates in order.
 * `fetch` is stubbed; nothing here reaches ESPN.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/prisma', () => ({ prisma: {} }))

import {
  EspnApiResponseError,
  clearEspnResponseCache,
  espnCurrentFantasySeason,
  espnDefaultSeasonCandidates,
  fetchEspnLeagueJsonFirstSeason,
} from '@/lib/league-import/espn/espnFantasyClient'
import { espnSeasonCandidates } from '@/lib/league-import/espn/EspnLeagueFetchService'
import { fetchEspnLeague as fetchEspnLeagueForSync } from '@/lib/league-sync-core'
import { fetchEspnLeague as fetchEspnLeagueLegacy } from '@/lib/espn-client'

const JAN_2027 = new Date(2027, 0, 15)
const MAR_2027 = new Date(2027, 2, 10)
const SEP_2026 = new Date(2026, 8, 20)

const SWID = '{ABCD1234-EF56-7890-ABCD-1234567890AB}'
const S2 = `AEB${'k3Pq9ZtW1xYv%2B7mN0rLs'.repeat(14)}%3D%3D`

function league(season: number) {
  return {
    id: 123,
    seasonId: season,
    settings: { name: `League ${season}`, size: 2 },
    teams: [
      { id: 1, name: 'A', roster: { entries: [] } },
      { id: 2, name: 'B', roster: { entries: [] } },
    ],
  }
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
}

/** Answers per season in the URL; a season with no entry 404s. */
function espnBySeason(answers: Record<number, number | 'league'>) {
  return vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input)
    const season = Number(/\/seasons\/(\d{4})\//.exec(url)?.[1])
    const answer = answers[season]
    if (answer === 'league') return json(league(season))
    return json({ messages: ['nope'] }, typeof answer === 'number' ? answer : 404)
  })
}

function seasonsRequested(fetchImpl: ReturnType<typeof vi.fn>): number[] {
  return fetchImpl.mock.calls.map((c) => Number(/\/seasons\/(\d{4})\//.exec(String(c[0]))?.[1]))
}

beforeEach(() => clearEspnResponseCache())
afterEach(() => vi.unstubAllGlobals())

describe('espnDefaultSeasonCandidates', () => {
  it('tries last season first in January, while the playoffs may still be on', () => {
    expect(espnDefaultSeasonCandidates(JAN_2027)).toEqual([2026, 2027])
    expect(espnCurrentFantasySeason(JAN_2027)).toBe(2026)
  })

  it('tries this year first the rest of the year, then the un-renewed league', () => {
    expect(espnDefaultSeasonCandidates(MAR_2027)).toEqual([2027, 2026])
    expect(espnDefaultSeasonCandidates(SEP_2026)).toEqual([2026, 2025])
  })

  it('is what the importer uses for a bare id, and an explicit season is never second-guessed', () => {
    expect(espnSeasonCandidates({ leagueId: '1', season: 2027, seasonExplicit: false }, JAN_2027)).toEqual([2026, 2027])
    expect(espnSeasonCandidates({ leagueId: '1', season: 2024, seasonExplicit: true }, JAN_2027)).toEqual([2024])
  })
})

describe('fetchEspnLeagueJsonFirstSeason', () => {
  it('moves past a 404 to the next season', async () => {
    const fetchImpl = espnBySeason({ 2026: 'league' })
    const found = await fetchEspnLeagueJsonFirstSeason(
      { seasons: [2027, 2026], leagueId: '123', views: ['mTeam'] },
      { fetchImpl },
    )
    expect(found.season).toBe(2026)
    expect(seasonsRequested(fetchImpl)).toEqual([2027, 2026])
  })

  it('stops on a private-league answer instead of trying another season', async () => {
    const fetchImpl = espnBySeason({ 2027: 403, 2026: 'league' })
    await expect(
      fetchEspnLeagueJsonFirstSeason({ seasons: [2027, 2026], leagueId: '123', views: ['mTeam'] }, { fetchImpl }),
    ).rejects.toMatchObject({ status: 403 })
    expect(seasonsRequested(fetchImpl)).toEqual([2027])
  })

  it('throws the 404 when no season has the league', async () => {
    const fetchImpl = espnBySeason({})
    const error = await fetchEspnLeagueJsonFirstSeason(
      { seasons: [2027, 2026], leagueId: '123', views: ['mTeam'] },
      { fetchImpl },
    ).catch((e) => e)
    expect(error).toBeInstanceOf(EspnApiResponseError)
    expect(error.status).toBe(404)
  })
})

describe('/api/league/sync ESPN read', () => {
  it('syncs last season in the offseason when the league has not been renewed', async () => {
    const fetchImpl = espnBySeason({ 2026: 'league' })
    vi.stubGlobal('fetch', fetchImpl)
    const payload = await fetchEspnLeagueForSync('123', SWID, S2, MAR_2027)
    expect(payload.season).toBe(2026)
    expect(payload.name).toBe('League 2026')
    expect(seasonsRequested(fetchImpl)).toEqual([2027, 2026])
  })

  it('reads the season still being played in January, not the new calendar year', async () => {
    const fetchImpl = espnBySeason({ 2026: 'league', 2027: 'league' })
    vi.stubGlobal('fetch', fetchImpl)
    const payload = await fetchEspnLeagueForSync('123', SWID, S2, JAN_2027)
    expect(payload.season).toBe(2026)
    expect(seasonsRequested(fetchImpl)).toEqual([2026])
  })

  it('names both seasons when neither has the league', async () => {
    vi.stubGlobal('fetch', espnBySeason({}))
    await expect(fetchEspnLeagueForSync('123', SWID, S2, MAR_2027)).rejects.toThrow(
      'ESPN league 123 was not found for 2027 or 2026.',
    )
  })

  it('keeps the cookie message for a refused read, and the message carries no cookie', async () => {
    vi.stubGlobal('fetch', espnBySeason({ 2027: 401 }))
    const error = await fetchEspnLeagueForSync('123', SWID, S2, MAR_2027).catch((e) => e)
    expect(error.message).toBe('Failed to fetch ESPN league — check your SWID and ESPN_S2 cookies')
    expect(error.message).not.toContain('ABCD1234')
  })
})

describe('legacy guest read (lib/espn-client)', () => {
  it('falls back a season when none was given', async () => {
    const fetchImpl = espnBySeason({ 2026: 'league' })
    vi.stubGlobal('fetch', fetchImpl)
    const result = await fetchEspnLeagueLegacy('123', undefined, MAR_2027)
    expect(result.seasonId).toBe(2026)
    expect(result.numTeams).toBe(2)
  })

  it('asks only for the season it was given', async () => {
    const fetchImpl = espnBySeason({ 2026: 'league' })
    vi.stubGlobal('fetch', fetchImpl)
    await expect(fetchEspnLeagueLegacy('123', 2027, MAR_2027)).rejects.toThrow(/League not found/)
    expect(seasonsRequested(fetchImpl)).toEqual([2027])
  })
})
