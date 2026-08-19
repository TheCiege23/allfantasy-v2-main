/**
 * DraftWarRoomUIResolver — war room panel visibility and links for draft room.
 * Integrates with legacy draft-war-room API and af-legacy tab.
 */

/** URL to open Legacy Draft War Room (mock draft tab). */
export const DRAFT_WAR_ROOM_LEGACY_URL = '/af-legacy?tab=mock-draft'

/** URL to open league draft tab (app) with war room panel. */
export function getLeagueDraftTabUrl(leagueId: string): string {
  return `/league/${encodeURIComponent(leagueId)}?tab=Draft`
}

/**
 * Whether to show the war room panel (e.g. when league has draft config and user is in draft).
 */
export function shouldShowWarRoomPanel(
  hasDraftConfig: boolean,
  isDraftStarted?: boolean
): boolean {
  return hasDraftConfig
}

/**
 * Label for "Open War Room" depending on context (mock draft vs league draft).
 */
export function getWarRoomPanelTitle(context: 'mock_draft' | 'league_draft'): string {
  return context === 'mock_draft' ? 'AF Legacy Draft' : 'AF Legacy Draft (League)'
}

export function getWarRoomPanelDescription(context: 'mock_draft' | 'league_draft'): string {
  return context === 'mock_draft'
    ? 'Open advanced draft planning with queue strategy and live board context.'
    : 'Open AF Legacy planning tools for deeper draft decision support.'
}
