import { prisma } from "@/lib/prisma"
import { legalLastUpdated } from "@/lib/legal/legalVersions"

/**
 * Record that a user agreed to legal documents — which ones, at which version, where, and when.
 *
 * WHY. Until 2026-10-03 nothing was stored: sign-up refused to proceed without the Terms and
 * Disclaimer boxes ticked, but kept only `ageConfirmedAt`, and Settings › Legal inferred
 * "accepted" from that. There was no answer to "when did this user agree, and to which version?",
 * and nothing for "Download my data" to show. Owner's call that day: start recording it.
 *
 * ⚠ BEST-EFFORT, NEVER BLOCKING. A failure is logged and returns false; it never throws into the
 * sign-up or age-prompt flow that called it. Refusing an account because an audit row failed to
 * write would trade a working product for a bookkeeping gap. This also makes the code safe to
 * ship before the `legal_acceptances` migration is applied — every write fails quietly (P2021)
 * until the table exists.
 *
 * Append-only: every acceptance is its own row, stamped with the version from
 * lib/legal/legalVersions at that moment.
 */

export type LegalDocument = "terms" | "disclaimer" | "privacy"
export type LegalAcceptanceSource = "signup" | "age_prompt"

type Db = Pick<typeof prisma, "legalAcceptance">

export async function recordLegalAcceptances(
  userId: string,
  documents: readonly LegalDocument[],
  source: LegalAcceptanceSource,
  opts: { db?: Db; now?: Date } = {},
): Promise<boolean> {
  if (!userId || documents.length === 0) return false
  const db = opts.db ?? prisma
  const acceptedAt = opts.now ?? new Date()
  try {
    await db.legalAcceptance.createMany({
      data: [...new Set(documents)].map((document) => ({
        userId,
        document,
        documentVersion: legalLastUpdated(document),
        source,
        acceptedAt,
      })),
    })
    return true
  } catch (err) {
    // The CODE only (P2021 = table missing), never the message: a Prisma "invalid invocation"
    // message echoes the query arguments, user id included.
    const code = (err as { code?: unknown })?.code
    console.error(
      `[legal] acceptance not recorded source=${source} documents=${documents.join(",")} code=${
        typeof code === "string" ? code : err instanceof Error ? err.name : "unknown"
      }`,
    )
    return false
  }
}
