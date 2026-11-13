/**
 * Devy league fixtures for the DB-free harness, typed against the screens' own response types with
 * `satisfies`, so a fixture that drifts from the real shape fails the typecheck instead of rendering a
 * screen the app never could. They are dumped to JSON for the capture script. Harness-only.
 */
import type { DevySlot, PlayerState, TaxiSlot, WeeklyEntry } from '@/app/devy/[leagueId]/roster/DevyRosterClient'
import type { DevyPickInventory } from '@/app/devy/[leagueId]/picks/DevyPicksClient'
import type { PickRow } from '@/app/devy/components/PicksBoard'

export const HARNESS_USER_ID = 'e2e-devy-user'

const ROSTERS = [
  { id: 'ckdevyroster00001', ownerId: HARNESS_USER_ID, teamName: 'Future Is Now' },
  { id: 'ckdevyroster00002', ownerId: 'u2', teamName: 'Redshirt Rebels' },
  { id: 'ckdevyroster00003', ownerId: 'u3', teamName: 'The Long Game' },
  { id: 'ckdevyroster00004', ownerId: 'u4', teamName: 'Combine Kings of Cleveland' },
]
const ME = ROSTERS[0]!.id

export const config = { config: { devySlots: 6, taxiSlots: 4, futureDraftFormat: 'separate', season: 2026 } as Record<string, unknown> }

export const season = { season: { season: 2026, currentWeek: 10, totalWeeks: 18, rosters: ROSTERS } }

const s = (playerId: string, playerName: string, position: string, bucketState: string): PlayerState => ({
  playerId, playerName, position, bucketState, scoringEligibility: bucketState === 'active_starter' ? 'starter' : 'display_only', playerType: 'nfl',
})

const playerStates = [
  s('n1', 'Jayden Daniels', 'QB', 'active_starter'),
  s('n2', 'Bijan Robinson', 'RB', 'active_starter'),
  s('n3', 'Jahmyr Gibbs', 'RB', 'active_starter'),
  s('n4', "Ja'Marr Chase", 'WR', 'active_starter'),
  s('n5', 'Puka Nacua', 'WR', 'active_starter'),
  s('n6', 'Amon-Ra St. Brown', 'WR', 'active_starter'),
  s('n7', 'Brock Bowers', 'TE', 'active_starter'),
  s('n8', 'Malik Nabers', 'WR', 'active_starter'),
  s('b1', 'Ladd McConkey', 'WR', 'active_bench'),
  s('b2', 'Tank Bigsby', 'RB', 'active_bench'),
  s('i1', 'Christian McCaffrey', 'RB', 'ir'),
  s('t1', 'Travis Hunter', 'WR', 'taxi'),
] satisfies PlayerState[]

const taxiSlots = [
  { playerId: 't1', playerName: 'Travis Hunter', position: 'WR', taxiYearsCurrent: 1, taxiYearStart: 2025 },
] satisfies TaxiSlot[]

const devySlots = [
  { playerId: 'd1', playerName: 'Arch Manning', position: 'QB', school: 'Texas', schoolLogoUrl: null, classYear: 'JR', projectedDeclarationYear: 2027, hasEnteredNFL: false, nflEntryYear: null },
  { playerId: 'd2', playerName: 'Jeremiah Smith', position: 'WR', school: 'Ohio State', schoolLogoUrl: null, classYear: 'SO', projectedDeclarationYear: 2027, hasEnteredNFL: false, nflEntryYear: null },
  { playerId: 'd3', playerName: 'Bryce Underwood', position: 'QB', school: 'Michigan', schoolLogoUrl: null, classYear: 'FR', projectedDeclarationYear: 2028, hasEnteredNFL: false, nflEntryYear: null },
  { playerId: 'd4', playerName: 'Dakorien Moore', position: 'WR', school: 'Oregon', schoolLogoUrl: null, classYear: 'FR', projectedDeclarationYear: 2028, hasEnteredNFL: false, nflEntryYear: null },
] satisfies DevySlot[]

const weekly: Record<string, WeeklyEntry> = Object.fromEntries(
  playerStates.map((p, i) => [p.playerId, { fantasyPts: Math.round((24.6 - i * 1.7) * 10) / 10, eligibility: p.scoringEligibility, bucketState: p.bucketState }]),
)

export const roster = { playerStates, taxiSlots, devySlots, weeklyScores: { week: 10, season: 2026, byPlayerId: weekly } }

const pick = (id: string, season: number, round: number, pickType: string, original: string, current = original): PickRow => ({
  id, season, round, pickType, originalOwnerId: original, currentOwnerId: current, isTradeable: true, isUsed: false,
})

const ALL: PickRow[] = [2026, 2027].flatMap((yr) =>
  ROSTERS.flatMap((r, i) => [
    pick(`rk-${yr}-1-${i}`, yr, 1, 'rookie', r.id, yr === 2026 && i === 2 ? ME : r.id),
    pick(`rk-${yr}-2-${i}`, yr, 2, 'rookie', r.id),
    pick(`dv-${yr}-1-${i}`, yr, 1, 'devy', r.id),
  ]),
)

export const inventory = {
  inventory: {
    seasonStart: 2026,
    years: [2026, 2027].map((year) => ({
      year,
      rookiePicks: ALL.filter((p) => p.season === year && p.pickType === 'rookie' && p.currentOwnerId === ME),
      devyPicks: ALL.filter((p) => p.season === year && p.pickType === 'devy' && p.currentOwnerId === ME),
    })),
  } satisfies DevyPickInventory,
}

export const allPicks = { picks: ALL }
