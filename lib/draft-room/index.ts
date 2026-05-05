/**
 * Draft Room UX — view service, board renderer, queue controller, search resolver,
 * war room resolver, AI bridge, sport draft UI.
 */

/** No deps — listed first so barrel consumers don’t hit heavier modules before this resolves. */
export { MOCK_DRAFT_ROSTER_HINT_DELAY_MS } from './mock-draft-ui-constants'

export {
  getDraftViewState,
  getCurrentPickDisplay,
  getTimerDisplay,
  getPickConfirmationLabel,
  DRAFT_ROOM_MESSAGES,
  DRAFT_ROOM_I18N_KEYS,
  type DraftViewState,
  type CurrentPickDisplay,
  type TimerDisplay,
} from './DraftRoomViewService'

export {
  getSlotInRound,
  formatPickLabel,
  getCellKey,
  type PickCell,
} from './DraftBoardRenderer'

export {
  canAddToQueue,
  addToQueue,
  removeFromQueue,
  removeFromQueueByPlayerName,
  reorderQueue,
  getNextQueuedAvailable,
  type QueuePlayer,
} from './DraftQueueController'

export {
  filterBySearch,
  filterByPosition,
  excludeDrafted,
  applyDraftFilters,
  type DraftPlayer,
} from './DraftPlayerSearchResolver'

export {
  getDraftStatColumnsForSport,
  getStatValueForDraftPlayer,
  flattenDraftPlayerStatBag,
  formatDraftStatDisplay,
  filterDraftPlayersByStat,
  sportUsesColumnKeys,
  isLikelyIdpFootballPosition,
  isLikelyPitcherPosition,
  isLikelyGoaliePosition,
  type DraftStatColumnDef,
  type DraftStatPlayerSource,
  type DraftStatColumnOptions,
  type StatColumnFilter,
} from './draftSportStatColumns'

export {
  DRAFT_WAR_ROOM_LEGACY_URL,
  getLeagueDraftTabUrl,
  shouldShowWarRoomPanel,
  getWarRoomPanelTitle,
  getWarRoomPanelDescription,
} from './DraftWarRoomUIResolver'

export {
  getDraftAIChatUrl,
  buildDraftSummaryForAI,
  type DraftContextForAI,
} from './DraftToAIContextBridge'

export {
  getPositionFilterOptionsForSport,
  getDefaultRosterSlotsForSport,
  getSupportedDraftSports,
  getDraftSportOptions,
  type PositionFilterOption,
  type DraftSportOption,
} from './SportDraftUIResolver'

export { getRosterSlotLabelsForLeagueDraft } from './getRosterSlotLabelsForLeagueDraft'

export {
  getManagerColorByIndex,
  getManagerColorBySeed,
  getManagerColorBySlot,
  withAlpha,
  type ManagerColorDescriptor,
} from './ManagerColorResolver'

export { buildLiveDraftBrainPayload } from './buildLiveDraftBrainPayload'
