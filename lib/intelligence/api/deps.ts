/**
 * G15.5 — Real dependency wiring for the Intelligence API routes.
 *
 * Routes call `createIntelligenceApiDeps()` and pass it to the handler cores. Tests use
 * fake deps instead, so this module is never exercised by unit tests.
 */
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { assertLeagueMember, assertLeagueCommissioner } from '@/lib/league/league-access'
import { IntelligenceQueryService } from '@/lib/intelligence/IntelligenceQueryService'
import type { AccessResult, IntelligenceApiDeps } from './handlers'

export function createIntelligenceApiDeps(): IntelligenceApiDeps {
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
    service: new IntelligenceQueryService(prisma),
  }
}
