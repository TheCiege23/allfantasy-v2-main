/**
 * Fixture answers for the redraft broadcast-deck harness (/e2e/redraft-league/deck/<tab>). Harness only:
 * app/e2e is notFound() in production (app/e2e/layout.tsx). Every shape is the route's own contract,
 * and the checklist and the manager cards go through the REAL builders (buildWeeklyChecklist,
 * managersToCheck), so a frame shows what those rules produce, not a hand-written list.
 */
import type { LeagueTeamSlot } from '@/app/dashboard/types'
import { buildWeeklyChecklist } from '@/lib/commissioner/weeklyChecklist'
import { managersToCheck, type CommishHealthSummary, type WeeklyChecklistResponse } from '@/lib/league-media/redraftDeck'

export const DECK_SPORTS = {
  NFL: { week: 9, total: 17, playoffStart: 15, deadline: 12, assets: [['RB', 'Bijan Robinson'], ['WR', 'Garrett Wilson'], ['TE', 'Sam LaPorta']] },
  NBA: { week: 4, total: 21, playoffStart: 19, deadline: 16, assets: [['PG', 'Tyrese Haliburton'], ['C', 'Alperen Sengun'], ['SF', 'Franz Wagner']] },
  NHL: { week: 5, total: 22, playoffStart: 20, deadline: 17, assets: [['C', 'Jack Hughes'], ['D', 'Quinn Hughes'], ['G', 'Igor Shesterkin']] },
  MLB: { week: 7, total: 26, playoffStart: 24, deadline: 20, assets: [['SS', 'Bobby Witt Jr.'], ['SP', 'Tarik Skubal'], ['OF', 'Julio Rodríguez']] },
  NCAAF: { week: 6, total: 15, playoffStart: 13, deadline: 9, assets: [['QB', 'Arch Manning'], ['RB', 'Jeremiyah Love'], ['WR', 'Jeremiah Smith']] },
  NCAAB: { week: 8, total: 18, playoffStart: 16, deadline: 12, assets: [['G', 'Darius Acuff'], ['F', 'Cameron Boozer'], ['C', 'Flory Bidunga']] },
  SOCCER: { week: 11, total: 38, playoffStart: 35, deadline: 26, assets: [['MID', 'Cole Palmer'], ['FWD', 'Bukayo Saka'], ['DEF', 'Trent Alexander-Arnold']] },
} as const

export type DeckSport = keyof typeof DECK_SPORTS
export type DeckState = 'season' | 'empty'

export const MANAGERS = [
  'Sunday Scaries', 'Taco Tuesday', 'Monday Night Misery', 'Waiver Wire Wizards', 'Bench Mob', 'The Commish',
  'Late Round Legends', 'Trade Deadline Thieves', 'Couch Coaches', 'Fourth & Long', 'Buzzer Beaters', 'Dynasty Dreams',
]

export function deckTeams(): LeagueTeamSlot[] {
  const records = [[7, 1], [6, 2], [5, 3], [5, 3], [5, 3], [4, 4], [4, 4], [3, 5], [3, 5], [2, 6], [2, 6], [2, 6]]
  return MANAGERS.map((teamName, i) => ({
    id: `team-${i}`,
    externalId: `r-${i}`,
    teamName,
    ownerName: teamName,
    avatarUrl: null,
    platformUserId: null,
    role: i === 0 ? 'commissioner' : 'member',
    isOrphan: false,
    claimedByUserId: i === 7 ? null : `user-${i}`,
    draftPosition: i + 1,
    wins: records[i][0],
    losses: records[i][1],
    ties: 0,
    pointsFor: 1180 - i * 31.4,
    pointsAgainst: 1010 + i * 12.2,
    currentRank: i + 1,
    faabRemaining: i === 2 ? 64 : 40 + i,
    waiverPriority: 12 - i,
    divisionId: null,
  }))
}

/** The viewer is team 2 ("Monday Night Misery"), so the KPI row and the "me" row have something to show. */
export const VIEWER_TEAM_ID = 'team-2'

export function thisWeekResponse(sport: DeckSport, now: number) {
  const cfg = DECK_SPORTS[sport]
  return {
    lineup: { week: cfg.week, lockAt: new Date(now + 2 * 86_400_000 + 5 * 3_600_000).toISOString(), locked: false, automatic: false, starters: 9, toFix: 1, questionable: 1, unresolved: 0 },
    waivers: { schedule: { dayOfWeek: 3, time: '03:00', timeZone: 'America/New_York' }, observed: true },
    tradeDeadline: { at: null, week: cfg.deadline },
  }
}

export function tradesPanelResponse(sport: DeckSport) {
  const [a, b, c] = DECK_SPORTS[sport].assets
  return {
    activeTrades: [
      {
        id: 'trade-1',
        direction: 'incoming',
        partnerName: MANAGERS[1],
        timestamp: '2026-10-29T18:20:00.000Z',
        sent: [{ id: 'p1', label: a[1], sublabel: a[0] }],
        received: [{ id: 'p2', label: b[1], sublabel: b[0] }, { id: 'p3', label: c[1], sublabel: c[0] }],
        status: 'pending',
        viewerIsReceiver: true,
        viewerIsProposer: false,
      },
    ],
    verdictContext: null,
  }
}

export function weeklyChecklistResponse(sport: DeckSport, leagueId: string, state: DeckState, now: Date): WeeklyChecklistResponse {
  if (state === 'empty') return { applies: false, reason: 'not_in_season' }
  const cfg = DECK_SPORTS[sport]
  return {
    applies: true,
    week: cfg.week,
    items: buildWeeklyChecklist(
      {
        leagueId,
        week: cfg.week,
        totalWeeks: cfg.total,
        playoffStartWeek: cfg.playoffStart,
        lastWeekMatchups: Array.from({ length: 6 }, () => ({ status: 'final' })),
        pendingClaims: [],
        processedClaimsLast7Days: 9,
        lineups: MANAGERS.map((teamName, i) => ({ teamName, required: 9, filled: i === 1 || i === 2 ? 8 : 9, unavailable: [] })),
        tradesAwaitingReview: 1,
        tradeDeadlineWeek: cfg.deadline,
        dues: null,
      },
      now,
    ),
  }
}

export function healthSummaryResponse(state: DeckState, now: Date): CommishHealthSummary {
  if (state === 'empty') {
    return {
      score: { available: false, reason: 'Not enough data to score this league yet — no score is shown rather than a guessed one.' },
      managers: [],
      managersRead: false,
    }
  }
  const ago = (days: number) => new Date(now.getTime() - days * 86_400_000).toISOString()
  const rows = MANAGERS.map((teamName, i) => ({
    rosterId: `r-${i}`,
    managerName: teamName,
    teamName,
    lineupsSet: i === 2 ? 7 : 9,
    expectedStarters: 9,
    lastActionAt: i === 1 ? ago(19) : i === 2 ? ago(9) : i === 7 ? ago(30) : ago(1),
    status: (i === 1 ? 'inactive' : i === 2 ? 'at_risk' : i === 7 ? 'inactive' : 'active') as 'inactive' | 'at_risk' | 'active',
  }))
  return {
    score: {
      available: true,
      score: 82,
      status: 'healthy',
      summary: 'Lineups are set and trades are moving.',
      confidencePct: 84,
      activeManagers: 11,
      totalManagers: 12,
      sub: { activity: 88, participation: 92, fairness: 78, sustainability: 74 },
      history: [],
    },
    // Team 7 is an unclaimed seat (deckTeams), so the real rule drops it.
    managers: managersToCheck(rows, [MANAGERS[7]], now),
    managersRead: true,
  }
}
