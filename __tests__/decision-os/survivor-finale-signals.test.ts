// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { deriveSurvivorFinaleSignals, formatTimeLeft, type SurvivorFinaleSignalInputs } from '@/lib/decision-os/survivorFinaleSignals'

const NOW = new Date('2026-12-20T18:00:00.000Z')
const iso = (h: number) => new Date(NOW.getTime() + h * 3_600_000).toISOString()
const base: SurvivorFinaleSignalInputs = {
  leagueId: 'L1', now: NOW,
  questionsToAsk: 0, questionsDeadline: null, questionWindowOpen: true,
  questionsToAnswer: 0, answersDeadline: null, answerWindowOpen: true,
  speechMissing: false, speechesDeadline: null, speechWindowOpen: true,
  ballotOwed: false, ballotsDueAt: null,
}

describe('Survivor finale Decision OS signals', () => {
  it('nothing owed, nothing signalled', () => {
    expect(deriveSurvivorFinaleSignals(base)).toEqual([])
  })

  it('"jury question window closes in X", severity by time left', () => {
    const [s] = deriveSurvivorFinaleSignals({ ...base, questionsToAsk: 2, questionsDeadline: iso(1.5) })
    expect(s).toMatchObject({ type: 'survivor_jury_question_window', title: 'Jury question window closes in 2 h', severity: 'high', source: 'survivor', leagueId: 'L1' })
    expect(deriveSurvivorFinaleSignals({ ...base, questionsToAsk: 1, questionsDeadline: iso(30) })[0]!.severity).toBe('low')
    expect(deriveSurvivorFinaleSignals({ ...base, questionsToAsk: 1 })[0]!.title).toBe('Ask the finalists your jury question')
    expect(deriveSurvivorFinaleSignals({ ...base, questionsToAsk: 1, questionWindowOpen: false })).toEqual([])
    expect(deriveSurvivorFinaleSignals({ ...base, questionsToAsk: 1, questionsDeadline: iso(-1) })).toEqual([])
  })

  it('"write your closing speech" and "answer the jury"', () => {
    const out = deriveSurvivorFinaleSignals({ ...base, speechMissing: true, speechesDeadline: iso(10), questionsToAnswer: 1 })
    expect(out.map((s) => s.type)).toEqual(['survivor_finalist_answer_due', 'survivor_closing_speech'])
    expect(out[1]!.title).toBe('Write your closing speech — 10 h left')
    expect(out[1]!.severity).toBe('medium')
  })

  it('"votes due in X" only when the viewer owes a ballot', () => {
    expect(deriveSurvivorFinaleSignals({ ...base, ballotOwed: true, ballotsDueAt: iso(0.5) })[0]).toMatchObject({ type: 'survivor_votes_due', title: 'Votes due in 30 min', severity: 'high' })
    expect(deriveSurvivorFinaleSignals({ ...base, ballotOwed: false, ballotsDueAt: iso(0.5) })).toEqual([])
  })

  it('ids are stable for the same condition', () => {
    const a = deriveSurvivorFinaleSignals({ ...base, ballotOwed: true, ballotsDueAt: iso(3) })
    const b = deriveSurvivorFinaleSignals({ ...base, now: new Date(NOW.getTime() + 60_000), ballotOwed: true, ballotsDueAt: iso(3) })
    expect(a[0]!.id).toBe(b[0]!.id)
    expect(formatTimeLeft(3 * 24 * 3_600_000)).toBe('3 days')
  })
})
