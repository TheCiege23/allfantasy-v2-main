/**
 * Big Brother fixtures for the DB-free harness, typed against the app's own response types so a fixture that
 * drifts from the real shape fails the typecheck instead of rendering a screen the app never could. They are
 * dumped to JSON for the capture script. Harness-only.
 *
 * A 12-houseguest NFL house in week 5 with the eviction vote open: two evicted (one on the jury), an HOH, two
 * nominees and a Veto winner who did not use it. The viewer is safe and votes this week.
 */
import type { BigBrotherSpecialtySummary } from '@/components/big-brother/BigBrotherSpecialtyHome'
import type { BigBrotherMemoryWallEntry, BigBrotherUserStatus } from '@/components/big-brother/types'

const NAMES = [
  'Ciege', 'Morgan', 'Riley Castellanos-Whitmore', 'Jordan', 'Avery', 'Lee',
  'Sam', 'Taylor', 'Quinn', 'Drew', 'Casey', 'Reese',
]
const ID = (i: number) => `ckbbroster${String(i + 1).padStart(6, '0')}`
const ME = ID(0)
const HOH = ID(1)
const NOM1 = ID(2)
const NOM2 = ID(3)
const VETO = ID(4)
const EVICTED = [ID(10), ID(11)]

const status = (i: number): BigBrotherUserStatus =>
  ID(i) === HOH ? 'HOH' : ID(i) === NOM1 || ID(i) === NOM2 ? 'NOMINATED' : ID(i) === VETO ? 'VETO_WINNER'
    : ID(i) === EVICTED[0] ? 'JURY' : ID(i) === EVICTED[1] ? 'ELIMINATED' : 'SAFE'

const wall: BigBrotherMemoryWallEntry[] = NAMES.map((displayName, i) => ({ rosterId: ID(i), displayName, avatarUrl: null, status: status(i) }))
const alive = NAMES.map((_, i) => ID(i)).filter((id) => !EVICTED.includes(id))

export const summary = {
  totalRosterCount: 12,
  remainingCount: 10,
  config: { sport: 'NFL', finaleFormat: 'jury_vote', juryStartMode: 'after_evictions', challengeMode: 'hybrid' },
  sportCalendar: {
    regularSeasonWeeks: 14, evictionEndWeek: 12,
    scoringWindowDisclaimer: '',
    timelineNote: 'Evictions run weeks 1–12; the finale is week 13.',
  },
  cycle: {
    id: 'cycle-5', week: 5, phase: 'VOTING_OPEN', hohRosterId: HOH, nominee1RosterId: NOM1, nominee2RosterId: NOM2,
    vetoWinnerRosterId: VETO, vetoParticipantRosterIds: [HOH, NOM1, NOM2, VETO, ID(5), ID(6)], vetoUsed: false,
    vetoSavedRosterId: null, replacementNomineeRosterId: null, evictedRosterId: null,
    voteDeadlineAt: '2026-11-12T01:00:00.000Z', voteOpenedAt: '2026-11-09T14:00:00.000Z', closedAt: null,
  },
  finalNomineeRosterIds: [NOM1, NOM2],
  eligibility: {
    canCompeteHOH: alive.filter((id) => id !== HOH), canBeNominated: alive.filter((id) => id !== HOH),
    canVote: alive.filter((id) => ![HOH, NOM1, NOM2].includes(id)), juryRosterIds: [EVICTED[0]!], eliminatedRosterIds: EVICTED,
  },
  jury: [{ rosterId: EVICTED[0]!, evictedWeek: 4 }],
  finalists: [],
  ballot: { canVote: true, voteDeadlineAt: '2026-11-12T01:00:00.000Z', closed: false },
  myRosterId: ME,
  myStatus: 'SAFE',
  rosterDisplayNames: Object.fromEntries(NAMES.map((n, i) => [ID(i), n])),
  memoryWall: wall,
  isCommissioner: true,
  haveNotRosterIds: [ID(6), ID(7)],
  home: {
    leagueName: 'Big Brother: Gridiron House',
    season: 2026,
    phaseStep: 4,
    nextDecision: { label: 'Voting closes', at: '2026-11-12T01:00:00.000Z' },
    lastEviction: {
      week: 4, evictedRosterId: EVICTED[0]!, nomineeRosterIds: [EVICTED[0]!, ID(8)], votesByNominee: { [EVICTED[0]!]: 6, [ID(8)]: 2 },
      tied: false, nominatedByRosterId: ID(9), juryEnrolled: true, releasedPlayerCount: 18,
    },
    feed: [
      { id: 'veto-5', kind: 'veto', week: 5, rosterId: VETO },
      { id: 'hoh-5', kind: 'hoh', week: 5, rosterId: HOH },
      { id: 'evict-4', kind: 'evict', week: 4, rosterId: EVICTED[0]! },
      { id: 'veto-4', kind: 'veto', week: 4, rosterId: ID(8) },
    ],
  },
} satisfies BigBrotherSpecialtySummary

/** GET /api/leagues/[id]/big-brother/audit — the History panel's log. */
export const audit = {
  log: [
    { eventType: 'eviction', metadata: { week: 4, evictedRosterId: EVICTED[0], votes: { [EVICTED[0]!]: 6, [ID(8)]: 2 } }, createdAt: '2026-11-05T02:00:00.000Z' },
    { eventType: 'veto_winner', metadata: { week: 5, rosterId: VETO }, createdAt: '2026-11-08T18:00:00.000Z' },
    { eventType: 'hoh_winner', metadata: { week: 5, rosterId: HOH }, createdAt: '2026-11-06T18:00:00.000Z' },
    { eventType: 'nominations', metadata: { week: 5, nominee1RosterId: NOM1, nominee2RosterId: NOM2 }, createdAt: '2026-11-07T18:00:00.000Z' },
  ],
}

/** GET /api/leagues/[id]/big-brother/config — the Twists panel reads `config.premiumEngineSpec`. */
export const config = { config: { premiumEngineSpec: null } }
