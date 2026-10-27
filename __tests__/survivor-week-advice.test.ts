import { describe, expect, it } from 'vitest'
import { buildSurvivorWeekAdvice, type SurvivorWeekAdviceFacts } from '@/lib/survivor/survivorWeekAdvice'

const facts = (over: Partial<SurvivorWeekAdviceFacts> = {}): SurvivorWeekAdviceFacts => ({
  merged: false,
  inGame: true,
  myRosterId: 'r1',
  myTribeId: 't1',
  tribeScores: { t1: 80, t2: 95.5, t3: 110 },
  tribeNames: { t1: 'Tala', t2: 'Vanua', t3: 'Kele' },
  memberScores: { r1: 20, r2: 41.5, r3: 30 },
  rosterNames: { r1: 'Me', r2: 'Ace', r3: 'Bo' },
  immuneRosterIds: [],
  scoresFinalized: false,
  council: null,
  myIdols: [],
  idolExpiryText: 'Play it before the tribes merge; it expires at the merge.',
  ...over,
})
const ids = (f: SurvivorWeekAdviceFacts) => buildSurvivorWeekAdvice(f).map(a => a.id)
const byId = (f: SurvivorWeekAdviceFacts, id: string) => buildSurvivorWeekAdvice(f).find(a => a.id === id)

describe('buildSurvivorWeekAdvice', () => {
  it('before the merge, a last-place tribe is at risk, with the gap to the next tribe, and the lineup advice is the floor', () => {
    expect(ids(facts())).toEqual(['at_risk', 'lineup'])
    expect(byId(facts(), 'at_risk')!.body).toBe('Your tribe is last, 15.5 behind Vanua. Finish last and you go to Tribal Council.')
    expect(byId(facts(), 'lineup')!.title).toMatch(/floor/)
  })

  it('a tribe that is not last is not at risk, and holding an idol is safe', () => {
    const f = facts({ myTribeId: 't3', myIdols: [{ name: 'Immunity Idol', playableAtCouncil: true }] })
    expect(ids(f)).toEqual(['hold_idol', 'lineup'])
    expect(byId(f, 'hold_idol')!.body).toMatch(/expires at the merge/)
  })

  it('at an open council the viewer attends: "Play your idol now?", and no lineup advice', () => {
    const f = facts({ council: { attendingTribeId: 't1' }, myIdols: [{ name: 'Immunity Idol', playableAtCouncil: true }, { name: 'Extra Vote', playableAtCouncil: true }] })
    expect(ids(f)).toEqual(['at_council', 'play_idol'])
    expect(byId(f, 'play_idol')!.body).toMatch(/^You hold Immunity Idol and 1 more\. Play it before the votes are read/)
  })

  it('an idol that is not played at council never prompts a play', () => {
    expect(ids(facts({ council: { attendingTribeId: 't1' }, myIdols: [{ name: 'Points Surge', playableAtCouncil: false }] }))).toEqual(['at_council'])
  })

  it('another tribe at council: no warning for the viewer', () => {
    expect(ids(facts({ myTribeId: 't3', council: { attendingTribeId: 't1' } }))).toEqual([])
  })

  it('after the merge, without immunity: chase the top score, with the gap to the leader', () => {
    const f = facts({ merged: true, myTribeId: null })
    expect(ids(f)).toEqual(['lineup'])
    expect(byId(f, 'lineup')!.body).toBe("Immunity goes to the week's top score. You are 21.5 behind Ace. Start the players with the biggest upside.")
  })

  it('an immune manager is told so, gets no idol prompt and no chase advice, even at council', () => {
    const f = facts({ merged: true, immuneRosterIds: ['r1'], council: { attendingTribeId: null }, myIdols: [{ name: 'Immunity Idol', playableAtCouncil: true }] })
    expect(ids(f)).toEqual(['immune'])
  })

  it('once the week is final the lineup advice stops; a manager out of the game gets nothing', () => {
    expect(ids(facts({ scoresFinalized: true }))).toEqual([])
    expect(ids(facts({ inGame: false }))).toEqual([])
  })
})
