/**
 * The "hold flagged trades" setting (lib/integrity/holdFlaggedTrades.ts), with the words each choice
 * shows. No imports, so the settings screens and the server read one definition.
 */
export const HOLD_FLAGGED_TRADES_KEY = 'integrity_hold_flagged_trades'

export type HoldFlaggedTradesMode = 'off' | 'severe' | 'all'
export const HOLD_FLAGGED_TRADES_MODES: readonly HoldFlaggedTradesMode[] = ['off', 'severe', 'all']

/** The trade review's checks (lib/decision-os/trade/tradeReview.ts) that hold a trade in `severe` mode. */
export const SEVERE_HOLD_CODES: ReadonlySet<string> = new Set(['heavily_lopsided', 'eliminated_team_dumping'])

export const HOLD_FLAGGED_TRADES_LABELS: Record<HoldFlaggedTradesMode, { label: string; detail: string }> = {
  off: { label: 'Off', detail: 'Flagged trades go through. You still get an alert.' },
  severe: {
    label: 'Serious flags',
    detail:
      'A very lopsided trade, or a team out of the race sending starters to a contender, waits for you to approve or veto it. Other flags only alert you.',
  },
  all: { label: 'Every flag', detail: 'Every flagged trade waits for you to approve or veto it.' },
}

/** Absent means the default, `severe`. `true` / `false` are the older on/off switch. */
export function readHoldFlaggedTradesMode(settings: unknown): HoldFlaggedTradesMode {
  const v = settings && typeof settings === 'object' ? (settings as Record<string, unknown>)[HOLD_FLAGGED_TRADES_KEY] : undefined
  if (v === true || v === 'all') return 'all'
  if (v === false || v === 'off') return 'off'
  return 'severe'
}

/** A choice sent by a commissioner: a mode, or the older on/off switch (`true` = every flag). */
export function parseHoldFlaggedTradesMode(value: unknown): HoldFlaggedTradesMode | null {
  if (value === true) return 'all'
  if (value === false) return 'off'
  return typeof value === 'string' && (HOLD_FLAGGED_TRADES_MODES as readonly string[]).includes(value) ? (value as HoldFlaggedTradesMode) : null
}

/** The mode a settings response carries, from either field. */
export function holdModeFromResponse(settings: { holdFlaggedTradesMode?: unknown; holdFlaggedTrades?: unknown } | null | undefined): HoldFlaggedTradesMode {
  return parseHoldFlaggedTradesMode(settings?.holdFlaggedTradesMode) ?? (settings?.holdFlaggedTrades === false ? 'off' : 'severe')
}

/** True when a flag raising these review checks is held in this mode. */
export function flagIsHeld(mode: HoldFlaggedTradesMode, codes: readonly string[]): boolean {
  if (mode === 'off') return false
  if (mode === 'all') return true
  return codes.some((c) => SEVERE_HOLD_CODES.has(c))
}
