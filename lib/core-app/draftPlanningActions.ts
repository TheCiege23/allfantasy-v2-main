'use server'
import { requireAuth } from '@/lib/auth-guard'
import { prisma } from '@/lib/prisma'
import { canViewLeague } from '@/server/services/permissionService'
import { consumeRateLimit } from '@/lib/rate-limit'
import { draftPlanningPreference } from './draftPlanningPreferenceModel'
import { storeDraftPlanningPreference } from './draftPlanningPreferenceStore'
export async function saveDraftPlanningPreference(leagueId: string, sessionId: string, raw: unknown) {
  const auth = await requireAuth()
  if (!auth.ok) return { ok: false as const }
  const value = draftPlanningPreference(raw)
  if (!value || typeof leagueId !== 'string' || typeof sessionId !== 'string' || !leagueId.length || !sessionId.length || leagueId.length > 64 || sessionId.length > 64) return { ok: false as const }
  const limit = consumeRateLimit({ scope: 'core', action: 'draft_planning_preferences', sleeperUsername: auth.userId, maxRequests: 60, windowMs: 60000 })
  if (!limit.success || !await canViewLeague(leagueId, auth.userId)) return { ok: false as const }
  const session = await prisma.draftSession.findFirst({ where: { id: sessionId, leagueId, sessionKind: 'live', sleeperDraftId: null }, select: { customRankingsEnabled: true } })
  if (!session || (value.order.length && !session.customRankingsEnabled)) return { ok: false as const }
  try {
    await storeDraftPlanningPreference(auth.userId, leagueId, sessionId, value)
    return { ok: true as const }
  } catch { return { ok: false as const } }
}
