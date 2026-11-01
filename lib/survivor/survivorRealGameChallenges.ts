import 'server-only'

import type { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { getTeamIndex } from '@/lib/follows/teamFollows'
import { resolveTeam } from '@/lib/follows/teamResolver'
import { LIVE_SCORE_SOURCES } from '@/lib/scores/liveSourceSelection'
import { easternCalendarDay } from '@/lib/sports-data/easternGameDay'
import { applyChallengeRewards } from './SurvivorEffectEngine'
import { planWeekWindow, type SurvivorPlanSport } from './survivorPlanCalendar'
import {
  classifyFixtureResult, groupFixtures, readRealGameSettings, realGameChallengeCopy, realGameLang, realGameResultSummary,
  REAL_GAME_CHALLENGE_NUMBERS, REAL_GAME_PICK_TYPE, REAL_GAME_SPORTS, selectFeaturedFixtures, settleRealGamePicks,
  type RealGameLang, type RealGameOutcome, type RealGamePrize, type RealGameRow, type TeamResolver, type TribeSnapshot,
} from './survivorRealGameChallengeLogic'

/**
 * Real-game challenges: each week the system features one or two REAL games of the league's sport
 * ("Who wins: Bills vs. Chiefs?"), every castaway picks a side before kickoff, and the stored final
 * score settles it — with a real prize for the winners. The rules (pick-the-winner only, the tribe
 * rule, when a final is trusted, void, the allowed prizes) are in survivorRealGameChallengeLogic.ts.
 *
 * DB-FIRST. Games and finals come from `SportsGame`, written by the score/schedule crons (ESPN and
 * TheSportsDB for NFL; TheSportsDB for NBA, NHL and MLB). Nothing here calls a provider.
 *
 * Best-effort, like the weekly call: the runner catches every failure, and nothing here holds up the
 * island. Idempotent: one set of challenges per week (upsert on the unique key), and a settlement is
 * claimed `open → settling` before any prize is paid, so a retry can never pay twice.
 */

export { REAL_GAME_PICK_TYPE } from './survivorRealGameChallengeLogic'

const HOUR_MS = 3_600_000
/** A daily sport's window is Eastern days; a 10pm Eastern start is the next UTC day. */
const EASTERN_OVERSELECT_MS = 6 * HOUR_MS
/** How far from the stored kickoff a settlement looks for the game's rows. */
const SETTLE_LOOKAROUND_MS = 36 * HOUR_MS

type ChallengeConfig = {
  kind: 'pick_winner'
  sport: string
  lang: RealGameLang
  fixture: { key: string; homeAbbr: string; awayAbbr: string; homeLabel: string; awayLabel: string; kickoff: string }
  options: Array<{ id: string; label: string }>
  tribes: TribeSnapshot[] | null
  prize: RealGamePrize
  rostered: number
}

function readConfig(value: unknown): ChallengeConfig | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const row = value as Record<string, unknown>
  const fixture = row.fixture as ChallengeConfig['fixture'] | undefined
  if (row.kind !== 'pick_winner' || !fixture || typeof fixture.homeAbbr !== 'string' || typeof fixture.awayAbbr !== 'string' || typeof fixture.kickoff !== 'string') return null
  const options = Array.isArray(row.options) ? (row.options as ChallengeConfig['options']).filter(o => typeof o?.id === 'string' && typeof o?.label === 'string') : []
  const prize = (row.prize ?? { type: 'none', amount: 0 }) as RealGamePrize
  return {
    kind: 'pick_winner', sport: String(row.sport ?? ''), lang: row.lang === 'es' ? 'es' : 'en', fixture, options,
    tribes: Array.isArray(row.tribes) ? (row.tribes as TribeSnapshot[]) : null,
    prize: (prize.type === 'faab' || prize.type === 'score_bonus') && typeof prize.amount === 'number' && prize.amount > 0 ? prize : { type: 'none', amount: 0 },
    rostered: typeof row.rostered === 'number' ? row.rostered : 0,
  }
}

async function teamResolver(sport: string): Promise<TeamResolver | null> {
  const index = await getTeamIndex(sport)
  return index ? (name: string) => resolveTeam(index, name, { exactNames: true }) : null
}

const pickOf = (value: unknown): string | null =>
  value && typeof value === 'object' && typeof (value as Record<string, unknown>).optionId === 'string' ? (value as Record<string, string>).optionId : null

/** The week's games, from the same ranked feeds and the same Eastern-day window the finalizer reads. */
async function readWindowGames(sport: SurvivorPlanSport, window: { start: Date; end: Date }): Promise<RealGameRow[]> {
  const daily = sport !== 'NFL'
  const rows = (await prisma.sportsGame.findMany({
    where: {
      sport,
      startTime: { gte: window.start, lt: new Date(window.end.getTime() + (daily ? EASTERN_OVERSELECT_MS : 0)) },
      source: { in: [...LIVE_SCORE_SOURCES] },
      OR: [{ seasonType: 'regular' }, { seasonType: null }],
    },
    select: { source: true, homeTeam: true, awayTeam: true, homeScore: true, awayScore: true, status: true, startTime: true, fetchedAt: true },
  })) as RealGameRow[]
  if (!daily) return rows
  return rows.filter(row => {
    const day = easternCalendarDay(row.startTime)
    return day != null && day >= window.start && day < window.end
  })
}

export type EnsureRealGameResult = 'created' | 'exists' | 'disabled' | 'unsupported_sport' | 'no_window' | 'no_team_index' | 'no_games'

/**
 * Open the week's real-game challenges once: up to two featured games, a pick-the-winner each,
 * locking at that game's kickoff. Tribe scope before the merge (with a snapshot of the tribes),
 * individual after.
 */
export async function ensureRealGameChallenges(
  leagueId: string,
  week: number,
  input: { sport: SurvivorPlanSport; season: number; merged: boolean; now?: Date },
): Promise<EnsureRealGameResult> {
  if (!(REAL_GAME_SPORTS as readonly string[]).includes(input.sport)) return 'unsupported_sport'
  const config = await prisma.survivorLeagueConfig.findUnique({ where: { leagueId }, select: { id: true, challengesSystemRun: true } })
  if (!config || config.challengesSystemRun === false) return 'disabled'
  const league = await prisma.league.findUnique({ where: { id: leagueId }, select: { settings: true, language: true } })
  const settings = readRealGameSettings(league?.settings)
  if (!settings.enabled) return 'disabled'
  const existing = await prisma.survivorChallenge.findFirst({ where: { leagueId, week, challengeType: REAL_GAME_PICK_TYPE }, select: { id: true } })
  if (existing) return 'exists'
  const now = input.now ?? new Date()
  const window = planWeekWindow(input.sport, input.season, week)
  if (!window) return 'no_window'
  const resolve = await teamResolver(input.sport)
  if (!resolve) return 'no_team_index'

  const fixtures = groupFixtures(await readWindowGames(input.sport, window), resolve, LIVE_SCORE_SOURCES)
  const active = await prisma.survivorPlayer.findMany({ where: { leagueId, playerState: 'active' }, select: { userId: true, tribeId: true, redraftRosterId: true } })
  const rosterIds = active.flatMap(p => (p.redraftRosterId ? [p.redraftRosterId] : []))
  const rosterPlayers = rosterIds.length
    ? await prisma.redraftRosterPlayer.findMany({ where: { rosterId: { in: rosterIds }, droppedAt: null }, select: { team: true } })
    : []
  const rosteredByTeam = new Map<string, number>()
  for (const player of rosterPlayers) {
    const abbr = player.team ? resolve(player.team) : null
    if (abbr) rosteredByTeam.set(abbr, (rosteredByTeam.get(abbr) ?? 0) + 1)
  }
  const featured = selectFeaturedFixtures(fixtures, rosteredByTeam, now, settings.perWeek)
  if (!featured.length) return 'no_games'

  let tribes: TribeSnapshot[] | null = null
  if (!input.merged) {
    const rows = await prisma.survivorTribe.findMany({ where: { leagueId, isActive: true, isMerged: false }, select: { id: true, name: true }, orderBy: { slotIndex: 'asc' } })
    const snapshot = rows.map(t => ({ id: t.id, name: t.name, memberUserIds: active.filter(p => p.tribeId === t.id).map(p => p.userId).sort() }))
    // Fewer than two tribes with castaways is not a tribe contest: score it individually.
    if (snapshot.filter(t => t.memberUserIds.length > 0).length >= 2) tribes = snapshot
  }
  const lang = realGameLang(league?.language)

  for (const [index, game] of featured.entries()) {
    const challengeNumber = REAL_GAME_CHALLENGE_NUMBERS[index]!
    const copy = realGameChallengeCopy({ lang, sport: input.sport, homeLabel: game.homeLabel, awayLabel: game.awayLabel, tribeScope: tribes != null, prize: settings.prize })
    const configJson: ChallengeConfig = {
      kind: 'pick_winner', sport: input.sport, lang,
      fixture: { key: game.key, homeAbbr: game.homeAbbr, awayAbbr: game.awayAbbr, homeLabel: game.homeLabel, awayLabel: game.awayLabel, kickoff: game.kickoff.toISOString() },
      options: [{ id: game.awayAbbr, label: game.awayLabel }, { id: game.homeAbbr, label: game.homeLabel }],
      tribes, prize: settings.prize, rostered: game.rostered,
    }
    const row = await prisma.survivorChallenge.upsert({
      where: { configId_week_challengeNumber_challengeType: { configId: config.id, week, challengeNumber, challengeType: REAL_GAME_PICK_TYPE } },
      create: {
        leagueId, configId: config.id, week, challengeNumber, challengeType: REAL_GAME_PICK_TYPE, scope: tribes ? 'tribe' : 'individual',
        title: copy.title, description: copy.description, instructions: copy.instructions,
        submissionMode: 'app', status: 'open', locksAt: game.kickoff, lockAt: game.kickoff,
        rewardType: settings.prize.type === 'none' ? null : settings.prize.type, rewardAmount: settings.prize.type === 'none' ? null : settings.prize.amount,
        configJson: configJson as unknown as Prisma.InputJsonValue,
      },
      update: {},
    })
    await prisma.survivorAuditEntry.create({
      data: {
        leagueId, week, category: 'challenge', action: 'real_game_pick_opened', relatedEntityId: row.id, relatedEntityType: 'challenge',
        data: { fixture: configJson.fixture, rostered: game.rostered, scope: tribes ? 'tribe' : 'individual', prize: settings.prize } as Prisma.InputJsonValue,
        isVisibleToCommissioner: true, isVisibleToPublic: true,
      },
    })
  }
  return 'created'
}

export type RealGameSubmitResult = { ok: true; pick: { id: string; label: string } } | { ok: false; status: 400 | 403 | 404 | 409; error: string }

/** Pick or change a side before kickoff. Castaways still in the game only: the prize is real. */
export async function submitRealGamePick(leagueId: string, userId: string, challengeId: string, optionId: string, now = new Date()): Promise<RealGameSubmitResult> {
  const challenge = await prisma.survivorChallenge.findFirst({ where: { id: challengeId, leagueId, challengeType: REAL_GAME_PICK_TYPE } })
  if (!challenge) return { ok: false, status: 404, error: 'That challenge was not found.' }
  const config = readConfig(challenge.configJson)
  const pick = config?.options.find(option => option.id === optionId)
  if (!config || !pick) return { ok: false, status: 400, error: 'Pick one of the two teams.' }
  const lock = challenge.locksAt ?? challenge.lockAt
  if (challenge.status !== 'open' || (lock && lock.getTime() <= now.getTime())) return { ok: false, status: 409, error: 'Picks are locked: the game has started.' }
  const player = await prisma.survivorPlayer.findFirst({ where: { leagueId, userId, playerState: 'active' }, select: { userId: true } })
  if (!player) return { ok: false, status: 403, error: 'Only castaways still in the game can pick.' }
  await prisma.survivorChallengeSubmission.upsert({
    where: { uniq_challenge_user: { challengeId, userId } },
    create: { challengeId, leagueId, userId, submission: { optionId } },
    update: { submission: { optionId }, submittedAt: now },
  })
  return { ok: true, pick }
}

export type SettleRealGameResult = { settled: number; voided: number; pending: number }

/**
 * Settle every locked real-game challenge whose game has a trusted final (or is void). Idempotent:
 * a challenge is claimed `open → settling` first, and only the claimer pays.
 */
export async function settleRealGameChallenges(leagueId: string, now = new Date()): Promise<SettleRealGameResult> {
  const out: SettleRealGameResult = { settled: 0, voided: 0, pending: 0 }
  const challenges = await prisma.survivorChallenge.findMany({
    where: { leagueId, challengeType: REAL_GAME_PICK_TYPE, status: 'open', locksAt: { lte: now } },
    orderBy: [{ week: 'asc' }, { challengeNumber: 'asc' }],
    take: 10,
  })
  for (const challenge of challenges) {
    const config = readConfig(challenge.configJson)
    if (!config || !(REAL_GAME_SPORTS as readonly string[]).includes(config.sport)) { out.pending++; continue }
    const resolve = await teamResolver(config.sport)
    if (!resolve) { out.pending++; continue }
    const kickoff = new Date(config.fixture.kickoff)
    const rows = (await prisma.sportsGame.findMany({
      where: {
        sport: config.sport,
        startTime: { gte: new Date(kickoff.getTime() - SETTLE_LOOKAROUND_MS), lte: new Date(kickoff.getTime() + SETTLE_LOOKAROUND_MS) },
        source: { in: [...LIVE_SCORE_SOURCES] },
      },
      select: { source: true, homeTeam: true, awayTeam: true, homeScore: true, awayScore: true, status: true, startTime: true, fetchedAt: true },
    })) as RealGameRow[]
    const outcome = classifyFixtureResult({ homeAbbr: config.fixture.homeAbbr, awayAbbr: config.fixture.awayAbbr, kickoff }, rows, resolve, now)
    if (outcome.state === 'pending') { out.pending++; continue }
    const done = await settleOne(leagueId, challenge, config, outcome, now)
    if (done === 'void') out.voided++
    else if (done === 'settled') out.settled++
  }
  return out
}

async function settleOne(
  leagueId: string,
  challenge: { id: string; week: number },
  config: ChallengeConfig,
  outcome: Exclude<RealGameOutcome, { state: 'pending' }>,
  now: Date,
): Promise<'settled' | 'void' | 'skipped'> {
  const submissions = await prisma.survivorChallengeSubmission.findMany({ where: { challengeId: challenge.id }, select: { id: true, userId: true, submission: true } })
  const picks = submissions.flatMap(row => { const optionId = pickOf(row.submission); return row.userId && optionId ? [{ userId: row.userId, optionId }] : [] })
  const active = await prisma.survivorPlayer.findMany({ where: { leagueId, playerState: 'active' }, select: { userId: true, redraftRosterId: true } })
  const answerAbbr = outcome.state === 'final' ? outcome.winnerAbbr : null
  const settlement = settleRealGamePicks({ answerAbbr, picks, tribes: config.tribes, activeUserIds: new Set(active.map(p => p.userId)) })

  // Claim before paying: only one runner may move this challenge out of `open`.
  const claim = await prisma.survivorChallenge.updateMany({ where: { id: challenge.id, status: 'open' }, data: { status: 'settling' } })
  if (claim.count !== 1) return 'skipped'

  const paid = outcome.state === 'final' && answerAbbr && config.prize.type !== 'none' ? settlement.prizeUserIds : []
  const rosterOf = new Map(active.map(p => [p.userId, p.redraftRosterId]))
  // FAAB keeps the original path; points go through the reward API (applyChallengeRewards routes
  // `score_bonus` to applySurvivorReward with a stable key per challenge and roster).
  const rewards = paid.flatMap(userId => { const rosterId = rosterOf.get(userId); return rosterId ? [{ rewardType: config.prize.type, rosterId, amount: config.prize.amount }] : [] })
  let appliedRewards: unknown[] = []
  let rewardError: string | null = null
  if (rewards.length) {
    try {
      appliedRewards = await applyChallengeRewards(challenge.id, { rewards, source: 'real_game_pick' })
    } catch (error) {
      // Recorded, never retried: a retry after a partial payout would pay twice.
      rewardError = error instanceof Error ? error.message : String(error)
      console.warn('[survivor] real-game prize failed', challenge.id, rewardError)
    }
  }

  const labels = Object.fromEntries(config.options.map(o => [o.id, o.label]))
  const tribeNames = new Map((config.tribes ?? []).map(t => [t.id, t.name]))
  const summary = realGameResultSummary({
    lang: config.lang, outcome, labels, pickCount: picks.length, correctCount: settlement.correctUserIds.length,
    paidCount: rewardError ? 0 : rewards.length, winnerTribeNames: settlement.winnerTribeIds.map(id => tribeNames.get(id) ?? id), prize: config.prize,
  })
  const correct = new Set(settlement.correctUserIds)
  const isVoid = outcome.state === 'void'
  const resultJson = {
    source: 'sports_game_final_v1',
    outcome: isVoid ? 'void' : answerAbbr ? 'win' : 'tie',
    voidReason: isVoid ? outcome.reason : null,
    answerId: answerAbbr,
    answerLabel: answerAbbr ? labels[answerAbbr] ?? null : null,
    scores: outcome.state === 'final' ? outcome.scores : null,
    confirmedBy: outcome.state === 'final' ? outcome.sources : [],
    pickCount: picks.length,
    correctUserIds: settlement.correctUserIds,
    winnerTribeIds: settlement.winnerTribeIds,
    tribeTally: settlement.tribeTally,
    prize: config.prize,
    prizeUserIds: rewardError ? [] : paid,
    appliedRewards,
    rewardError,
    settledAt: now.toISOString(),
  }
  await prisma.$transaction([
    ...submissions.map(row => prisma.survivorChallengeSubmission.update({
      where: { id: row.id },
      data: isVoid || !answerAbbr
        ? { isLocked: true, isCorrect: null, pointsEarned: 0 }
        : { isLocked: true, isCorrect: row.userId ? correct.has(row.userId) : false, pointsEarned: row.userId && correct.has(row.userId) ? 1 : 0 },
    })),
    prisma.survivorChallenge.update({
      where: { id: challenge.id },
      data: {
        status: 'complete', closesAt: now,
        winnerUserIds: rewardError ? [] : paid,
        winnerTribeId: settlement.winnerTribeIds.length === 1 ? settlement.winnerTribeIds[0]! : null,
        resultJson: resultJson as unknown as Prisma.InputJsonValue,
        resultSummary: summary,
      },
    }),
    prisma.survivorAuditEntry.create({
      data: {
        leagueId, week: challenge.week, category: 'challenge', action: 'real_game_pick_result', relatedEntityId: challenge.id, relatedEntityType: 'challenge',
        data: { outcome: resultJson.outcome, voidReason: resultJson.voidReason, answerId: answerAbbr, scores: resultJson.scores, confirmedBy: resultJson.confirmedBy, prizeUserIds: resultJson.prizeUserIds, rewardError } as Prisma.InputJsonValue,
        isVisibleToCommissioner: true, isVisibleToPublic: true,
      },
    }),
  ])
  return isVoid ? 'void' : 'settled'
}

export type RealGameChallengeView = {
  id: string
  week: number
  title: string
  description: string
  instructions: string
  scope: 'tribe' | 'individual'
  status: 'open' | 'locked' | 'complete'
  locksAt: string | null
  options: Array<{ id: string; label: string; picks: number | null }>
  myPick: string | null
  outcome: 'win' | 'tie' | 'void' | null
  answer: { id: string; label: string } | null
  resultSummary: string | null
  prize: RealGamePrize
  /** Who was paid, named, once settled. */
  winners: string[]
}

export type RealGameBoard = { lang: RealGameLang; current: RealGameChallengeView[]; past: RealGameChallengeView[] }

/** The challenges for one viewer. Picks stay hidden until kickoff, then show as counts per team. */
export async function loadRealGameBoard(leagueId: string, userId: string, now = new Date()): Promise<RealGameBoard> {
  const [league, challenges, players] = await Promise.all([
    prisma.league.findUnique({ where: { id: leagueId }, select: { language: true } }),
    prisma.survivorChallenge.findMany({
      where: { leagueId, challengeType: REAL_GAME_PICK_TYPE },
      orderBy: [{ week: 'desc' }, { challengeNumber: 'asc' }],
      take: 30,
      include: { submissions: { select: { userId: true, submission: true } } },
    }),
    prisma.survivorPlayer.findMany({ where: { leagueId }, select: { userId: true, displayName: true } }),
  ])
  const nameOf = new Map(players.map(p => [p.userId, p.displayName]))
  const views: RealGameChallengeView[] = challenges.flatMap(challenge => {
    const config = readConfig(challenge.configJson)
    if (!config) return []
    const lock = challenge.locksAt ?? challenge.lockAt
    const status: RealGameChallengeView['status'] = challenge.status === 'complete' ? 'complete' : lock && lock.getTime() <= now.getTime() ? 'locked' : 'open'
    const counts = new Map<string, number>()
    for (const row of challenge.submissions) { const pick = pickOf(row.submission); if (pick) counts.set(pick, (counts.get(pick) ?? 0) + 1) }
    const result = (challenge.resultJson ?? {}) as Record<string, unknown>
    const outcome = status === 'complete' && (result.outcome === 'win' || result.outcome === 'tie' || result.outcome === 'void') ? result.outcome : null
    const answerId = outcome === 'win' && typeof result.answerId === 'string' ? result.answerId : null
    return [{
      id: challenge.id, week: challenge.week, title: challenge.title, description: challenge.description, instructions: challenge.instructions,
      scope: challenge.scope === 'tribe' ? 'tribe' : 'individual', status,
      locksAt: lock ? lock.toISOString() : null,
      options: config.options.map(option => ({ ...option, picks: status === 'open' ? null : counts.get(option.id) ?? 0 })),
      myPick: pickOf(challenge.submissions.find(row => row.userId === userId)?.submission),
      outcome,
      answer: answerId ? config.options.find(o => o.id === answerId) ?? null : null,
      resultSummary: status === 'complete' ? challenge.resultSummary : null,
      prize: config.prize,
      winners: status === 'complete' ? challenge.winnerUserIds.map(id => nameOf.get(id) ?? 'A castaway') : [],
    }]
  })
  return { lang: realGameLang(league?.language), current: views.filter(v => v.status !== 'complete'), past: views.filter(v => v.status === 'complete') }
}
