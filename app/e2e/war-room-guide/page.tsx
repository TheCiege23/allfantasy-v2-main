import { notFound } from 'next/navigation'
import AfCoreShell from '@/components/core-app/AfCoreShell'
import { Scout } from '@/components/core-app/screens/Scout'
import { GamePlan } from '@/components/core-app/screens/GamePlan'
import { WarCampaign } from '@/components/core-app/screens/WarCampaign'
import { WarChest } from '@/components/core-app/screens/WarChest'
import { WarStrategyBrief } from '@/components/core-app/screens/WarStrategyBrief'
import { WarTradeIdeas } from '@/components/core-app/screens/WarTradeIdeas'
import type { CoreDepthAccess } from '@/lib/core-app/coreDepthAccess'
import type { GameDayTriage } from '@/lib/core-app/gameDayTriage'
import type { ScoutData, ScoutStanding } from '@/lib/core-app/scout'
import type { WarCampaign as Campaign } from '@/lib/core-app/warRoomCampaign'
import type { WarChest as WarChestView } from '@/lib/core-app/warRoomWarChest'
import type { NextSeasonView } from '@/lib/core-app/warRoomNextSeason'
import type { WarTradesView } from '@/lib/core-app/warRoomTrades'

/**
 * DB-free render of a league's War Room (Scout) with the 2026-11-14 layout: the headline, your three moves,
 * then "More about this league" folded. Every team, manager and player here is SAMPLE data. Production is
 * refused here and by app/e2e/layout.tsx.
 *
 *   /e2e/war-room-guide                 a long shot: the road ahead is one sentence
 *   /e2e/war-room-guide?road=list       a game that matters: the per-game list
 */
const standing = (seed: number, w: number, l: number): ScoutStanding => ({
  seed,
  record: { wins: w, losses: l, ties: 0 },
  pointsFor: 2300 - seed * 40,
  pointsAgainst: 2000,
  form: seed < 6 ? ['W', 'W', 'L', 'W', 'W'] : ['L', 'L', 'W', 'L', 'L'],
  zone: seed <= 8 ? 'playoff' : 'out',
  gamesBack: seed <= 8 ? -1 : seed - 8,
  powerRank: seed,
})

const NAMES = ['Sample Champs', 'Sample Jaguars', 'Sample Petes', 'Sample Browns', 'Sample Dolphins', 'Sample Broncos', 'Sample Niners', 'Sample Texans', 'Sample Pats', 'Sample Raiders', 'Sample Baileys', 'Sample You', 'Sample Sisters', 'Sample Minnows']
const RECORDS: Array<[number, number]> = [[9, 0], [8, 1], [6, 3], [5, 4], [5, 4], [5, 4], [5, 4], [4, 5], [4, 5], [3, 6], [3, 6], [2, 7], [1, 8], [1, 8]]

const data: ScoutData = {
  league: { id: 'L-sample', name: 'Sample Dynasty', sport: 'NFL' },
  you: { managerId: 'm12', teamName: 'Sample You', standing: standing(12, 2, 7) },
  week: { seasonYear: 2026, week: 10 },
  opponent: { managerId: 'm5', teamName: 'Sample Dolphins', headToHead: null },
  managers: {
    available: true,
    data: NAMES.map((name, i) => ({
      managerId: `m${i + 1}`,
      teamName: name,
      ownerName: `Owner ${i + 1}`,
      avatarUrl: null,
      isYou: i === 11,
      isNextOpponent: i === 4,
      standing: standing(i + 1, RECORDS[i]![0], RECORDS[i]![1]),
      eliminated: null,
      picks: { count: 10 + (i % 4), early: 4 + (i % 3) },
    })),
  },
  basis: { available: true, data: { season: 2026, throughWeek: 9, seasonComplete: false, orderBasis: 'Order is winning percentage, then points for.' } },
  format: { kind: 'dynasty', elimination: false, bestBall: false, dynasty: true, picks: null },
} as ScoutData

const league = { leagueId: 'L-sample', leagueName: 'Sample Dynasty', platform: 'sleeper', platformLeagueId: null, season: 2026, teamId: null }
const triage: GameDayTriage = {
  week: { season: 2026, week: 10 },
  leaguesRead: 1,
  startersRead: 16,
  rows: [
    {
      player: { sport: 'NFL', externalId: 'p1', sleeperId: 'p1', name: 'Sample Receiver', position: 'WR', team: 'NYJ', imageUrl: null },
      status: { label: 'Questionable', tone: 'warn' },
      description: 'Sample note: expected to be cleared to play on Sunday.',
      reportedAt: null,
      leagues: [league],
      kickoff: '2026-11-15T18:00:00.000Z',
      noGame: false,
      inactive: null,
      bye: false,
    },
  ],
} as GameDayTriage

const open = {
  depth: 'trade_depth',
  unlocked: true,
  hasPlan: true,
  preLaunchFree: false,
  startsAt: '2027-01-01T00:00:00.000Z',
  planName: 'AF Pro',
  label: 'Trade depth',
  upgradePath: '/pricing',
} as CoreDepthAccess

const trades = {
  leagueId: 'L-sample',
  posture: 'bubble',
  tradeCenterHref: '/core/trades?league=L-sample',
  trades: {
    mode: 'win_now',
    rankedBy: 'playoff',
    basisWeek: { season: '2026', week: 10 },
    screened: 2816,
    ideas: [
      {
        partnerRosterId: 'm7',
        partnerName: 'Sample Niners',
        send: { id: 's', name: 'Sample Veteran RB', position: 'RB', team: 'BUF', age: 27 },
        receive: { id: 'r', name: 'Sample Young WR', position: 'WR', team: 'LV', age: 23 },
        youGainPerWeek: 3.1,
        partnerGainPerWeek: 4.2,
        playoffDelta: 0.4,
        titleDelta: 0,
        partnerPlayoffPct: 81,
      },
    ],
  },
} as unknown as WarTradesView

const game = (week: number, name: string, small: boolean, ifWin: number, ifLose: number) => ({
  week,
  opponent: { rosterId: name, name, wins: 5, losses: 4, ties: 0, playoffPct: 70 },
  ifWin,
  ifLose,
  swing: ifWin - ifLose,
  biggest: !small,
  small,
})

const chest: WarChestView = {
  kind: 'faab',
  budget: 1000,
  you: 449,
  rank: 11,
  known: 14,
  rows: NAMES.map((name, i) => ({ rosterId: `m${i + 1}`, name, isYou: i === 11, remaining: i === 11 ? 449 : 1000 - i * 60 })),
  weeksRemaining: 4,
  useIt: true,
} as WarChestView

const nextSeason = {
  kind: 'dynasty',
  window: 'rebuild',
  posture: 'sell_for_youth',
  contendScore: 27,
  avgStarterAge: 26.5,
  earlyPickCount: 6,
  facts: [
    'Record 2-7 (win% 0.22).',
    'Average starter age 26.5.',
    'Pick capital: 12 future pick(s), 6 early, tier total 87.5.',
    'Young-asset value share 22% (sustainability signal).',
  ],
  missing: [],
} as NextSeasonView

export default async function WarRoomGuideHarnessPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  if (process.env.NODE_ENV === 'production') notFound()
  const sp = await searchParams
  const road: Campaign =
    sp.road === 'list'
      ? { kind: 'games', playoffPct: 41, games: [game(11, 'Sample Petes', false, 58, 27), game(12, 'Sample Browns', true, 44, 40)], inProgressWeek: null, unpricedGames: 0, medianGame: false, tiebreak: null }
      : { kind: 'games', playoffPct: 0.3, games: [game(11, 'Sample Petes', true, 1, 0), game(12, 'Sample Browns', true, 1, 0), game(13, 'Sample Baileys', true, 1, 0)], inProgressWeek: null, unpricedGames: 0, medianGame: false, tiebreak: null }
  return (
    <AfCoreShell
      active="war-room"
      leagues={[]}
      selectedLeagueId={null}
      syncAge={{ label: 'just now', stale: false }}
      syncEligibleCount={0}
      comms={{ leagues: [], chimmyTokenCost: null, dockable: false, supportEmail: null }}
    >
      <div data-testid="war-room-guide-harness">
        <Scout
          data={data}
          gamePlanHref="/core/war-room?view=plan"
          matchupHref="/core/matchup?league=L-sample"
          standingsHref="/core/standings?league=L-sample"
          tradesHref="/core/trades?league=L-sample"
          leaguePlan={
            <GamePlan data={triage} nowIso="2026-11-15T01:20:00.000Z" weekHref="/core/week?league=L-sample" waiversHref="/core/waivers?league=L-sample" showHead={false} scope="league" />
          }
          tradeIdeas={<WarTradeIdeas view={trades} access={open} />}
          road={<WarCampaign view={road} />}
          chest={<WarChest view={chest} />}
          brief={<WarStrategyBrief format={null} nextSeason={nextSeason} />}
        />
      </div>
    </AfCoreShell>
  )
}
