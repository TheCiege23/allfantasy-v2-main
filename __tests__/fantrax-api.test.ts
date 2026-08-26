import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  getFantraxLeagueInfo,
  getFantraxPlayerIds,
  getFantraxTeamRosters,
  resolveRosters,
} from '@/lib/league-import/fantrax/fantraxApi'

/**
 * ⚠ FANTRAX ANSWERS HTTP 200 FOR ERRORS. A missing league returns
 * `200 {"error":{"message":"Invalid 'leagueId' parameter - league ID: x not found"}}`,
 * so `res.ok` is TRUE and a client that checks only the status imports an empty
 * league and reports success. Every shape below is one this API actually
 * produced against the live service on 2026-08-26.
 */

const NOT_FOUND_BODY = JSON.stringify({
  error: { onScreen: false, code: 'WARNING', message: "Invalid 'leagueId' parameter - league ID: nope not found" },
})

function resp(status: number, body: string) {
  return { ok: status >= 200 && status < 300, status, text: async () => body }
}

afterEach(() => vi.unstubAllGlobals())

describe('a 200 carrying an error is not a league', () => {
  it('treats the 200-with-error body as not_found, not as success', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(resp(200, NOT_FOUND_BODY)))
    const res = await getFantraxLeagueInfo('nope')

    expect(res.ok).toBe(false)
    if (res.ok) return
    expect(res.failure.kind).toBe('not_found')
    expect(res.failure.message).toMatch(/not found/i)
  })

  /**
   * ⚠ An uppercased id returns HTTP 400 with a web page, so JSON.parse throws
   * rather than yielding an error object. League ids are case-sensitive.
   */
  it('an HTML response is reported as such, and names the case-sensitivity', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(resp(400, '<!DOCTYPE html>\n<html>...')))
    const res = await getFantraxLeagueInfo('V2KZEDYPMM8JP61B')

    expect(res.ok).toBe(false)
    if (res.ok) return
    expect(res.failure.kind).toBe('not_json')
    expect(res.failure.message).toMatch(/case-sensitive/i)
  })

  it('a real league resolves', async () => {
    const body = JSON.stringify({ leagueName: 'My C2C League', seasonYear: 2026, teamInfo: { a: { id: 'a', name: 'T' } } })
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(resp(200, body)))
    const res = await getFantraxLeagueInfo('v2kzedypmm8jp61b')

    expect(res.ok).toBe(true)
    if (!res.ok) return
    expect(res.data.leagueName).toBe('My C2C League')
  })

  it('a network failure is reported rather than swallowed', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('ECONNRESET')))
    const res = await getFantraxLeagueInfo('x')
    expect(res.ok).toBe(false)
    if (res.ok) return
    expect(res.failure.kind).toBe('network')
  })
})

describe('rosters', () => {
  const ROSTERS = {
    t1: { teamName: 'Ciege82', rosterItems: [{ id: '05z2o', position: 'WR', status: 'ACTIVE' }] },
  }

  it('accepts both the nested and flat payload shapes', async () => {
    for (const body of [JSON.stringify({ rosters: ROSTERS }), JSON.stringify(ROSTERS)]) {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(resp(200, body)))
      const res = await getFantraxTeamRosters('v2kzedypmm8jp61b')
      expect(res.ok).toBe(true)
      if (!res.ok) return
      expect(Object.keys(res.data)).toEqual(['t1'])
    }
  })

  /**
   * ⚠ Guessing one shape and getting {} back would look exactly like a league
   * with no rosters, which is why empty is an explicit failure.
   */
  it('no teams is a failure, not an empty league', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(resp(200, '{}')))
    const res = await getFantraxTeamRosters('v2kzedypmm8jp61b')
    expect(res.ok).toBe(false)
    if (res.ok) return
    expect(res.failure.message).toMatch(/no team rosters/i)
  })
})

describe('player map', () => {
  it('an empty map is a failure rather than a league of unknown players', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(resp(200, '{}')))
    const res = await getFantraxPlayerIds('CFB')
    expect(res.ok).toBe(false)
  })

  it('resolves a populated map', async () => {
    const map = { '05z2o': { fantraxId: '05z2o', name: 'Sparks, Beau', team: 'TxSt', position: 'WR' } }
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(resp(200, JSON.stringify(map))))
    const res = await getFantraxPlayerIds('CFB')
    expect(res.ok).toBe(true)
  })
})

describe('joining rosters to the player map', () => {
  const rosters = {
    t1: {
      teamName: 'Ciege82',
      rosterItems: [
        { id: 'known', position: 'WR', status: 'ACTIVE' },
        { id: 'missing', position: 'RB', status: 'RESERVE' },
      ],
    },
  }
  const map = { known: { fantraxId: 'known', name: 'Sparks, Beau', team: 'TxSt', position: 'WR' } }

  /**
   * ⚠ Measured 96% (447/466) on the real league — about one player in twenty is
   * not in the map. Dropping them would silently shrink every roster.
   */
  it('keeps an unresolved player with a null name rather than dropping him', () => {
    const [team] = resolveRosters(rosters, map)
    expect(team.players).toHaveLength(2)
    expect(team.players[1].name).toBeNull()
    expect(team.players[1].fantraxId).toBe('missing')
  })

  it('reports how many it could name, so partial resolution is visible', () => {
    const [team] = resolveRosters(rosters, map)
    expect(team.resolved).toBe(1)
    expect(team.total).toBe(2)
    expect(team.teamName).toBe('Ciege82')
  })

  /**
   * ⚠ College rosters resolved against the NFL map returned 0 of 38 on the real
   * league. Wrong map looks exactly like an empty league.
   */
  it('the wrong sport map resolves nothing, which must stay visible', () => {
    const [team] = resolveRosters(rosters, {})
    expect(team.resolved).toBe(0)
    expect(team.total).toBe(2)
  })
})
