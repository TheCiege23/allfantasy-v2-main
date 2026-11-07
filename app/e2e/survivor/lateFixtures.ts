/**
 * Late-season Survivor fixtures — Swap/Merge, Jury and the Season Story — typed against the app's own
 * response types with `satisfies`, so a fixture that drifts from the real shape fails the typecheck
 * instead of rendering a screen the app never could. `scripts/e2e-survivor-fixture-json.ts` prints them as
 * JSON for the capture script (alongside app/e2e/survivor/fixture.json). Harness-only.
 */
import type { TribeShuffleView } from '@/lib/survivor/tribeSwapService'
import type { JuryQaView } from '@/lib/survivor/survivorJuryQaService'
import type { BallotRevealCouncil } from '@/lib/survivor/survivorBallotReveal'
import type { FinaleRevealView } from '@/lib/survivor/finaleView'
import type { LeagueRecord, SeasonTimelineNode, TrophyRecord } from '@/lib/survivor/seasonStory'

const TALA = { id: 'tribe-tala', name: 'Tala', crestUrl: null, primary: '#22d3ee', secondary: '#0e7490', emoji: null }
const MANU = { id: 'tribe-manu', name: 'Manu', crestUrl: null, primary: '#fb923c', secondary: '#9a3412', emoji: null }
const NAMES: Record<string, string> = {
  r1: 'Ciege', r2: 'Morgan', r3: 'Riley Castellanos-Whitmore', r4: 'Jordan', r5: 'Avery',
  r6: 'Lee', r7: 'Sam', r8: 'Taylor', r9: 'Quinn',
}

/** Week 6 swap, revealed: two managers changed tribes. */
export const shuffleSwap = {
  language: 'en',
  swapWeek: 6,
  mergeWeek: 10,
  names: NAMES,
  tribes: [TALA, MANU],
  swap: {
    week: 6,
    sealed: false,
    revealAt: '2026-10-13T00:00:00.000Z',
    before: [
      { tribeId: 'tribe-tala', rosterIds: ['r1', 'r2', 'r3', 'r4', 'r6'] },
      { tribeId: 'tribe-manu', rosterIds: ['r5', 'r7', 'r8', 'r9'] },
    ],
    after: [
      { tribeId: 'tribe-tala', rosterIds: ['r1', 'r2', 'r3', 'r4', 'r5'] },
      { tribeId: 'tribe-manu', rosterIds: ['r6', 'r7', 'r8', 'r9'] },
    ],
    // What swapMemberStatuses(before, after) returns for those snapshots.
    members: [
      { rosterId: 'r1', tribeId: 'tribe-tala', fromTribeId: 'tribe-tala', moved: false },
      { rosterId: 'r2', tribeId: 'tribe-tala', fromTribeId: 'tribe-tala', moved: false },
      { rosterId: 'r3', tribeId: 'tribe-tala', fromTribeId: 'tribe-tala', moved: false },
      { rosterId: 'r4', tribeId: 'tribe-tala', fromTribeId: 'tribe-tala', moved: false },
      { rosterId: 'r5', tribeId: 'tribe-tala', fromTribeId: 'tribe-manu', moved: true },
      { rosterId: 'r6', tribeId: 'tribe-manu', fromTribeId: 'tribe-tala', moved: true },
      { rosterId: 'r7', tribeId: 'tribe-manu', fromTribeId: 'tribe-manu', moved: false },
      { rosterId: 'r8', tribeId: 'tribe-manu', fromTribeId: 'tribe-manu', moved: false },
      { rosterId: 'r9', tribeId: 'tribe-manu', fromTribeId: 'tribe-manu', moved: false },
    ],
    movedCount: 2,
  },
  merge: null,
  viewer: { isCommissioner: false, rosterId: 'r1' },
  sealed: false,
} satisfies TribeShuffleView

export const juryFinale = {
  leagueName: 'Island of Champions',
  week: 14,
  finalistCount: 3,
  open: true,
  sealed: true,
  votingDeadline: '2026-12-15T01:00:00.000Z',
  juryCount: 5,
  jury: [
    { rosterId: 'r6', name: 'Lee', votedOutWeek: 10 },
    { rosterId: 'r7', name: 'Sam', votedOutWeek: 11 },
    { rosterId: 'r8', name: 'Taylor', votedOutWeek: 12 },
    { rosterId: 'r9', name: 'Quinn', votedOutWeek: 13 },
    { rosterId: 'r4', name: 'Jordan', votedOutWeek: 13 },
  ],
  finalists: [
    { rosterId: 'r1', name: 'Ciege', record: { immunityWins: 3, idolsPlayed: 1, seasonPoints: 1488.2, votesSurvived: 4 } },
    { rosterId: 'r2', name: 'Morgan', record: { immunityWins: 1, idolsPlayed: 0, seasonPoints: 1521.6, votesSurvived: 2 } },
    { rosterId: 'r3', name: 'Riley Castellanos-Whitmore', record: { immunityWins: 2, idolsPlayed: 2, seasonPoints: 1402.9, votesSurvived: 6 } },
  ],
  viewer: { rosterId: 'r1', isJuror: false, isFinalist: true, myVoteFinalistRosterId: null },
  tiebreakRule: 'Most season points',
  reveal: null,
  champion: null,
} satisfies FinaleRevealView

export const juryBallots = [
  {
    councilId: 'c13', week: 13, councilNumber: 11, phase: 'final', eliminatedName: 'Quinn',
    ballots: [
      { voterName: 'Ciege', targetName: 'Quinn', counted: true, late: false },
      { voterName: 'Morgan', targetName: 'Quinn', counted: true, late: false },
      { voterName: 'Riley Castellanos-Whitmore', targetName: 'Jordan', counted: true, late: false },
      { voterName: 'Quinn', targetName: 'Morgan', counted: true, late: true },
    ],
  },
] satisfies BallotRevealCouncil[]

export const storyTimeline = [
  { key: 'draft', week: 0, kind: 'draft', label: 'Draft', icon: '🏝', card: null },
  { key: 'w3', week: 3, kind: 'voted_out', label: 'O1 out', icon: '🔥',
    card: { kicker: 'Week 3 · Tribal Council', headline: 'Drew is the first one voted out', sub: '4 votes to 1 on the Tala beach.', chips: ['Tala', '4–1'], heroPath: '/survivor/scenes/tribal-night.svg', mood: 'night' } },
  { key: 'w6', week: 6, kind: 'swap', label: 'Swap', icon: '🔀',
    card: { kicker: 'Week 6 · Tribe swap', headline: 'Two managers change tribes', sub: 'Avery joins Tala; Lee crosses to Manu.', chips: ['Swap'], heroPath: '/survivor/scenes/beach-day.svg', mood: 'day' } },
  { key: 'w9', week: 9, kind: 'idol', label: 'Idol', icon: '🗿',
    card: { kicker: 'Week 9 · Idol', headline: 'An idol is played', sub: 'Every vote against its holder is cancelled.', chips: ['Idol'], heroPath: '/survivor/scenes/tribal-night.svg', mood: 'dusk' } },
  { key: 'w10', week: 10, kind: 'upcoming', label: 'Merge', icon: '⏳', card: null },
] satisfies SeasonTimelineNode[]

export const story = {
  leagueName: 'Island of Champions',
  sport: 'NFL',
  season: 2026,
  seasons: [2026, 2025],
  nodes: storyTimeline,
  trophies: [] satisfies TrophyRecord[],
  records: [] satisfies LeagueRecord[],
}

export const juryQa = {
  canRead: true,
  settings: { juryQuestionsEnabled: true, closingSpeechesEnabled: true },
  windows: {
    questionsOpenAt: '2026-12-08T00:00:00.000Z',
    questionsDeadline: '2026-12-12T01:00:00.000Z',
    answersDeadline: '2026-12-13T01:00:00.000Z',
    speechesDeadline: '2026-12-14T01:00:00.000Z',
    questionState: 'open',
    answerState: 'open',
    speechState: 'open',
    votingHeldForSpeeches: true,
  },
  finaleOpen: true,
  voteComplete: false,
  finalists: [
    { rosterId: 'r1', name: 'Ciege' },
    { rosterId: 'r2', name: 'Morgan' },
    { rosterId: 'r3', name: 'Riley Castellanos-Whitmore' },
  ],
  questions: [
    { id: 'r6:r1', jurorRosterId: 'r6', finalistRosterId: 'r1', jurorName: 'Lee', finalistName: 'Ciege',
      question: 'You played an idol in week 9 that sent Jordan home. Was that the plan all along, or did you panic?',
      askedAt: '2026-12-09T18:00:00.000Z', answer: null, answeredAt: null, seenAt: null },
    { id: 'r7:r2', jurorRosterId: 'r7', finalistRosterId: 'r2', jurorName: 'Sam', finalistName: 'Morgan',
      question: 'Name one move you made that nobody else at this table could have made.',
      askedAt: '2026-12-09T19:30:00.000Z', answer: 'Keeping Avery after the swap. Everyone else wanted the points; I wanted the vote.',
      answeredAt: '2026-12-10T02:10:00.000Z', seenAt: null },
  ],
  speeches: [
    { finalistRosterId: 'r3', name: 'Riley Castellanos-Whitmore',
      text: 'I survived six votes. I never had the numbers and I never stopped building them. That is the game.',
      postedAt: '2026-12-10T20:00:00.000Z', updatedAt: '2026-12-10T20:00:00.000Z' },
  ],
  // What juryQaTodo returns for finalist r1 with Lee's question unanswered and no speech yet.
  viewer: { rosterId: 'r1', isJuror: false, isFinalist: true, isHost: false,
    todo: { questionsToAsk: [], questionsToAnswer: ['r6:r1'], answersToRead: [], speechMissing: true } },
} satisfies JuryQaView
