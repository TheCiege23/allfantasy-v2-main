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
