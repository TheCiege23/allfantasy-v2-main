/**
 * D.5-proper — feature flag + dev-mode toggle for AllFantasy AI ADP.
 *
 * When `NEXT_PUBLIC_USE_ALLFANTASY_ADP === 'true'`, the draft room reads AI ADP
 * from `AllFantasyAdpSnapshot` via `/api/leagues/[id]/ai-adp?source=allfantasy`.
 * The legacy `lookupAiAdpMatch` client-side overlay is bypassed so the resolver
 * value is the single source of truth for the AI ADP column.
 *
 * `?adpMode=test` (URL) or `NEXT_PUBLIC_ALLFANTASY_ADP_DRAFT_MODE=test` (env)
 * override the production default (`real`) — used to surface seeded harness
 * data in a dev draft room without polluting production.
 *
 * Pure module — no React, no DOM access at import time. The runtime helpers
 * accept an optional `URLSearchParams` so callers control where the URL comes
 * from (server-side prerender doesn't have window.location).
 */

type AllFantasyAdpDraftMode = 'real' | 'mock' | 'test'

const ALLFANTASY_ADP_FLAG_ENV = 'NEXT_PUBLIC_USE_ALLFANTASY_ADP'
const ALLFANTASY_ADP_DRAFT_MODE_ENV = 'NEXT_PUBLIC_ALLFANTASY_ADP_DRAFT_MODE'
const ALLFANTASY_ADP_URL_PARAM = 'adpMode'

/**
 * Returns true when the AllFantasy AI ADP feature flag is on. Reads
 * `process.env.NEXT_PUBLIC_USE_ALLFANTASY_ADP` (string `'true'` ⇒ enabled).
 * Default OFF — production keeps the legacy AI ADP path until ops flips it on.
 */
export function isAllFantasyAdpEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  const v = (env[ALLFANTASY_ADP_FLAG_ENV] ?? '').toString().trim().toLowerCase()
  return v === 'true' || v === '1' || v === 'yes'
}

/**
 * Resolve the requested draft mode. Precedence:
 *   1. URL `?adpMode=test|mock|real` (callers pass `URLSearchParams`)
 *   2. env `NEXT_PUBLIC_ALLFANTASY_ADP_DRAFT_MODE=test|mock|real`
 *   3. default `'real'`
 *
 * Unknown values fall through to default.
 */
export function resolveAllFantasyAdpDraftMode(
  options: { searchParams?: URLSearchParams | null; env?: NodeJS.ProcessEnv } = {},
): AllFantasyAdpDraftMode {
  const fromUrl = options.searchParams?.get(ALLFANTASY_ADP_URL_PARAM)?.toLowerCase()
  if (fromUrl === 'test' || fromUrl === 'mock' || fromUrl === 'real') return fromUrl
  const env = options.env ?? process.env
  const fromEnv = (env[ALLFANTASY_ADP_DRAFT_MODE_ENV] ?? '').toString().toLowerCase()
  if (fromEnv === 'test' || fromEnv === 'mock' || fromEnv === 'real') return fromEnv
  return 'real'
}

/**
 * Build the URL the draft room hits when the flag is enabled.
 *
 *   /api/leagues/<leagueId>/ai-adp?source=allfantasy&draftMode=<mode>
 *
 * When the flag is disabled, callers should fall back to the legacy URL
 * (`/api/leagues/<leagueId>/ai-adp` with no source parameter).
 */
export function buildAllFantasyAdpUrl(
  leagueId: string,
  options: { draftMode?: AllFantasyAdpDraftMode; searchParams?: URLSearchParams | null; env?: NodeJS.ProcessEnv } = {},
): string {
  const mode = options.draftMode ?? resolveAllFantasyAdpDraftMode(options)
  const params = new URLSearchParams({ source: 'allfantasy', draftMode: mode })
  return `/api/leagues/${encodeURIComponent(leagueId)}/ai-adp?${params.toString()}`
}
