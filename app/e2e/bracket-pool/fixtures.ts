/**
 * Bracket-pool fixtures for the DB-free pool-dashboard harness, typed against `PlayoffChallengeView` (what
 * `getPlayoffBracketView` returns to app/brackets/leagues/[leagueId]/page.tsx) and built on the real
 * `buildPlayoffTemplate`, so a fixture that drifts from the real shape fails the typecheck. Harness-only.
 *
 * An NBA playoff pool mid first round: four first-round series final, four in progress, the viewer with a
 * complete first-round card and the later rounds still open. Variants:
 *   pool   — the viewer is a member (not the owner)
 *   owner  — the same pool seen by its owner (invite + commissioner tools)
 *   empty  — a brand-new pool: no picks, one entry, nothing played
 */
import { buildPlayoffTemplate, getPlayoffRoundOrder } from '@/lib/playoffs/playoffTemplate'
import type { PlayoffChallengeView, PlayoffPickView, PlayoffSeriesView } from '@/lib/playoffs/types'

export const HARNESS_USER_ID = 'e2e-bracket-user'
const OWNER_ID = 'cku0000poolowner01'
const CREATED = '2027-04-10T15:00:00.000Z'

const template = buildPlayoffTemplate({ sport: 'nba', seasonYear: 2027, isTestMode: true })

/** Round 1: series 1-4 final (two upsets), 5-8 in progress with game scores. */
const series: PlayoffSeriesView[] = template.map((s, i) => {
  const id = `ser-${i + 1}`
  if (s.roundIndex !== 1) return { ...s, id }
  const n = s.seriesNumber
  if (n <= 4) {
    const upset = n === 2 || n === 4
    return {
      ...s, id, status: 'final', winnerTeamName: upset ? s.awayTeamName : s.homeTeamName,
      homeTeamWins: upset ? 2 : 4, awayTeamWins: upset ? 4 : 1, seriesSummary: upset ? `${s.awayTeamName} won 4-2` : `${s.homeTeamName} won 4-1`,
      startsAt: '2027-04-19T23:00:00.000Z', lastSyncedAt: '2027-05-01T04:00:00.000Z',
    }
  }
  return {
    ...s, id, status: 'in_progress', homeTeamWins: 2, awayTeamWins: n === 7 ? 3 : 1,
    seriesSummary: n === 7 ? `${s.awayTeamName} leads 3-2` : `${s.homeTeamName} leads 2-1`,
    nextGameAt: '2027-05-02T00:30:00.000Z', nextGameDateLabel: 'Sat 8:30 PM ET', broadcastNetwork: 'TNT',
    startsAt: '2027-04-20T23:00:00.000Z', lastSyncedAt: '2027-05-01T04:00:00.000Z',
  }
})

const NAMES = ['Ciege', 'Morgan', 'Riley Castellanos-Whitmore', 'Jordan', 'Avery', 'Lee', 'Sam', 'Taylor']

const entries: PlayoffChallengeView['entries'] = NAMES.map((name, i) => ({
  id: `ent-${i + 1}`,
  name: i === 0 ? 'Ciege’s Big Board' : `${name.split(' ')[0]}’s bracket`,
  userId: i === 0 ? HARNESS_USER_ID : i === 1 ? OWNER_ID : `cku0000poolmember${i}`,
  pickCount: 15, isComplete: true, finalizedAt: '2027-04-19T22:00:00.000Z',
  rank: [3, 1, 2, 4, 5, 6, 7, 8][i], totalScore: [30, 40, 40, 20, 20, 10, 10, 0][i],
  potentialTotal: [150, 160, 140, 120, 110, 100, 90, 80][i], correctPicks: [3, 4, 4, 2, 2, 1, 1, 0][i], resolvedPicks: 4,
  createdAt: CREATED,
}))

/** The viewer picked every home team in round 1 (so two upsets cost them) and advanced those teams to the final:
 *  a later-round pick is the team picked in the series feeding its home slot. */
const pickedBySeries = new Map<number, string>()
for (const s of [...series].sort((a, b) => a.roundIndex - b.roundIndex)) {
  pickedBySeries.set(s.seriesNumber, s.sourceSeriesHome == null ? s.homeTeamName : pickedBySeries.get(s.sourceSeriesHome)!)
}
const picks: PlayoffPickView[] = series.map((s) => ({
  id: `pick-${s.id}`, entryId: 'ent-1', seriesId: s.id,
  pickTeamName: pickedBySeries.get(s.seriesNumber)!,
  confirmedAt: '2027-04-19T22:00:00.000Z', confirmedTeamName: pickedBySeries.get(s.seriesNumber)!, draftTeamName: null,
  createdAt: CREATED, updatedAt: CREATED,
}))

const challenge: PlayoffChallengeView['challenge'] = {
  id: 'e2e-pool', name: 'Sunday League Playoff Pool', ownerUserId: OWNER_ID, sport: 'nba', seasonYear: 2027,
  status: 'active', isTestMode: false, maxEntriesPerParticipant: 2, inviteUrl: '/brackets/leagues/e2e-pool',
  inviteCode: 'HOOPS27', visibility: 'private', maxParticipants: 50, scoringStyle: 'standard', lockRule: 'series_start',
  firstGameStartsAt: '2027-04-19T23:00:00.000Z', config: null, createdAt: CREATED, updatedAt: '2027-05-01T04:00:00.000Z',
}

const base: PlayoffChallengeView = {
  participants: NAMES.map((displayName, i) => ({ userId: entries[i]!.userId, displayName, entryCount: 1 })),
  challenge,
  viewerUserId: HARNESS_USER_ID,
  viewerTournamentBracketLimit: 2,
  viewerTournamentBracketUsed: 1,
  activeEntry: { ...entries[0]!, tiebreakerTotalScore: 214 },
  entries,
  series,
  picks,
  rounds: getPlayoffRoundOrder('nba'),
  lockDiagnostics: { lockRule: 'series_start', allowTestLatePicks: false, viewerCanLatePick: false, isPoolOwner: false, isTestMode: false, hasPoolAdminAccess: false },
  completion: {
    mode: 'full_bracket_required', isSubmittable: true, requiredPickCount: 15, savedRequiredPickCount: 15,
    totalSeriesCount: 15, unavailableSeriesCount: 0, missingRequiredSeriesIds: [], message: 'Your bracket is complete.',
  },
}

const fresh = template.map((s, i) => ({ ...s, id: `ser-${i + 1}` }))

export const VIEWS: Record<'pool' | 'owner' | 'empty', PlayoffChallengeView> = {
  pool: base,
  owner: {
    ...base,
    viewerUserId: OWNER_ID,
    activeEntry: { ...entries[1]! },
    picks: picks.map((p) => ({ ...p, entryId: 'ent-2' })),
    lockDiagnostics: { ...base.lockDiagnostics!, isPoolOwner: true, hasPoolAdminAccess: true },
  },
  empty: {
    ...base,
    challenge: { ...challenge, status: 'open', firstGameStartsAt: '2027-04-19T23:00:00.000Z' },
    participants: [{ userId: HARNESS_USER_ID, displayName: 'Ciege', entryCount: 1 }],
    entries: [{ ...entries[0]!, pickCount: 0, isComplete: false, finalizedAt: null, rank: null, totalScore: 0, correctPicks: 0, resolvedPicks: 0 }],
    activeEntry: { ...entries[0]!, pickCount: 0, isComplete: false, finalizedAt: null, rank: null, totalScore: 0, correctPicks: 0, resolvedPicks: 0 },
    series: fresh,
    picks: [],
    completion: {
      mode: 'full_bracket_required', isSubmittable: false, requiredPickCount: 15, savedRequiredPickCount: 0,
      totalSeriesCount: 15, unavailableSeriesCount: 0, missingRequiredSeriesIds: fresh.map((s) => s.id), message: 'Pick every series to submit.',
    },
  },
}
