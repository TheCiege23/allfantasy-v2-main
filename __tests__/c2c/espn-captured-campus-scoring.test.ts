// @vitest-environment node
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { parseEspnCollegeBoxScore } from '@/lib/espn/espnNcaabBoxScore'
import { parseEspnCollegeScoreboard } from '@/lib/espn/espnNcaabScoreboard'

const fixture = (name: string) => JSON.parse(readFileSync(`contracts/espn/fixtures/${name}`, 'utf8'))

describe('captured ESPN college basketball scoring evidence', () => {
  it('parses both teams and every player from a complete final box', () => {
    const body = fixture('summary.NCAAB.event401825532.json')
    const box = parseEspnCollegeBoxScore(body, '401825532')
    expect(box).toMatchObject({ status: 'final', complete: true, rejected: 0 })
    expect(box.players).toHaveLength(29)
    expect(new Set(box.players.map(player => player.teamId)).size).toBe(2)
    for (const competitor of body.header.competitions[0].competitors) {
      const teamId = String(competitor.team.id)
      const playerPoints = box.players.filter(player => player.teamId === teamId).reduce((sum, player) => sum + (player.stats?.pts ?? 0), 0)
      expect(playerPoints).toBe(Number(competitor.score))
    }
    expect(box.players.find(player => player.espnId === '5107782')?.stats).toMatchObject({ pts: 14, reb: 3, ast: 15, threes: 0 })
  })
  it('parses every event on the captured Division I scoreboard', () => {
    const body = fixture('scoreboard.NCAAB.20260221.json')
    const parsed = parseEspnCollegeScoreboard(body)
    expect(parsed.rejected).toBe(0)
    expect(parsed.games).toHaveLength(148)
    expect(parsed.games.some(game => game.id === '401825532')).toBe(true)
  })
})
