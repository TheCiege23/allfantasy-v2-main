/**
 * Phase 2A — token-bounded summary helper for the future chat-route injection.
 *
 * NOT wired into `app/api/ai/chat/route.ts` in this batch. Lives here so the
 * Phase 2B PR can import it without inventing a new abstraction.
 *
 * Keeps the prompt compact: small, evidence-friendly key/value lines rather
 * than dumping raw JSON.
 */

import type { ChimmyContextBundle } from "@/lib/chimmy-context/types"

/** Rough char-budget. ~4 chars per token is a safe average for prompt sizing. */
const DEFAULT_MAX_CHARS = 2400

function line(label: string, value: string | number | null | undefined): string | null {
  if (value == null || value === "" || (typeof value === "number" && !Number.isFinite(value))) {
    return null
  }
  return `- ${label}: ${value}`
}

export function summarizeChimmyContextForPrompt(
  bundle: ChimmyContextBundle,
  options: { maxChars?: number } = {}
): string {
  const cap = options.maxChars ?? DEFAULT_MAX_CHARS
  const sections: string[] = []

  if (bundle.user) {
    sections.push(
      [
        "## USER",
        line("Display name", bundle.user.displayName),
        line("Timezone", bundle.user.timezone),
        line("Preferred language", bundle.user.preferredLanguage),
      ]
        .filter(Boolean)
        .join("\n")
    )
  }

  if (bundle.aiAccess) {
    sections.push(
      [
        "## AI ACCESS",
        line("Plan", bundle.aiAccess.planLabel ?? (bundle.aiAccess.hasSubscription ? "Premium" : "Free")),
        // Trial lines removed for the same reason as renderAIAccessSection: the trial
        // has no allowance behind it, so the model must not repeat it to the user.
        line("Token balance", bundle.aiAccess.tokenBalance),
      ]
        .filter(Boolean)
        .join("\n")
    )
  }

  if (bundle.activeLeague) {
    const lg = bundle.activeLeague
    sections.push(
      [
        "## ACTIVE LEAGUE",
        line("Name", lg.name),
        line("Platform", lg.platform),
        line("Sport", lg.sport),
        line("Season", lg.season),
        line("Format", lg.format),
        line("Scoring", lg.scoring),
        line("Teams", lg.numTeams),
        line("Your role", lg.role),
      ]
        .filter(Boolean)
        .join("\n")
    )
  }

  if (bundle.importedHistory && bundle.importedHistory.totalLeagues > 0) {
    const h = bundle.importedHistory
    sections.push(
      [
        "## IMPORTED HISTORY",
        line("Source", h.source),
        line("Total leagues", h.totalLeagues),
        line("Total seasons", h.totalSeasons),
        line("Career record", h.careerRecord),
        line("Win %", h.winPercentage),
        line("Championships", h.championships),
        line("Archetype", h.archetype),
      ]
        .filter(Boolean)
        .join("\n")
    )
  }

  let out = sections.join("\n\n")
  if (out.length > cap) out = out.slice(0, cap) + "\n…(truncated)"
  return out
}
