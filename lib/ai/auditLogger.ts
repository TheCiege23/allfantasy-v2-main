/**
 * AllFantasy AI Audit Logger
 *
 * Fire-and-forget writer for AiInteractionLog rows.
 * All errors are swallowed — logging must NEVER break an AI response.
 *
 * Usage:
 *   logAiInteraction({ sport: "world_cup", feature: "pool_chat", ... })
 *
 * Called AFTER every AI response (LLM or deterministic) at the service layer,
 * not at the route layer, so it captures the ground truth of what was sent.
 */
import "server-only"
import { prisma } from "@/lib/prisma"

export type AiValidatorResult = "clean" | "warned" | "blocked" | "deterministic" | "unavailable"

export type AiAuditEntry = {
  userId?: string | null
  sport: string
  feature: string
  route?: string | null
  plan?: string | null
  providerSource?: string | null
  freshnessTier?: string | null
  promptIntent?: string | null
  missingData?: string[]
  allowedClaims?: string[]
  validatorResult?: AiValidatorResult | null
  blockedReason?: string | null
  modelUsed?: string | null
  tokenCost?: number | null
  wasDeterministic?: boolean
}

/**
 * Write one audit row. Never awaited by callers — errors are caught internally.
 */
export function logAiInteraction(entry: AiAuditEntry): void {
  if (!prisma?.aiInteractionLog?.create) {
    return
  }

  prisma.aiInteractionLog
    .create({
      data: {
        userId: entry.userId ?? null,
        sport: entry.sport,
        feature: entry.feature,
        route: entry.route ?? null,
        plan: entry.plan ?? null,
        providerSource: entry.providerSource ?? null,
        freshnessTier: entry.freshnessTier ?? null,
        promptIntent: entry.promptIntent ?? null,
        missingData: entry.missingData ?? [],
        allowedClaims: entry.allowedClaims ?? [],
        validatorResult: entry.validatorResult ?? null,
        blockedReason: entry.blockedReason ?? null,
        modelUsed: entry.modelUsed ?? null,
        tokenCost: entry.tokenCost ?? null,
        wasDeterministic: entry.wasDeterministic ?? false,
      },
    })
    .catch((err: unknown) => {
      // Never rethrow — logging failure must not degrade the user experience
      console.error("[AiAuditLog] Failed to write audit row:", err)
    })
}
