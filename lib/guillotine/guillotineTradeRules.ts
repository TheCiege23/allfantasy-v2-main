/**
 * The pure half of ./guillotineTrades.ts (read by the rules page in the browser, so no database here).
 */

export const GUILLOTINE_SETTINGS_KEY = 'guillotineSettings'
export const MAX_TRADES_CLOSE_AT = 32

export type GuillotineTradeRules = { tradesAllowed: boolean; tradesCloseAtTeamsLeft: number | null; tradesClosed: boolean }

export const CHOPPED_TEAM_TRADE_MESSAGE = 'A chopped team can’t trade.'
export function tradesClosedMessage(teamsLeft: number | null): string {
  return teamsLeft != null ? `Trades closed once ${teamsLeft} teams were left.` : 'Trades are closed in this league.'
}

export function guillotineSettingsBag(settings: unknown): Record<string, unknown> {
  const s = settings && typeof settings === 'object' && !Array.isArray(settings) ? (settings as Record<string, unknown>) : {}
  const g = s[GUILLOTINE_SETTINGS_KEY]
  return g && typeof g === 'object' && !Array.isArray(g) ? (g as Record<string, unknown>) : {}
}

export function isTradesCloseAt(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 2 && value <= MAX_TRADES_CLOSE_AT
}

export function readGuillotineTrades(settings: unknown): GuillotineTradeRules {
  const g = guillotineSettingsBag(settings)
  return {
    tradesAllowed: g.tradesAllowed === true,
    tradesCloseAtTeamsLeft: isTradesCloseAt(g.tradesCloseAtTeamsLeft) ? g.tradesCloseAtTeamsLeft : null,
    tradesClosed: g.tradesClosed === true,
  }
}

/** Pure: should trades be closed with `alive` teams left. Only when trades are on and the rule is set. */
export function tradesShouldBeClosed(rules: Pick<GuillotineTradeRules, 'tradesAllowed' | 'tradesCloseAtTeamsLeft'>, alive: number): boolean {
  return rules.tradesAllowed && rules.tradesCloseAtTeamsLeft != null && alive <= rules.tradesCloseAtTeamsLeft
}

/** `settings` with the commissioner's two choices written in (and the closed mark left to the sync). */
export function writeGuillotineTradeRules(
  settings: Record<string, unknown>,
  next: { tradesAllowed?: boolean; tradesCloseAtTeamsLeft?: number | null },
): Record<string, unknown> {
  const g = { ...guillotineSettingsBag(settings) }
  if (next.tradesAllowed !== undefined) g.tradesAllowed = next.tradesAllowed
  if (next.tradesCloseAtTeamsLeft !== undefined) {
    if (next.tradesCloseAtTeamsLeft == null) delete g.tradesCloseAtTeamsLeft
    else g.tradesCloseAtTeamsLeft = next.tradesCloseAtTeamsLeft
  }
  return { ...settings, [GUILLOTINE_SETTINGS_KEY]: g }
}
