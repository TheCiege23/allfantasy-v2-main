import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

import { SURVIVOR_AI_ACTIONS, SURVIVOR_AI_TYPE_RULE_CODE, SURVIVOR_SOLD_AI_ACTIONS } from '@/lib/survivor/survivor-ai-token-catalog'
import { getTokenSpendRuleMatrixEntry } from '@/lib/tokens/pricing-matrix'
import { TOKEN_SPEND_RULE_SEEDS } from '@/lib/tokens/constants'

/*
 * 🛑 THE SURVIVOR COMMAND CENTRE SHOWED PRICES NOBODY CHARGES (fixed 2026-09-29): the catalog typed
 * 15 / 50 / 100 beside each rule while the matrix — which seeds the rows the charge reads — said
 * 10 / 30 / 75 / 200. Every displayed price must now be the charged rule's base cost.
 */
describe('Survivor AI token prices', () => {
  it.each(SURVIVOR_AI_ACTIONS.map((a) => [a.id, a] as const))('%s shows the cost its rule charges', (_id, action) => {
    const matrix = getTokenSpendRuleMatrixEntry(action.ruleCode)
    expect(matrix, `${action.ruleCode} is missing from the pricing matrix`).not.toBeNull()
    expect(action.tokenCost).toBe(matrix!.tokenCost)
    // …and the matrix is what the charge reads: the seeded rule carries the same cost.
    expect(TOKEN_SPEND_RULE_SEEDS.find((s) => s.code === action.ruleCode)?.tokenCost).toBe(action.tokenCost)
  })

  it('no price is typed into the catalog by hand', () => {
    const src = readFileSync(resolve(process.cwd(), 'lib/survivor/survivor-ai-token-catalog.ts'), 'utf8')
    expect(src).not.toMatch(/tokenCost:\s*\d/)
  })

  it('the command centre prints no hand-typed price scale', () => {
    const src = readFileSync(resolve(process.cwd(), 'components/survivor/SurvivorPremiumCommandCenterPanel.tsx'), 'utf8')
    expect(src).not.toMatch(/1 \/ 2 \/ 3 AF Tokens|15 \/ 50 \/ 100/)
  })

  // 13 of the catalogue's 22 rows had no code behind them and were still listed with a price.
  it('the command centre lists only actions the AI route can run, at the price that route charges', () => {
    expect(SURVIVOR_SOLD_AI_ACTIONS.map((a) => a.aiType).sort()).toEqual(Object.keys(SURVIVOR_AI_TYPE_RULE_CODE).sort())
    for (const action of SURVIVOR_SOLD_AI_ACTIONS) {
      expect(action.ruleCode).toBe(SURVIVOR_AI_TYPE_RULE_CODE[action.aiType])
      expect(action.tokenCost).toBe(getTokenSpendRuleMatrixEntry(action.ruleCode)?.tokenCost)
      expect(action.lane).toBe(action.aiType.startsWith('host_') ? 'host' : 'player')
    }
    const src = readFileSync(resolve(process.cwd(), 'components/survivor/SurvivorPremiumCommandCenterPanel.tsx'), 'utf8')
    expect(src).toContain('SURVIVOR_SOLD_AI_ACTIONS')
    expect(src).not.toMatch(/\bSURVIVOR_AI_ACTIONS\b/)
  })
})
