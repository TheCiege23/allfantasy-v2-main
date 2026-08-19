/**
 * G15.10 — Live Chimmy commissioner-grounding resolver.
 *
 * Gates + builds the privacy-safe grounding text the chat pipeline attaches to commissioner
 * questions. NEVER throws — returns null on any miss so the chat continues normally.
 *
 * Attach only when ALL hold:
 *   - a leagueId is present
 *   - the question matches commissioner/league-health intent (or an explicit commissioner flag)
 *   - the requester is a league commissioner
 *   - the feature gate allows it (enforced inside buildCommissionerGrounding)
 *
 * Deps are injectable for testing; defaults use the real session/access/service.
 */
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { assertLeagueCommissioner } from '@/lib/league/league-access'
import { IntelligenceQueryService } from '../IntelligenceQueryService'
import { detectCommissionerIntelligenceIntent, buildCommissionerGrounding } from './commissionerGrounding'

export interface ChimmyGroundingArgs {
  userId?: string | null
  leagueId?: string | null
  question?: string | null
  commissionerFlag?: boolean
}

export interface ChimmyGroundingDeps {
  resolveUserId?: () => Promise<string | null>
  /** Returns true if `userId` is a commissioner of `leagueId`. */
  assertCommissioner?: (leagueId: string, userId: string) => Promise<boolean>
  /** Returns the grounding `{ available, text }` for the league. */
  buildGrounding?: (leagueId: string, userId: string) => Promise<{ available: boolean; text: string }>
}

const defaultDeps: Required<ChimmyGroundingDeps> = {
  resolveUserId: async () => {
    const session = (await getServerSession(authOptions as never)) as { user?: { id?: string } } | null
    return session?.user?.id ?? null
  },
  assertCommissioner: async (leagueId, userId) => {
    const r = await assertLeagueCommissioner(leagueId, userId)
    return r.ok
  },
  buildGrounding: async (leagueId, userId) => {
    const g = await buildCommissionerGrounding({ service: new IntelligenceQueryService(prisma), leagueId, principal: { userId } })
    return { available: g.available, text: g.text }
  },
}

export async function resolveChimmyCommissionerGrounding(
  args: ChimmyGroundingArgs,
  deps: ChimmyGroundingDeps = {},
): Promise<string | null> {
  const d = { ...defaultDeps, ...deps }
  try {
    const leagueId = args.leagueId?.trim()
    if (!leagueId) return null
    if (!args.commissionerFlag && !detectCommissionerIntelligenceIntent(args.question)) return null

    const userId = args.userId ?? (await d.resolveUserId())
    if (!userId) return null

    if (!(await d.assertCommissioner(leagueId, userId))) return null

    const grounding = await d.buildGrounding(leagueId, userId)
    // available=false → restricted/error → do not ground. available=true → ok/empty text.
    return grounding.available ? grounding.text : null
  } catch {
    return null // never break the chat turn
  }
}
