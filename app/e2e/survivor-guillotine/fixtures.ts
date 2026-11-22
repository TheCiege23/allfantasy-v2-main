/**
 * Survivor Guillotine fixtures for the DB-free harness, typed against the league island's own payload type
 * (`Data`, the GET /api/leagues/[id]/survivor-guillotine response) and built on the real `defaultSGConfig`, so a
 * fixture that drifts from the real shape fails the typecheck. They are dumped to JSON for the capture script.
 * Harness-only.
 *
 * 12 teams in two tribes of six, period 4 of an NFL season (match play), two teams already chopped, the viewer in
 * tribe A with a roster, FAAB left, a held power and a pending waiver bid.
 */
import { defaultSGConfig } from '@/lib/survivor-guillotine/config'
import type { Data } from '@/components/survivor-guillotine/SurvivorGuillotineLeague'

const NAMES: [string, string][] = [
  ['Torch Bearers', 'Ciege'], ['Blindside Brigade', 'Morgan'], ['Idol Hunters of the Lower East Side', 'Riley Castellanos-Whitmore'],
  ['Merge Monsters', 'Jordan'], ['Tribal Fire', 'Avery'], ['Jury Bait', 'Lee'],
  ['Final Three', 'Sam'], ['Snuffed Out', 'Taylor'], ['Hidden Advantage', 'Quinn'],
  ['Outcasts', 'Drew'], ['Exile Island', 'Casey'], ['Last Gamble', 'Reese'],
]
const ID = (i: number) => `ckguilroster${String(i + 1).padStart(4, '0')}`
const ME = ID(0)
const CHOPPED = [ID(10), ID(11)]
const config = { ...defaultSGConfig('NFL', 17), teamCount: 12, tribeCount: 2 }

const teams: Data['teams'] = NAMES.map(([teamName, ownerName], i) => ({
  legacyRosterId: ID(i), teamName, ownerName,
  eliminatedAt: CHOPPED.includes(ID(i)) ? (i === 10 ? '2026-09-23T10:00:00.000Z' : '2026-09-30T10:00:00.000Z') : null,
}))

const players = [
  ['p1', 'Jayden Daniels', 'QB', 'WAS'], ['p2', 'Bijan Robinson', 'RB', 'ATL'], ['p3', 'Jahmyr Gibbs', 'RB', 'DET'],
  ['p4', "Ja'Marr Chase", 'WR', 'CIN'], ['p5', 'Puka Nacua', 'WR', 'LAR'], ['p6', 'Brock Bowers', 'TE', 'LV'],
  ['p7', 'Ladd McConkey', 'WR', 'LAC'], ['p8', 'Brandon Aubrey', 'K', 'DAL'],
].map(([id, name, position, team]) => ({ id: id!, name: name!, position: position!, team: team! }))

const scoreOf = (i: number) => Math.round((1288 - i * 41.7) * 10) / 10

export const season = {
  season: {
    config,
    tribes: NAMES.map((_, i) => ({ rosterId: ID(i), tribeId: i % 2 === 0 ? 'tribe-0' : 'tribe-1', captain: i < 2 })),
    periodState: {
      period: 4, matchups: [{ team1: ID(0), team2: ID(1) }, { team1: ID(2), team2: ID(3) }, { team1: ID(4), team2: ID(5) },
        { team1: ID(6), team2: ID(7) }, { team1: ID(8), team2: ID(9) }],
      champions: [], sitOuts: [], priorSitOuts: [], ceremonyAt: '2026-10-07T10:00:00.000Z',
      scoringStartsAt: '2026-10-02T00:00:00.000Z', scoringEndsAt: '2026-10-07T04:00:00.000Z', ceremonyStarted: false,
    },
    currentPeriod: 4,
    status: 'in_progress',
    periodHistory: {
      '2': { mode: 'match_play', completedAt: '2026-09-23T10:00:00.000Z', choppedTeamIds: [ID(10)], savedTeamIds: [ID(9)],
        scores: Object.fromEntries(NAMES.map((_, i) => [ID(i), scoreOf(i) / 4])), immuneTribeId: 'tribe-0' },
      '3': { mode: 'match_play', completedAt: '2026-09-30T10:00:00.000Z', choppedTeamIds: [ID(11)], savedTeamIds: [ID(8)],
        scores: Object.fromEntries(NAMES.map((_, i) => [ID(i), scoreOf(i) / 3.6])), immuneTribeId: 'tribe-1' },
    },
    tribeDraftState: null,
  },
  ownRoster: {
    id: ME, faabRemaining: 640, players, dailyLineups: [],
    ownBid: { amount: 120, status: 'pending' }, tribeChoice: null,
  },
  teams,
  scores: NAMES.map((_, i) => ({ rosterId: ID(i), totalPoints: scoreOf(i), status: CHOPPED.includes(ID(i)) ? 'chopped' : 'active' })),
  powers: [
    { id: 'pw1', kind: 'personal_immunity', binding: 'manager', playerId: null, ownerId: ME, expiresAfterPeriod: 6, status: 'held', targetTeamId: null, revealed: false },
  ],
  chops: [{ period: 2, rosterId: ID(10) }, { period: 3, rosterId: ID(11) }],
  stealTargets: [],
  releasedPlayers: [
    { id: 'r1', name: 'Christian McCaffrey', position: 'RB', team: 'SF', fromRosterId: ID(10), period: 2, available: true },
    { id: 'r2', name: 'Tyreek Hill', position: 'WR', team: 'MIA', fromRosterId: ID(11), period: 3, available: true },
  ],
  reversals: [],
} satisfies Data

/** GET …/operations — commissioner-only; the harness viewer is the commissioner. */
export const operations = { calendar: {}, faabOnChop: 'keep', canEditPaid: false }
