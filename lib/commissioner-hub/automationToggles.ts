/**
 * The free automations a commissioner can switch straight from the "What runs itself" card (phase 11,
 * 2026-10-29). Each is the request that automation's own card or settings page already sends, so the
 * same permission checks, validation and audit apply; nothing here writes settings itself. Paid
 * automations keep their link: their switches carry plan checks and choices of their own.
 */
export const TOGGLEABLE_AUTOMATIONS = ['fill_empty_starters', 'auto_handover', 'rookie_draft_opens', 'rookie_draft_starts', 'trade_review_auto_approve'] as const
export type ToggleableAutomation = (typeof TOGGLEABLE_AUTOMATIONS)[number]

export function isToggleableAutomation(key: string): key is ToggleableAutomation {
  return (TOGGLEABLE_AUTOMATIONS as readonly string[]).includes(key)
}

export function automationToggleRequest(leagueId: string, key: ToggleableAutomation, on: boolean): { url: string; method: 'POST' | 'PUT'; body: Record<string, unknown> } {
  const base = `/api/leagues/${encodeURIComponent(leagueId)}`
  switch (key) {
    case 'fill_empty_starters':
      return { url: `${base}/fill-empty-starters`, method: 'POST', body: { on } }
    case 'auto_handover':
      // Switched on from the card it takes the middle setting; the inactive-managers card offers the rest.
      return { url: `${base}/inactive-managers`, method: 'POST', body: { autoHandover: on ? { days: 14, to: 'lineups' } : null } }
    case 'rookie_draft_opens':
      return { url: `${base}/dynasty-settings`, method: 'PUT', body: { rookieDraftAutoOpen: on } }
    case 'rookie_draft_starts':
      return { url: `${base}/dynasty-settings`, method: 'PUT', body: { rookieDraftAutoStartDays: on ? 7 : null } }
    case 'trade_review_auto_approve':
      return { url: `${base}/trade-review-auto-approve`, method: 'POST', body: { on } }
  }
}
