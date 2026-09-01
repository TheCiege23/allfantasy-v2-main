import { NextResponse, type NextRequest } from 'next/server'

import { requireAdminOrBearer } from '@/lib/adminAuth'
import { buildDecisionOsGroundingPacket } from '@/lib/decision-os/grounding/packet'
import { serializeDecisionOsGroundingForPrompt } from '@/lib/decision-os/grounding/serialize'

/**
 * GET /api/admin/decision-os/grounding-proof?leagueId=…&userId=…
 *
 * 🛑 THE POINT: SEE EXACTLY WHAT CHIMMY SEES (5.1, D11).
 *
 * `DECISION_OS_GROUNDING_ENABLED` is now on, so the packet is being assembled on every chat turn
 * with a league — and until this route existed there was no way to look at one. The only evidence
 * was whether an answer "seemed better", which is not evidence.
 *
 * It returns BOTH halves, because they fail differently:
 *   packet      the structured object, with every slice's age, provenance, verdict and gap
 *   serialized  the exact text put into the prompt
 *
 * ⚠ A PACKET THAT LOOKS RIGHT AND SERIALIZES TO NOTHING IS A REAL FAILURE MODE, and one you
 * cannot see from either half alone: `serializeDecisionOsGroundingForPrompt` returns '' when
 * nothing is available AND nothing is missing, and the route then adds no section at all. Seeing
 * a rich packet beside an empty string is the tell.
 *
 * ── WHAT THIS IS FOR, SPECIFICALLY ──────────────────────────────────────────────────────────
 * 4.5 cannot retire `/api/chimmy` until answers have been compared with the flag on and off. That
 * comparison needs someone to be able to READ the grounding, not infer it. This is that.
 *
 * ⚠ ADMIN-GATED AND INTERNAL (D11). It exposes one user's league facts to whoever calls it, which
 * is exactly why `userId` is a parameter rather than the session: an admin diagnosing a beta
 * user's bad answer needs to build the packet AS that user. That is a deliberate capability and
 * the reason this route is not, and must not become, user-reachable.
 *
 * ⚠ AND IT IS KEEP-LINED IN THE SAME COMMIT. `app/api/admin` is excluded wholesale by
 * `scripts/vercel-next-build.cjs`, so a new admin route ships as a 404 unless `filesToKeep` names
 * it. A proof surface that 404s in production is worse than none — it is a diagnostic tool that
 * silently is not there, which is the failure this whole plan keeps recording in other forms.
 */
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 60

export async function GET(request: NextRequest) {
  const gate = await requireAdminOrBearer(request)
  if (!gate.ok) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const url = request.nextUrl
  const leagueId = url.searchParams.get('leagueId')?.trim() || null
  const userId = url.searchParams.get('userId')?.trim() || null
  const sport = url.searchParams.get('sport')?.trim() || 'NFL'
  const seasonRaw = Number(url.searchParams.get('season'))
  const weekRaw = Number(url.searchParams.get('week'))
  const question = url.searchParams.get('q')?.trim() || null

  if (!leagueId || !userId) {
    return NextResponse.json(
      {
        error: 'leagueId and userId are both required',
        // Say what to do, not just what is wrong — the same rule the packet's own gaps follow.
        usage: '/api/admin/decision-os/grounding-proof?leagueId=<id>&userId=<id>&sport=NFL&season=2026&week=3&q=should+I+start+X',
      },
      { status: 400 },
    )
  }

  const startedAt = Date.now()
  const packet = await buildDecisionOsGroundingPacket({
    leagueId,
    userId,
    sport,
    season: Number.isFinite(seasonRaw) && seasonRaw > 0 ? seasonRaw : new Date().getFullYear(),
    week: Number.isFinite(weekRaw) && weekRaw > 0 ? weekRaw : null,
    question,
    want: { projections: true, leagueRules: true },
  }).catch((e: unknown) => {
    // Surface the failure rather than returning an empty packet that reads as "nothing to see".
    return { __error: e instanceof Error ? e.message : String(e) } as const
  })

  if ('__error' in packet) {
    return NextResponse.json({ ok: false, error: packet.__error }, { status: 500 })
  }

  const serialized = serializeDecisionOsGroundingForPrompt(packet)

  return NextResponse.json({
    ok: true,
    /*
     * The flag's real state, echoed back. Without it a reader cannot tell an empty result from a
     * disabled feature, and those need completely different responses.
     */
    groundingEnabled: process.env.DECISION_OS_GROUNDING_ENABLED === 'true',
    buildMs: Date.now() - startedAt,
    /** ⚠ Compare against the 3000ms ceiling in /api/chat/chimmy: at or above it, the live route
     *  is discarding this packet every turn while still paying to build it. */
    exceedsChatCeiling: Date.now() - startedAt >= 3000,
    packet,
    serialized,
    serializedLength: serialized.length,
    /** The one-line verdict a reader actually wants first. */
    summary: {
      /**
       * Feeds an operator has switched off (5.3).
       *
       * ⚠ FIRST IN THE SUMMARY ON PURPOSE. A killed feed and a cold one look identical from the
       * outside — both produce a thin answer — and the switch is the one cause a reader can fix
       * in seconds. Burying it under the counts is how someone spends an hour debugging a
       * producer that was never asked to run.
       */
      killedFeeds: packet.meta.killedFeeds,
      slicesPresent: packet.meta.sources.filter((s) => s.ok).length,
      slicesTotal: packet.meta.sources.length,
      gaps: packet.gaps.length,
      gapReasons: [...new Set(packet.gaps.map((g) => g.reason))],
    },
  })
}
