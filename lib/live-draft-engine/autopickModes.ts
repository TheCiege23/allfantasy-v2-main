/**
 * A manager's personal auto-pick modes (LiveDraftAutopickPreference.mode).
 *
 * `standard`: queue, then the league's fallback. `ai_queue` (AF Pro): Chimmy's queue.
 * `draft_as_me` (AF Pro): queue, then the pick this manager would make, from how they have drafted
 * before (lib/draft-room/draftAsMe.ts).
 */
export type AutopickMode = 'standard' | 'ai_queue' | 'draft_as_me'
export const AUTOPICK_MODES: readonly AutopickMode[] = ['standard', 'ai_queue', 'draft_as_me']
export const PRO_AUTOPICK_MODES: ReadonlySet<AutopickMode> = new Set(['ai_queue', 'draft_as_me'])
