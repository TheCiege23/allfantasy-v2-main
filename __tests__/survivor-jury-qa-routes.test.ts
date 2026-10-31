// @vitest-environment node
/**
 * Routes for the jury Q&A, closing speeches, the ballot reveal (/api/survivor/jury) and the
 * commissioner's finale rules and windows (/api/survivor/commissioner).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const h = vi.hoisted(() => ({
  db: {
    roster: { findFirst: vi.fn() },
    league: { findUnique: vi.fn(), update: vi.fn() },
    survivorTribalCouncil: { findFirst: vi.fn() },
    jurySession: { findUnique: vi.fn(), upsert: vi.fn() },
    survivorCommissionerAction: { create: vi.fn() },
  },
  member: vi.fn(),
  commissionerRole: vi.fn(),
  ask: vi.fn(),
  answer: vi.fn(),
  seen: vi.fn(),
  speech: vi.fn(),
  qaView: vi.fn(),
  ballots: vi.fn(),
  openJuryVoting: vi.fn(),
  ensureJuryVotingOpen: vi.fn(),
  submitJuryVote: vi.fn(),
}))
vi.mock('next-auth', () => ({ getServerSession: async () => ({ user: { id: 'u-juror' } }) }))
vi.mock('@/lib/auth', () => ({ authOptions: {} }))
vi.mock('@/lib/prisma', () => ({ prisma: h.db }))
vi.mock('@/lib/league/league-access', () => ({ assertLeagueMember: h.member, assertLeagueCommissioner: vi.fn(async () => ({ ok: true })) }))
vi.mock('@/lib/league/permissions', () => ({ requireCommissionerRole: h.commissionerRole }))
vi.mock('@/lib/survivor/survivorHostGuard', () => ({ survivorHostGuard: async () => null }))
vi.mock('@/lib/survivor/juryEngine', () => ({ openFinale: vi.fn(), openJuryPhase: vi.fn(), openJuryVoting: h.openJuryVoting, ensureJuryVotingOpen: h.ensureJuryVotingOpen }))
vi.mock('@/lib/survivor/SurvivorFinaleEngine', () => ({ recordCrownedWinner: vi.fn(), settleFinaleIfDue: vi.fn(), submitJuryVote: h.submitJuryVote }))
vi.mock('@/lib/survivor/SurvivorTimelineResolver', () => ({ resolveSurvivorCurrentWeek: async () => 17 }))
vi.mock('@/lib/survivor/finaleView', () => ({ getFinaleRevealView: vi.fn(async () => ({ sealed: true })) }))
vi.mock('@/lib/survivor/survivorJuryQaService', () => ({ askJuryQuestion: h.ask, answerJuryQuestion: h.answer, markJuryAnswerSeen: h.seen, postClosingSpeech: h.speech, getJuryQaView: h.qaView }))
vi.mock('@/lib/survivor/survivorBallotRevealService', () => ({ loadEndOfSeasonBallotReveal: h.ballots }))
vi.mock('@/lib/survivor/gameStateMachine', () => ({ advancePhase: vi.fn() }))
vi.mock('@/lib/survivor/exileEngine', () => ({ processReturnFromExile: vi.fn() }))
vi.mock('@/lib/survivor/SurvivorTribeShuffleEngine', () => ({ runShuffle: vi.fn() }))
vi.mock('@/lib/survivor/survivorTribalOverride', () => ({ overrideTribalResult: vi.fn(), readTribalOverrideTarget: vi.fn() }))
vi.mock('@/lib/survivor/SurvivorLeagueConfig', () => ({ getSurvivorConfig: vi.fn() }))
vi.mock('@/lib/survivor/notificationEngine', () => ({ enqueueNotification: vi.fn() }))
vi.mock('@/lib/redraft/voidPendingTradesForElimination', () => ({ voidPendingRedraftTradesForRoster: vi.fn() }))
vi.mock('@/lib/survivor/survivorCouncilPause', () => ({ setCouncilPaused: vi.fn() }))
vi.mock('@/lib/survivor/SurvivorSitOutEngine', () => ({ maybeTriggerSurvivorTribeShuffleRecommendation: vi.fn() }))

import { GET as juryGet, POST as juryPost } from '@/app/api/survivor/jury/route'
import { GET as commGet, POST as commPost } from '@/app/api/survivor/commissioner/route'

const jury = (body: object) => juryPost(new NextRequest('https://x.test/api/survivor/jury', { method: 'POST', body: JSON.stringify({ leagueId: 'L1', ...body }) }))
const comm = (body: object) => commPost(new NextRequest('https://x.test/api/survivor/commissioner', { method: 'POST', body: JSON.stringify({ leagueId: 'L1', ...body }) }))
const future = (h: number) => new Date(Date.now() + h * 3_600_000).toISOString()

beforeEach(() => {
  vi.clearAllMocks()
  h.member.mockResolvedValue({ ok: true })
  h.commissionerRole.mockResolvedValue(undefined)
  h.db.roster.findFirst.mockResolvedValue({ id: 'r-juror' })
  h.db.league.findUnique.mockResolvedValue({ settings: { existing: 1 } })
  h.db.survivorTribalCouncil.findFirst.mockResolvedValue(null)
  h.db.jurySession.findUnique.mockResolvedValue({ status: 'questions_open', votingDeadline: null })
  for (const fn of [h.ask, h.answer, h.seen, h.speech]) fn.mockResolvedValue({ ok: true })
})

describe('/api/survivor/jury — Q&A and speeches', () => {
  it('asks as the caller’s own roster, never a roster from the body', async () => {
    const res = await jury({ intent: 'jury_question', finalistRosterId: 'r-f1', jurorRosterId: 'someone-else', text: 'Why you?' })
    expect(res.status).toBe(200)
    expect(h.ask).toHaveBeenCalledWith('L1', expect.objectContaining({ jurorRosterId: 'r-juror', finalistRosterId: 'r-f1', text: 'Why you?' }))
  })

  it('answers, marks seen and posts a closing speech through the service', async () => {
    expect((await jury({ intent: 'finalist_answer', jurorRosterId: 'r-j1', text: 'Because' })).status).toBe(200)
    expect(h.answer).toHaveBeenCalledWith('L1', expect.objectContaining({ finalistRosterId: 'r-juror', jurorRosterId: 'r-j1' }))
    expect((await jury({ intent: 'juror_seen', finalistRosterId: 'r-f1' })).status).toBe(200)
    expect(h.seen).toHaveBeenCalledWith('L1', { jurorRosterId: 'r-juror', finalistRosterId: 'r-f1' })
    expect((await jury({ intent: 'closing_speech', text: 'Vote for me' })).status).toBe(200)
    expect(h.speech).toHaveBeenCalledWith('L1', expect.objectContaining({ finalistRosterId: 'r-juror', text: 'Vote for me' }))
  })

  it('400 for bad input, 403 outside the league or without a roster, the service status on a refusal', async () => {
    expect((await jury({ intent: 'jury_question', text: 'no target' })).status).toBe(400)
    expect((await jury({ intent: 'closing_speech' })).status).toBe(400)
    h.member.mockResolvedValueOnce({ ok: false, status: 403 })
    expect((await jury({ intent: 'closing_speech', text: 'x' })).status).toBe(403)
    h.db.roster.findFirst.mockResolvedValueOnce(null)
    expect((await jury({ intent: 'closing_speech', text: 'x' })).status).toBe(403)
    h.ask.mockResolvedValueOnce({ ok: false, code: 'already_asked', status: 409 })
    const refused = await jury({ intent: 'jury_question', finalistRosterId: 'r-f1', text: 'again' })
    expect(refused.status).toBe(409)
    expect(await refused.json()).toMatchObject({ code: 'already_asked' })
    expect(h.ask).toHaveBeenCalledTimes(1)
  })

  it('a jury vote held for the closing speeches is a 409 with its code', async () => {
    h.submitJuryVote.mockResolvedValueOnce({ ok: false, code: 'held_for_speeches', error: 'Jury voting opens when the closing speeches close' })
    const res = await jury({ intent: 'jury_vote', finalistRosterId: 'r-f1' })
    expect(res.status).toBe(409)
    expect(await res.json()).toMatchObject({ code: 'held_for_speeches' })
  })

  it('GET part=qa and part=ballots read their views for a member only', async () => {
    h.qaView.mockResolvedValue({ canRead: true })
    h.ballots.mockResolvedValue(null)
    const qa = await juryGet(new NextRequest('https://x.test/api/survivor/jury?leagueId=L1&part=qa'))
    expect(await qa.json()).toEqual({ qa: { canRead: true } })
    const ballots = await juryGet(new NextRequest('https://x.test/api/survivor/jury?leagueId=L1&part=ballots'))
    expect(await ballots.json()).toEqual({ ballots: null })
    h.member.mockResolvedValueOnce({ ok: false, status: 403 })
    expect((await juryGet(new NextRequest('https://x.test/api/survivor/jury?leagueId=L1&part=qa'))).status).toBe(403)
  })
})

describe('/api/survivor/commissioner — finale rules and windows', () => {
  it('saves finale rules for the commissioner', async () => {
    const res = await comm({ action: 'finale_settings', settings: { endOfSeasonBallotReveal: true, votesDueHoursBeforeCeremony: 3 } })
    expect(res.status).toBe(200)
    expect(h.db.league.update).toHaveBeenCalledWith({ where: { id: 'L1' }, data: { settings: { existing: 1, endOfSeasonBallotReveal: true, votesDueHoursBeforeCeremony: 3 } } })
    expect((await res.json()).settings).toMatchObject({ endOfSeasonBallotReveal: true, votesDueHoursBeforeCeremony: 3 })
  })

  it('403 for a non-commissioner, 400 for bad input', async () => {
    h.commissionerRole.mockRejectedValueOnce(new Response('Forbidden', { status: 403 }))
    expect((await comm({ action: 'finale_settings', settings: { sealedImmunity: true } })).status).toBe(403)
    expect((await comm({ action: 'finale_settings', settings: { sealedImmunity: 'on' } })).status).toBe(400)
    expect((await comm({ action: 'finale_windows', windows: { speechesDeadline: 'tomorrow-ish' } })).status).toBe(400)
    expect((await comm({ action: 'finale_windows', windows: {} })).status).toBe(400)
    expect(h.db.league.update).not.toHaveBeenCalled()
  })

  it('sealed immunity and the vote due time wait for an open council', async () => {
    h.db.survivorTribalCouncil.findFirst.mockResolvedValue({ id: 'open' })
    const res = await comm({ action: 'finale_settings', settings: { sealedImmunity: true } })
    expect(res.status).toBe(409)
    expect(await res.json()).toMatchObject({ code: 'council_open' })
    // The reunion toggle is not locked by a council.
    expect((await comm({ action: 'finale_settings', settings: { reunionChatEnabled: false } })).status).toBe(200)
  })

  it('saves the windows, mirrors the question deadline and opens the jury vote with its deadline', async () => {
    const q = future(10)
    const vote = future(48)
    const res = await comm({ action: 'finale_windows', windows: { questionsDeadline: q, speechesDeadline: future(24), juryVoteDeadline: vote } })
    expect(res.status).toBe(200)
    expect(h.db.league.update).toHaveBeenCalledWith({ where: { id: 'L1' }, data: { settings: expect.objectContaining({ survivorFinaleWindows: expect.objectContaining({ questionsDeadline: q }) }) } })
    expect(h.db.jurySession.upsert).toHaveBeenCalledWith(expect.objectContaining({ update: { questionsDeadline: new Date(q) } }))
    expect(h.openJuryVoting).toHaveBeenCalledWith('L1', new Date(vote))
  })

  it('the jury vote must close after the speeches', async () => {
    expect((await comm({ action: 'finale_windows', windows: { speechesDeadline: future(24), juryVoteDeadline: future(12) } })).status).toBe(400)
    expect(h.openJuryVoting).not.toHaveBeenCalled()
  })

  it('GET type=finale returns the rules, windows and the jury deadline', async () => {
    h.db.jurySession.findUnique.mockResolvedValue({ status: 'voting_open', votingDeadline: new Date('2026-12-31T05:00:00.000Z') })
    const res = await commGet(new NextRequest('https://x.test/api/survivor/commissioner?leagueId=L1&type=finale'))
    expect(await res.json()).toMatchObject({ settings: { reunionChatEnabled: true }, juryVoteDeadline: '2026-12-31T05:00:00.000Z', councilOpen: false })
  })
})
