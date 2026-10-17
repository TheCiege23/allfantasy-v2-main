/**
 * How a draft surface words AllFantasy's own projection for one pick.
 *
 * Client-safe on purpose (types only, no `server-only` import): the draft screens are client
 * components and `draftAfProjections.ts` is a server module. See that file for what the numbers are.
 */

import type { DraftAfProjection } from './draftAfProjections'

/** The short cell text — "AF 21.1" — or null when there is no weekly AF number to show. */
export function draftAfText(af: DraftAfProjection | undefined): string | null {
  return af?.af != null ? `AF ${af.af.toFixed(1)}` : null
}

/**
 * The hover text: which week the AF number is for, and the rest-of-season total with the games it
 * covers — labelled PPR, because the engine's season total is not re-scored per league.
 */
export function draftAfTitle(af: DraftAfProjection | undefined): string | undefined {
  if (!af) return undefined
  const parts: string[] = []
  if (af.af != null) {
    parts.push(`AllFantasy projection, week ${af.week}: ${af.af.toFixed(1)} under this league's scoring`)
  }
  if (af.ros != null) {
    parts.push(`rest of season ${af.ros.toFixed(1)} PPR${af.rosWeeks != null ? ` over ${af.rosWeeks} games` : ''}`)
  }
  return parts.length > 0 ? parts.join(' · ') : undefined
}
