/**
 * Harness-only extra reads for /e2e/survivor/[leagueId]/[screen] (app/e2e is 404 in production).
 *
 * `fixture.json` answers the season, the ballot and a few side reads. These are the GET reads it does
 * not answer, so without them the challenge board, real-game picks, weekly call, past challenges, jury,
 * finale, swap/merge, season story and premium tiles render only their empty or error states.
 *
 * Same cast as fixture.json: week 9 (NFL, "Island of Champions"), tribes Tala (r1 Ciege = the viewer,
 * r2 Morgan, r3 Riley Castellanos-Whitmore, r4 Jordan, r5 Avery) and Manu (r6 Lee, r7 Sam, r8 Taylor,
 * r9 Quinn); voted out so far: Drew (r10, week 6), Kai (r12, week 7), Casey Vandermolen-Ruiz (r11,
 * week 8) — the three on the Exile boss board. Roster ids r10–r12 are this file's; fixture.json gives
 * none for them.
 *
 * Every body is what the real route handler sends (wrapper keys included) and is typed against the
 * real exported type with `satisfies`, so a drift in the type fails a typecheck. Where the shape is
 * only a local/unexported type, it is mirrored here and says so.
 *
 * Matching: `query` lists the params the read carries. The jury reads with `part=` are listed BEFORE
 * the plain jury read, so a matcher that treats `query` as a subset still picks the right body.
 */
import type { SurvivorChallenge } from '@prisma/client'
import type { BuilderChallengeView } from '@/lib/survivor/survivorChallengeBuilder'
import type { RealGameBoard } from '@/lib/survivor/survivorRealGameChallenges'
import type { WeeklyCallBoard } from '@/lib/survivor/survivorWeeklyCall'
import type { FinaleRevealView } from '@/lib/survivor/finaleView'
import type { JuryQaView } from '@/lib/survivor/survivorJuryQaService'
import type { BallotRevealCouncil } from '@/lib/survivor/survivorBallotReveal'
import type { TribeShuffleView } from '@/lib/survivor/tribeSwapService'
import type { ChallengeLang } from '@/lib/survivor/survivorChallengeBuilderModel'
import type { SurvivorRewardSpec, SurvivorRewardStatus, SurvivorRewardType } from '@/lib/survivor/survivorRewardModel'
import type { AfPlanId } from '@/lib/tournament/af-premium-plans'
import { describeSurvivorReward } from '@/lib/survivor/survivorRewardModel'
import { buildLeagueRecords, buildSeasonTimeline, buildTrophyCase, type ChampionshipRow, type LeagueRecord, type SeasonStoryMoment, type SeasonTimelineNode, type TrophyRecord } from '@/lib/survivor/seasonStory'
import { SURVIVOR_PREMIUM_COMMAND_TILES, resolveSurvivorPremiumTileAccess, type SurvivorPremiumTileAccess } from '@/lib/survivor/survivor-premium-access'
import { FINALE_TIEBREAK_RULE } from '@/lib/survivor/finaleReveal'

const LEAGUE_ID = 'e2e-survivor'
const LEAGUE_NAME = 'Island of Champions'
const Q = { leagueId: LEAGUE_ID }

// ------------------------------------------------------------------ GET /api/survivor/challenge-board
// Route: NextResponse.json(await loadBuilderBoard(leagueId, userId)) → { lang, challenges }.
// SurvivorChallengeBoardCard reads `board.challenges`.

const challengeBoard = {
  lang: 'en',
  challenges: [
    {
      id: 'cb-9-1', week: 9, title: 'Monday night total',
      question: 'How many total points are scored in Monday Night Football (Bears at Packers)? Closest without going over wins.',
      kind: 'closest_without_going_over', scope: 'individual', status: 'open',
      opensAt: '2026-11-06T17:00:00.000Z', locksAt: '2026-11-10T01:15:00.000Z', inputKind: 'number',
      options: [], prizeText: '1st: +6 points in week 9 · 2nd: $10 FAAB',
      wager: null, uniqueAnswers: true, sealed: false, mine: null, answers: null, resultSummary: null, myResult: null,
    },
    {
      id: 'cb-9-2', week: 9, title: 'Sunday night upset?',
      question: 'Who wins Sunday Night Football: Eagles or Cowboys? Stake FAAB on it.',
      kind: 'pick_winner', scope: 'individual', status: 'open',
      opensAt: '2026-11-06T17:00:00.000Z', locksAt: '2026-11-09T01:20:00.000Z', inputKind: 'choice',
      options: [{ id: 'phi', label: 'Eagles', count: null }, { id: 'dal', label: 'Cowboys', count: null }],
      prizeText: 'Stake × 1.5 back in FAAB · wager 1–10 FAAB',
      wager: { currency: 'faab', min: 1, max: 10, winMultiplier: 1.5, lossFraction: 0.5 },
      uniqueAnswers: false, sealed: false, mine: null, answers: null, resultSummary: null, myResult: null,
    },
    {
      id: 'cb-9-3', week: 9, title: 'Tribe sweep',
      question: 'Three Sunday props. Your tribe needs all three right.',
      kind: 'sweep', scope: 'tribe', status: 'locked',
      opensAt: '2026-11-05T17:00:00.000Z', locksAt: '2026-11-08T18:00:00.000Z', inputKind: 'sweep',
      options: [],
      props: [
        { id: 'p1', question: 'Most passing yards, early window', options: [{ id: 'p1a', label: 'Jalen Hurts' }, { id: 'p1b', label: 'Jordan Love' }] },
        { id: 'p2', question: 'Any overtime game on Sunday?', options: [{ id: 'p2a', label: 'Yes' }, { id: 'p2b', label: 'No' }] },
        { id: 'p3', question: 'Highest-scoring team of the day', options: [{ id: 'p3a', label: 'Lions' }, { id: 'p3b', label: 'Ravens' }, { id: 'p3c', label: 'Bills' }] },
      ],
      prizeText: 'FAAB taken from the other tribe ($10 per player)',
      wager: null, uniqueAnswers: false, sealed: false,
      mine: { answer: { picks: { p1: 'p1a', p2: 'p2b', p3: 'p3b' } }, wager: null, byMe: false },
      answers: [
        { name: 'Tala', answer: 'Jalen Hurts · No · Ravens' },
        { name: 'Manu', answer: 'Jordan Love · No · Lions' },
      ],
      resultSummary: null, myResult: null,
    },
    {
      id: 'cb-8-1', week: 8, title: 'Thursday night total',
      question: 'Total points in Thursday Night Football. Closest wins.',
      kind: 'game_total_closest', scope: 'individual', status: 'complete',
      opensAt: '2026-10-30T17:00:00.000Z', locksAt: '2026-11-03T00:15:00.000Z', inputKind: 'number',
      options: [], prizeText: '1st: +4 points in week 8', wager: null, uniqueAnswers: false, sealed: false,
      mine: { answer: { value: 44 }, wager: null, byMe: true },
      answers: [
        { name: 'Ciege', answer: '44' }, { name: 'Morgan', answer: '41' }, { name: 'Lee', answer: '47.5' },
        { name: 'Sam', answer: '38' }, { name: 'Avery', answer: '51' },
      ],
      resultSummary: 'Final: 45 points. Ciege was closest at 44 and takes +4 points.',
      myResult: 'won',
    },
    {
      id: 'cb-7-1', week: 7, title: 'Riddle of the reef',
      question: 'I have a crown but no kingdom, a buff but no tribe. What am I?',
      kind: 'puzzle', scope: 'individual', status: 'complete',
      opensAt: '2026-10-23T17:00:00.000Z', locksAt: '2026-10-25T17:00:00.000Z', inputKind: 'text',
      options: [], prizeText: '$15 FAAB', wager: null, uniqueAnswers: false, sealed: true,
      mine: { answer: { text: 'A pineapple' }, wager: null, byMe: true },
      answers: [{ name: 'Taylor', answer: 'The idol' }, { name: 'Ciege', answer: 'A pineapple' }, { name: 'Quinn', answer: 'An immunity necklace' }],
      resultSummary: 'Answer: an immunity necklace. Quinn solved it first.',
      myResult: 'lost',
    },
  ],
} satisfies { lang: ChallengeLang; challenges: BuilderChallengeView[] }

// ------------------------------------------------------------------ GET /api/survivor/rewards
// Route builds { rewards: [{ rewardId, type, status, week, applyWeek, holder, text, targets }] } inline
// (no exported type) — mirrored by RewardWire. `text` comes from the real describeSurvivorReward.
// `targets` exist only on a reward awaiting the viewer's choice: tribemates for tribemate_points.

type RewardWire = {
  rewardId: string
  type: SurvivorRewardType
  status: SurvivorRewardStatus
  week: number
  applyWeek: number
  holder: boolean
  text: string
  targets: { rosterId: string; name: string }[] | undefined
}

function reward(rewardId: string, spec: SurvivorRewardSpec, status: SurvivorRewardStatus, week: number, applyWeek: number, targets?: { rosterId: string; name: string }[]): RewardWire {
  return { rewardId, type: spec.type, status, week, applyWeek, holder: true, text: describeSurvivorReward({ spec, status, applyWeek }, 'en'), targets }
}

const rewards = {
  rewards: [
    reward('challenge:cb-8-1:r1:points', { type: 'tribemate_points', chooserRosterId: 'r1', points: 5 }, 'awaiting_choice', 8, 9, [
      { rosterId: 'r5', name: 'Avery' },
      { rosterId: 'r4', name: 'Jordan' },
      { rosterId: 'r2', name: 'Morgan' },
      { rosterId: 'r3', name: 'Riley Castellanos-Whitmore' },
    ]),
    reward('challenge:cb-8-1:r1:bonus', { type: 'score_bonus', rosterId: 'r1', points: 4 }, 'applied', 8, 8),
    reward('weekly_prize:w6:r1:faab', { type: 'faab_grant', rosterId: 'r1', amount: 15 }, 'applied', 6, 6),
    reward('auction:a-7:r1:blocker', { type: 'steal_blocker', rosterId: 'r1' }, 'available', 7, 7),
    reward('challenge:c-5:r1:trade', { type: 'free_trade_token', rosterId: 'r1', samePositionOnly: true }, 'available', 5, 5),
    reward('challenge:c-4:r1:deferred', { type: 'score_bonus', rosterId: 'r1', points: 3 }, 'deferred', 4, 10),
  ],
} satisfies { rewards: RewardWire[] }

// ------------------------------------------------------------------ GET /api/survivor/real-game-challenge
// Route: NextResponse.json(await loadRealGameBoard(leagueId, userId)) → RealGameBoard, read as-is.
// Picks are null while a challenge is open (hidden until kickoff), counts once locked.

const realGameBoard = {
  lang: 'en',
  current: [
    {
      id: 'rg-9-2', week: 9, title: 'Who wins: Bears at Packers?', description: 'Monday Night Football. Pick the winner before kickoff.',
      instructions: 'Pick a side. You can change it until kickoff.', scope: 'individual', status: 'open',
      locksAt: '2026-11-10T01:15:00.000Z',
      options: [{ id: 'chi', label: 'Bears', picks: null }, { id: 'gb', label: 'Packers', picks: null }],
      myPick: 'gb', outcome: null, answer: null, resultSummary: null, prize: { type: 'faab', amount: 5 }, winners: [],
    },
    {
      id: 'rg-9-1', week: 9, title: 'Who wins: Eagles at Cowboys?', description: 'Sunday Night Football. Pick the winner before kickoff.',
      instructions: 'Pick a side. You can change it until kickoff.', scope: 'individual', status: 'locked',
      locksAt: '2026-11-09T01:20:00.000Z',
      options: [{ id: 'phi', label: 'Eagles', picks: 6 }, { id: 'dal', label: 'Cowboys', picks: 3 }],
      myPick: 'phi', outcome: null, answer: null, resultSummary: null, prize: { type: 'faab', amount: 5 }, winners: [],
    },
  ],
  past: [
    {
      id: 'rg-8-1', week: 8, title: 'Who wins: Chiefs at Bills?', description: 'Sunday Night Football.',
      instructions: 'Pick a side. You can change it until kickoff.', scope: 'individual', status: 'complete',
      locksAt: '2026-11-02T01:20:00.000Z',
      options: [{ id: 'kc', label: 'Chiefs', picks: 5 }, { id: 'buf', label: 'Bills', picks: 4 }],
      myPick: 'kc', outcome: 'win', answer: { id: 'buf', label: 'Bills' }, resultSummary: 'Final: Bills 27, Chiefs 24.',
      prize: { type: 'faab', amount: 5 }, winners: ['Morgan', 'Lee', 'Sam', 'Quinn'],
    },
    {
      id: 'rg-7-1', week: 7, title: 'Who wins: Ravens at Steelers?', description: 'Sunday Night Football.',
      instructions: 'Pick a side. You can change it until kickoff.', scope: 'individual', status: 'complete',
      locksAt: '2026-10-26T00:20:00.000Z',
      options: [{ id: 'bal', label: 'Ravens', picks: 7 }, { id: 'pit', label: 'Steelers', picks: 3 }],
      myPick: 'bal', outcome: 'win', answer: { id: 'bal', label: 'Ravens' }, resultSummary: 'Final: Ravens 31, Steelers 17.',
      prize: { type: 'faab', amount: 5 }, winners: ['Ciege', 'Avery', 'Jordan', 'Lee', 'Taylor', 'Drew', 'Kai'],
    },
  ],
} satisfies RealGameBoard

// ------------------------------------------------------------------ GET /api/survivor/weekly-call
// Route: NextResponse.json(await loadWeeklyCallBoard(leagueId, userId)) → WeeklyCallBoard, read as-is.

const weeklyCallBoard = {
  current: {
    id: 'wc-9', week: 9, kind: 'top_tribe', title: 'Call the week: which tribe scores more?',
    description: 'Tala or Manu: which tribe puts up the bigger total in week 9?', status: 'locked',
    locksAt: '2026-11-08T18:00:00.000Z',
    options: [{ id: 'tribe-tala', label: 'Tala', calls: 4 }, { id: 'tribe-manu', label: 'Manu', calls: 5 }],
    myPick: 'tribe-tala', answer: null, correct: [], callCount: 9,
  },
  past: [
    {
      id: 'wc-8', week: 8, kind: 'top_scorer', title: 'Call the week: top scorer',
      description: 'Who posts the highest score in the league in week 8?', status: 'complete',
      locksAt: '2026-11-01T17:00:00.000Z',
      options: [
        { id: 'u-6', label: 'Lee', calls: 3 }, { id: 'u-you', label: 'Ciege', calls: 2 },
        { id: 'u-2', label: 'Morgan', calls: 3 }, { id: 'u-7', label: 'Sam', calls: 2 },
      ],
      myPick: 'u-6', answer: { id: 'u-6', label: 'Lee' }, correct: ['Ciege', 'Taylor', 'Quinn'], callCount: 10,
    },
    {
      id: 'wc-7', week: 7, kind: 'top_tribe', title: 'Call the week: which tribe scores more?',
      description: 'Tala or Manu: which tribe puts up the bigger total in week 7?', status: 'complete',
      locksAt: '2026-10-25T17:00:00.000Z',
      options: [{ id: 'tribe-tala', label: 'Tala', calls: 6 }, { id: 'tribe-manu', label: 'Manu', calls: 5 }],
      myPick: 'tribe-tala', answer: { id: 'tribe-tala', label: 'Tala' }, correct: ['Ciege', 'Morgan', 'Riley Castellanos-Whitmore', 'Jordan', 'Avery', 'Casey Vandermolen-Ruiz'], callCount: 11,
    },
  ],
  leaderboard: [
    { userId: 'u-6', name: 'Lee', correct: 6, calls: 8 },
    { userId: 'u-you', name: 'Ciege', correct: 5, calls: 8 },
    { userId: 'u-2', name: 'Morgan', correct: 5, calls: 8 },
    { userId: 'u-9', name: 'Quinn', correct: 4, calls: 7 },
    { userId: 'u-5', name: 'Avery', correct: 4, calls: 8 },
    { userId: 'u-7', name: 'Sam', correct: 3, calls: 8 },
    { userId: 'u-3', name: 'Riley Castellanos-Whitmore', correct: 3, calls: 6 },
    { userId: 'u-8', name: 'Taylor', correct: 2, calls: 8 },
    { userId: 'u-4', name: 'Jordan', correct: 2, calls: 5 },
  ],
} satisfies WeeklyCallBoard

// ------------------------------------------------------------------ GET /api/survivor/challenge
// Route: NextResponse.json({ challenges: await prisma.survivorChallenge.findMany(...) }) — raw Prisma
// rows, week desc, so Dates arrive as ISO strings. Typed as the Prisma row with Dates as strings. The
// challenges page keeps rows that are not weekly_call / real_game_pick and are complete/graded/resolved.

type Wire<T> = { [K in keyof T]: T[K] extends Date ? string : T[K] extends Date | null ? string | null : T[K] }
type ChallengeRow = Wire<SurvivorChallenge>

function challengeRow(p: Pick<ChallengeRow, 'id' | 'week' | 'title' | 'status' | 'challengeType'> & Partial<ChallengeRow>): ChallengeRow {
  const locks = p.locksAt ?? null
  return {
    leagueId: LEAGUE_ID, configId: 'cfg-e2e-survivor', configJson: null, lockAt: locks, resultJson: null,
    createdAt: '2026-09-01T12:00:00.000Z', updatedAt: '2026-11-09T12:00:00.000Z', auditLog: null, challengeNumber: 1,
    closesAt: null, description: '', instructions: '', locksAt: locks, penaltyDetails: null, penaltyType: null,
    resultSummary: null, rewardAmount: null, rewardDetails: null, rewardType: 'immunity', scope: 'tribe',
    submissionMode: 'tribe_chat', type: null, winnerTribeId: null, winnerUserIds: [],
    ...p,
  }
}

const challengeList = {
  challenges: [
    challengeRow({
      id: 'challenge-9', week: 9, title: 'Highest-scoring QB', status: 'closed', challengeType: 'prediction', submissionMode: 'pick',
      locksAt: '2026-11-09T18:00:00.000Z', description: 'Tribe immunity challenge',
      instructions: 'Pick the quarterback who scores the most fantasy points this week. The tribe with the most correct picks wins immunity.',
    }),
    challengeRow({ id: 'wc-9', week: 9, title: 'Call the week: which tribe scores more?', status: 'open', challengeType: 'weekly_call', scope: 'individual', rewardType: null }),
    challengeRow({ id: 'rg-9-1', week: 9, title: 'Who wins: Eagles at Cowboys?', status: 'open', challengeType: 'real_game_pick', scope: 'individual', rewardType: 'faab', rewardAmount: 5 }),
    challengeRow({
      id: 'challenge-8', week: 8, title: 'Bench points showdown', status: 'complete', challengeType: 'score_based', submissionMode: 'automatic',
      locksAt: '2026-11-02T18:00:00.000Z', winnerTribeId: 'tribe-manu', winnerUserIds: ['u-6', 'u-7', 'u-8', 'u-9'],
      resultSummary: 'Manu won immunity: 184.5 to Tala’s 171.2. Lee led everyone with 96.4.',
    }),
    challengeRow({ id: 'wc-8', week: 8, title: 'Call the week: top scorer', status: 'complete', challengeType: 'weekly_call', scope: 'individual', rewardType: null, resultSummary: 'Lee scored the most.' }),
    challengeRow({
      id: 'challenge-7', week: 7, title: 'Flex frenzy', status: 'complete', challengeType: 'prediction', submissionMode: 'pick',
      locksAt: '2026-10-26T17:00:00.000Z', winnerTribeId: 'tribe-tala', winnerUserIds: ['u-you', 'u-2', 'u-3', 'u-4', 'u-5'],
      resultSummary: 'Tala called 4 of 5 flex starters right and won immunity. Manu went to Tribal.',
    }),
    challengeRow({
      id: 'challenge-6', week: 6, title: 'Kicker roulette', status: 'graded', challengeType: 'prediction', submissionMode: 'pick',
      locksAt: '2026-10-19T17:00:00.000Z', winnerTribeId: 'tribe-manu', winnerUserIds: ['u-6', 'u-7', 'u-8', 'u-9'],
      resultSummary: 'Manu’s kicker pick scored 14. Tala went to Tribal and voted out Drew.',
    }),
    challengeRow({
      id: 'challenge-5', week: 5, title: 'Swap-week scramble', status: 'complete', challengeType: 'score_based', submissionMode: 'automatic',
      locksAt: '2026-10-12T17:00:00.000Z', rewardType: 'faab', rewardAmount: 10, winnerTribeId: 'tribe-tala',
      resultSummary: 'New tribes, first test: Tala outscored Manu by 22.6 and took $10 FAAB each.',
    }),
  ],
} satisfies { challenges: ChallengeRow[] }

// ------------------------------------------------------------------ GET /api/survivor/jury (+ part=qa, part=ballots)
// Routes: { view: FinaleRevealView } · { qa: JuryQaView } · { ballots: BallotRevealCouncil[] | null }.
// ⚠ Deliberately NOT the week-9 truth. In a real pre-merge week 9 the jury is empty, there are no
// finalists and ballots are null (the reveal waits for a complete season and the commissioner's
// opt-in), so both screens would show only placeholders. This is the finale shape over the SAME cast
// so the jury and finale screens render in full: jury = the three already voted out, finalists Ciege
// (the viewer), Lee and Morgan; the jury vote is open and sealed while closing speeches run.

const juryBench = [
  { rosterId: 'r10', name: 'Drew', votedOutWeek: 6 },
  { rosterId: 'r12', name: 'Kai', votedOutWeek: 7 },
  { rosterId: 'r11', name: 'Casey Vandermolen-Ruiz', votedOutWeek: 8 },
]
const finalists = [
  { rosterId: 'r1', name: 'Ciege' },
  { rosterId: 'r6', name: 'Lee' },
  { rosterId: 'r2', name: 'Morgan' },
]
const nameOf = (rosterId: string) => [...juryBench, ...finalists].find((p) => p.rosterId === rosterId)?.name ?? 'Manager'

const finaleView = {
  view: {
    leagueName: LEAGUE_NAME,
    week: 9,
    finalistCount: 3,
    open: true,
    sealed: true,
    votingDeadline: '2026-11-12T01:00:00.000Z',
    juryCount: juryBench.length,
    jury: juryBench,
    finalists: [
      { ...finalists[0], record: { immunityWins: 3, idolsPlayed: 0, seasonPoints: 1012.4, votesSurvived: 2 } },
      { ...finalists[1], record: { immunityWins: 5, idolsPlayed: 0, seasonPoints: 1068.9, votesSurvived: 0 } },
      { ...finalists[2], record: { immunityWins: 3, idolsPlayed: 1, seasonPoints: 987.1, votesSurvived: 3 } },
    ],
    viewer: { rosterId: 'r1', isJuror: false, isFinalist: true, myVoteFinalistRosterId: null },
    tiebreakRule: FINALE_TIEBREAK_RULE,
    reveal: null,
    champion: null,
  },
} satisfies { view: FinaleRevealView }

const q = (jurorRosterId: string, finalistRosterId: string, question: string, askedAt: string, answer: string | null, answeredAt: string | null, seenAt: string | null) => ({
  id: `${jurorRosterId}:${finalistRosterId}`, jurorRosterId, finalistRosterId, question, askedAt, answer, answeredAt, seenAt,
  jurorName: nameOf(jurorRosterId), finalistName: nameOf(finalistRosterId),
})

const juryQa = {
  qa: {
    canRead: true,
    settings: { juryQuestionsEnabled: true, closingSpeechesEnabled: true },
    windows: {
      questionsOpenAt: '2026-11-09T17:00:00.000Z',
      questionsDeadline: '2026-11-10T17:00:00.000Z',
      answersDeadline: '2026-11-11T01:00:00.000Z',
      speechesDeadline: '2026-11-11T17:00:00.000Z',
      questionState: 'open',
      answerState: 'open',
      speechState: 'open',
      votingHeldForSpeeches: true,
    },
    finaleOpen: true,
    voteComplete: false,
    finalists,
    questions: [
      q('r10', 'r1', 'You wrote my name down in week 6 and never told me why. Was it strategy or just my bench?', '2026-11-09T18:02:00.000Z',
        'Strategy. You were the swing vote on a tribe I needed to keep together, and the numbers said Tala was losing again. It was never personal.', '2026-11-09T21:40:00.000Z', null),
      q('r12', 'r1', 'Name one move you made this season that you are proud of.', '2026-11-09T19:15:00.000Z', null, null, null),
      q('r11', 'r6', 'Five immunity wins. Did you ever actually play the social game?', '2026-11-09T18:30:00.000Z',
        'I played it every week. Winning challenges meant I never had to beg for votes, and I never once lied to you.', '2026-11-09T20:05:00.000Z', '2026-11-09T22:10:00.000Z'),
      q('r10', 'r2', 'You survived three votes. Who saved you, and do they know it?', '2026-11-09T18:45:00.000Z', null, null, null),
    ],
    speeches: [
      {
        finalistRosterId: 'r6', name: 'Lee',
        text: 'I won when it mattered and I kept every promise I made at camp. I am asking you to reward the player who earned every week.',
        postedAt: '2026-11-09T22:30:00.000Z', updatedAt: '2026-11-09T22:30:00.000Z',
      },
      {
        finalistRosterId: 'r2', name: 'Morgan',
        text: 'Three times my name came out of that urn and three times I stayed. That was not luck. That was the game.',
        postedAt: '2026-11-09T23:05:00.000Z', updatedAt: '2026-11-10T00:12:00.000Z',
      },
    ],
    viewer: {
      rosterId: 'r1', isJuror: false, isFinalist: true, isHost: false,
      todo: { questionsToAsk: [], questionsToAnswer: ['r12:r1'], answersToRead: [], speechMissing: true },
    },
  },
} satisfies { qa: JuryQaView }

const ballotReveal = {
  ballots: [
    {
      councilId: 'council-6', week: 6, councilNumber: 1, phase: 'pre_merge', eliminatedName: 'Drew',
      ballots: [
        { voterName: 'Ciege', targetName: 'Drew', counted: true, late: false },
        { voterName: 'Morgan', targetName: 'Drew', counted: true, late: false },
        { voterName: 'Riley Castellanos-Whitmore', targetName: 'Drew', counted: true, late: false },
        { voterName: 'Casey Vandermolen-Ruiz', targetName: 'Drew', counted: true, late: false },
        { voterName: 'Drew', targetName: 'Morgan', counted: true, late: false },
        { voterName: 'Avery', targetName: 'Morgan', counted: true, late: false },
      ],
    },
    {
      councilId: 'council-7', week: 7, councilNumber: 2, phase: 'pre_merge', eliminatedName: 'Kai',
      ballots: [
        { voterName: 'Lee', targetName: 'Kai', counted: true, late: false },
        { voterName: 'Sam', targetName: 'Kai', counted: true, late: false },
        { voterName: 'Taylor', targetName: 'Kai', counted: true, late: false },
        { voterName: 'Quinn', targetName: 'Taylor', counted: true, late: false },
        { voterName: 'Kai', targetName: 'Taylor', counted: true, late: false },
      ],
    },
    {
      councilId: 'council-8', week: 8, councilNumber: 3, phase: 'pre_merge', eliminatedName: 'Casey Vandermolen-Ruiz',
      ballots: [
        { voterName: 'Ciege', targetName: 'Casey Vandermolen-Ruiz', counted: true, late: false },
        { voterName: 'Morgan', targetName: 'Casey Vandermolen-Ruiz', counted: true, late: false },
        { voterName: 'Riley Castellanos-Whitmore', targetName: 'Casey Vandermolen-Ruiz', counted: true, late: false },
        { voterName: 'Casey Vandermolen-Ruiz', targetName: 'Riley Castellanos-Whitmore', counted: true, late: false },
        { voterName: 'Jordan', targetName: 'Riley Castellanos-Whitmore', counted: true, late: false },
        { voterName: 'Avery', targetName: 'Riley Castellanos-Whitmore', counted: false, late: true },
      ],
    },
  ],
} satisfies { ballots: BallotRevealCouncil[] | null }

// ------------------------------------------------------------------ GET /api/survivor/tribes?view=shuffle
// Route: { view: TribeShuffleView } (TribeShuffle reads `data.view`). TribeShuffleView is the inferred
// return type of getTribeShuffleView. Tala and Manu are not catalogue names, so crestUrl is null and the
// secondary colour is the buff default (#f2c94c), exactly as buffColorsForTribe resolves them.
// Swap: revealed in week 5 (before/after snapshots include the three since voted out). Merge: ⚠ shown
// as just happened (unnamed, managers voting on the name) so the merge screen renders in full — the
// season fixture's own phase is still pre_merge, where the real route sends `merge: null`.

const swapBefore = [
  { tribeId: 'tribe-tala', rosterIds: ['r1', 'r2', 'r6', 'r7', 'r10', 'r12'] },
  { tribeId: 'tribe-manu', rosterIds: ['r3', 'r4', 'r5', 'r8', 'r9', 'r11'] },
]
const swapAfter = [
  { tribeId: 'tribe-tala', rosterIds: ['r1', 'r2', 'r3', 'r4', 'r5', 'r10', 'r11'] },
  { tribeId: 'tribe-manu', rosterIds: ['r6', 'r7', 'r8', 'r9', 'r12'] },
]
const oldTribe = new Map(swapBefore.flatMap((t) => t.rosterIds.map((id) => [id, t.tribeId] as const)))
const swapMembers = swapAfter.flatMap((t) => t.rosterIds.map((rosterId) => {
  const fromTribeId = oldTribe.get(rosterId) ?? null
  return { rosterId, tribeId: t.tribeId, fromTribeId, moved: fromTribeId !== t.tribeId }
}))

const tribeShuffle = {
  view: {
    language: 'en',
    swapWeek: 5,
    mergeWeek: 9,
    names: {
      r1: 'Ciege', r2: 'Morgan', r3: 'Riley Castellanos-Whitmore', r4: 'Jordan', r5: 'Avery',
      r6: 'Lee', r7: 'Sam', r8: 'Taylor', r9: 'Quinn', r10: 'Drew', r11: 'Casey Vandermolen-Ruiz', r12: 'Kai',
    },
    tribes: [
      { id: 'tribe-tala', name: 'Tala', crestUrl: null, primary: '#22d3ee', secondary: '#f2c94c', emoji: null },
      { id: 'tribe-manu', name: 'Manu', crestUrl: null, primary: '#fb923c', secondary: '#f2c94c', emoji: null },
    ],
    swap: {
      week: 5, sealed: false as const, revealAt: '2026-10-11T17:00:00.000Z',
      before: swapBefore, after: swapAfter, members: swapMembers, movedCount: swapMembers.filter((m) => m.moved).length,
    },
    merge: {
      tribeId: 'tribe-merged', name: null, provisionalName: 'The merged tribe', named: false, mode: 'manager_vote',
      suggestions: ['Koa', 'Vela', 'Marau'], myVote: 'Vela', votesIn: 5, votersTotal: 9, canVote: true, canName: false,
      members: ['r1', 'r2', 'r3', 'r4', 'r5', 'r6', 'r7', 'r8', 'r9'],
    },
    viewer: { isCommissioner: false, rosterId: 'r1' },
    sealed: false,
  },
} satisfies { view: TribeShuffleView }

// ------------------------------------------------------------------ GET /api/leagues/e2e-survivor/survivor/season-story
// Route: NextResponse.json(view) with no wrapper. The response type (SeasonStoryView) is local to
// lib/survivor/seasonStoryServer.ts and the component's `View` is local too — mirrored here. The nodes,
// trophies and records come from the SAME pure builders the route calls, fed this season's public facts.

type SeasonStoryWire = {
  leagueName: string
  sport: string
  season: number
  seasons: number[]
  nodes: SeasonTimelineNode[]
  trophies: TrophyRecord[]
  records: LeagueRecord[]
}

const moment = (id: string, m: Omit<SeasonStoryMoment, 'id' | 'final' | 'published'> & Partial<Pick<SeasonStoryMoment, 'published'>>): SeasonStoryMoment => ({ id, final: true, published: false, ...m })
const storyMoments: SeasonStoryMoment[] = [
  moment('m-24-champ', { type: 'champ', week: 13, displayName: 'Lee', season: 2024, tribeName: null, tally: '3–2', immunityWins: 4 }),
  moment('m-25-champ', { type: 'champ', week: 13, displayName: 'Avery', season: 2025, tribeName: null, tally: '5–1', immunityWins: 3 }),
  moment('m-25-out', { type: 'out', week: 12, displayName: 'Morgan', season: 2025, tribeName: 'Koa', tally: '4–1', weeks: 12 }),
  moment('m-25-idol', { type: 'idol', week: 10, displayName: 'Morgan', season: 2025, tribeName: null, published: true, idolName: 'Hidden immunity idol' }),
  moment('m-1-imm', { type: 'immunity', week: 1, displayName: 'Lee', season: 2026, tribeName: 'Manu' }),
  moment('m-3-imm', { type: 'immunity', week: 3, displayName: 'Lee', season: 2026, tribeName: 'Manu' }),
  moment('m-4-imm', { type: 'immunity', week: 4, displayName: 'Ciege', season: 2026, tribeName: 'Tala' }),
  moment('m-6-out', { type: 'out', week: 6, displayName: 'Drew', season: 2026, tribeName: 'Tala', tally: '4–2', weeks: 6 }),
  moment('m-7-out', { type: 'out', week: 7, displayName: 'Kai', season: 2026, tribeName: 'Manu', tally: '3–2', weeks: 7 }),
  moment('m-8-out', { type: 'out', week: 8, displayName: 'Casey Vandermolen-Ruiz', season: 2026, tribeName: 'Tala', tally: '3–2', weeks: 8 }),
]
const championships: ChampionshipRow[] = [
  { season: 2024, teamName: 'Lee', playoffRecord: null },
  { season: 2025, teamName: 'Avery', playoffRecord: null },
]

const seasonStory = {
  leagueName: LEAGUE_NAME,
  sport: 'NFL',
  season: 2026,
  seasons: [2026, 2025, 2024],
  nodes: buildSeasonTimeline({
    season: 2026,
    currentSeason: 2026,
    firstWeek: 1,
    lastWeek: 13,
    draftComplete: true,
    moments: storyMoments,
    swaps: [{ week: 5, revealedAt: '2026-10-11T17:00:00.000Z' }],
    jurors: [],
    mergeWeek: null,
    mergedTribeName: null,
    mergedCount: null,
    now: new Date('2026-11-09T12:00:00.000Z'),
  }),
  trophies: buildTrophyCase(championships, storyMoments, 'NFL'),
  records: buildLeagueRecords(storyMoments, championships),
} satisfies SeasonStoryWire

// ------------------------------------------------------------------ GET /api/leagues/e2e-survivor/survivor/premium
// Route: { ok: true, ...loadSurvivorPremiumIndex() } → { ok, plan, tiles }; the index type is local to
// survivorPremiumTileData.ts — mirrored here. Access comes from the real resolver for a member (not the
// commissioner, per fixture.json's settings) on AF Pro: player tiles open, host tiles commissioner-only.

const viewerPlan: AfPlanId = 'af_pro'
const premiumIndex = {
  ok: true as const,
  plan: viewerPlan,
  tiles: SURVIVOR_PREMIUM_COMMAND_TILES.map((tile) => ({
    tileId: tile.tileId,
    access: resolveSurvivorPremiumTileAccess({ tileId: tile.tileId, plan: viewerPlan, isCommissioner: false }),
  })),
} satisfies { ok: true; plan: AfPlanId | null; tiles: Array<{ tileId: string; access: SurvivorPremiumTileAccess }> }

// ------------------------------------------------------------------ export

export const SURVIVOR_EXTRA_API: { path: string; query?: Record<string, string>; body: unknown }[] = [
  { path: '/api/survivor/challenge-board', query: Q, body: challengeBoard },
  { path: '/api/survivor/rewards', query: Q, body: rewards },
  { path: '/api/survivor/real-game-challenge', query: Q, body: realGameBoard },
  { path: '/api/survivor/weekly-call', query: Q, body: weeklyCallBoard },
  { path: '/api/survivor/challenge', query: Q, body: challengeList },
  // Specific `part=` reads first (see the header note on matching).
  { path: '/api/survivor/jury', query: { ...Q, part: 'qa' }, body: juryQa },
  { path: '/api/survivor/jury', query: { ...Q, part: 'ballots' }, body: ballotReveal },
  { path: '/api/survivor/jury', query: Q, body: finaleView },
  { path: '/api/survivor/tribes', query: { ...Q, view: 'shuffle' }, body: tribeShuffle },
  { path: `/api/leagues/${LEAGUE_ID}/survivor/season-story`, body: seasonStory },
  { path: `/api/leagues/${LEAGUE_ID}/survivor/premium`, body: premiumIndex },
]
