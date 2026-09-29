/**
 * @vitest-environment node
 *
 * 🛑 A Sleeper-space starter is named, slotted and injured from HIS row — never from a Rolling
 * Insights row that shares the number. RI writes its own ids into `SportsPlayer.externalId`: Sleeper
 * 9228 is Bryce Young; RI 9228 is Michael Tarquin, an offensive tackle. This scan read
 * `externalId IN ids OR sleeperId IN ids` and keyed its map by both columns, so the RI row could
 * overwrite Young — turning his Out into nothing and his QB slot into "an OT is not eligible for QB".
 * The mock database honours the query's `where`, as Postgres does.
 */
import { describe, expect, it, vi } from 'vitest'

type Row = { externalId: string; sleeperId: string | null; source: string; name: string; position: string; status: string | null }
const ROWS: Row[] = [
  // Sleeper's own row: the real starter, ruled Out.
  { externalId: 'sleeper:9228', sleeperId: '9228', source: 'sleeper', name: 'Bryce Young', position: 'QB', status: 'Out' },
  // Rolling Insights' row for a different person that happens to carry 9228 as ITS id.
  { externalId: '9228', sleeperId: null, source: 'rolling_insights', name: 'Michael Tarquin', position: 'OT', status: null },
]
type Clause = { sleeperId?: { in: string[] }; externalId?: { in: string[] } }

vi.mock('@/lib/prisma', () => ({
  prisma: {
    sportsPlayer: {
      findMany: vi.fn(async ({ where }: { where: { OR: Clause[] } }) =>
        ROWS.filter((r) =>
          where.OR.some(
            (c) =>
              (r.sleeperId != null && (c.sleeperId?.in.includes(r.sleeperId) ?? false)) ||
              (c.externalId?.in.includes(r.externalId) ?? false),
          ),
        ),
      ),
    },
  },
}))
vi.mock('@/lib/multi-sport/MultiSportRosterService', () => ({
  getRosterTemplateForLeague: vi.fn(async () => ({ slots: [{ slotName: 'QB', starterCount: 1 }] })),
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

describe('scanNativeLeagueLineup — a Sleeper-space starter whose id an RI row also carries', () => {
  it('flags Bryce Young as the injured starter, and never names the offensive tackle', async () => {
    const { actions } = await scanNativeLeagueLineup({
      leagueId: 'L1',
      leagueName: 'League',
      sport: 'NFL' as never,
      platform: 'manual',
      bestBallMode: false,
      playerData: { players: ['9228'], starters: ['9228'], lineup_sections: { starters: ['9228'] } },
      thresholds: THRESHOLDS,
    })
    expect(actions.map((a) => [a.reasonType, a.playerName])).toEqual([['injured_starter', 'Bryce Young']])
  })
})
