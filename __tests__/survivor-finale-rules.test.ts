// @vitest-environment node
/**
 * Jury, finale and reunion rules (survivorFinaleSettings), the jury Q&A fold and its refusals
 * (survivorJuryQa), sealed immunity, closest-without-going-over, the end-of-season ballot reveal, the
 * reunion gate and Chimmy's finale decisions. All pure.
 */
import { describe, expect, it } from 'vitest'
import {
  ballotsDueAt,
  closingSpeechWindow,
  finaleSettingsLockedDuringCouncil,
  juryQuestionWindow,
  juryVotingHeldForSpeeches,
  readSurvivorFinaleSettings,
  readSurvivorFinaleWindows,
  SURVIVOR_FINALE_DEFAULTS,
  validateFinaleWindowsPatch,
  validateSurvivorFinaleSettingsPatch,
  EMPTY_FINALE_WINDOWS,
} from '@/lib/survivor/survivorFinaleSettings'
import { canReadJuryQa, foldJuryQa, juryQaTodo, refuseAnswerSeen, refuseClosingSpeech, refuseFinalistAnswer, refuseJuryQuestion, type JuryQaGate } from '@/lib/survivor/survivorJuryQa'
import { isImmunitySealed, redactImmunityList, sealCouncilImmunity, shouldDeferImmunityAnnouncement } from '@/lib/survivor/survivorSealedImmunity'
import { closestTargetFromStoredGame, parseCommissionerTarget, settleClosestWithoutGoingOver } from '@/lib/survivor/survivorClosestWithoutGoingOver'
import { buildBallotReveal } from '@/lib/survivor/survivorBallotReveal'
import { chimmyClosingSpeech, chimmyFinalistAnswer, chimmyJurorVote, chimmyJuryQuestion, chimmyLang } from '@/lib/survivor/chimmyJury'
import { answerSurvivorRules, survivorRulesTopic, type SurvivorRulesContext } from '@/lib/survivor/survivorRulesAnswers'
import { SURVIVOR_DEFAULT_FOUNDATION_SETTINGS } from '@/lib/survivor/survivorSettings'

const NOW = new Date('2026-12-20T18:00:00.000Z')
const iso = (h: number) => new Date(NOW.getTime() + h * 3_600_000).toISOString()

describe('finale settings', () => {
  it('defaults keep current behaviour (reunion on, everything else as before)', () => {
    expect(readSurvivorFinaleSettings({})).toEqual(SURVIVOR_FINALE_DEFAULTS)
    expect(SURVIVOR_FINALE_DEFAULTS).toMatchObject({ sealedImmunity: false, votesDueHoursBeforeCeremony: 0, endOfSeasonBallotReveal: false, reunionChatEnabled: true })
  })

  it('reads top level over the foundation snapshot and clamps the hours', () => {
    const s = readSurvivorFinaleSettings({ survivorFoundationSettings: { sealedImmunity: true }, votesDueHoursBeforeCeremony: 500, reunionChatEnabled: 'false' })
    expect(s).toMatchObject({ sealedImmunity: true, votesDueHoursBeforeCeremony: 72, reunionChatEnabled: false })
  })

  it('validates a patch: booleans, whole hours 0–72, nothing empty', () => {
    expect(validateSurvivorFinaleSettingsPatch({ sealedImmunity: true, votesDueHoursBeforeCeremony: 3 })).toEqual({ ok: true, patch: { sealedImmunity: true, votesDueHoursBeforeCeremony: 3 } })
    expect(validateSurvivorFinaleSettingsPatch({ sealedImmunity: 'yes' }).ok).toBe(false)
    expect(validateSurvivorFinaleSettingsPatch({ votesDueHoursBeforeCeremony: 1.5 }).ok).toBe(false)
    expect(validateSurvivorFinaleSettingsPatch({ votesDueHoursBeforeCeremony: 73 }).ok).toBe(false)
    expect(validateSurvivorFinaleSettingsPatch({}).ok).toBe(false)
  })

  it('locks only sealed immunity and the due time while a council is open, and only when they change', () => {
    expect(finaleSettingsLockedDuringCouncil({ sealedImmunity: true, reunionChatEnabled: false }, SURVIVOR_FINALE_DEFAULTS)).toEqual(['sealedImmunity'])
    expect(finaleSettingsLockedDuringCouncil({ sealedImmunity: false }, SURVIVOR_FINALE_DEFAULTS)).toEqual([])
  })

  it('ballots are due N hours before the ceremony; 0 is the ceremony', () => {
    expect(ballotsDueAt(NOW, 0).toISOString()).toBe(NOW.toISOString())
    expect(ballotsDueAt(NOW, 3).toISOString()).toBe(iso(-3))
  })
})

describe('finale windows', () => {
  it('validates order and future deadlines, and clears with null', () => {
    const ok = validateFinaleWindowsPatch({ questionsOpenAt: iso(1), questionsDeadline: iso(10), answersDeadline: iso(20), speechesDeadline: iso(30) }, EMPTY_FINALE_WINDOWS, NOW)
    expect(ok.ok).toBe(true)
    expect(validateFinaleWindowsPatch({ questionsOpenAt: iso(10), questionsDeadline: iso(5) }, EMPTY_FINALE_WINDOWS, NOW).ok).toBe(false)
    expect(validateFinaleWindowsPatch({ questionsDeadline: iso(10), answersDeadline: iso(5) }, EMPTY_FINALE_WINDOWS, NOW).ok).toBe(false)
    expect(validateFinaleWindowsPatch({ speechesDeadline: iso(-1) }, EMPTY_FINALE_WINDOWS, NOW).ok).toBe(false)
    expect(validateFinaleWindowsPatch({ speechesDeadline: 'soon' }, EMPTY_FINALE_WINDOWS, NOW).ok).toBe(false)
    const cleared = validateFinaleWindowsPatch({ speechesDeadline: null }, { ...EMPTY_FINALE_WINDOWS, speechesDeadline: iso(5) }, NOW)
    expect(cleared).toEqual({ ok: true, windows: EMPTY_FINALE_WINDOWS })
    expect(readSurvivorFinaleWindows({ survivorFinaleWindows: { questionsDeadline: iso(2), junk: 1 } }).questionsDeadline).toBe(iso(2))
  })

  it('window states, and voting is held for speeches only with a speech window set', () => {
    const w = { ...EMPTY_FINALE_WINDOWS, questionsOpenAt: iso(1), questionsDeadline: iso(5), speechesDeadline: iso(3) }
    expect(juryQuestionWindow(w, NOW)).toBe('not_yet')
    expect(juryQuestionWindow(w, new Date(iso(2)))).toBe('open')
    expect(juryQuestionWindow(w, new Date(iso(6)))).toBe('closed')
    expect(closingSpeechWindow(EMPTY_FINALE_WINDOWS, NOW)).toBe('open')
    expect(juryVotingHeldForSpeeches({ closingSpeechesEnabled: true }, w, NOW)).toBe(true)
    expect(juryVotingHeldForSpeeches({ closingSpeechesEnabled: true }, w, new Date(iso(4)))).toBe(false)
    expect(juryVotingHeldForSpeeches({ closingSpeechesEnabled: true }, EMPTY_FINALE_WINDOWS, NOW)).toBe(false)
    expect(juryVotingHeldForSpeeches({ closingSpeechesEnabled: false }, w, NOW)).toBe(false)
  })
})

const ev = (eventType: string, metadata: object, h: number) => ({ eventType, metadata, createdAt: new Date(iso(h)) })
const gate = (over: Partial<JuryQaGate> = {}): JuryQaGate => ({ enabled: true, finaleOpen: true, voteComplete: false, finalists: ['f1', 'f2'], jurors: ['j1', 'j2'], window: 'open', ...over })

describe('jury Q&A', () => {
  const events = [
    ev('jury_question_asked', { jurorRosterId: 'j1', finalistRosterId: 'f1', text: 'Why you?' }, 0),
    ev('jury_question_asked', { jurorRosterId: 'j1', finalistRosterId: 'f1', text: 'Second try' }, 1),
    ev('jury_question_answered', { jurorRosterId: 'j1', finalistRosterId: 'f1', text: 'Because.' }, 2),
    ev('jury_answer_seen', { jurorRosterId: 'j1', finalistRosterId: 'f1' }, 3),
    ev('finalist_closing_speech', { finalistRosterId: 'f2', text: 'Draft' }, 1),
    ev('finalist_closing_speech', { finalistRosterId: 'f2', text: 'Final' }, 4),
  ]

  it('folds: the first question stands, answers and seen apply, the latest speech wins', () => {
    const state = foldJuryQa(events)
    expect(state.questions).toHaveLength(1)
    expect(state.questions[0]).toMatchObject({ question: 'Why you?', answer: 'Because.', seenAt: iso(3) })
    expect(state.speeches).toEqual([{ finalistRosterId: 'f2', text: 'Final', postedAt: iso(1), updatedAt: iso(4) }])
  })

  it('a changed answer clears the seen receipt', () => {
    const state = foldJuryQa([...events, ev('jury_question_answered', { jurorRosterId: 'j1', finalistRosterId: 'f1', text: 'New answer' }, 5)])
    expect(state.questions[0]).toMatchObject({ answer: 'New answer', seenAt: null })
  })

  it('one question per juror per finalist, inside the window, by a juror, about a finalist', () => {
    const state = foldJuryQa(events)
    expect(refuseJuryQuestion(state, gate(), { jurorRosterId: 'j1', finalistRosterId: 'f1', text: 'again' })).toBe('already_asked')
    expect(refuseJuryQuestion(state, gate(), { jurorRosterId: 'j1', finalistRosterId: 'f2', text: 'ok' })).toBeNull()
    expect(refuseJuryQuestion(state, gate(), { jurorRosterId: 'f1', finalistRosterId: 'f2', text: 'ok' })).toBe('not_juror')
    expect(refuseJuryQuestion(state, gate(), { jurorRosterId: 'j2', finalistRosterId: 'j1', text: 'ok' })).toBe('unknown_finalist')
    expect(refuseJuryQuestion(state, gate({ window: 'closed' }), { jurorRosterId: 'j2', finalistRosterId: 'f1', text: 'ok' })).toBe('window_closed')
    expect(refuseJuryQuestion(state, gate({ window: 'not_yet' }), { jurorRosterId: 'j2', finalistRosterId: 'f1', text: 'ok' })).toBe('window_not_open')
    expect(refuseJuryQuestion(state, gate({ enabled: false }), { jurorRosterId: 'j2', finalistRosterId: 'f1', text: 'ok' })).toBe('disabled')
    expect(refuseJuryQuestion(state, gate({ voteComplete: true }), { jurorRosterId: 'j2', finalistRosterId: 'f1', text: 'ok' })).toBe('vote_complete')
    expect(refuseJuryQuestion(state, gate(), { jurorRosterId: 'j2', finalistRosterId: 'f1', text: '   ' })).toBe('empty')
    expect(refuseJuryQuestion(state, gate(), { jurorRosterId: 'j2', finalistRosterId: 'f1', text: 'x'.repeat(501) })).toBe('too_long')
  })

  it('answers only questions asked of you; seen only after an answer; speeches only by finalists', () => {
    const state = foldJuryQa(events.slice(0, 1))
    expect(refuseFinalistAnswer(state, gate(), { finalistRosterId: 'f1', jurorRosterId: 'j1', text: 'a' })).toBeNull()
    expect(refuseFinalistAnswer(state, gate(), { finalistRosterId: 'f2', jurorRosterId: 'j1', text: 'a' })).toBe('no_question')
    expect(refuseFinalistAnswer(state, gate(), { finalistRosterId: 'j2', jurorRosterId: 'j1', text: 'a' })).toBe('not_finalist')
    expect(refuseAnswerSeen(state, gate(), { jurorRosterId: 'j1', finalistRosterId: 'f1' })).toBe('not_answered')
    expect(refuseAnswerSeen(foldJuryQa(events), gate(), { jurorRosterId: 'j1', finalistRosterId: 'f1' })).toBeNull()
    expect(refuseClosingSpeech(gate(), { finalistRosterId: 'j1', text: 'hi' })).toBe('not_finalist')
    expect(refuseClosingSpeech(gate(), { finalistRosterId: 'f1', text: 'hi' })).toBeNull()
    expect(refuseClosingSpeech(gate({ window: 'closed' }), { finalistRosterId: 'f1', text: 'hi' })).toBe('window_closed')
  })

  it('only the jury, finalists and a host read it before the champion is crowned', () => {
    expect(canReadJuryQa({ isJuror: false, isFinalist: false, isHost: false }, false)).toBe(false)
    expect(canReadJuryQa({ isJuror: true, isFinalist: false, isHost: false }, false)).toBe(true)
    expect(canReadJuryQa({ isJuror: false, isFinalist: false, isHost: true }, false)).toBe(true)
    expect(canReadJuryQa({ isJuror: false, isFinalist: false, isHost: false }, true)).toBe(true)
  })

  it('to-do: questions to ask, to answer, answers to read and a missing speech', () => {
    const state = foldJuryQa(events.slice(0, 3))
    expect(juryQaTodo(state, { rosterId: 'j1', isJuror: true, isFinalist: false }, ['f1', 'f2'], { speechesEnabled: true })).toMatchObject({ questionsToAsk: ['f2'], answersToRead: ['j1:f1'] })
    expect(juryQaTodo(state, { rosterId: 'f1', isJuror: false, isFinalist: true }, ['f1', 'f2'], { speechesEnabled: true })).toMatchObject({ questionsToAnswer: [], speechMissing: true })
    expect(juryQaTodo(state, { rosterId: 'f1', isJuror: false, isFinalist: true }, ['f1', 'f2'], { speechesEnabled: false }).speechMissing).toBe(false)
  })
})

describe('sealed immunity', () => {
  it('is sealed only when on and the week’s council has not closed', () => {
    expect(isImmunitySealed(false, null)).toBe(false)
    expect(isImmunitySealed(true, null)).toBe(true)
    expect(isImmunitySealed(true, { status: 'voting_open' })).toBe(true)
    expect(isImmunitySealed(true, { status: 'scheduled' })).toBe(true)
    expect(isImmunitySealed(true, { status: 'closed', closedAt: NOW })).toBe(false)
    expect(isImmunitySealed(true, { status: 'voting_open', isRevealed: true })).toBe(false)
    expect(shouldDeferImmunityAnnouncement(true, { status: 'voting_open' })).toBe(true)
  })

  it('keeps the immune on the ballot and off the public list while sealed', () => {
    expect(sealCouncilImmunity(['u1', 'u1'], true)).toEqual({ safeImmuneUserIds: [], publicImmuneUserIds: [], sealedImmuneUserIds: ['u1'] })
    expect(sealCouncilImmunity(['u1'], false)).toEqual({ safeImmuneUserIds: ['u1'], publicImmuneUserIds: ['u1'], sealedImmuneUserIds: [] })
    expect(redactImmunityList([{ u: 'a' }, { u: 'b' }], true, (r) => r.u === 'b')).toEqual([{ u: 'b' }])
    expect(redactImmunityList([{ u: 'a' }], false, () => false)).toEqual([{ u: 'a' }])
  })
})

describe('closest without going over', () => {
  const entries = [
    { userId: 'a', guess: 40, submittedAt: iso(1) },
    { userId: 'b', guess: 45, submittedAt: iso(2) },
    { userId: 'c', guess: 45, submittedAt: iso(0) },
    { userId: 'd', guess: 52, submittedAt: iso(0) },
    { userId: 'c', guess: 47, submittedAt: iso(3) },
  ]

  it('highest guess not over wins; equal guesses go to the earliest; first submission stands', () => {
    const r = settleClosestWithoutGoingOver(entries, 47)
    expect(r.winnerUserId).toBe('c')
    expect(r.ranked.map((x) => x.userId)).toEqual(['c', 'b', 'a', 'd'])
    expect(r.ranked.find((x) => x.userId === 'd')).toMatchObject({ over: true, margin: -5 })
  })

  it('everyone over: closest overall by default, or no winner', () => {
    expect(settleClosestWithoutGoingOver(entries, 10)).toMatchObject({ winnerUserId: 'a', everyoneOver: true })
    expect(settleClosestWithoutGoingOver(entries, 10, { allOverRule: 'no_winner' })).toMatchObject({ winnerUserId: null, everyoneOver: true })
    expect(settleClosestWithoutGoingOver([], 10).winnerUserId).toBeNull()
  })

  it('a stored final game gives the target; otherwise the commissioner enters it', () => {
    expect(closestTargetFromStoredGame({ status: 'Final', homeScore: 27, awayScore: 20 })).toBe(47)
    expect(closestTargetFromStoredGame({ status: 'in_progress', homeScore: 27, awayScore: 20 })).toBeNull()
    expect(closestTargetFromStoredGame({ status: 'final', homeScore: null, awayScore: 20 })).toBeNull()
    expect(parseCommissionerTarget('47.255')).toBe(47.26)
    expect(parseCommissionerTarget(-1)).toBeNull()
  })
})

describe('end-of-season ballot reveal', () => {
  const councils = [
    { id: 'c2', week: 3, councilNumber: 1, phase: 'merge', status: 'revealed', isRevealed: true, eliminatedUserId: 'u3' },
    { id: 'c1', week: 2, councilNumber: 1, phase: 'pre_merge', status: 'revealed', isRevealed: true, eliminatedUserId: null },
    { id: 'cx', week: 4, councilNumber: 1, phase: 'merge', status: 'cancelled', isRevealed: false, eliminatedUserId: null },
  ]
  const votes = [
    { councilId: 'c2', voterUserId: 'u1', voterName: null, targetUserId: 'u3', targetName: null, doesNotCount: false, isLateVote: false },
    { councilId: 'c2', voterUserId: 'u2', voterName: null, targetUserId: 'u3', targetName: null, doesNotCount: true, isLateVote: true },
  ]
  const names = new Map([['u1', 'Ann'], ['u2', 'Bo'], ['u3', 'Cy']])

  it('is never released before the season is complete, whatever the setting', () => {
    expect(buildBallotReveal({ enabled: true, seasonComplete: false }, councils, votes, names)).toBeNull()
    expect(buildBallotReveal({ enabled: false, seasonComplete: true }, councils, votes, names)).toBeNull()
  })

  it('after the season, every revealed council in order with who voted for whom', () => {
    const out = buildBallotReveal({ enabled: true, seasonComplete: true }, councils, votes, names)!
    expect(out.map((c) => c.councilId)).toEqual(['c1', 'c2'])
    expect(out[1]).toMatchObject({ eliminatedName: 'Cy', ballots: [{ voterName: 'Ann', targetName: 'Cy', counted: true, late: false }, { voterName: 'Bo', targetName: 'Cy', counted: false, late: true }] })
  })
})

describe('Chimmy at the finale', () => {
  const finalists = [
    { rosterId: 'f1', name: 'Ann', seasonPoints: 1400, immunityWins: 1 },
    { rosterId: 'f2', name: 'Bo', seasonPoints: 1400, immunityWins: 3 },
    { rosterId: 'f3', name: 'Cy', seasonPoints: 1200, immunityWins: 5 },
  ]

  it('votes for the strongest season (points, then immunity wins), never for itself', () => {
    expect(chimmyJurorVote(finalists)).toBe('f2')
    expect(chimmyJurorVote(finalists, 'f2')).toBe('f1')
    expect(chimmyJurorVote([])).toBeNull()
  })

  it('asks a stable question, answers and speaks in the league’s language', () => {
    const q = chimmyJuryQuestion('en', 'j1', finalists[0]!, finalists)
    expect(q).toBe(chimmyJuryQuestion('en', 'j1', finalists[0]!, finalists))
    expect(q).toContain('Ann')
    expect(chimmyLang('es-MX')).toBe('es')
    expect(chimmyJuryQuestion('es', 'j1', finalists[0]!, finalists)).toMatch(/[¿]/)
    expect(chimmyFinalistAnswer('en', finalists[2]!)).toContain('5 immunity wins')
    expect(chimmyClosingSpeech('es', finalists[0]!)).toContain('Jurado')
  })
})

describe('Chimmy rules answers know the finale settings', () => {
  const ctx = (finale = SURVIVOR_FINALE_DEFAULTS, finaleWindows = EMPTY_FINALE_WINDOWS): SurvivorRulesContext => ({ sport: 'NFL', settings: SURVIVOR_DEFAULT_FOUNDATION_SETTINGS, plan: null, finale, finaleWindows })

  it('routes closing speeches and the reunion to the jury topic', () => {
    expect(survivorRulesTopic('how do closing speeches work?')).toBe('jury')
    expect(survivorRulesTopic('when is the reunion?')).toBe('jury')
  })

  it('explains questions, speeches, the ballot reveal, the reunion, sealed immunity and votes due', () => {
    const jury = answerSurvivorRules('jury', ctx({ ...SURVIVOR_FINALE_DEFAULTS, endOfSeasonBallotReveal: true }, { ...EMPTY_FINALE_WINDOWS, speechesDeadline: iso(5) }))
    expect(jury).toContain('one question')
    expect(jury).toContain('Jury voting opens when the speeches close')
    expect(jury).toContain('who voted for whom')
    expect(jury).toContain('reunion')
    expect(answerSurvivorRules('immunity', ctx({ ...SURVIVOR_FINALE_DEFAULTS, sealedImmunity: true }))).toContain('Immunity is sealed')
    expect(answerSurvivorRules('immunity', ctx())).not.toContain('sealed')
    expect(answerSurvivorRules('voting', ctx({ ...SURVIVOR_FINALE_DEFAULTS, votesDueHoursBeforeCeremony: 3 }))).toContain('Ballots are due 3 hours before the Torch Ceremony')
    expect(answerSurvivorRules('voting', ctx())).toContain('Votes close at the Torch Ceremony')
  })
})
