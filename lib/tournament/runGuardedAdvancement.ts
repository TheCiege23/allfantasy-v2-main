/**
 * Run advancement, but only on the numbers the commissioner actually saw.
 *
 * 🛑 `POST /api/tournament/advancement` ALREADY DOES THE WORK, AND DOES IT
 * IMMEDIATELY. It is correctly commissioner-gated, but it takes a round id and
 * runs — no preview, no check that anyone is unmatched, no check that the round
 * has already been advanced. That is fine for the programmatic callers it has
 * (`redraftScheduler`, the commissioner route); it is not what should sit behind
 * a button that ends 176 seasons.
 *
 * ⚠ THIS DOES NOT REPLACE THAT ROUTE OR CHANGE IT. Tightening it in place would
 * change behaviour under callers that depend on running unattended. This is the
 * guarded path for the UI; the unguarded one stays for automation.
 */
import 'server-only'
import { prisma } from '@/lib/prisma'
import { identifyQualifiers } from '@/lib/tournament/advancementEngine'
import {
  previewAdvancement,
  type AdvancementPreview,
  type Blocker,
} from '@/lib/tournament/advancementPreview'

export type RunOutcome =
  | {
      ok: true
      preview: AdvancementPreview
      qualified: number
      wildcards: number
      bubble: number
      eliminated: number
      overrode: Blocker[]
    }
  | { ok: false; error: string; status: 400 | 404 | 409; blockers?: Blocker[]; preview?: AdvancementPreview }

export async function runGuardedAdvancement(args: {
  tournamentId: string
  commissionerUserId: string
  /** The signature from the preview the commissioner read. */
  expectedSignature: string
  /** Blocker codes the commissioner has explicitly chosen to override. */
  acknowledge?: string[]
}): Promise<RunOutcome> {
  const preview = await previewAdvancement(args.tournamentId, args.commissionerUserId)
  if (!preview) return { ok: false, error: 'Tournament not found', status: 404 }
  if (!preview.roundId) {
    return { ok: false, error: 'This tournament has no round to advance from.', status: 400 }
  }

  /*
   * 🛑 THE BOARD MOVES BETWEEN LOOKING AND CLICKING. A sync landing in between
   * changes who is 64th — and a commissioner who read one list and confirmed
   * another has authorised something they never saw. Refuse and make them look
   * again; the second look costs seconds, the wrong cut costs somebody a season.
   */
  if (args.expectedSignature !== preview.signature) {
    return {
      ok: false,
      error:
        'The standings changed since you looked. Nothing was run — check the new numbers and confirm again.',
      status: 409,
      preview,
    }
  }

  const acknowledged = new Set(args.acknowledge ?? [])
  const blocking = preview.blockers.filter((b) => b.severity === 'blocker')
  const unacknowledged = blocking.filter((b) => !acknowledged.has(b.code))
  if (unacknowledged.length > 0) {
    return {
      ok: false,
      error: 'There are things to sort out before this can run.',
      status: 400,
      blockers: unacknowledged,
      preview,
    }
  }

  const result = await identifyQualifiers(args.tournamentId, preview.roundId)

  /*
   * ⚠ AUDITED WITH THE OVERRIDES NAMED. If somebody was eliminated because a
   * link was missing and the commissioner waved it through, the record has to
   * say that was a choice — otherwise the only evidence left is a manager who
   * looks like he lost every week.
   */
  await prisma.tournamentAuditLog
    .create({
      data: {
        tournamentId: args.tournamentId,
        roundNumber: preview.roundNumber,
        action: 'advancement.run',
        actorType: 'commissioner',
        actorId: args.commissionerUserId,
        targetType: 'round',
        targetId: preview.roundId,
        data: {
          signature: preview.signature,
          qualified: result.directQualifiers.length,
          wildcards: result.wildcards.length,
          bubble: result.bubble.length,
          eliminated: result.eliminated.length,
          overrode: blocking.filter((b) => acknowledged.has(b.code)).map((b) => b.code),
        },
      },
    })
    .catch(() => {})

  return {
    ok: true,
    preview,
    qualified: result.directQualifiers.length,
    wildcards: result.wildcards.length,
    bubble: result.bubble.length,
    eliminated: result.eliminated.length,
    overrode: blocking.filter((b) => acknowledged.has(b.code)),
  }
}
