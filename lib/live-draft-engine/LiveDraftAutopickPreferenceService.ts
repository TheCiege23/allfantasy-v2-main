import { prisma } from '@/lib/prisma'
import { EntitlementResolver } from '@/lib/subscription/EntitlementResolver'

export type ViewerAutopickPreference = {
  enabled: boolean
  mode: 'standard' | 'ai_queue'
  isProEligible: boolean
  updatedAt: string | null
}

type AutopickRow = {
  enabled: boolean
  mode: string
  updatedAt: Date
}

function defaults(isProEligible: boolean): ViewerAutopickPreference {
  return { enabled: false, mode: 'standard', isProEligible, updatedAt: null }
}

async function resolveProEligibility(viewerUserId: string): Promise<boolean> {
  try {
    const result = await new EntitlementResolver().resolveForUser(viewerUserId, 'pro_draft_ai')
    return result.hasAccess === true
  } catch (e) {
    console.warn('[LiveDraftAutopickPreference] entitlement resolve failed', {
      viewerUserId,
      error: (e as Error)?.message ?? 'unknown error',
    })
    return false
  }
}

async function loadRow(draftSessionId: string, viewerUserId: string): Promise<AutopickRow | null> {
  try {
    const row = await prisma.liveDraftAutopickPreference.findUnique({
      where: { draft_session_user_unique: { draftSessionId, userId: viewerUserId } },
      select: { enabled: true, mode: true, updatedAt: true },
    })
    return row
  } catch (e) {
    console.warn('[LiveDraftAutopickPreference] row load failed', {
      draftSessionId,
      viewerUserId,
      error: (e as Error)?.message ?? 'unknown error',
    })
    return null
  }
}

export async function getViewerAutopickPreference(
  draftSessionId: string,
  viewerUserId: string,
): Promise<ViewerAutopickPreference> {
  const [row, isProEligible] = await Promise.all([
    loadRow(draftSessionId, viewerUserId),
    resolveProEligibility(viewerUserId),
  ])

  if (!row) return defaults(isProEligible)

  // Defensive downgrade: a stale ai_queue row from an expired Pro user falls back to standard at read time.
  // The DB row is left untouched — re-upgrade is automatic if entitlement returns.
  const mode: 'standard' | 'ai_queue' =
    row.mode === 'ai_queue' && isProEligible ? 'ai_queue' : 'standard'

  return {
    enabled: row.enabled,
    mode,
    isProEligible,
    updatedAt: row.updatedAt instanceof Date ? row.updatedAt.toISOString() : null,
  }
}

export async function setViewerAutopickPreference({
  draftSessionId,
  viewerUserId,
  enabled,
  mode,
}: {
  draftSessionId: string
  viewerUserId: string
  enabled: boolean
  mode?: 'standard' | 'ai_queue'
}): Promise<ViewerAutopickPreference> {
  // When disabled, always coerce to standard so no stale ai_queue row survives a disable.
  const persistMode: string = enabled ? (mode ?? 'standard') : 'standard'

  await prisma.liveDraftAutopickPreference.upsert({
    where: { draft_session_user_unique: { draftSessionId, userId: viewerUserId } },
    create: { draftSessionId, userId: viewerUserId, enabled, mode: persistMode },
    update: { enabled, mode: persistMode },
  })

  return getViewerAutopickPreference(draftSessionId, viewerUserId)
}

export async function getViewerAutopickPreferenceForLeague(
  leagueId: string,
  viewerUserId: string,
): Promise<ViewerAutopickPreference> {
  const session = await prisma.draftSession.findUnique({
    where: { leagueId },
    select: { id: true },
  })
  if (!session) return defaults(await resolveProEligibility(viewerUserId))
  return getViewerAutopickPreference(session.id, viewerUserId)
}
