/**
 * Per-roster (league + manager) preference for whether AF Pro may persist AI-adjusted
 * draft queue order. Stored on `Roster.settings` JSON (`aiManageDraftQueueEnabled`).
 */

import type { QueueEntry } from '@/lib/live-draft-engine/types'

export const AI_MANAGE_DRAFT_QUEUE_SETTING_KEY = 'aiManageDraftQueueEnabled' as const

export function getAiManageDraftQueueEnabled(settings: unknown): boolean {
  if (!settings || typeof settings !== 'object') return false
  const s = settings as Record<string, unknown>
  return s[AI_MANAGE_DRAFT_QUEUE_SETTING_KEY] === true
}

/** Merge AF Pro queue preference into existing roster settings without dropping other keys. */
export function mergeAiManageDraftQueuePreference(
  settings: unknown,
  enabled: boolean
): Record<string, unknown> {
  const base = (settings && typeof settings === 'object' ? settings : {}) as Record<string, unknown>
  return { ...base, [AI_MANAGE_DRAFT_QUEUE_SETTING_KEY]: enabled }
}

/** Manual queue saves should drop AI-run metadata so the client queue reflects user edits. */
export function stripAiQueueMetadata(entries: QueueEntry[]): QueueEntry[] {
  return entries.map(({ isAiAdjusted: _a, aiOriginalRank: _r, aiReason: _x, ...rest }) => rest)
}
