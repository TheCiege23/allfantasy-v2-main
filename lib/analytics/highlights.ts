import { z } from 'zod'

export const HIGHLIGHTS_PREFIX = 'engagement.highlights.'
export const HIGHLIGHTS = {
  VIEW: HIGHLIGHTS_PREFIX + 'surface_view',
  LOAD: HIGHLIGHTS_PREFIX + 'load_requested',
  READY: HIGHLIGHTS_PREFIX + 'embed_ready',
  ERROR: HIGHLIGHTS_PREFIX + 'embed_error',
  SOURCE: HIGHLIGHTS_PREFIX + 'source_open',
} as const
export const HIGHLIGHT_SURFACES = ['player_card', 'my_team', 'league_spotlight'] as const
export type HighlightSurface = typeof HIGHLIGHT_SURFACES[number]
export type HighlightAction = 'load_requested' | 'embed_ready' | 'embed_error' | 'source_open'
export type HighlightOutcome = { status: 'clips' | 'empty' | 'unavailable' | 'error'; clipCount: number }
const base = z.object({ surface: z.enum(HIGHLIGHT_SURFACES), viewId: z.string().uuid() })
const view = base.extend({
  status: z.enum(['clips', 'empty', 'unavailable', 'error']),
  clipCount: z.number().int().min(0).max(12),
  visibility: z.enum(['header', 'interaction']),
}).strict().refine(m => m.status === 'clips' ? m.clipCount > 0 : m.clipCount === 0)
const action = base.extend({ kind: z.enum(['play', 'interview', 'commentary']) }).strict()

/** Exact first-party vocabulary; never accept captions, roster IDs or arbitrary metadata. */
export function parseHighlightMeta(event: string, meta: unknown): Record<string, unknown> | null {
  if (!Object.values(HIGHLIGHTS).some(name => name === event)) return null
  const result = (event === HIGHLIGHTS.VIEW ? view : action).safeParse(meta)
  return result.success ? result.data : null
}
