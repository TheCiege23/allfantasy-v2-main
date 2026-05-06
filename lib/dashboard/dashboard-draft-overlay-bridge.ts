/**
 * iframe (embedded league hub) ↔ dashboard parent bridge for full-screen draft/dispersal overlays.
 */

export const DASHBOARD_OPEN_DRAFT_MESSAGE_TYPE = 'af-dashboard-open-draft' as const

/** @deprecated Use DASHBOARD_OPEN_DRAFT_MESSAGE_TYPE */
export const DASHBOARD_DRAFT_OVERLAY_MESSAGE = DASHBOARD_OPEN_DRAFT_MESSAGE_TYPE

export type DashboardDraftOverlayBridgePayload = {
  type: typeof DASHBOARD_OPEN_DRAFT_MESSAGE_TYPE
  leagueId: string
  /** Live draft session id — omit to let parent resolve via GET /api/leagues/.../draft/session */
  draftId?: string
  /** Dispersal draft id — loads `/league/.../dispersal-draft/...` in overlay iframe */
  dispersalDraftId?: string
  source?: string
}

export function isDashboardDraftOverlayMessage(data: unknown): data is DashboardDraftOverlayBridgePayload {
  return isOpenDraftOverlayMessage(data)
}

export function isOpenDraftOverlayMessage(data: unknown): data is DashboardDraftOverlayBridgePayload {
  if (!data || typeof data !== 'object') return false
  const o = data as Record<string, unknown>
  if (o.type !== DASHBOARD_OPEN_DRAFT_MESSAGE_TYPE) return false
  if (typeof o.leagueId !== 'string' || !o.leagueId.trim()) return false
  if (o.draftId !== undefined && typeof o.draftId !== 'string') return false
  if (o.dispersalDraftId !== undefined && typeof o.dispersalDraftId !== 'string') return false
  if (o.source !== undefined && typeof o.source !== 'string') return false
  return true
}

export type BuildDashboardDraftOverlayUrlInput = {
  leagueId: string
  draftId?: string
  dispersalDraftId?: string
}

export function buildDashboardDraftOverlayUrl(input: BuildDashboardDraftOverlayUrlInput): string {
  const q = new URLSearchParams()
  q.set('leagueId', input.leagueId)
  q.set('draftOverlay', '1')
  if (input.dispersalDraftId) {
    q.set('dispersalDraftId', input.dispersalDraftId)
  } else if (input.draftId) {
    q.set('draftId', input.draftId)
  }
  return `/dashboard?${q.toString()}`
}

export type PostOpenDraftOverlayMessageInput = {
  leagueId: string
  draftId?: string
  dispersalDraftId?: string
  source?: string
}

export function postOpenDraftOverlayMessage(input: PostOpenDraftOverlayMessageInput): void {
  if (typeof window === 'undefined') return
  const payload: DashboardDraftOverlayBridgePayload = {
    type: DASHBOARD_OPEN_DRAFT_MESSAGE_TYPE,
    leagueId: input.leagueId,
    ...(input.draftId ? { draftId: input.draftId } : {}),
    ...(input.dispersalDraftId ? { dispersalDraftId: input.dispersalDraftId } : {}),
    ...(input.source ? { source: input.source } : {}),
  }
  window.parent?.postMessage(payload, window.location.origin)
}

export async function fetchLiveDraftSessionIdForLeague(leagueId: string): Promise<string | null> {
  try {
    const res = await fetch(`/api/leagues/${encodeURIComponent(leagueId)}/draft/session`, {
      credentials: 'include',
    })
    const json = (await res.json().catch(() => null)) as { session?: { id?: string } | null } | null
    const id = json?.session && typeof json.session.id === 'string' ? json.session.id : null
    return id
  } catch {
    return null
  }
}

export type ParsedLeagueDraftNavIntent =
  | { kind: 'live'; leagueId: string }
  | { kind: 'dispersal'; leagueId: string; dispersalDraftId: string }

/** Parses `/league/[id]/draft` or `/league/[id]/dispersal-draft/[draftId]` paths (pathname only). */
export function parseLeagueDraftNavigationIntent(href: string): ParsedLeagueDraftNavIntent | null {
  try {
    const path = href.startsWith('http') ? new URL(href).pathname : href.split('?')[0] ?? ''
    const live = path.match(/^\/league\/([^/]+)\/draft\/?$/)
    if (live?.[1]) return { kind: 'live', leagueId: live[1] }
    const disp = path.match(/^\/league\/([^/]+)\/dispersal-draft\/([^/]+)\/?$/)
    if (disp?.[1] && disp?.[2]) return { kind: 'dispersal', leagueId: disp[1], dispersalDraftId: disp[2] }
    return null
  } catch {
    return null
  }
}

export type OpenDraftFromEmbeddedLeagueInput = PostOpenDraftOverlayMessageInput & {
  /** When false, caller should use normal router navigation */
  dashboardEmbed: boolean
}

/**
 * From embedded league UI: resolve live draft id when missing, then postMessage parent.
 * Full-page league hub should pass dashboardEmbed: false and use router instead (caller responsibility).
 */
export async function openDraftFromEmbeddedLeague(input: OpenDraftFromEmbeddedLeagueInput): Promise<void> {
  if (!input.dashboardEmbed || typeof window === 'undefined' || !window.parent || window.parent === window) {
    return
  }
  let draftId = input.draftId
  let dispersalDraftId = input.dispersalDraftId
  if (!dispersalDraftId && !draftId) {
    draftId = (await fetchLiveDraftSessionIdForLeague(input.leagueId)) ?? undefined
  }
  postOpenDraftOverlayMessage({
    leagueId: input.leagueId,
    draftId,
    dispersalDraftId,
    source: input.source,
  })
}

type RouterLike = { replace: (href: string, opts?: { scroll?: boolean }) => void }

export type OpenDraftOverlayInParentInput = BuildDashboardDraftOverlayUrlInput & {
  router: RouterLike
}

/** When already on dashboard parent (not iframe), set overlay query params. */
export function openDraftOverlayInParent(input: OpenDraftOverlayInParentInput): void {
  input.router.replace(buildDashboardDraftOverlayUrl(input), { scroll: false })
}
