import 'server-only'

import { prisma } from '@/lib/prisma'
import { appendSurvivorAudit } from './SurvivorAuditLog'
import { getFinaleState, type SurvivorFinaleState } from './SurvivorFinaleEngine'
import { getSurvivorConfig } from './SurvivorLeagueConfig'
import { resolveSurvivorAccessContext } from './survivorAccessControl'
import { resolveSurvivorCurrentWeek } from './SurvivorTimelineResolver'
import {
  closingSpeechWindow,
  finalistAnswerWindow,
  juryQuestionWindow,
  juryVotingHeldForSpeeches,
  readSurvivorFinaleSettings,
  readSurvivorFinaleWindows,
  type SurvivorFinaleSettings,
  type SurvivorFinaleWindows,
} from './survivorFinaleSettings'
import {
  canReadJuryQa,
  foldJuryQa,
  JURY_QA_EVENT_TYPES,
  juryQaTodo,
  refuseAnswerSeen,
  refuseClosingSpeech,
  refuseFinalistAnswer,
  refuseJuryQuestion,
  type JuryQaGate,
  type JuryQaRefusal,
  type JuryQaState,
} from './survivorJuryQa'

/**
 * Jury Q&A and closing speeches (server). Every write is an append-only SurvivorAuditLog event —
 * see survivorJuryQa.ts for the event shapes and the rules. No new table.
 */

export interface JuryQaContext {
  leagueId: string
  configId: string | null
  week: number
  finale: SurvivorFinaleState
  settings: SurvivorFinaleSettings
  windows: SurvivorFinaleWindows
  state: JuryQaState
  names: Map<string, string>
}

export async function loadJuryQaContext(leagueId: string): Promise<JuryQaContext> {
  const week = await resolveSurvivorCurrentWeek(leagueId)
  const [finale, league, config, events] = await Promise.all([
    getFinaleState(leagueId, week),
    prisma.league.findUnique({ where: { id: leagueId }, select: { settings: true } }),
    getSurvivorConfig(leagueId),
    prisma.survivorAuditLog.findMany({
      where: { leagueId, eventType: { in: [...JURY_QA_EVENT_TYPES] } },
      orderBy: { createdAt: 'asc' },
      select: { eventType: true, metadata: true, createdAt: true },
    }),
  ])
  const rosterIds = [...new Set([...finale.finalists, ...finale.juryRosterIds])]
  const rosters = rosterIds.length ? await prisma.roster.findMany({ where: { leagueId, id: { in: rosterIds } }, select: { id: true, platformUserId: true } }) : []
  const players = await prisma.survivorPlayer.findMany({ where: { leagueId, userId: { in: rosters.map((r) => r.platformUserId) } }, select: { userId: true, displayName: true } })
  const nameByUser = new Map(players.map((p) => [p.userId, p.displayName]))
  const names = new Map(rosters.map((r) => [r.id, nameByUser.get(r.platformUserId) ?? 'Manager']))
  return {
    leagueId,
    configId: config?.configId ?? null,
    week,
    finale,
    settings: readSurvivorFinaleSettings(league?.settings),
    windows: readSurvivorFinaleWindows(league?.settings),
    state: foldJuryQa(events),
    names,
  }
}

function gateFor(ctx: JuryQaContext, kind: 'question' | 'answer' | 'speech', now: Date): JuryQaGate {
  const window = kind === 'question' ? juryQuestionWindow(ctx.windows, now) : kind === 'answer' ? finalistAnswerWindow(ctx.windows, now) : closingSpeechWindow(ctx.windows, now)
  return {
    enabled: kind === 'speech' ? ctx.settings.closingSpeechesEnabled : ctx.settings.juryQuestionsEnabled,
    finaleOpen: ctx.finale.open && !ctx.finale.closed,
    voteComplete: ctx.finale.votingComplete,
    finalists: ctx.finale.finalists,
    jurors: ctx.finale.juryRosterIds,
    window,
  }
}

export type JuryQaWriteResult = { ok: true } | { ok: false; code: JuryQaRefusal | 'not_survivor'; status: 400 | 403 | 409 }

const FORBIDDEN: ReadonlySet<JuryQaRefusal> = new Set(['not_juror', 'not_finalist'])
const CONFLICT: ReadonlySet<JuryQaRefusal> = new Set(['disabled', 'finale_not_open', 'vote_complete', 'window_not_open', 'window_closed', 'already_asked', 'not_answered'])

function refused(code: JuryQaRefusal): JuryQaWriteResult {
  return { ok: false, code, status: FORBIDDEN.has(code) ? 403 : CONFLICT.has(code) ? 409 : 400 }
}

export async function askJuryQuestion(leagueId: string, input: { jurorRosterId: string; finalistRosterId: string; text: string; source?: string }, now = new Date()): Promise<JuryQaWriteResult> {
  const ctx = await loadJuryQaContext(leagueId)
  if (!ctx.configId) return { ok: false, code: 'not_survivor', status: 400 }
  const refusal = refuseJuryQuestion(ctx.state, gateFor(ctx, 'question', now), input)
  if (refusal) return refused(refusal)
  await appendSurvivorAudit(leagueId, ctx.configId, 'jury_question_asked', { jurorRosterId: input.jurorRosterId, finalistRosterId: input.finalistRosterId, text: input.text.trim(), source: input.source ?? null })
  return { ok: true }
}

export async function answerJuryQuestion(leagueId: string, input: { finalistRosterId: string; jurorRosterId: string; text: string; source?: string }, now = new Date()): Promise<JuryQaWriteResult> {
  const ctx = await loadJuryQaContext(leagueId)
  if (!ctx.configId) return { ok: false, code: 'not_survivor', status: 400 }
  const refusal = refuseFinalistAnswer(ctx.state, gateFor(ctx, 'answer', now), input)
  if (refusal) return refused(refusal)
  await appendSurvivorAudit(leagueId, ctx.configId, 'jury_question_answered', { jurorRosterId: input.jurorRosterId, finalistRosterId: input.finalistRosterId, text: input.text.trim(), source: input.source ?? null })
  return { ok: true }
}

export async function markJuryAnswerSeen(leagueId: string, input: { jurorRosterId: string; finalistRosterId: string }, now = new Date()): Promise<JuryQaWriteResult> {
  const ctx = await loadJuryQaContext(leagueId)
  if (!ctx.configId) return { ok: false, code: 'not_survivor', status: 400 }
  const refusal = refuseAnswerSeen(ctx.state, { jurors: ctx.finale.juryRosterIds }, input)
  if (refusal) return refused(refusal)
  await appendSurvivorAudit(leagueId, ctx.configId, 'jury_answer_seen', { jurorRosterId: input.jurorRosterId, finalistRosterId: input.finalistRosterId })
  return { ok: true }
}

export async function postClosingSpeech(leagueId: string, input: { finalistRosterId: string; text: string; source?: string }, now = new Date()): Promise<JuryQaWriteResult> {
  const ctx = await loadJuryQaContext(leagueId)
  if (!ctx.configId) return { ok: false, code: 'not_survivor', status: 400 }
  const refusal = refuseClosingSpeech(gateFor(ctx, 'speech', now), input)
  if (refusal) return refused(refusal)
  await appendSurvivorAudit(leagueId, ctx.configId, 'finalist_closing_speech', { finalistRosterId: input.finalistRosterId, text: input.text.trim(), source: input.source ?? null })
  return { ok: true }
}

export interface JuryQaView {
  canRead: boolean
  settings: Pick<SurvivorFinaleSettings, 'juryQuestionsEnabled' | 'closingSpeechesEnabled'>
  windows: SurvivorFinaleWindows & { questionState: string; answerState: string; speechState: string; votingHeldForSpeeches: boolean }
  finaleOpen: boolean
  voteComplete: boolean
  finalists: Array<{ rosterId: string; name: string }>
  questions: Array<JuryQaState['questions'][number] & { jurorName: string; finalistName: string }>
  speeches: Array<JuryQaState['speeches'][number] & { name: string }>
  viewer: { rosterId: string | null; isJuror: boolean; isFinalist: boolean; isHost: boolean; todo: ReturnType<typeof juryQaTodo> }
}

/** The Q&A view for one viewer. A viewer outside the finale gets the windows and nothing else until the champion is crowned. */
export async function getJuryQaView(leagueId: string, viewerUserId: string, now = new Date()): Promise<JuryQaView> {
  const [ctx, roster, access] = await Promise.all([
    loadJuryQaContext(leagueId),
    prisma.roster.findFirst({ where: { leagueId, platformUserId: viewerUserId }, select: { id: true } }),
    resolveSurvivorAccessContext(leagueId, viewerUserId).catch(() => null),
  ])
  const rosterId = roster?.id ?? null
  const isJuror = Boolean(rosterId && ctx.finale.juryRosterIds.includes(rosterId))
  const isFinalist = Boolean(rosterId && ctx.finale.finalists.includes(rosterId))
  const isHost = Boolean(access?.isNonParticipatingCommissionerHost)
  const canRead = canReadJuryQa({ isJuror, isFinalist, isHost }, ctx.finale.closed)
  const nameOf = (id: string) => ctx.names.get(id) ?? 'Manager'
  return {
    canRead,
    settings: { juryQuestionsEnabled: ctx.settings.juryQuestionsEnabled, closingSpeechesEnabled: ctx.settings.closingSpeechesEnabled },
    windows: {
      ...ctx.windows,
      questionState: juryQuestionWindow(ctx.windows, now),
      answerState: finalistAnswerWindow(ctx.windows, now),
      speechState: closingSpeechWindow(ctx.windows, now),
      votingHeldForSpeeches: juryVotingHeldForSpeeches(ctx.settings, ctx.windows, now),
    },
    finaleOpen: ctx.finale.open && !ctx.finale.closed,
    voteComplete: ctx.finale.votingComplete,
    finalists: ctx.finale.finalists.map((id) => ({ rosterId: id, name: nameOf(id) })),
    questions: canRead ? ctx.state.questions.map((q) => ({ ...q, jurorName: nameOf(q.jurorRosterId), finalistName: nameOf(q.finalistRosterId) })) : [],
    speeches: canRead ? ctx.state.speeches.map((s) => ({ ...s, name: nameOf(s.finalistRosterId) })) : [],
    viewer: { rosterId, isJuror, isFinalist, isHost, todo: juryQaTodo(ctx.state, { rosterId, isJuror, isFinalist }, ctx.finale.finalists, { speechesEnabled: ctx.settings.closingSpeechesEnabled }) },
  }
}
