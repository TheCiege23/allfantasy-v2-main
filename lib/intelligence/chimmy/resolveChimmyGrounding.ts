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

/**
 * Why commissioner grounding was or was not produced.
 *
 * 🛑 `resolveChimmyCommissionerGrounding` BELOW RETURNS `null` FOR FIVE DIFFERENT REASONS — no
 * league, not a commissioner-intelligence question, no user, NOT A COMMISSIONER, and grounding
 * unavailable — and a caller cannot tell them apart. That is fine for its own use, which only
 * needs "is there text to add", and it is why Decision OS's `not_entitled` gap reason had no
 * producer: the information is discarded one layer below where D8 needs it.
 *
 * "You are not this league's commissioner" and "you did not ask a commissioner question" are
 * completely different sentences to a user, and only one of them is worth saying.
 */
export type CommissionerGroundingOutcome =
  | { status: 'ok'; text: string }
  /** The question was not about commissioner intelligence. Not a gap — nothing was wanted. */
  | { status: 'not_asked' }
  /** 🛑 The user is not a commissioner of this league. This is the real `not_entitled`. */
  | { status: 'not_entitled' }
  /** Asked for, permitted, and the service could not produce it. */
  | { status: 'unavailable' }

/**
 * The same resolution, with the reason preserved.
 *
 * ⚠ ADDITIVE ON PURPOSE. `resolveChimmyCommissionerGrounding` keeps its exact signature and
 * behaviour because `/api/chimmy` already calls it; changing that function to return a union would
 * be a breaking edit to a live path for the benefit of a new one. Both share `defaultDeps`, so
 * there is one implementation of the access rule rather than two.
 */
export async function resolveCommissionerGroundingOutcome(
  args: ChimmyGroundingArgs,
  deps: ChimmyGroundingDeps = {},
): Promise<CommissionerGroundingOutcome> {
  const d = { ...defaultDeps, ...deps }
  try {
    const leagueId = args.leagueId?.trim()
    if (!leagueId) return { status: 'not_asked' }
    if (!args.commissionerFlag && !detectCommissionerIntelligenceIntent(args.question)) {
      return { status: 'not_asked' }
    }
    const userId = args.userId ?? (await d.resolveUserId())
    if (!userId) return { status: 'not_asked' }

    if (!(await d.assertCommissioner(leagueId, userId))) return { status: 'not_entitled' }

    const grounding = await d.buildGrounding(leagueId, userId)
    return grounding.available ? { status: 'ok', text: grounding.text } : { status: 'unavailable' }
  } catch {
    // Never break the chat turn — but say it was unavailable rather than pretending it was
    // never asked for, which would hide a real failure behind a legitimate-looking silence.
    return { status: 'unavailable' }
  }
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
