// @vitest-environment node
/**
 * THE grade on a Trade Center partner suggestion (2026-09-27) — `lib/trade-intel/partnerSuggestionGrades.ts`.
 *
 * 🛑 The finder called a package "fair" on its own roster-value gap, and the same deal graded "Major
 * overpay" in the builder. Pinned: the suggestion is graded with the builder's exact inputs, only the
 * cards shown are graded, and a withheld or failed grade never becomes a letter.
 */
import { describe, expect, it, vi } from 'vitest'
import { gradePartnerSuggestions } from '@/lib/trade-intel/partnerSuggestionGrades'
import type { PartnerRanking, PartnerRecommendation } from '@/lib/trade-intel/partnerRanking'

const partner = (rosterId: string, withSuggestion = true): PartnerRecommendation => ({
  rosterId, ownerName: rosterId, rank: 1, score: 60, label: 'Good fit',
  components: { availability: null, need: null, package: null, history: null }, reasons: [],
  suggestion: withSuggestion
    ? {
        give: [{ id: 'p-mine', name: 'Receiver', position: 'WR', value: 4000, kind: 'player' }, { id: 'pick-1', name: '2027 2nd', position: null, value: 900, kind: 'pick' }],
        get: [{ id: 'p-theirs', name: 'Runner', position: 'RB', value: 4600, kind: 'player' }],
        percentApart: 3,
      }
    : null,
})

const GRADED = { graded: true, letter: 'D', partnerLetter: 'B', label: 'Slightly favors opponent', giveValue: 5200, getValue: 4100 }
const picks = new Map([['pick-1', { season: 2027, round: 2, label: '2027 2nd' }], ['pick-bad', { season: null, round: 2, label: '??' }]])

describe('gradePartnerSuggestions', () => {
  it('grades with the builder’s exact inputs and attaches the letters from the viewer’s side', async () => {
    const ranking: PartnerRanking = { partners: [partner('A')], gaps: [] }
    const grade = vi.fn().mockResolvedValue(GRADED)
    await gradePartnerSuggestions({ ranking, picks, grade, limit: 5 })
    expect(grade).toHaveBeenCalledWith(
      { assets: [{ kind: 'player', playerId: 'p-mine', name: 'Receiver' }, { kind: 'pick', year: 2027, round: 2, label: '2027 2nd' }], unpriceable: [] },
      { assets: [{ kind: 'player', playerId: 'p-theirs', name: 'Runner' }], unpriceable: [] },
    )
    expect(ranking.partners[0]!.suggestion!.grade).toEqual({ graded: true, letter: 'D', partnerLetter: 'B', label: 'Slightly favors opponent', giveValue: 5200, getValue: 4100 })
  })

  it('a pick the builder could not rebuild is named as unpriceable, never priced as zero', async () => {
    const p = partner('A')
    p.suggestion!.give = [{ id: 'pick-bad', name: '2027 2nd (unknown)', position: null, value: 900, kind: 'pick' }]
    const grade = vi.fn().mockResolvedValue({ graded: false, reason: 'x', basis: null })
    await gradePartnerSuggestions({ ranking: { partners: [p], gaps: [] }, picks, grade, limit: 5 })
    expect(grade.mock.calls[0]![0]).toEqual({ assets: [], unpriceable: ['2027 2nd (unknown)'] })
  })

  it('grades only the cards shown, and skips a partner with no suggestion', async () => {
    const ranking: PartnerRanking = { partners: [partner('A'), partner('B', false), partner('C'), partner('D')], gaps: [] }
    const grade = vi.fn().mockResolvedValue(GRADED)
    await gradePartnerSuggestions({ ranking, picks, grade, limit: 3 })
    expect(grade).toHaveBeenCalledTimes(2) // A and C; B has no deal; D is past the limit
    expect(ranking.partners[3]!.suggestion!.grade).toBeUndefined()
  })

  it('a withheld grade carries its reason; a failed one carries nothing — never a letter', async () => {
    const ranking: PartnerRanking = { partners: [partner('A'), partner('B')], gaps: [] }
    const grade = vi.fn()
      .mockResolvedValueOnce({ graded: false, reason: 'Runner could not be found in the NFL player database', basis: null })
      .mockRejectedValueOnce(new Error('chart down'))
    await gradePartnerSuggestions({ ranking, picks, grade, limit: 5 })
    expect(ranking.partners[0]!.suggestion!.grade).toEqual({ graded: false, reason: 'Runner could not be found in the NFL player database' })
    expect(ranking.partners[1]!.suggestion!.grade).toBeNull()
  })
})
