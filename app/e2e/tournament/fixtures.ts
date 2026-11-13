/**
 * Tournament fixtures for the DB-free harness, typed against the app's own types so a fixture that drifts from
 * the real shape fails the typecheck instead of rendering a screen the app never could. Harness-only.
 *
 *  - `layout`: what app/tournament/[tournamentId]/layout.tsx loads (`loadTournamentLayoutPayload`) and hands the
 *    pages through `TournamentUiProvider`.
 *  - `standings`: GET /api/tournament/standings (`fetchTournamentStandingsJson`), answered by the capture script.
 *
 * A 32-team tournament: 2 conferences × 2 leagues × 8 teams, round 1 of 3 in week 6, 2 advancers per league plus
 * 2 wildcards and a 4-team bubble. The viewer is in the first league, on the bubble.
 */
import type { TournamentLayoutPayload } from '@/lib/tournament/tournamentPageData'
import type { fetchTournamentStandingsJson } from '@/lib/tournament/tournamentStandingsFetch'
import type { HarnessApiRoute } from '../harnessApi'

export const HARNESS_USER_ID = 'e2e-tournament-user'
export const TOURNAMENT_ID = 'e2e-tournament'

const CONFERENCES = [
  { id: 'conf-a', name: 'Gridiron Conference', slug: 'gridiron', theme: 'gold', colorHex: '#f5b800', conferenceNumber: 1 },
  { id: 'conf-b', name: 'Blitz Conference', slug: 'blitz', theme: 'blue', colorHex: '#3b82f6', conferenceNumber: 2 },
]

const ROUNDS = [
  { id: 'r1', roundNumber: 1, roundType: 'opening', roundLabel: 'Opening Round', weekStart: 1, weekEnd: 8, status: 'active' },
  { id: 'r2', roundNumber: 2, roundType: 'elite', roundLabel: 'Elite Eight', weekStart: 9, weekEnd: 13, status: 'upcoming' },
  { id: 'r3', roundNumber: 3, roundType: 'final', roundLabel: 'Championship', weekStart: 14, weekEnd: 17, status: 'upcoming' },
]

const LEAGUE_NAMES = ['Gridiron North', 'Gridiron South of the Mississippi', 'Blitz East', 'Blitz West']
const LEAGUES = LEAGUE_NAMES.map((name, i) => ({
  id: `tl-${i + 1}`, name, slug: name.toLowerCase().replace(/[^a-z]+/g, '-'), roundId: 'r1', conferenceId: i < 2 ? 'conf-a' : 'conf-b',
  leagueId: `lg-${i + 1}`, status: 'active', teamSlots: 8, currentTeamCount: 8, draftScheduledAt: null,
  colorHex: i < 2 ? '#f5b800' : '#3b82f6', logoUrl: null, advancersCount: 2,
}))

const MANAGERS = [
  'Ciege', 'Morgan', 'Riley Castellanos-Whitmore', 'Jordan', 'Avery', 'Lee', 'Sam', 'Taylor',
  'Quinn', 'Drew', 'Casey', 'Reese', 'Parker', 'Rowan', 'Emerson', 'Hayden',
  'Skyler', 'Finley', 'Dakota', 'Sage', 'Blake', 'Cameron', 'Jamie', 'Kendall',
  'Logan', 'Marley', 'Noel', 'Oakley', 'Peyton', 'River', 'Shiloh', 'Tatum',
]

export const layout = {
  shell: {
    id: TOURNAMENT_ID, name: 'AllFantasy Open 2026', sport: 'NFL', status: 'in_progress', maxParticipants: 32, currentParticipantCount: 32,
    conferenceCount: 2, leaguesPerConference: 2, teamsPerLeague: 8, namingMode: 'custom', currentRoundNumber: 1, totalRounds: 3,
    advancersPerLeague: 2, wildcardCount: 2, bubbleEnabled: true, bubbleSize: 4, bubbleScoringMode: 'points_for', scoringSystem: 'ppr',
    draftType: 'snake', waiverType: 'faab', openingRosterSize: 16, tournamentRosterSize: 14, eliteRosterSize: 12, faabResetOnRedraft: true,
    draftClockSeconds: 90, simultaneousDrafts: true, tiebreakerMode: 'points_for', standingsVisibility: 'all',
  },
  conferences: CONFERENCES,
  rounds: ROUNDS,
  tournamentLeagues: LEAGUES,
  participant: {
    id: 'p-1', userId: HARNESS_USER_ID, displayName: 'Ciege', avatarUrl: null, status: 'active', currentRoundNumber: 1, furthestRoundReached: 1,
    currentConferenceId: 'conf-a', currentLeagueId: 'tl-1', careerWins: 3, careerLosses: 2, careerPointsFor: 612.4, careerPointsAgainst: 588.1,
    advancementHistory: [],
  },
  isCommissioner: false,
  announcements: [
    { id: 'an-1', type: 'round_update', title: 'Week 6 is final', content: 'Two weeks left in the Opening Round. The top 2 in each league advance; 2 wildcards come from the bubble.', roundNumber: 1, createdAt: '2026-10-14T13:00:00.000Z', isPosted: true },
    { id: 'an-2', type: 'general', title: 'Elite Eight redraft date set', content: 'The Elite Eight redraft runs Tuesday after week 8 at 8:00 PM ET.', roundNumber: 2, createdAt: '2026-10-10T18:00:00.000Z', isPosted: true },
  ],
  hubKind: 'shell',
} satisfies TournamentLayoutPayload

type Standings = Awaited<ReturnType<typeof fetchTournamentStandingsJson>>

export const standings: Standings = {
  round: ROUNDS[0]!,
  leagues: LEAGUES.map((L, li) => ({
    id: L.id, name: L.name, conferenceId: L.conferenceId, roundId: 'r1', leagueId: L.leagueId, status: L.status, teamSlots: 8, advancersCount: 2,
    participants: MANAGERS.slice(li * 8, li * 8 + 8).map((name, i) => {
      const wins = [5, 4, 4, 3, 3, 2, 2, 1][i]!
      const userId = li === 0 && i === 0 ? HARNESS_USER_ID : `u-${li}-${i}`
      // The viewer sits third in their league: on the bubble.
      const rank = li === 0 ? [3, 1, 2, 4, 5, 6, 7, 8][i]! : i + 1
      return {
        id: `s-${li}-${i}`, tournamentLeagueId: L.id, participantId: li === 0 && i === 0 ? 'p-1' : `p-${li}-${i}`, userId,
        wins: li === 0 && i === 0 ? 4 : wins, losses: 6 - (li === 0 && i === 0 ? 4 : wins), ties: 0,
        pointsFor: Math.round((742 - i * 31.6 - li * 4.2) * 10) / 10, pointsAgainst: Math.round((690 + i * 12.4) * 10) / 10,
        streak: i % 2 ? 'L1' : 'W2', leagueRank: rank, conferenceRank: rank + (li % 2) * 8,
        advancementStatus: rank <= 2 ? 'qualified' : rank <= 4 ? 'bubble' : 'competing', draftSlot: null,
        participant: { displayName: name, userId },
      }
    }),
  })),
}

/** The player screens' one /api/ read, served by scripts/e2e-harness-capture.mjs (the commissioner screen's are in commissioner-fixtures.ts). */
export const HARNESS_API: HarnessApiRoute[] = [{ path: '/api/tournament/standings', body: standings }]
