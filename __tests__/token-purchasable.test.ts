// @vitest-environment node
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

import { buildToolsHub } from '@/lib/core-app/toolsHub'
import { getTokenSpendRuleMatrixEntry, listTokenSpendRuleMatrix } from '@/lib/tokens/pricing-matrix'
import { isTokenPurchasableRule, TOKEN_PURCHASABLE_RULES } from '@/lib/tokens/tokenPurchasable'

/*
 * What tokens can actually buy (lib/tokens/tokenPurchasable.ts). Census 2026-09-25: the price
 * table priced 64 actions and the /tokens page listed every one; 13 had a screen that charges
 * them. The rest were priced and never charged, or chargeable only through an API no screen calls.
 */

const root = resolve(__dirname, '..')

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name.startsWith('.')) continue
    const full = join(dir, name)
    if (statSync(full).isDirectory()) sourceFiles(full, out)
    else if (/\.(ts|tsx)$/.test(name)) out.push(full)
  }
  return out
}

/** Files that NAME a rule without charging it — the price table, the seed, this allowlist, the launcher. */
const NAMING_ONLY = [
  'lib/tokens/pricing-matrix.ts',
  'lib/tokens/constants.ts',
  'lib/tokens/tokenPurchasable.ts',
  'lib/monetization/feature-monetization-matrix.ts',
  'lib/core-app/toolsHub.ts',
]

describe('TOKEN_PURCHASABLE_RULES', () => {
  it('every listed action is a priced rule, and there are 13 of the table’s 64', () => {
    for (const r of TOKEN_PURCHASABLE_RULES) {
      const entry = getTokenSpendRuleMatrixEntry(r.code)
      expect(entry, r.code).not.toBeNull()
      expect(entry!.tokenCost, r.code).toBeGreaterThan(0)
    }
    expect(TOKEN_PURCHASABLE_RULES).toHaveLength(13)
    expect(new Set(TOKEN_PURCHASABLE_RULES.map((r) => r.code)).size).toBe(13)
    expect(listTokenSpendRuleMatrix().length).toBe(64)
  }, 60_000)

  it('🛑 every listed action is charged by something outside the price table (the half a machine can check)', () => {
    const chargers = [...sourceFiles(join(root, 'app', 'api')), ...sourceFiles(join(root, 'lib'))]
      .map((f) => ({ rel: f.slice(root.length + 1).split('\\').join('/'), text: readFileSync(f, 'utf8') }))
      .filter((f) => !NAMING_ONLY.includes(f.rel))
    for (const r of TOKEN_PURCHASABLE_RULES) {
      const where = chargers.filter((f) => f.text.includes(`'${r.code}'`) || f.text.includes(`"${r.code}"`))
      expect(where.length, `${r.code} — no route or charging module names it`).toBeGreaterThan(0)
    }
  }, 120_000)

  it('🛑 actions nothing sells are not on the menu', () => {
    for (const code of [
      'ai_waiver_one_off_suggestion', // priced; the waiver engine charges ai_waiver_engine_run instead
      'ai_draft_helper_session_recommendation', // offered on the draft helper's lock card; nothing charges it
      'ai_war_room_multi_step_planning', // linked from the AF Legacy spotlight; its only caller has no caller
      'ai_strategy_3_5_year_planning',
      'commissioner_ai_collusion_detection_scan',
      'survivor_ai_blindside_risk', // only a developer smoke-test button
      'big_brother_ai_vote_prediction', // no screen calls the route
      'ai_matchup_explanation_single', // the screen cannot confirm the charge
    ]) {
      expect(isTokenPurchasableRule(code), code).toBe(false)
    }
    expect(isTokenPurchasableRule(null)).toBe(false)
    expect(isTokenPurchasableRule(undefined)).toBe(false)
  })
})

describe('Tools hub prices', () => {
  const hub = buildToolsHub({
    issues: [],
    stats: { leaguesPlayed: 1, tradesOnFile: 0, connectedLeagues: 1 },
    selectedLeagueId: null,
  })
  const tool = (id: string) => hub.groups.flatMap((g) => g.tools).find((t) => t.id === id)

  it('🛑 the Waiver Assistant card no longer shows the price of a rule nothing charges', () => {
    expect(tool('waivers')).toBeTruthy()
    expect(tool('waivers')!.tokenCost).toBeNull()
  })

  it('a card for something tokens do buy keeps its price', () => {
    expect(tool('trade')!.tokenCost).toBe(getTokenSpendRuleMatrixEntry('ai_trade_analyzer_full_review')!.tokenCost)
  })
})
