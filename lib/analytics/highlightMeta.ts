import { z } from 'zod'
import { HIGHLIGHTS, HIGHLIGHT_SURFACES } from './highlights'

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
