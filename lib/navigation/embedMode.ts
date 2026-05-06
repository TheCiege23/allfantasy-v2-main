/**
 * Query-param helpers for embedded league hub (`/league/[id]?embed=1`) and
 * optional draft fullscreen flags used by dashboard overlays / iframes.
 */

export type EmbedSearchParamsInput =
  | URLSearchParams
  | Record<string, string | string[] | undefined>
  | null
  | undefined

function first(raw: string | string[] | undefined): string | undefined {
  if (raw === undefined) return undefined
  return Array.isArray(raw) ? raw[0] : raw
}

/** True when `embed` is standardized `1` or `true`. */
export function isEmbedModeFromSearchParams(searchParams: EmbedSearchParamsInput): boolean {
  if (!searchParams) return false
  const v =
    searchParams instanceof URLSearchParams
      ? searchParams.get('embed') ?? undefined
      : first(searchParams.embed as string | string[] | undefined)
  return v === '1' || v === 'true'
}

/** When true, strip global ProductShell / ResponsiveNav chrome for league routes. */
export function shouldHideGlobalChromeInEmbedMode(searchParams: EmbedSearchParamsInput): boolean {
  return isEmbedModeFromSearchParams(searchParams)
}

export function isDraftFullscreenFromSearchParams(searchParams: EmbedSearchParamsInput): boolean {
  if (!searchParams) return false
  const v =
    searchParams instanceof URLSearchParams
      ? searchParams.get('draftFullscreen') ?? undefined
      : first(searchParams.draftFullscreen as string | string[] | undefined)
  return v === '1' || v === 'true'
}
