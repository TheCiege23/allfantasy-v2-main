/**
 * The Trade Center's "Explain with Chimmy" prefill must be a sentence Chimmy's trade grader can
 * read: split on " for ", with a received pick naming its owner. The old prefill had neither, and
 * a picks-only trade came back NOT COMPUTED (AFC Dreaming!, 2026-09-30).
 */
import { describe, expect, it } from 'vitest'

import { describeAssetForChimmy, tradeExplainPrompt } from '@/lib/core-app/tradeExplainPrompt'
import { splitSides } from '@/lib/chimmy-trade/tradeSentence'
import { extractPickMentions } from '@/lib/chimmy/tradePickMentions'
import type { PickedAsset } from '@/components/core-app/screens/TradeAssetPicker'

const allen: PickedAsset = { kind: 'player', playerId: '11588', name: 'Braelon Allen', position: 'RB', team: 'NYJ', value: 1501 } as PickedAsset
const jeffs2nd: PickedAsset = { kind: 'pick', year: 2028, round: 2, label: '2028 2nd', pickId: 'p1', value: 1186 }

const base = {
  leagueName: 'AFC Dreaming!',
  give: [allen],
  get: [jeffs2nd],
  myName: 'TheCiege26',
  partnerName: 'JeffersonTD',
  partnerTeamName: 'Champ DeThroner',
  giveValue: 1501,
  getValue: 1186,
  verdict: 'The analyzer says: Slightly favors opponent.',
}

describe('tradeExplainPrompt', () => {
  it('requests Spanish without breaking the grader’s canonical trade and pick-owner parsing', () => {
    const text = tradeExplainPrompt({ ...base, language: 'es' })
    expect(text).toContain('Responde en español')
    expect(text).toContain('¿Qué riesgos o datos me faltan?')
    const sides = splitSides(text)!
    expect(sides.left).toBe('Braelon Allen')
    expect(extractPickMentions(sides.right).picks).toEqual([expect.objectContaining({season:2028,round:2,owner:'JeffersonTD'})])
  })
  it('writes the trade first, as "X for Y", with the received pick naming its owner', () => {
    const text = tradeExplainPrompt(base)
    expect(text).toBe(
      'Braelon Allen for 2028 2nd Rd (JeffersonTD). Explain this trade in AFC Dreaming! with Champ DeThroner (JeffersonTD). ' +
        'On the trade screen I give 1,501 and get 1,186 in league value — explain using those numbers. ' +
        'The analyzer says: Slightly favors opponent. What am I missing?',
    )
  })

  it('is read by the grader’s own splitter: Allen on the left, JeffersonTD’s 2nd on the right', () => {
    const sides = splitSides(tradeExplainPrompt(base))!
    expect(sides.left).toBe('Braelon Allen')
    const right = extractPickMentions(sides.right)
    expect(right.picks).toEqual([expect.objectContaining({ season: 2028, round: 2, owner: 'JeffersonTD' })])
    // Control: the old prefill has no " for " at all, so the grader never saw a trade.
    expect(splitSides('Explain this trade in AFC Dreaming!. I give: Braelon Allen. I get: 2028 2nd. What am I missing?')).toBeNull()
  })

  it('an acquired pick keeps the team it came from; values are left out when a side is unpriced', () => {
    const acquired: PickedAsset = { kind: 'pick', year: 2027, round: 1, label: '2027 1st (Pats Nation)', pickId: 'p2', value: null }
    expect(describeAssetForChimmy(acquired, 'JeffersonTD')).toBe('2027 1st Rd (Pats Nation)')
    const text = tradeExplainPrompt({ ...base, get: [acquired], getValue: null })
    expect(text).not.toMatch(/in league value/)
    expect(describeAssetForChimmy({ kind: 'faab', amount: 20 }, null)).toBe('$20 FAAB')
  })

  it('an empty side falls back to a general question', () => {
    expect(tradeExplainPrompt({ ...base, get: [] })).toBe('Help me think about a trade in AFC Dreaming!.')
  })
})
