export type DraftPlanningPreference = { version: 1; order: string[]; spread: 'adp' | 'tight' | 'broad' }
export function draftPlanningPreference(raw: unknown): DraftPlanningPreference | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const value = raw as Record<string, unknown>
  if (!Array.isArray(value.order) || value.order.length > 3000 || !['adp', 'tight', 'broad'].includes(String(value.spread))) return null
  if (!value.order.every(k => typeof k === 'string' && k.length > 0 && k.length <= 128 && k.startsWith('id:'))) return null
  return { version: 1, order: [...new Set(value.order as string[])], spread: value.spread as DraftPlanningPreference['spread'] }
}
