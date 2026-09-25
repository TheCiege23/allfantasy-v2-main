/**
 * The token actions a person can actually start — and be charged for — from a screen today.
 *
 * 🛑 THE PRICE TABLE IS NOT A MENU. `lib/tokens/pricing-matrix.ts` prices 64 actions and the
 * /tokens page used to list all of them under "What things cost". A census on 2026-09-25
 * found only these 13 wired to a screen that charges them:
 *   - 33 were priced and never charged anywhere;
 *   - 15 could be charged only by calling an API no screen calls (Survivor and Big Brother
 *     AI, matchup simulation, World Cup Chimmy coaching);
 *   - 2 sat behind code with no caller (the Decision OS planning sessions).
 * So the page sold things nobody could buy, and locked-feature cards offered "Or use N
 * tokens" for features that accept no tokens at all.
 *
 * ⚠ ADD A RULE HERE ONLY WHEN A SCREEN CAN BUY IT. That means a route charges this code AND
 * a page someone can reach calls that route. `__tests__/token-purchasable.test.ts` checks
 * the first half (each code is referenced by a route under app/api); the second half is a
 * human check, recorded in `where` below.
 *
 * Costs are NOT stored here — they come from the live spend rules, so re-pricing needs no
 * edit in this file.
 */

export type TokenBuyer =
  /** Any signed-in user. */
  | 'anyone'
  /** A member of the league the action is about. */
  | 'league_member'
  /** The league's commissioner. */
  | 'commissioner'
  /** The manager of a World Cup pool. */
  | 'pool_manager'

export type TokenPurchasableRule = {
  code: string
  /** What the page calls it — plain words, not the rule's internal label. */
  label: string
  who: TokenBuyer
  /** The screen that sells it, for the human half of the check above. */
  where: string
}

export const TOKEN_PURCHASABLE_RULES: readonly TokenPurchasableRule[] = [
  { code: 'ai_chimmy_chat_message', label: 'Chimmy question', who: 'anyone', where: 'Chimmy chat' },
  {
    code: 'ai_player_comparison_quick_explanation',
    label: 'Player comparison write-up',
    who: 'anyone',
    where: 'Player Comparison',
  },
  { code: 'ai_draft_pick_explanation', label: 'Draft pick explanation', who: 'league_member', where: 'draft room' },
  {
    code: 'ai_league_rankings_explanation',
    label: 'Power rankings commentary',
    who: 'league_member',
    where: 'Power Rankings',
  },
  { code: 'ai_trade_analyzer_full_review', label: 'Full trade review', who: 'anyone', where: 'Trade Evaluator' },
  { code: 'ai_waiver_engine_run', label: 'Waiver Wire AI run', who: 'anyone', where: 'Waiver Wire' },
  { code: 'ai_storyline_creation', label: 'League storyline', who: 'league_member', where: 'league drama and story' },
  {
    code: 'commissioner_ai_chat_question',
    label: 'AI Commissioner question',
    who: 'commissioner',
    where: 'AI Commissioner panel',
  },
  {
    code: 'commissioner_ai_cycle_run',
    label: 'AI Commissioner full league run',
    who: 'commissioner',
    where: 'AI Commissioner panel',
  },
  {
    code: 'world_cup_ai_edge_report',
    label: 'World Cup daily edge report',
    who: 'anyone',
    where: 'World Cup Daily Edge Report card',
  },
  {
    code: 'world_cup_ai_matchup_analysis',
    label: 'World Cup matchup analysis',
    who: 'anyone',
    where: 'World Cup bracket entry',
  },
  {
    code: 'world_cup_ai_bracket_explanation',
    label: 'World Cup bracket explanation',
    who: 'anyone',
    where: 'World Cup bracket entry',
  },
  {
    code: 'world_cup_ai_commissioner_report',
    label: 'World Cup pool manager report',
    who: 'pool_manager',
    where: 'World Cup pool manager tools',
  },
]

const BY_CODE = new Map(TOKEN_PURCHASABLE_RULES.map((r) => [r.code, r]))

export function getTokenPurchasableRule(code: string | null | undefined): TokenPurchasableRule | null {
  return code ? (BY_CODE.get(code) ?? null) : null
}

export function isTokenPurchasableRule(code: string | null | undefined): boolean {
  return getTokenPurchasableRule(code) !== null
}
