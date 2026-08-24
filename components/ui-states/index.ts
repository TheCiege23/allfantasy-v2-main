/**
 * Handoff 16c — the shared empty / loading / error state vocabulary.
 *
 * These are shared primitives, not one-off screens: every list and panel in the
 * product should reach for one of these rather than hand-rolling a spinner or a
 * "no data" line, so the copy contract (what happened · is my data safe · what do
 * I press) holds everywhere without being re-argued per surface.
 */
export { default as EmptyStateRenderer, EmptyStateGrid } from "./EmptyStateRenderer"
export { default as LoadingStateRenderer, SkeletonRowsRenderer } from "./LoadingStateRenderer"
export { default as ErrorStateRenderer, StaleDataNotice } from "./ErrorStateRenderer"

export type { EmptyStateAction, EmptyStateRendererProps } from "./EmptyStateRenderer"
export type { LoadingStateRendererProps } from "./LoadingStateRenderer"
export type { ErrorStateAction, ErrorStateRendererProps } from "./ErrorStateRenderer"
