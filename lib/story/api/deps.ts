/**
 * G15.13 — Real dependency wiring for the Story API routes.
 *
 * Routes call `createStoryApiDeps()` and pass it to the handler cores. Tests use fake deps
 * instead, so this module is never exercised by unit tests. The Story Engine is fed the
 * IntelligenceQueryService (its only data source); no raw event/provider access.
 */
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { assertLeagueMember, assertLeagueCommissioner } from '@/lib/league/league-access'
import { IntelligenceQueryService } from '@/lib/intelligence/IntelligenceQueryService'
import { StoryEngine } from '@/lib/story/StoryEngine'
import { defaultStoryFeatureGate } from '@/lib/story/featureGate'
import type { AccessResult, StoryApiDeps } from './handlers'

export function createStoryApiDeps(): StoryApiDeps {
  return {
    getUserId: async () => {
      const session = (await getServerSession(authOptions as never)) as { user?: { id?: string } } | null
      return session?.user?.id ?? null
    },
    assertMember: async (leagueId, userId): Promise<AccessResult> => {
      const r = await assertLeagueMember(leagueId, userId)
      return r.ok ? { ok: true } : { ok: false, status: r.status }
    },
    assertCommissioner: async (leagueId, userId): Promise<AccessResult> => {
      const r = await assertLeagueCommissioner(leagueId, userId)
      return r.ok ? { ok: true } : { ok: false, status: r.status }
    },
    engine: new StoryEngine(new IntelligenceQueryService(prisma)),
    gate: defaultStoryFeatureGate,
  }
}
