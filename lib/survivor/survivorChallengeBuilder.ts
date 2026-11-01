import 'server-only'

import type { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { getTeamIndex } from '@/lib/follows/teamFollows'
import { resolveTeam } from '@/lib/follows/teamResolver'
import { LIVE_SCORE_SOURCES } from '@/lib/scores/liveSourceSelection'
import { normalizeNflWeeklyStats } from '@/lib/scoring-runtime/nflStatNormalization'
import { isChimmyRunning } from '@/lib/inactive-manager/inactiveManagerMode'
import { readPlayableChimmyLineups } from '@/lib/inactive-manager/chimmyPlayable'
import { isSeatPlaceholderUserId } from '@/lib/orphan-ai-manager/orphan-platform-ids'
import { applySurvivorReward, reverseSurvivorReward } from './survivorRewardEngine'
import { classifyFixtureResult, groupFixtures, type RealGameRow, type TeamResolver } from './survivorRealGameChallengeLogic'
import { planWeekWindow, type SurvivorPlanSport } from './survivorPlanCalendar'
import { readSurvivorFullSeasonPlan } from './survivorFullSeasonPlan'
import {
  answerKey, CHALLENGE_BUILDER_FIRST_NUMBER, CHALLENGE_BUILDER_MAX_PER_WEEK, CHALLENGE_BUILDER_TYPE, CHALLENGE_ANYTIME_KEYS, challengeSettlementSource,
  challengeError, challengeInputKind, challengeLang, challengeLockLine, challengeOpenLine, challengeResultLine, challengeSportKey,
  normalizeAnswerText, playerStatSupported, positionLeaderTruth, prizePhaseOf, readPrizePhaseRules, type ChallengeSettlementSource,
  choiceTruthFromNumber, clockStatus, describeChallengePrizes, editAfterAnswersError, planChallengePayouts,
  readChallengeBuilderConfig, readChallengeFaabWeeklyCap, readSubmission, scoreChallenge, validateChallengeAnswer,
  validateChallengeDraft, type ChallengeBuilderConfig, type ChallengeBuilderStatus, type ChallengeDraftInput,
  type ChallengeEntry, type ChallengeError, type ChallengeLang, type ChallengeTruth, type PlannedPayout,
} from './survivorChallengeBuilderModel'
import { chimmyChallengeAnswer, nudgeChimmyAnswer, type ChimmyChallengeFacts } from './survivorChallengeChimmyModel'

/**
 * The Survivor CHALLENGE BUILDER — the DB half. The rules, the validation and the scoring are in
 * `survivorChallengeBuilderModel.ts`; this file stores the challenge (`SurvivorChallenge`, type
 * `commissioner_challenge`, config in `configJson`, outcome in `resultJson` — no new table), takes
 * answers, settles from OUR stored data, pays through the reward API (`applySurvivorReward`) and
 * reverses through `reverseSurvivorReward`.
 *
 * DB-FIRST. Games and finals come from `SportsGame` (the score crons write it); player stats from
 * `PlayerWeeklyScore` (the redraft score sync writes it). Nothing here calls a provider.
 *
 * IDEMPOTENT. A settlement claims the row (`locked → settling`) before paying, and every reward has
 * a stable key (`cb:<challengeId>:r<round>:…`). A reversal bumps the round, so a re-settle pays
 * under fresh keys and never collides with a reversed one. Host lines use deterministic message ids.
 *
 * SPOILER-SAFE. Before the lock nobody sees another entrant's answer; with `sealed` nobody sees them
 * until the result. A result line never names an immunity winner while sealed immunity holds.
 */

const HOUR_MS = 3_600_000
/** Chimmy answers for its seats in the last hours before the lock (never early: tribe answers lock on first submit). */
export const CHIMMY_ANSWER_WINDOW_MS = 3 * HOUR_MS
const PRE_MERGE = new Set(['pre_merge', 'post_swap'])

type Row = {
  id: string
  leagueId: string
  week: number
  challengeNumber: number
  title: string
  status: string
  configJson: unknown
  resultJson: unknown
  locksAt: Date | null
}

type BuilderResult<T = Record<string, unknown>> = ({ ok: true } & T) | { ok: false; status: 400 | 403 | 404 | 409; error: string; code?: string }

const fail = (status: 400 | 403 | 404 | 409, error: string | ChallengeError) =>
  ({ ok: false as const, status, error: typeof error === 'string' ? error : error.message, ...(typeof error === 'string' ? {} : { code: error.code }) })

function rec(v: unknown): Record<string, unknown> {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {}
}

async function leagueFacts(leagueId: string) {
  const [league, game, config] = await Promise.all([
    prisma.league.findUnique({ where: { id: leagueId }, select: { language: true, settings: true, sport: true, season: true, userId: true } }),
    prisma.survivorGameState.findUnique({ where: { leagueId }, select: { currentWeek: true, phase: true, mergeTriggeredAt: true } }),
    prisma.survivorLeagueConfig.findUnique({ where: { leagueId }, select: { id: true } }),
  ])
  const lang = challengeLang(league?.language)
  const currentWeek = Math.max(1, game?.currentWeek ?? 1)
  const merged = Boolean(game?.mergeTriggeredAt) || (game?.phase != null && !PRE_MERGE.has(game.phase))
  // Which prize types this phase allows (the commissioner's per-phase rules; defaults = today's).
  const prizePhase = prizePhaseOf(game?.phase ?? null, merged)
  const prizePhaseRules = readPrizePhaseRules(league?.settings)
  return { league, game, configId: config?.id ?? null, lang, currentWeek, merged, prizePhase, prizePhaseRules }
}

async function otherFaabThisWeek(leagueId: string, week: number, exceptId?: string): Promise<number> {
  const rows = await prisma.survivorChallenge.findMany({
    where: { leagueId, week, rewardType: 'faab', status: { not: 'cancelled' }, ...(exceptId ? { id: { not: exceptId } } : {}) },
    select: { rewardAmount: true },
  })
  return rows.reduce((sum, r) => sum + (typeof r.rewardAmount === 'number' ? r.rewardAmount : 0), 0)
}

async function teamResolver(sport: string): Promise<TeamResolver | null> {
  const index = await getTeamIndex(sport)
  return index ? (name: string) => resolveTeam(index, name, { exactNames: true }) : null
}

const GAME_SELECT = { source: true, homeTeam: true, awayTeam: true, homeScore: true, awayScore: true, status: true, startTime: true, fetchedAt: true } as const

/** What the Hub's builder form needs to know about the league. */
export async function builderMeta(leagueId: string) {
  const facts = await leagueFacts(leagueId)
  return {
    currentWeek: facts.currentWeek,
    season: facts.league?.season ?? new Date().getUTCFullYear(),
    sport: String(facts.league?.sport ?? 'NFL').toUpperCase(),
    merged: facts.merged,
    lang: facts.lang,
    faabWeeklyCap: readChallengeFaabWeeklyCap(facts.league?.settings),
    prizePhase: facts.prizePhase,
    prizePhaseRules: facts.prizePhaseRules,
  }
}

// ── Commissioner pickers ──────────────────────────────────────────────────────────────────────────

export type ChallengeGameChoice = { sport: string; homeAbbr: string; awayAbbr: string; homeLabel: string; awayLabel: string; kickoff: string }

/** The stored games a challenge can be about: this Survivor week's window, or the next 10 days. */
export async function listChallengeGameChoices(leagueId: string, week: number, now = new Date()): Promise<ChallengeGameChoice[]> {
  const league = await prisma.league.findUnique({ where: { id: leagueId }, select: { sport: true, season: true, settings: true } })
  const sport = String(league?.sport ?? 'NFL').toUpperCase()
  const plan = readSurvivorFullSeasonPlan(league?.settings)
  const window = plan ? planWeekWindow(plan.sport as SurvivorPlanSport, plan.season, week) : null
  const start = window && window.start > now ? window.start : now
  const end = window ? new Date(Math.max(window.end.getTime(), start.getTime() + HOUR_MS)) : new Date(now.getTime() + 10 * 24 * HOUR_MS)
  const resolve = await teamResolver(sport)
  if (!resolve) return []
  const rows = (await prisma.sportsGame.findMany({
    where: { sport, startTime: { gte: start, lt: end }, source: { in: [...LIVE_SCORE_SOURCES] } },
    select: GAME_SELECT,
    take: 400,
  })) as RealGameRow[]
  return groupFixtures(rows, resolve, LIVE_SCORE_SOURCES)
    .sort((a, b) => a.kickoff.getTime() - b.kickoff.getTime() || a.key.localeCompare(b.key))
    .slice(0, 60)
    .map((f) => ({ sport, homeAbbr: f.homeAbbr, awayAbbr: f.awayAbbr, homeLabel: f.homeLabel, awayLabel: f.awayLabel, kickoff: f.kickoff.toISOString() }))
}

export type ChallengePlayerChoice = { playerId: string; playerName: string; position: string; team: string | null; sport: string }

/** Players on this league's active rosters (their stored weekly stats settle a player prop). */
export async function listChallengePlayerChoices(leagueId: string, query: string): Promise<ChallengePlayerChoice[]> {
  const cast = await prisma.survivorPlayer.findMany({ where: { leagueId, playerState: 'active' }, select: { redraftRosterId: true } })
  const rosterIds = cast.flatMap((c) => (c.redraftRosterId ? [c.redraftRosterId] : []))
  if (!rosterIds.length) return []
  const q = query.trim()
  const rows = await prisma.redraftRosterPlayer.findMany({
    where: { rosterId: { in: rosterIds }, droppedAt: null, ...(q ? { playerName: { contains: q, mode: 'insensitive' as const } } : {}) },
    select: { playerId: true, playerName: true, position: true, team: true, sport: true },
    take: 40,
    orderBy: { playerName: 'asc' },
  })
  const seen = new Set<string>()
  return rows.filter((r) => (seen.has(r.playerId) ? false : (seen.add(r.playerId), true))).map((r) => ({ ...r, sport: String(r.sport).toUpperCase() }))
}

// ── Create / edit / open / lock / cancel ─────────────────────────────────────────────────────────

function rowData(draft: { title: string; config: ChallengeBuilderConfig; faabPerWinner: number }, lang: ChallengeLang, week: number, now: Date) {
  const status: ChallengeBuilderStatus = new Date(draft.config.opensAt).getTime() <= now.getTime() ? 'open' : 'scheduled'
  return {
    title: draft.title,
    description: draft.config.question,
    instructions: describeChallengePrizes(draft.config, lang, week),
    scope: draft.config.scope,
    submissionMode: 'app',
    lockAt: new Date(draft.config.locksAt),
    locksAt: new Date(draft.config.locksAt),
    // The weekly FAAB cap (assertWeeklyChallengeRewardBalance) reads these two columns.
    rewardType: draft.faabPerWinner > 0 ? 'faab' : draft.config.prizes[0]?.rewards[0]?.type ?? null,
    rewardAmount: draft.faabPerWinner > 0 ? draft.faabPerWinner : null,
    type: draft.config.kind,
    status,
  }
}

async function audit(leagueId: string, week: number, action: string, challengeId: string, data: Record<string, unknown>, actorUserId?: string | null, isPublic = false) {
  await prisma.survivorAuditEntry.create({
    data: {
      leagueId, week, category: 'challenge', action, actorUserId: actorUserId ?? null, relatedEntityId: challengeId, relatedEntityType: 'challenge',
      data: data as Prisma.InputJsonValue, isVisibleToCommissioner: true, isVisibleToPublic: isPublic,
    },
  })
}

export async function createBuilderChallenge(leagueId: string, actorUserId: string, input: ChallengeDraftInput, now = new Date()): Promise<BuilderResult<{ challengeId: string }>> {
  const facts = await leagueFacts(leagueId)
  if (!facts.configId) return fail(409, 'This league has no Survivor setup yet.')
  const week = typeof input.week === 'number' ? input.week : facts.currentWeek
  const checked = validateChallengeDraft(input, {
    now, currentWeek: facts.currentWeek, merged: facts.merged, lang: facts.lang,
    faabWeeklyCap: readChallengeFaabWeeklyCap(facts.league?.settings), otherFaabThisWeek: await otherFaabThisWeek(leagueId, week),
    prizePhase: facts.prizePhase, prizePhaseRules: facts.prizePhaseRules,
  })
  if (!checked.ok) return fail(400, checked.error)
  const { draft } = checked
  const taken = await prisma.survivorChallenge.findMany({ where: { leagueId, week: draft.week, challengeType: CHALLENGE_BUILDER_TYPE }, select: { challengeNumber: true } })
  if (taken.length >= CHALLENGE_BUILDER_MAX_PER_WEEK) return fail(409, facts.lang === 'es' ? 'Ya hay demasiados retos esta semana.' : 'This week already has the most challenges allowed.')
  const challengeNumber = Math.max(CHALLENGE_BUILDER_FIRST_NUMBER - 1, ...taken.map((t) => t.challengeNumber)) + 1
  const row = await prisma.survivorChallenge.create({
    data: {
      leagueId, configId: facts.configId, week: draft.week, challengeNumber, challengeType: CHALLENGE_BUILDER_TYPE,
      ...rowData(draft, facts.lang, draft.week, now),
      configJson: { ...draft.config, lang: facts.lang } as unknown as Prisma.InputJsonValue,
    },
  })
  await audit(leagueId, draft.week, 'challenge_builder_created', row.id, { kind: draft.config.kind, scope: draft.config.scope, prizes: draft.config.prizes, locksAt: draft.config.locksAt }, actorUserId)
  if (row.status === 'open') await postOpenLine(leagueId, row.id, draft.title, draft.config, draft.week, facts.lang)
  return { ok: true, challengeId: row.id }
}

async function loadRow(leagueId: string, challengeId: string): Promise<(Row & { config: ChallengeBuilderConfig }) | null> {
  const row = await prisma.survivorChallenge.findFirst({
    where: { id: challengeId, leagueId, challengeType: CHALLENGE_BUILDER_TYPE },
    select: { id: true, leagueId: true, week: true, challengeNumber: true, title: true, status: true, configJson: true, resultJson: true, locksAt: true },
  })
  const config = row ? readChallengeBuilderConfig(row.configJson) : null
  return row && config ? { ...row, config } : null
}

export async function updateBuilderChallenge(leagueId: string, challengeId: string, actorUserId: string, input: ChallengeDraftInput, now = new Date()): Promise<BuilderResult> {
  const [facts, row] = await Promise.all([leagueFacts(leagueId), loadRow(leagueId, challengeId)])
  if (!row) return fail(404, 'No such challenge.')
  const status = clockStatus(row.status, row.config.opensAt, row.config.locksAt, now)
  if (status !== 'scheduled' && status !== 'open') return fail(409, challengeError('locked', facts.lang))
  const checked = validateChallengeDraft({ ...input, week: row.week }, {
    now, currentWeek: Math.min(facts.currentWeek, row.week), merged: facts.merged, lang: facts.lang,
    faabWeeklyCap: readChallengeFaabWeeklyCap(facts.league?.settings), otherFaabThisWeek: await otherFaabThisWeek(leagueId, row.week, row.id),
    prizePhase: facts.prizePhase, prizePhaseRules: facts.prizePhaseRules,
  })
  if (!checked.ok) return fail(400, checked.error)
  const answers = await prisma.survivorChallengeSubmission.count({ where: { challengeId } })
  // An open challenge keeps its opening time unless it has not opened yet.
  const next = { ...checked.draft.config, opensAt: status === 'open' ? row.config.opensAt : checked.draft.config.opensAt }
  if (answers > 0) {
    const err = editAfterAnswersError(row.config, next, facts.lang)
    if (err) return fail(409, err)
  }
  const data = rowData({ ...checked.draft, config: next }, facts.lang, row.week, now)
  await prisma.survivorChallenge.update({
    where: { id: challengeId },
    data: { ...data, status: status === 'open' ? 'open' : data.status, configJson: { ...next, lang: facts.lang } as unknown as Prisma.InputJsonValue },
  })
  await audit(leagueId, row.week, 'challenge_builder_edited', challengeId, { answers, locksAt: next.locksAt }, actorUserId)
  return { ok: true }
}

async function postOpenLine(leagueId: string, challengeId: string, title: string, config: ChallengeBuilderConfig, week: number, lang: ChallengeLang) {
  const { postChallengeBuilderLine } = await import('./leagueChatPoster')
  await postChallengeBuilderLine(leagueId, challengeOpenLine({ title, config, week, lang }), `survivor-cb:${challengeId}:open`, { type: 'challenge_builder', phase: 'open', challengeId, locksAt: config.locksAt })
    .catch((error) => console.warn('[survivor] challenge open line failed', error instanceof Error ? error.message : error))
}

async function postLockLine(leagueId: string, challengeId: string, title: string, lang: ChallengeLang) {
  const answers = await prisma.survivorChallengeSubmission.count({ where: { challengeId } })
  const { postChallengeBuilderLine } = await import('./leagueChatPoster')
  await postChallengeBuilderLine(leagueId, challengeLockLine({ title, answers, lang }), `survivor-cb:${challengeId}:lock`, { type: 'challenge_builder', phase: 'lock', challengeId, answers })
    .catch((error) => console.warn('[survivor] challenge lock line failed', error instanceof Error ? error.message : error))
}

export async function openBuilderChallengeNow(leagueId: string, challengeId: string, actorUserId: string, now = new Date()): Promise<BuilderResult> {
  const [facts, row] = await Promise.all([leagueFacts(leagueId), loadRow(leagueId, challengeId)])
  if (!row) return fail(404, 'No such challenge.')
  if (clockStatus(row.status, row.config.opensAt, row.config.locksAt, now) !== 'scheduled') return fail(409, facts.lang === 'es' ? 'Este reto no está programado.' : 'This challenge is not scheduled.')
  const config = { ...row.config, opensAt: now.toISOString() }
  await prisma.survivorChallenge.update({ where: { id: challengeId }, data: { status: 'open', configJson: { ...config, lang: facts.lang } as unknown as Prisma.InputJsonValue } })
  await audit(leagueId, row.week, 'challenge_builder_opened', challengeId, { by: 'commissioner' }, actorUserId)
  await postOpenLine(leagueId, challengeId, row.title, config, row.week, facts.lang)
  return { ok: true }
}

export async function lockBuilderChallengeNow(leagueId: string, challengeId: string, actorUserId: string | null, now = new Date()): Promise<BuilderResult> {
  const [facts, row] = await Promise.all([leagueFacts(leagueId), loadRow(leagueId, challengeId)])
  if (!row) return fail(404, 'No such challenge.')
  if (row.status !== 'open' && row.status !== 'scheduled') return fail(409, challengeError('locked', facts.lang))
  const config = new Date(row.config.locksAt).getTime() > now.getTime() ? { ...row.config, locksAt: now.toISOString() } : row.config
  const claim = await prisma.survivorChallenge.updateMany({
    where: { id: challengeId, status: { in: ['open', 'scheduled'] } },
    data: { status: 'locked', lockAt: new Date(config.locksAt), locksAt: new Date(config.locksAt), configJson: { ...config, lang: facts.lang } as unknown as Prisma.InputJsonValue },
  })
  if (claim.count !== 1) return { ok: true }
  await prisma.survivorChallengeSubmission.updateMany({ where: { challengeId }, data: { isLocked: true } })
  await audit(leagueId, row.week, 'challenge_builder_locked', challengeId, { by: actorUserId ? 'commissioner' : 'clock' }, actorUserId)
  await postLockLine(leagueId, challengeId, row.title, facts.lang)
  return { ok: true }
}

export async function cancelBuilderChallenge(leagueId: string, challengeId: string, actorUserId: string): Promise<BuilderResult> {
  const [facts, row] = await Promise.all([leagueFacts(leagueId), loadRow(leagueId, challengeId)])
  if (!row) return fail(404, 'No such challenge.')
  if (row.status === 'complete' || row.status === 'settling') return fail(409, facts.lang === 'es' ? 'Anula primero el resultado.' : 'Reverse the result first.')
  if (row.status === 'cancelled') return { ok: true }
  await prisma.survivorChallenge.update({ where: { id: challengeId }, data: { status: 'cancelled', closesAt: new Date() } })
  await audit(leagueId, row.week, 'challenge_builder_cancelled', challengeId, {}, actorUserId)
  return { ok: true }
}

// ── Answers ───────────────────────────────────────────────────────────────────────────────────────

export type SubmitAnswerResult = BuilderResult<{ submission: { answer: unknown; wager: number | null } }>

/**
 * One answer per entrant, and the first one stands (no take backs). Individual: the manager's own
 * roster. Tribe: the first member to submit answers for the whole tribe. Castaways still in the
 * game only. `asChimmy` is the runner submitting for a seat Chimmy plays.
 */
export async function submitBuilderAnswer(leagueId: string, userId: string, challengeId: string, raw: unknown, now = new Date()): Promise<SubmitAnswerResult> {
  const [facts, row] = await Promise.all([leagueFacts(leagueId), loadRow(leagueId, challengeId)])
  if (!row) return fail(404, 'No such challenge.')
  const es = facts.lang === 'es'
  const status = clockStatus(row.status, row.config.opensAt, row.config.locksAt, now)
  if (status === 'scheduled') return fail(409, es ? 'Este reto aún no está abierto.' : 'This challenge is not open yet.')
  if (status !== 'open') return fail(409, es ? 'Las respuestas están cerradas.' : 'Answers are locked.')
  const player = await prisma.survivorPlayer.findFirst({ where: { leagueId, userId, playerState: 'active' }, select: { userId: true, tribeId: true, redraftRosterId: true } })
  if (!player?.redraftRosterId) return fail(403, es ? 'Solo los náufragos que siguen en el juego pueden responder.' : 'Only castaways still in the game can answer.')
  if (row.config.scope === 'tribe' && !player.tribeId) return fail(403, es ? 'Necesitas una tribu para responder.' : 'You need a tribe to answer.')
  const checked = validateChallengeAnswer(row.config, raw, facts.lang)
  if (!checked.ok) return fail(400, checked.error)
  if (row.config.wager?.currency === 'faab') {
    const { readSurvivorFaabBalance } = await import('./survivorRewardEngine')
    const balance = await readSurvivorFaabBalance(prisma, leagueId, player.redraftRosterId)
    if ((balance ?? 0) < (checked.submission.wager ?? 0)) return fail(400, es ? 'No puedes apostar más FAAB del que tienes.' : 'You cannot stake more FAAB than you have.')
  }
  const existing = await prisma.survivorChallengeSubmission.findMany({ where: { challengeId }, select: { rosterId: true, tribeId: true, submission: true } })
  const mine = row.config.scope === 'tribe' ? existing.find((s) => s.tribeId === player.tribeId) : existing.find((s) => s.rosterId === player.redraftRosterId)
  if (mine) return fail(409, row.config.scope === 'tribe' ? (es ? 'Tu tribu ya respondió; la primera respuesta cuenta.' : 'Your tribe already answered; the first answer stands.') : (es ? 'Ya respondiste; la primera respuesta cuenta.' : 'You already answered; the first answer stands.'))
  if (row.config.uniqueAnswers) {
    const key = answerKey(checked.submission.answer)
    if (existing.some((s) => { const sub = readSubmission(s.submission); return sub && answerKey(sub.answer) === key })) {
      return { ok: false, status: 409, code: 'answer_taken', error: es ? 'Otra entrada ya eligió esa respuesta. Elige otra.' : 'Someone else already took that answer. Pick another.' }
    }
  }
  try {
    await prisma.survivorChallengeSubmission.create({
      data: {
        challengeId, leagueId, userId,
        rosterId: row.config.scope === 'tribe' ? null : player.redraftRosterId,
        tribeId: row.config.scope === 'tribe' ? player.tribeId : null,
        submission: checked.submission as unknown as Prisma.InputJsonValue,
        isLocked: true,
      },
    })
  } catch {
    // The unique keys (one per roster / tribe / user) caught a race: someone answered first.
    return fail(409, es ? 'Ya hay una respuesta registrada.' : 'An answer is already in.')
  }
  return { ok: true, submission: checked.submission }
}

// ── Settlement ────────────────────────────────────────────────────────────────────────────────────

export type AutoTruth =
  | { state: 'pending'; reason: string }
  | { state: 'void'; reason: string }
  | { state: 'final'; truth: ChallengeTruth; label: string }
  | { state: 'manual_only' }

/** The true answer from OUR stored data, or why there is none yet. */
export async function resolveAutoTruth(config: ChallengeBuilderConfig, now = new Date()): Promise<AutoTruth> {
  const source = challengeSettlementSource(config)
  if (source === 'manual') return { state: 'manual_only' }
  if (source === 'exact_answer') {
    // A puzzle settles against the commissioner's own answer the moment it locks.
    return config.puzzle?.answer ? { state: 'final', truth: { text: config.puzzle.answer }, label: config.puzzle.answer } : { state: 'manual_only' }
  }
  if (source === 'position_leader') return resolvePositionLeader(config)
  if (source === 'game' && config.game) {
    const resolve = await teamResolver(config.game.sport)
    if (!resolve) return { state: 'pending', reason: 'no_team_index' }
    const kickoff = new Date(config.game.kickoff)
    const rows = (await prisma.sportsGame.findMany({
      where: { sport: config.game.sport, startTime: { gte: new Date(kickoff.getTime() - 36 * HOUR_MS), lte: new Date(kickoff.getTime() + 36 * HOUR_MS) }, source: { in: [...LIVE_SCORE_SOURCES] } },
      select: GAME_SELECT,
    })) as RealGameRow[]
    const outcome = classifyFixtureResult({ homeAbbr: config.game.homeAbbr, awayAbbr: config.game.awayAbbr, kickoff }, rows, resolve, now)
    if (outcome.state === 'pending') return { state: 'pending', reason: outcome.reason }
    if (outcome.state === 'void') return { state: 'void', reason: outcome.reason }
    const total = Object.values(outcome.scores).reduce((a, b) => a + b, 0)
    if (config.kind === 'pick_winner') {
      if (!outcome.winnerAbbr) return { state: 'void', reason: 'tie' }
      const label = config.options.find((o) => o.id === outcome.winnerAbbr)?.label ?? outcome.winnerAbbr
      return { state: 'final', truth: { optionId: outcome.winnerAbbr }, label }
    }
    if (config.kind === 'game_total_over_under') {
      const truth = choiceTruthFromNumber(config.kind, total, config.line)
      return truth === 'void' ? { state: 'void', reason: 'push' } : { state: 'final', truth, label: `${total} (${'optionId' in truth ? truth.optionId : ''})` }
    }
    return { state: 'final', truth: { value: total }, label: String(total) }
  }
  if (source === 'player_stat' && config.player) {
    const p = config.player
    const row = await prisma.playerWeeklyScore.findFirst({ where: { playerId: p.playerId, week: p.statWeek, season: p.season, sport: { in: [p.sport, p.sport.toLowerCase()] } }, select: { stats: true, fantasyPts: true, isFinalized: true } })
    if (!row || !row.isFinalized) return { state: 'pending', reason: row ? 'not_final' : 'no_stats_stored' }
    const value = playerStatValue(p.stat, p.sport, row.stats, row.fantasyPts)
    if (value == null) return { state: 'manual_only' }
    const truth = choiceTruthFromNumber(config.kind, value, config.line)
    return truth === 'void' ? { state: 'void', reason: 'push' } : { state: 'final', truth, label: `${p.playerName}: ${value}` }
  }
  return { state: 'manual_only' }
}

/**
 * Position leaders from `PlayerWeeklyScore`: the option player with the most stored fantasy points
 * in that sport week. Pending until the week has finalized rows; an option player with no row that
 * week (did not play) counts as 0 once any option row is final.
 */
async function resolvePositionLeader(config: ChallengeBuilderConfig): Promise<AutoTruth> {
  const p = config.position
  const ids = config.options.flatMap((o) => (o.playerId ? [o.playerId] : []))
  if (!p || !ids.length) return { state: 'manual_only' }
  const rows = await prisma.playerWeeklyScore.findMany({
    where: { playerId: { in: ids }, week: p.statWeek, season: p.season, sport: { in: sportSpellings(p.sport) } },
    select: { playerId: true, fantasyPts: true, isFinalized: true },
  })
  if (!rows.some((r) => r.isFinalized)) return { state: 'pending', reason: rows.length ? 'not_final' : 'no_stats_stored' }
  if (rows.some((r) => !r.isFinalized)) return { state: 'pending', reason: 'not_final' }
  const points = new Map(ids.map((id) => [id, 0]))
  for (const r of rows) points.set(r.playerId, Number.isFinite(r.fantasyPts) ? r.fantasyPts : 0)
  const truth = positionLeaderTruth(config.options, points)
  if (!truth || !('optionId' in truth)) return { state: 'pending', reason: 'no_stats_stored' }
  const winners = [truth.optionId, ...(truth.tiedOptionIds ?? [])].map((id) => config.options.find((o) => o.id === id)?.label ?? id)
  const top = config.options.find((o) => o.id === truth.optionId)?.playerId
  return { state: 'final', truth, label: `${winners.join(' / ')} (${top ? points.get(top) : ''})` }
}

/** The spellings a stored row's sport may use (`NCAAF` rows may say `NCAAFB`, and lower case). */
function sportSpellings(sport: string): string[] {
  const key = challengeSportKey(sport)
  const all = new Set([sport, sport.toLowerCase(), key, key.toLowerCase()])
  if (key === 'NCAAF') { all.add('NCAAFB'); all.add('ncaafb') }
  if (key === 'NCAAB') { all.add('NCAABB'); all.add('ncaabb') }
  return [...all]
}

/**
 * One stored stat. Null when that stat is not stored for this sport (then settle by hand). NFL reads
 * the normalized NFL keys; every other sport stores its canonical keys as-is (see
 * `CHALLENGE_SPORT_STATS`). `total_td` is the sport's "anytime" event (`CHALLENGE_ANYTIME_KEYS`).
 */
export function playerStatValue(stat: string, sport: string, stats: unknown, fantasyPts: number): number | null {
  if (stat === 'fantasy_points') return Number.isFinite(fantasyPts) ? fantasyPts : null
  const key = challengeSportKey(sport)
  if (stat === 'total_td' && key !== 'NFL') {
    const keys = CHALLENGE_ANYTIME_KEYS[key]
    if (!keys) return null
    const s = rec(stats)
    return keys.reduce((sum, k) => sum + (typeof s[k] === 'number' && Number.isFinite(s[k]) ? (s[k] as number) : 0), 0)
  }
  if (!playerStatSupported(key, stat)) return null
  if (key !== 'NFL') {
    const v = rec(stats)[stat]
    return typeof v === 'number' && Number.isFinite(v) ? v : 0
  }
  const s = normalizeNflWeeklyStats(stats)
  if (stat === 'total_td') return (s.rush_td ?? 0) + (s.rec_td ?? 0) + (s.fumble_td ?? 0)
  const v = s[stat]
  return typeof v === 'number' ? v : 0
}

export type ManualSettleInput = { truth?: unknown; places?: unknown; void?: unknown }

function readManual(config: ChallengeBuilderConfig, raw: ManualSettleInput | null | undefined, lang: ChallengeLang): { truth: ChallengeTruth; label: string } | { places: { place: number; entrantIds: string[] }[] } | 'void' | string | null {
  if (!raw) return null
  if (raw.void === true) return 'void'
  const es = lang === 'es'
  if (raw.places != null) {
    if (!Array.isArray(raw.places) || !raw.places.length) return es ? 'Nombra al menos un ganador.' : 'Name at least one winner.'
    const places = raw.places.map((p) => ({ place: Number(rec(p).place), entrantIds: Array.isArray(rec(p).entrantIds) ? (rec(p).entrantIds as unknown[]).filter((x): x is string => typeof x === 'string') : [] }))
    if (places.some((p) => !Number.isInteger(p.place) || p.place < 1 || p.place > 5 || !p.entrantIds.length)) return es ? 'Los ganadores no son válidos.' : 'The winners are not valid.'
    return { places }
  }
  const t = rec(raw.truth)
  const inputKind = challengeInputKind(config.kind)
  if (inputKind === 'text') {
    // A puzzle settled by hand: the commissioner confirms (or corrects) the answer to match against.
    const text = typeof t.text === 'string' ? t.text.trim() : ''
    if (!text || !normalizeAnswerText(text)) return es ? 'Escribe la respuesta correcta.' : 'Enter the right answer.'
    return { truth: { text: text.slice(0, 200) }, label: text.slice(0, 200) }
  }
  if (inputKind === 'sweep') {
    const given = rec(t.picks)
    const picks: Record<string, string> = {}
    for (const prop of config.props ?? []) {
      const option = prop.options.find((o) => o.id === given[prop.id])
      if (!option) return es ? 'Marca la respuesta correcta de cada apuesta.' : 'Mark the right answer on every prop.'
      picks[prop.id] = option.id
    }
    const label = (config.props ?? []).map((p) => p.options.find((o) => o.id === picks[p.id])?.label ?? '').join(' · ')
    return { truth: { picks }, label }
  }
  if (inputKind === 'number') {
    const v = typeof t.value === 'string' ? Number(t.value) : t.value
    if (typeof v !== 'number' || !Number.isFinite(v) || v < 0 || v > 100000) return es ? 'Escribe el valor real.' : 'Enter the true value.'
    return { truth: { value: Math.round(v * 100) / 100 }, label: String(Math.round(v * 100) / 100) }
  }
  const option = config.options.find((o) => o.id === t.optionId)
  if (!option) return es ? 'Elige la respuesta correcta.' : 'Choose the right answer.'
  return { truth: { optionId: option.id }, label: option.label }
}

type Entrants = { entries: ChallengeEntry[]; recipients: Map<string, string[]>; names: Map<string, string>; activeTribeIds: string[] }

async function loadEntrants(leagueId: string, challengeId: string, config: ChallengeBuilderConfig): Promise<Entrants> {
  const [subs, cast, tribes] = await Promise.all([
    prisma.survivorChallengeSubmission.findMany({ where: { challengeId }, select: { rosterId: true, tribeId: true, submission: true, submittedAt: true } }),
    prisma.survivorPlayer.findMany({ where: { leagueId, playerState: 'active' }, select: { userId: true, tribeId: true, redraftRosterId: true, displayName: true } }),
    prisma.survivorTribe.findMany({ where: { leagueId, isActive: true }, select: { id: true, name: true } }),
  ])
  const entries: ChallengeEntry[] = []
  for (const s of subs) {
    const submission = readSubmission(s.submission)
    const entrantId = config.scope === 'tribe' ? s.tribeId : s.rosterId
    if (submission && entrantId) entries.push({ entrantId, submission, submittedAt: s.submittedAt })
  }
  const recipients = new Map<string, string[]>()
  const names = new Map<string, string>()
  if (config.scope === 'tribe') {
    for (const t of tribes) {
      names.set(t.id, t.name)
      recipients.set(t.id, cast.filter((c) => c.tribeId === t.id && c.redraftRosterId).map((c) => c.redraftRosterId!))
    }
  } else {
    for (const c of cast) if (c.redraftRosterId) { recipients.set(c.redraftRosterId, [c.redraftRosterId]); names.set(c.redraftRosterId, c.displayName) }
  }
  return { entries, recipients, names, activeTribeIds: tribes.map((t) => t.id) }
}

export type SettlementPreview = {
  truthLabel: string | null
  voided: boolean
  places: { place: number; names: string[] }[]
  payouts: { name: string; text: string; reason: string }[]
}

function roundOf(result: unknown): number {
  const r = rec(result)
  return typeof r.round === 'number' && Number.isInteger(r.round) ? r.round : 0
}

function describePayout(p: PlannedPayout, lang: ChallengeLang): string {
  const es = lang === 'es'
  if (p.kind === 'immunity') return es ? 'Inmunidad individual' : 'Individual immunity'
  const s = p.spec
  switch (s.type) {
    case 'score_bonus': return `+${s.points} ${es ? 'puntos' : 'points'}`
    case 'score_penalty': return `−${s.points} ${es ? 'puntos' : 'points'}`
    case 'faab_grant': return `+$${s.amount} FAAB`
    case 'faab_penalty': return `−$${s.amount} FAAB`
    case 'faab_transfer': return es ? `$${s.amount} de FAAB de otra tribu` : `$${s.amount} FAAB from another tribe`
    case 'tribemate_points': return es ? `${s.points} puntos para un compañero` : `${s.points} points for a tribemate`
    case 'free_trade_token': return es ? 'Intercambio libre' : 'Free trade'
    case 'steal_blocker': return es ? 'Bloqueador de robos' : 'Steal blocker'
    case 'steal': return es ? `Robo de ${s.what === 'faab' ? `$${s.amount}` : `${s.amount} pts`}` : `Steal of ${s.what === 'faab' ? `$${s.amount}` : `${s.amount} pts`}`
    case 'advantage': return es ? 'Ventaja' : 'Advantage'
  }
}

async function planSettlement(leagueId: string, row: Row & { config: ChallengeBuilderConfig }, manual: ManualSettleInput | null, lang: ChallengeLang, now: Date):
  Promise<{ ok: false; status: 400 | 409; error: string } | { ok: true; pending?: string; voided: boolean; truthLabel: string | null; truth: ChallengeTruth | null; score: ReturnType<typeof scoreChallenge> | null; payouts: PlannedPayout[]; entrants: Entrants }> {
  const entrants = await loadEntrants(leagueId, row.id, row.config)
  const parsed = readManual(row.config, manual, lang)
  if (parsed === 'void') return { ok: true, voided: true, truthLabel: null, truth: null, score: null, payouts: [], entrants }
  if (typeof parsed === 'string') return { ok: false, status: 400, error: parsed }
  let truth: ChallengeTruth | null = null
  let truthLabel: string | null = null
  let score: ReturnType<typeof scoreChallenge> | null = null
  if (parsed && 'places' in parsed) {
    const known = new Set(entrants.entries.map((e) => e.entrantId))
    if (parsed.places.some((p) => p.entrantIds.some((id) => !known.has(id)))) return { ok: false, status: 400, error: lang === 'es' ? 'Solo puede ganar quien respondió.' : 'Only entrants who answered can win.' }
    const winners = new Set(parsed.places.flatMap((p) => p.entrantIds))
    score = { places: [...parsed.places].sort((a, b) => a.place - b.place), correctIds: parsed.places.find((p) => p.place === 1)?.entrantIds ?? [], wrongIds: challengeInputKind(row.config.kind) !== 'number' ? entrants.entries.map((e) => e.entrantId).filter((id) => !winners.has(id)) : [], ranked: [] }
  } else {
    if (parsed) { truth = parsed.truth; truthLabel = parsed.label }
    else {
      const auto = await resolveAutoTruth(row.config, now)
      if (auto.state === 'pending') return { ok: true, pending: auto.reason, voided: false, truthLabel: null, truth: null, score: null, payouts: [], entrants }
      if (auto.state === 'manual_only') return { ok: true, pending: 'manual_only', voided: false, truthLabel: null, truth: null, score: null, payouts: [], entrants }
      if (auto.state === 'void') return { ok: true, voided: true, truthLabel: auto.reason, truth: null, score: null, payouts: [], entrants }
      truth = auto.truth
      truthLabel = auto.label
    }
    score = scoreChallenge(row.config, entrants.entries, truth)
  }
  const payouts = planChallengePayouts(row.config, score, entrants.entries, {
    challengeId: row.id, week: row.week, round: roundOf(row.resultJson), recipients: entrants.recipients, activeTribeIds: entrants.activeTribeIds,
  })
  return { ok: true, voided: false, truthLabel, truth, score, payouts, entrants }
}

/** What a settlement would pay — the commissioner's confirm step. Changes nothing. */
export async function previewBuilderSettlement(leagueId: string, challengeId: string, manual: ManualSettleInput | null, now = new Date()): Promise<BuilderResult<{ preview: SettlementPreview; pending: string | null }>> {
  const [facts, row] = await Promise.all([leagueFacts(leagueId), loadRow(leagueId, challengeId)])
  if (!row) return fail(404, 'No such challenge.')
  const plan = await planSettlement(leagueId, row, manual, facts.lang, now)
  if (!plan.ok) return fail(plan.status, plan.error)
  const castNames = await rosterNames(leagueId)
  return {
    ok: true,
    pending: plan.pending ?? null,
    preview: {
      truthLabel: plan.truthLabel,
      voided: plan.voided,
      places: (plan.score?.places ?? []).map((p) => ({ place: p.place, names: p.entrantIds.map((id) => plan.entrants.names.get(id) ?? id) })),
      payouts: plan.payouts.map((p) => ({ name: castNames.get(p.kind === 'immunity' ? p.rosterId : rosterOfSpec(p.spec) ?? '') ?? plan.entrants.names.get(p.entrantId) ?? p.entrantId, text: describePayout(p, facts.lang), reason: p.reason })),
    },
  }
}

function rosterOfSpec(spec: unknown): string | null {
  const s = rec(spec)
  return (typeof s.rosterId === 'string' && s.rosterId) || (typeof s.chooserRosterId === 'string' && s.chooserRosterId) || (typeof s.thiefRosterId === 'string' && s.thiefRosterId) || null
}

async function rosterNames(leagueId: string): Promise<Map<string, string>> {
  const rows = await prisma.survivorPlayer.findMany({ where: { leagueId }, select: { redraftRosterId: true, displayName: true } })
  return new Map(rows.flatMap((r) => (r.redraftRosterId ? [[r.redraftRosterId, r.displayName] as const] : [])))
}

export type SettleOutcome = 'settled' | 'void' | 'pending' | 'skipped'

/**
 * Settle a locked challenge: from the stored data, or from the commissioner's answer / winners
 * (`manual`). Claims `locked → settling` before paying, so only one caller ever pays.
 */
export async function settleBuilderChallenge(leagueId: string, challengeId: string, opts: { manual?: ManualSettleInput | null; actorUserId?: string | null; now?: Date } = {}): Promise<BuilderResult<{ outcome: SettleOutcome; pending?: string }>> {
  const now = opts.now ?? new Date()
  const [facts, row] = await Promise.all([leagueFacts(leagueId), loadRow(leagueId, challengeId)])
  if (!row) return fail(404, 'No such challenge.')
  const status = clockStatus(row.status, row.config.opensAt, row.config.locksAt, now)
  if (status !== 'locked') return fail(409, facts.lang === 'es' ? 'Solo se resuelve un reto cerrado.' : 'Only a locked challenge can be settled.')
  // The clock locked it but the runner has not stamped it yet: stamp it now (posts the lock line once).
  if (row.status === 'open' || row.status === 'scheduled') await lockBuilderChallengeNow(leagueId, challengeId, null, now)
  const plan = await planSettlement(leagueId, row, opts.manual ?? null, facts.lang, now)
  if (!plan.ok) return fail(plan.status, plan.error)
  if (plan.pending) return { ok: true, outcome: 'pending', pending: plan.pending }

  const claim = await prisma.survivorChallenge.updateMany({ where: { id: challengeId, status: 'locked' }, data: { status: 'settling' } })
  if (claim.count !== 1) return { ok: true, outcome: 'skipped' }

  const rewardIds: string[] = []
  const immunityRosterIds: string[] = []
  const failures: { key: string; error: string }[] = []
  const label = { kind: 'challenge' as const, id: challengeId, label: row.title.slice(0, 120) }
  for (const p of plan.payouts) {
    try {
      if (p.kind === 'immunity') {
        const r = await prisma.survivorPlayer.updateMany({ where: { leagueId, redraftRosterId: p.rosterId, playerState: 'active' }, data: { hasImmunityThisWeek: true, immunitySource: 'challenge_win' } })
        if (r.count > 0) immunityRosterIds.push(p.rosterId)
        continue
      }
      const result = await applySurvivorReward({ leagueId, idempotencyKey: p.key, source: label, week: row.week, reward: p.spec, deferToWeek: p.deferToWeek, actorUserId: opts.actorUserId ?? null })
      if (result.ok) rewardIds.push(result.rewardId)
      else failures.push({ key: p.key, error: result.error })
    } catch (error) {
      failures.push({ key: p.key, error: error instanceof Error ? error.message : String(error) })
    }
  }

  const winnerIds = plan.score?.places.flatMap((p) => p.entrantIds) ?? []
  const winnerNames = [...new Set(winnerIds.map((id) => plan.entrants.names.get(id) ?? id))]
  const hasImmunity = plan.payouts.some((p) => p.kind === 'immunity')
  const { loadImmunitySealed } = await import('./survivorSealedImmunityState')
  const sealedImmunity = hasImmunity && (await loadImmunitySealed(leagueId, row.week))
  const summary = challengeResultLine({ title: row.title, truthLabel: plan.truthLabel, winnerNames, voided: plan.voided, sealedImmunity, lang: facts.lang })
  const previous = rec(row.resultJson)
  const resultJson = {
    source: opts.manual ? 'commissioner_manual' : 'stored_data_v1',
    round: roundOf(row.resultJson),
    outcome: plan.voided ? 'void' : 'settled',
    truth: plan.truth,
    truthLabel: plan.truthLabel,
    places: plan.score?.places ?? [],
    correctIds: plan.score?.correctIds ?? [],
    wrongIds: plan.score?.wrongIds ?? [],
    rewardIds,
    immunityRosterIds,
    failures,
    sealedImmunity,
    settledAt: now.toISOString(),
    settledBy: opts.actorUserId ?? 'automation',
    history: Array.isArray(previous.history) ? previous.history : [],
  }
  await prisma.survivorChallenge.update({
    where: { id: challengeId },
    data: {
      status: 'complete', closesAt: now, resultJson: resultJson as unknown as Prisma.InputJsonValue, resultSummary: summary,
      winnerTribeId: row.config.scope === 'tribe' && plan.score?.places[0]?.entrantIds.length === 1 ? plan.score.places[0].entrantIds[0]! : null,
      winnerUserIds: [],
    },
  })
  await audit(leagueId, row.week, 'challenge_builder_settled', challengeId, { outcome: resultJson.outcome, truth: plan.truth, places: resultJson.places, rewardIds, immunityRosterIds, failures, by: resultJson.settledBy }, opts.actorUserId ?? null)
  const { postChallengeBuilderLine } = await import('./leagueChatPoster')
  await postChallengeBuilderLine(leagueId, summary, `survivor-cb:${challengeId}:result:${resultJson.round}`, { type: 'challenge_builder', phase: 'result', challengeId })
    .catch((error) => console.warn('[survivor] challenge result line failed', error instanceof Error ? error.message : error))
  return { ok: true, outcome: plan.voided ? 'void' : 'settled' }
}

/**
 * The commissioner's undo for a settled challenge: every reward it paid is reversed through
 * `reverseSurvivorReward`, any immunity it granted is lifted, and the challenge goes back to
 * `locked` with its round bumped — so it can be settled again (fresh keys) or cancelled.
 */
export async function reverseBuilderChallenge(leagueId: string, challengeId: string, actorUserId: string, reason?: string | null): Promise<BuilderResult<{ reversed: number }>> {
  const [facts, row] = await Promise.all([leagueFacts(leagueId), loadRow(leagueId, challengeId)])
  if (!row) return fail(404, 'No such challenge.')
  if (row.status !== 'complete') return fail(409, facts.lang === 'es' ? 'Solo se anula un reto resuelto.' : 'Only a settled challenge can be reversed.')
  const result = rec(row.resultJson)
  const rewardIds = Array.isArray(result.rewardIds) ? (result.rewardIds as unknown[]).filter((x): x is string => typeof x === 'string') : []
  let reversed = 0
  for (const rewardId of rewardIds) {
    const r = await reverseSurvivorReward({ leagueId, rewardId, actorUserId, reason: reason ?? `challenge ${challengeId} reversed` })
    if (r.ok) reversed++
  }
  const immunity = Array.isArray(result.immunityRosterIds) ? (result.immunityRosterIds as unknown[]).filter((x): x is string => typeof x === 'string') : []
  if (immunity.length) {
    await prisma.survivorPlayer.updateMany({ where: { leagueId, redraftRosterId: { in: immunity }, immunitySource: 'challenge_win' }, data: { hasImmunityThisWeek: false, immunitySource: null } })
  }
  const history = [...(Array.isArray(result.history) ? result.history : []), { round: roundOf(row.resultJson), reversedAt: new Date().toISOString(), by: actorUserId, reason: reason ?? null, rewardIds, immunityRosterIds: immunity, outcome: result.outcome ?? null }]
  await prisma.survivorChallenge.update({
    where: { id: challengeId },
    data: { status: 'locked', resultSummary: null, winnerTribeId: null, resultJson: { round: roundOf(row.resultJson) + 1, history } as unknown as Prisma.InputJsonValue },
  })
  await audit(leagueId, row.week, 'challenge_builder_reversed', challengeId, { rewardIds, reversed, immunityRosterIds: immunity, reason: reason ?? null }, actorUserId)
  return { ok: true, reversed }
}

// ── Views ─────────────────────────────────────────────────────────────────────────────────────────

export type BuilderChallengeView = {
  id: string
  week: number
  title: string
  question: string
  kind: ChallengeBuilderConfig['kind']
  scope: ChallengeBuilderConfig['scope']
  status: ChallengeBuilderStatus
  opensAt: string
  locksAt: string
  inputKind: 'number' | 'choice' | 'text' | 'sweep'
  options: { id: string; label: string; count: number | null }[]
  /** A sweep's props (questions and options; never the right answers). */
  props?: { id: string; question: string; options: { id: string; label: string }[] }[]
  prizeText: string
  wager: ChallengeBuilderConfig['wager']
  uniqueAnswers: boolean
  sealed: boolean
  /** The viewer's own (or their tribe's) answer. */
  mine: { answer: unknown; wager: number | null; byMe: boolean } | null
  /** Everyone's answers: after the lock (after the result when sealed). */
  answers: { name: string; answer: string }[] | null
  resultSummary: string | null
  myResult: 'won' | 'lost' | 'void' | null
}

function answerText(config: ChallengeBuilderConfig, sub: ReturnType<typeof readSubmission>): string {
  if (!sub) return '—'
  if ('value' in sub.answer) return String(sub.answer.value)
  if ('text' in sub.answer) return sub.answer.text
  if ('picks' in sub.answer) {
    const picks = sub.answer.picks
    return (config.props ?? []).map((p) => p.options.find((o) => o.id === picks[p.id])?.label ?? '—').join(' · ')
  }
  const id = sub.answer.optionId
  return config.options.find((o) => o.id === id)?.label ?? id
}

/** The challenges one manager sees. Answers are hidden until the lock, or the result when sealed. */
export async function loadBuilderBoard(leagueId: string, userId: string, now = new Date()): Promise<{ lang: ChallengeLang; challenges: BuilderChallengeView[] }> {
  const [facts, rows, me] = await Promise.all([
    leagueFacts(leagueId),
    prisma.survivorChallenge.findMany({
      where: { leagueId, challengeType: CHALLENGE_BUILDER_TYPE, status: { not: 'cancelled' } },
      orderBy: [{ week: 'desc' }, { challengeNumber: 'asc' }],
      take: 30,
      include: { submissions: { select: { rosterId: true, tribeId: true, userId: true, submission: true } } },
    }),
    prisma.survivorPlayer.findFirst({ where: { leagueId, userId }, select: { tribeId: true, redraftRosterId: true } }),
  ])
  const names = await rosterNames(leagueId)
  const tribes = new Map((await prisma.survivorTribe.findMany({ where: { leagueId }, select: { id: true, name: true } })).map((t) => [t.id, t.name]))
  const challenges: BuilderChallengeView[] = []
  for (const row of rows) {
    const config = readChallengeBuilderConfig(row.configJson)
    if (!config) continue
    const status = clockStatus(row.status, config.opensAt, config.locksAt, now)
    if (status === 'scheduled') continue
    const showAnswers = status === 'complete' || ((status === 'locked' || status === 'settling') && !config.sealed)
    const mineRow = config.scope === 'tribe' ? row.submissions.find((s) => me?.tribeId && s.tribeId === me.tribeId) : row.submissions.find((s) => me?.redraftRosterId && s.rosterId === me.redraftRosterId)
    const mineSub = mineRow ? readSubmission(mineRow.submission) : null
    const counts = new Map<string, number>()
    for (const s of row.submissions) { const sub = readSubmission(s.submission); if (sub && 'optionId' in sub.answer) counts.set(sub.answer.optionId, (counts.get(sub.answer.optionId) ?? 0) + 1) }
    const result = rec(row.resultJson)
    const myEntrant = config.scope === 'tribe' ? me?.tribeId : me?.redraftRosterId
    const places = Array.isArray(result.places) ? (result.places as { entrantIds?: string[] }[]) : []
    const won = myEntrant ? places.some((p) => Array.isArray(p.entrantIds) && p.entrantIds.includes(myEntrant)) : false
    challenges.push({
      id: row.id, week: row.week, title: row.title, question: config.question, kind: config.kind, scope: config.scope, status,
      opensAt: config.opensAt, locksAt: config.locksAt, inputKind: challengeInputKind(config.kind),
      options: config.options.map((o) => ({ ...o, count: showAnswers ? counts.get(o.id) ?? 0 : null })),
      // Questions and options only — a puzzle's answer and a sweep's right picks never leave the server.
      ...(config.props ? { props: config.props.map((p) => ({ id: p.id, question: p.question, options: p.options.map((o) => ({ id: o.id, label: o.label })) })) } : {}),
      prizeText: describeChallengePrizes(config, facts.lang, row.week),
      wager: config.wager, uniqueAnswers: config.uniqueAnswers, sealed: config.sealed,
      mine: mineSub ? { answer: mineSub.answer, wager: mineSub.wager, byMe: mineRow?.userId === userId } : null,
      answers: showAnswers
        ? row.submissions.map((s) => ({ name: (config.scope === 'tribe' ? tribes.get(s.tribeId ?? '') : names.get(s.rosterId ?? '')) ?? '—', answer: answerText(config, readSubmission(s.submission)) }))
        : null,
      resultSummary: status === 'complete' ? row.resultSummary : null,
      myResult: status !== 'complete' || !mineSub ? null : result.outcome === 'void' ? 'void' : won ? 'won' : 'lost',
    })
  }
  return { lang: facts.lang, challenges }
}

export type CommissionerChallengeRow = {
  id: string
  week: number
  title: string
  status: ChallengeBuilderStatus
  config: ChallengeBuilderConfig
  answers: number
  entrants: { id: string; name: string; answer: string }[]
  resultSummary: string | null
  /** How it settles: from stored data, by exact match, or `manual` (the commissioner). */
  autoSource: ChallengeSettlementSource
}

/** Every builder challenge, with answers — the commissioner's Mini Games tab. */
export async function listBuilderChallengesForCommissioner(leagueId: string, now = new Date()): Promise<CommissionerChallengeRow[]> {
  const rows = await prisma.survivorChallenge.findMany({
    where: { leagueId, challengeType: CHALLENGE_BUILDER_TYPE },
    orderBy: [{ week: 'desc' }, { challengeNumber: 'asc' }],
    take: 60,
    include: { submissions: { select: { rosterId: true, tribeId: true, submission: true } } },
  })
  const names = await rosterNames(leagueId)
  const tribes = new Map((await prisma.survivorTribe.findMany({ where: { leagueId }, select: { id: true, name: true } })).map((t) => [t.id, t.name]))
  return rows.flatMap((row) => {
    const config = readChallengeBuilderConfig(row.configJson)
    if (!config) return []
    return [{
      id: row.id, week: row.week, title: row.title, status: clockStatus(row.status, config.opensAt, config.locksAt, now), config,
      answers: row.submissions.length,
      entrants: row.submissions.map((s) => {
        const id = (config.scope === 'tribe' ? s.tribeId : s.rosterId) ?? ''
        return { id, name: (config.scope === 'tribe' ? tribes.get(id) : names.get(id)) ?? id, answer: answerText(config, readSubmission(s.submission)) }
      }),
      resultSummary: row.resultSummary,
      autoSource: challengeSettlementSource(config),
    }]
  })
}

/** Open builder challenges and the manager's own answers, for Chimmy and the rules answers. */
export async function summarizeBuilderChallengesForChimmy(leagueId: string, userId: string, now = new Date()): Promise<string> {
  const board = await loadBuilderBoard(leagueId, userId, now).catch(() => null)
  if (!board || !board.challenges.length) return ''
  const live = board.challenges.filter((c) => c.status === 'open' || c.status === 'locked')
  const won = board.challenges.filter((c) => c.myResult === 'won').slice(0, 3)
  const mineText = (c: BuilderChallengeView): string => {
    const a = (c.mine?.answer ?? {}) as { value?: number; optionId?: string; text?: string; picks?: Record<string, string> }
    if (typeof a.value === 'number') return String(a.value)
    if (typeof a.text === 'string') return `"${a.text}"`
    if (a.picks) return (c.props ?? []).map((p) => p.options.find((o) => o.id === a.picks![p.id])?.label ?? '—').join(' · ')
    return c.options.find((o) => o.id === a.optionId)?.label ?? 'chosen'
  }
  const parts = live.map((c) => `"${c.title}" (${c.scope}, ${c.kind}, ${c.status === 'open' ? `open, locks ${c.locksAt}` : 'locked, awaiting result'}; prize: ${c.prizeText}; ${c.mine ? `answer in: ${mineText(c)}` : 'NOT answered yet'})`)
  const wins = won.map((c) => `"${c.title}"`)
  return `Commissioner challenges: ${parts.join('; ') || 'none open'}.${wins.length ? ` User won: ${wins.join(', ')}.` : ''} (Never reveal another manager's answer before the lock, or any answer before the result when a challenge is sealed.)`
}

// ── The season runner's step ──────────────────────────────────────────────────────────────────────

export type BuilderStepSummary = { opened: number; locked: number; settled: number; chimmyAnswered: number }

/**
 * Every 5-minute tick: open what is due (host line), lock what is due (host line), answer for the
 * seats Chimmy runs in the last hours before the lock, and settle what our stored data can settle.
 * Idempotent and best-effort: each challenge's failure is logged and skipped.
 */
export async function runChallengeBuilderStep(leagueId: string, now = new Date()): Promise<BuilderStepSummary> {
  const out: BuilderStepSummary = { opened: 0, locked: 0, settled: 0, chimmyAnswered: 0 }
  const rows = await prisma.survivorChallenge.findMany({
    where: { leagueId, challengeType: CHALLENGE_BUILDER_TYPE, status: { in: ['scheduled', 'open', 'locked'] } },
    select: { id: true, leagueId: true, week: true, challengeNumber: true, title: true, status: true, configJson: true, resultJson: true, locksAt: true },
    orderBy: [{ week: 'asc' }, { challengeNumber: 'asc' }],
    take: 40,
  })
  if (!rows.length) return out
  const facts = await leagueFacts(leagueId)
  for (const row of rows) {
    const config = readChallengeBuilderConfig(row.configJson)
    if (!config) continue
    try {
      const status = clockStatus(row.status, config.opensAt, config.locksAt, now)
      if (row.status === 'scheduled' && status === 'open') {
        const claim = await prisma.survivorChallenge.updateMany({ where: { id: row.id, status: 'scheduled' }, data: { status: 'open' } })
        if (claim.count === 1) {
          out.opened++
          await audit(leagueId, row.week, 'challenge_builder_opened', row.id, { by: 'clock' })
          await postOpenLine(leagueId, row.id, row.title, config, row.week, facts.lang)
        }
      }
      if (status === 'open' && new Date(config.locksAt).getTime() - now.getTime() <= CHIMMY_ANSWER_WINDOW_MS) {
        out.chimmyAnswered += await answerForChimmySeats(leagueId, { ...row, config }, now).catch((error) => {
          console.warn('[survivor] Chimmy challenge answers failed', row.id, error instanceof Error ? error.message : error)
          return 0
        })
      }
      if (status === 'locked' && row.status !== 'locked') {
        await lockBuilderChallengeNow(leagueId, row.id, null, now)
        out.locked++
      }
      if (status === 'locked' && challengeSettlementSource(config) !== 'manual') {
        const settled = await settleBuilderChallenge(leagueId, row.id, { now })
        if (settled.ok && (settled.outcome === 'settled' || settled.outcome === 'void')) out.settled++
      }
    } catch (error) {
      console.warn('[survivor] challenge builder step failed', row.id, error instanceof Error ? error.message : error)
    }
  }
  return out
}

async function chimmyFacts(leagueId: string, config: ChallengeBuilderConfig, now: Date): Promise<ChimmyChallengeFacts> {
  const facts: { records?: Map<string, { wins: number; losses: number }>; recentTotals?: number[]; playerValues?: number[]; optionValues?: Map<string, number[]> } = {}
  if (config.game) {
    const resolve = await teamResolver(config.game.sport)
    if (resolve) {
      const rows = (await prisma.sportsGame.findMany({
        where: { sport: config.game.sport, startTime: { gte: new Date(now.getTime() - 120 * 24 * HOUR_MS), lt: now }, source: { in: [...LIVE_SCORE_SOURCES] }, homeScore: { not: null }, awayScore: { not: null } },
        select: GAME_SELECT,
        take: 2000,
      })) as RealGameRow[]
      const records = new Map<string, { wins: number; losses: number }>()
      const totals: number[] = []
      const seen = new Set<string>()
      for (const g of rows) {
        const home = resolve(g.homeTeam), away = resolve(g.awayTeam)
        if (!home || !away || g.homeScore == null || g.awayScore == null || !/final/i.test(String(g.status ?? ''))) continue
        const key = `${[home, away].sort().join('|')}@${g.startTime?.toISOString().slice(0, 10)}`
        if (seen.has(key)) continue
        seen.add(key)
        const hw = g.homeScore > g.awayScore, aw = g.awayScore > g.homeScore
        for (const [t, w] of [[home, hw], [away, aw]] as const) {
          const r = records.get(t) ?? { wins: 0, losses: 0 }
          if (w) r.wins++
          else if (hw || aw) r.losses++
          records.set(t, r)
        }
        if ([home, away].some((t) => t === config.game!.homeAbbr || t === config.game!.awayAbbr)) totals.push(g.homeScore + g.awayScore)
      }
      facts.records = records
      facts.recentTotals = totals.slice(-10)
    }
  }
  if (config.player) {
    const p = config.player
    const rows = await prisma.playerWeeklyScore.findMany({ where: { playerId: p.playerId, season: p.season, sport: { in: [p.sport, p.sport.toLowerCase()] }, week: { lt: p.statWeek }, isFinalized: true }, select: { stats: true, fantasyPts: true } })
    facts.playerValues = rows.map((r) => playerStatValue(p.stat, p.sport, r.stats, r.fantasyPts)).filter((n): n is number => n != null)
  }
  if (config.kind === 'position_leader' && config.position) {
    // Each option player's stored fantasy points in earlier weeks — never anyone's answer.
    const pos = config.position
    const ids = config.options.flatMap((o) => (o.playerId ? [o.playerId] : []))
    const rows = ids.length
      ? await prisma.playerWeeklyScore.findMany({ where: { playerId: { in: ids }, season: pos.season, sport: { in: sportSpellings(pos.sport) }, week: { lt: pos.statWeek }, isFinalized: true }, select: { playerId: true, fantasyPts: true } })
      : []
    const byPlayer = new Map<string, number[]>()
    for (const r of rows) byPlayer.set(r.playerId, [...(byPlayer.get(r.playerId) ?? []), r.fantasyPts])
    facts.optionValues = byPlayer
  }
  return facts
}

/** Chimmy answers for the seats it runs that have not answered. Returns how many it submitted. */
async function answerForChimmySeats(leagueId: string, row: Row & { config: ChallengeBuilderConfig }, now: Date): Promise<number> {
  const league = await prisma.league.findUnique({ where: { id: leagueId }, select: { settings: true, userId: true } })
  if (!league) return 0
  const managed = await readPlayableChimmyLineups({ id: leagueId, ...league })
  const cast = await prisma.survivorPlayer.findMany({ where: { leagueId, playerState: 'active' }, select: { userId: true, tribeId: true, redraftRosterId: true } })
  const seats = cast.filter((c) => c.redraftRosterId && isSeatPlaceholderUserId(c.userId) && isChimmyRunning(managed, c.redraftRosterId, c.userId))
  if (!seats.length) return 0
  const subs = await prisma.survivorChallengeSubmission.findMany({ where: { challengeId: row.id }, select: { rosterId: true, tribeId: true } })
  const facts = await chimmyFacts(leagueId, row.config, now)
  let answered = 0
  const doneTribes = new Set(subs.map((s) => s.tribeId).filter(Boolean))
  for (const seat of seats.sort((a, b) => a.redraftRosterId!.localeCompare(b.redraftRosterId!))) {
    if (row.config.scope === 'tribe') {
      // A tribe answer belongs to the humans: Chimmy answers only for a tribe where nobody has, and
      // only when every member of that tribe is a seat it runs or the lock is under an hour away.
      if (!seat.tribeId || doneTribes.has(seat.tribeId)) continue
      const mates = cast.filter((c) => c.tribeId === seat.tribeId)
      const allChimmy = mates.every((m) => seats.includes(m))
      if (!allChimmy && new Date(row.config.locksAt).getTime() - now.getTime() > HOUR_MS) continue
    } else if (subs.some((s) => s.rosterId === seat.redraftRosterId)) continue
    const base = chimmyChallengeAnswer(row.config, facts, `${row.id}:${seat.redraftRosterId}`)
    if (!base) continue
    let attempt: typeof base | null = base
    for (let i = 0; attempt && i < 6; i++) {
      const a = attempt.answer
      const body = 'value' in a ? { value: a.value } : 'picks' in a ? { picks: a.picks } : 'text' in a ? { text: a.text } : { optionId: a.optionId }
      const res = await submitBuilderAnswer(leagueId, seat.userId, row.id, { ...body, wager: attempt.wager }, now)
      if (res.ok) {
        answered++
        if (seat.tribeId) doneTribes.add(seat.tribeId)
        await audit(leagueId, row.week, 'challenge_builder_chimmy_answered', row.id, { rosterId: seat.redraftRosterId })
        break
      }
      attempt = res.code === 'answer_taken' ? nudgeChimmyAnswer(row.config, base, i + 1) : null
    }
  }
  return answered
}

/** How many challenges Chimmy answered for each seat this week (the commissioner's weekly report). */
export async function countChimmyChallengeAnswers(leagueId: string, week: number, rosterIds: readonly string[]): Promise<Map<string, number>> {
  const rows = await prisma.survivorAuditEntry.findMany({ where: { leagueId, week, action: 'challenge_builder_chimmy_answered' }, select: { data: true } })
  const out = new Map<string, number>()
  for (const r of rows) {
    const id = rec(r.data).rosterId
    if (typeof id === 'string' && rosterIds.includes(id)) out.set(id, (out.get(id) ?? 0) + 1)
  }
  return out
}
