/**
 * Maps Survivor audit events to optional clip assets for league SSE / overlays.
 * Expand as more assets land under `public/survivor/`.
 */

import { SURVIVOR_LEAGUE_INTRO_VIDEO } from '@/lib/survivor/constants'

export type SurvivorClipKind = 'video' | 'image'

export type SurvivorClip = { url: string; type: SurvivorClipKind; label?: string }

/** New universal audit rows (`SurvivorAuditEntry`). */
export function survivorClipFromAuditEntry(row: { category: string; action: string }): SurvivorClip | null {
  const cat = row.category.toLowerCase()
  const act = row.action.toUpperCase()
  if (cat === 'tribal' && act === 'TRIBAL_OPENED') {
    return { url: SURVIVOR_LEAGUE_INTRO_VIDEO, type: 'video', label: 'Elimination Council' }
  }
  return null
}

/** Legacy append-only log (`SurvivorAuditLog` / `appendSurvivorAudit`). */
export function survivorClipFromAuditLog(row: { eventType: string }): SurvivorClip | null {
  const t = row.eventType.toLowerCase()
  if (t === 'merge') return { url: SURVIVOR_LEAGUE_INTRO_VIDEO, type: 'video', label: 'The merge' }
  if (t === 'tribe_shuffle') return { url: SURVIVOR_LEAGUE_INTRO_VIDEO, type: 'video', label: 'Tribe shuffle' }
  return null
}
