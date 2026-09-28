/**
 * @vitest-environment node
 *
 * 🛑 A foreign league's starters must never be named, slotted or injured from a Sleeper-id lookup.
 *
 * `computeLineupActionsForUser` routes every non-Sleeper league — Fleaflicker, MFL, Fantrax, Yahoo —
 * to `scanNativeLeagueLineup`. Those rosters hold that provider's own ids, short numbers that collide
 * with real Sleeper ids (51 of 248 on the one production Fleaflicker league), and the import writes
 * `lineup_sections.starters` as BARE ids, so the section read finds no name/position/status and the
 * `SportsPlayer` row fills every field: "Wrong Player is not eligible for QB", "Replace inactive
 * starter" — about somebody else. The control shows the same ids ARE resolved in a native league.
 */
import { describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/prisma', () => ({
  prisma: {
    sportsPlayer: {
      findMany: vi.fn(async ({ where }: { where: { OR: Array<{ sleeperId?: { in: string[] } }> } }) => {
        const asked = where.OR.find((c) => c.sleeperId)?.sleeperId?.in ?? []
        const table = [
          { externalId: 'ri-1', sleeperId: '6038', name: 'Wrong Player', position: 'K', status: null },
          { externalId: 'ri-2', sleeperId: '6040', name: 'Wrong Injured', position: 'QB', status: 'Out' },
        ]
        return table.filter((r) => asked.includes(r.sleeperId))
      }),
    },
  },
}))
vi.mock('@/lib/multi-sport/MultiSportRosterService', () => ({
  getRosterTemplateForLeague: vi.fn(async () => ({
    slots: [
      { slotName: 'QB', starterCount: 1 },
      { slotName: 'QB', starterCount: 1 },
    ],
  })),
}))

import { scanNativeLeagueLineup } from '@/lib/lineup-actions/nativeLineupScan'

const THRESHOLDS = {
  minimumStartSitConfidence: 0.72,
  minimumProjectedGain: 0.5,
  urgentLockWindowMinutes: 60,
  nearLockWindowHours: 24,
  countQuestionableAsAction: false,
  countDoubtfulAsAction: true,
  dailyLineupSports: [],
  bestBallSkipManual: true,
}

/* The shape the import bootstrap writes: bare string ids, in `starters` and in `lineup_sections`. */
const PLAYER_DATA = { players: ['6038', '6040'], starters: ['6038', '6040'], lineup_sections: { starters: ['6038', '6040'] } }

const scan = (platform: string) =>
  scanNativeLeagueLineup({
    leagueId: 'L1',
    leagueName: 'League',
    sport: 'NFL' as never,
    platform,
    bestBallMode: false,
    playerData: PLAYER_DATA,
    thresholds: THRESHOLDS,
  })

describe('scanNativeLeagueLineup — a foreign league’s starters', () => {
  it('🛑 a Fleaflicker starter id that equals a Sleeper id is never named, slotted or injured as that player', async () => {
    const { actions } = await scan('fleaflicker')
    expect(actions.map((a) => a.playerName)).not.toContain('Wrong Player')
    expect(actions.map((a) => a.playerName)).not.toContain('Wrong Injured')
    expect(actions.filter((a) => a.reasonType === 'illegal_slot' || a.reasonType === 'injured_starter')).toEqual([])
    /* Both slots are filled; the stripped lookup must not turn into a false "empty slot". */
    expect(actions.filter((a) => a.reasonType === 'native_starter_gap')).toEqual([])
  })

  it('🛑 the same for MFL, Fantrax and Yahoo', async () => {
    for (const platform of ['mfl', 'fantrax', 'yahoo']) {
      const { actions } = await scan(platform)
      expect(actions).toEqual([])
    }
  })

  it('CONTROL: in a native league the same ids ARE resolved — and flagged', async () => {
    const { actions } = await scan('manual')
    expect(actions.map((a) => [a.reasonType, a.playerName])).toEqual([
      ['illegal_slot', 'Wrong Player'],
      ['injured_starter', 'Wrong Injured'],
    ])
  })
})
