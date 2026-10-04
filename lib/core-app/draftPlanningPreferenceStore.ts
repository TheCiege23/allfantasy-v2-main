import 'server-only'
import { prisma } from '@/lib/prisma'
import { draftPlanningPreference, type DraftPlanningPreference } from './draftPlanningPreferenceModel'
export const DRAFT_PLANNING_SCOPE = 'draft_preparation_preferences'
export async function getDraftPlanningPreference(userId: string, leagueId: string, sessionId: string) {
  const row = await prisma.aiMemory.findUnique({ where: { userId_leagueId_scope_key: { userId, leagueId, scope: DRAFT_PLANNING_SCOPE, key: sessionId } }, select: { value: true } })
  return draftPlanningPreference(row?.value)
}
export async function storeDraftPlanningPreference(userId: string, leagueId: string, sessionId: string, value: DraftPlanningPreference) {
  await prisma.aiMemory.upsert({
    where: { userId_leagueId_scope_key: { userId, leagueId, scope: DRAFT_PLANNING_SCOPE, key: sessionId } },
    create: { userId, leagueId, scope: DRAFT_PLANNING_SCOPE, key: sessionId, value }, update: { value },
  })
}
