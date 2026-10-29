/**
 * Client side of the lineup warning (lib/waiver-wire/lineup-fill-warning.ts): the add/drop and claim
 * routes answer `LINEUP_WARNING` once for a drop that leaves a starting slot unfillable, the screen
 * asks the manager, and a "go ahead" re-sends the same request with `confirmLineupWarning: true`.
 * Client-safe: no server imports.
 */
export const LINEUP_WARNING_RESPONSE_CODE = 'LINEUP_WARNING'

export function isLineupWarningResponse(json: unknown): json is { code: 'LINEUP_WARNING'; warning?: { unfilledSlots?: unknown } } {
  return Boolean(json && typeof json === 'object' && (json as { code?: unknown }).code === LINEUP_WARNING_RESPONSE_CODE)
}

/** Slot tokens as a manager reads them (`FLX` is the FLEX slot, `SF` superflex). */
export function lineupWarningSlotNames(json: unknown): string {
  const raw = isLineupWarningResponse(json) && Array.isArray(json.warning?.unfilledSlots) ? json.warning!.unfilledSlots : []
  const label = (s: string) => (s === 'FLX' ? 'FLEX' : s === 'SF' ? 'SUPERFLEX' : s)
  return [...new Set((raw as unknown[]).map((s) => label(String(s))).filter(Boolean))].join(', ')
}

/**
 * Asks the manager to confirm. `t` is the screen's interpolating translator (key `waiverFa.lineupWarning`);
 * `ask` is `window.confirm` unless a test passes another. False when there is no window.
 */
export function confirmLineupWarning(
  json: unknown,
  t: (key: string, vars: Record<string, string>) => string,
  ask: ((message: string) => boolean) | null = typeof window !== 'undefined' ? (m) => window.confirm(m) : null,
): boolean {
  if (!ask) return false
  return ask(t('waiverFa.lineupWarning', { slots: lineupWarningSlotNames(json) }))
}
