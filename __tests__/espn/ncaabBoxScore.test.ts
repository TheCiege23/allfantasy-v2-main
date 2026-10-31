import { describe, expect, it, vi } from 'vitest'
import { parseEspnCollegeBoxScore } from '@/lib/espn/espnNcaabBoxScore'
import { fetchEspnCollegeBoxScore } from '@/lib/espn/espnNcaabFetch'
import { EspnBlockedError } from '@/lib/espn/espnNcaabFetch'
import { rawNcaab } from '@/__tests__/fixtures/espn-ncaab-summary'
import trimmedProviderCapture from '@/contracts/espn/fixtures/summary.NCAAB.event401825532.json'

function measuredFixture() {
  const value = rawNcaab()
  let id = 100
  for (const team of value.boxscore.players) for (const group of team.statistics) for (const row of group.athletes) row.athlete.id = String(id++)
  return value
}
describe('ESPN college basketball box score', () => {
  it('does not treat the key-union capture as a complete two-team box', () => {
    expect(parseEspnCollegeBoxScore(trimmedProviderCapture, '401825532').complete).toBe(false)
  })
  it('parses explicit provider IDs, scoring labels, made threes, and DNPs', () => {
    const result = parseEspnCollegeBoxScore(measuredFixture(), '401825532')
    expect(result).toMatchObject({ status: 'final', complete: true, rejected: 0 })
    expect(result.players[0]).toEqual({ espnId: '100', teamId: '356', didNotPlay: false, stats: { pts: 19, reb: 4, ast: 3, to: 2, stl: 0, blk: 0, threes: 1 } })
    expect(result.players[3]).toMatchObject({ espnId: '103', didNotPlay: true, stats: null })
  })
  it('refuses missing labels, malformed lines, duplicate players, and wrong events', () => {
    const missing = measuredFixture(); missing.boxscore.players[0].statistics[0].labels = ['PTS']
    expect(parseEspnCollegeBoxScore(missing, '401825532').complete).toBe(false)
    const bad = measuredFixture(); bad.boxscore.players[0].statistics[0].athletes[0].stats[2] = 'bad'; bad.boxscore.players[0].statistics[0].athletes[0].stats[3] = 'bad'
    expect(parseEspnCollegeBoxScore(bad, '401825532').rejected).toBeGreaterThan(0)
    const duplicate = measuredFixture(); duplicate.boxscore.players[1].statistics[0].athletes[0].athlete.id = '100'
    expect(parseEspnCollegeBoxScore(duplicate, '401825532').complete).toBe(false)
    expect(() => parseEspnCollegeBoxScore({ header: { id: '2' } }, '1')).toThrow('mismatch')
  })
  it('stops the caller on ESPN 403', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({ ok: false, status: 403 }) as unknown as typeof fetch
    await expect(fetchEspnCollegeBoxScore('401825532', { fetchImpl })).rejects.toBeInstanceOf(EspnBlockedError)
  })
})
