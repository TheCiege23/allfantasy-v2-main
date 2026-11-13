/**
 * Shared helpers for concept handlers — reads `conceptRules.extensions` and builds safe defaults.
 */
import type { HandlerContext, HandlerResult } from '@/lib/specialty-automation/types'

export function getConceptExtensions(ctx: HandlerContext): Record<string, unknown> {
  const ext = ctx.conceptRules?.extensions
  if (ext && typeof ext === 'object' && !Array.isArray(ext)) return ext as Record<string, unknown>
  return {}
}

export function notApplicableTrigger(ctx: HandlerContext, label: string): HandlerResult {
  return {
    summary: `${label}: skipped for trigger ${ctx.trigger}.`,
    actions: [],
    events: [],
    skipped: true,
    skipReason: 'trigger_not_applicable',
  }
}
