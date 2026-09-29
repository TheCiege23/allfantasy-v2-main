import { describe, expect, it, vi } from 'vitest'

/*
 * The league trade finder (`/api/legacy/trade/league-analyze`, and `/api/ai/trade/league-analyze`
 * which delegates to it): the model proposes packages, THE trade grade grades them. The model's own
 * "tradeGrade" is overwritten — never kept, never shown.
 */
import {
  gradeLegacyTradeSuggestions,
  ONE_SIDED_SUGGESTION_REASON,
  type LegacyPackageGrade,
} from '@/lib/legacy/legacyPackageGrade'

const GRADED: LegacyPackageGrade = {
  graded: true,
  letter: 'D',
  partnerLetter: 'B',
  label: 'Slightly favors opponent',
  recommendation: 'Ask for a little more back.',
  giveValue: 7000,
  getValue: 5600,
  basis: 'Dynasty · Superflex · 12 teams · PPR',
}

function suggestions() {
  return [
    {
      targetManager: 'user2',
      suggestedTrades: [
        { youGive: ['Josh Allen (QB)', '2026 2nd'], youReceive: ['Puka Nacua'], whyYouWin: 'x', tradeGrade: 'A' },
        { youGive: ['Garrett Wilson'], youReceive: [], tradeGrade: 'B' },
      ] as Array<Record<string, unknown>>,
    },
    { targetManager: 'user3', suggestedTrades: [{ youGive: ['Breece Hall'], youReceive: ['Jahmyr Gibbs', '2027 1st'], tradeGrade: 'C' }] as Array<Record<string, unknown>> },
  ]
}

describe('gradeLegacyTradeSuggestions — the model proposes, the one grader grades', () => {
  it('grades every suggested package from the user’s side: give = youGive, get = youReceive, on the labels as written', async () => {
    const gradeOf = vi.fn(async () => GRADED)
    const s = suggestions()
    await gradeLegacyTradeSuggestions(s, gradeOf)

    expect(gradeOf).toHaveBeenCalledTimes(2)
    expect(gradeOf).toHaveBeenCalledWith(
      { assets: [{ kind: 'player', name: 'Josh Allen' }, { kind: 'pick', year: 2026, round: 2, label: '2026 2nd' }], unpriceable: [] },
      { assets: [{ kind: 'player', name: 'Puka Nacua' }], unpriceable: [] },
    )
    expect(gradeOf).toHaveBeenCalledWith(
      { assets: [{ kind: 'player', name: 'Breece Hall' }], unpriceable: [] },
      { assets: [{ kind: 'player', name: 'Jahmyr Gibbs' }, { kind: 'pick', year: 2027, round: 1, label: '2027 1st' }], unpriceable: [] },
    )
  })

  it('the model’s letter is overwritten with the one letter — an A the grader calls D reads D', async () => {
    const s = suggestions()
    await gradeLegacyTradeSuggestions(s, async () => GRADED)
    expect(s[0]!.suggestedTrades[0]!.tradeGrade).toBe('D')
    expect(s[0]!.suggestedTrades[0]!.oneGrade).toEqual(GRADED)
    expect(s[1]!.suggestedTrades[0]!.tradeGrade).toBe('D')
  })

  it('a withheld grade leaves NO letter — the model’s is not kept as a fallback', async () => {
    const s = suggestions()
    await gradeLegacyTradeSuggestions(s, async () => ({ graded: false, reason: 'Not your league.' }))
    expect(s[0]!.suggestedTrades[0]!.tradeGrade).toBeNull()
    expect(s[0]!.suggestedTrades[0]!.oneGrade).toEqual({ graded: false, reason: 'Not your league.' })
  })

  it('a one-sided suggestion is withheld without asking the grader', async () => {
    const gradeOf = vi.fn(async () => GRADED)
    const s = suggestions()
    await gradeLegacyTradeSuggestions(s, gradeOf)
    expect(s[0]!.suggestedTrades[1]!.tradeGrade).toBeNull()
    expect(s[0]!.suggestedTrades[1]!.oneGrade).toEqual({ graded: false, reason: ONE_SIDED_SUGGESTION_REASON })
  })

  it('a grader that rejects costs that trade its letter, never the response', async () => {
    const s = suggestions()
    await expect(gradeLegacyTradeSuggestions(s, async () => { throw new Error('down') })).resolves.toBeUndefined()
    expect(s[0]!.suggestedTrades[0]!.tradeGrade).toBeNull()
    expect((s[0]!.suggestedTrades[0]!.oneGrade as LegacyPackageGrade).graded).toBe(false)
  })

  it('tolerates the model’s junk: non-array sides and non-string entries', async () => {
    const s = [{ suggestedTrades: [{ youGive: 'Josh Allen', youReceive: [42, null, 'Puka Nacua'] }] as Array<Record<string, unknown>> }]
    const gradeOf = vi.fn(async () => GRADED)
    await gradeLegacyTradeSuggestions(s, gradeOf)
    expect(gradeOf).not.toHaveBeenCalled()
    expect(s[0]!.suggestedTrades[0]!.tradeGrade).toBeNull()
  })
})
