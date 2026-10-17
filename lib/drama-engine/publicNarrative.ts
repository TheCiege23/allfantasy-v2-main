/**
 * publicNarrative — the read-side projection every drama summary passes through
 * before a user or an LLM prompt sees it.
 *
 * 🛑 Milestone 32: manager characterisation LABELS ("patient rebuilder",
 * "win-now", ...) are shown to nobody. `DramaEventDetector` used to write them
 * into REBUILD_PROGRESS prose ("Behavior profile (patient rebuilder, rookie-heavy)
 * now aligns with ..."), and those rows are still stored until the engine next
 * re-runs for that league. So the writer stopping is not enough: stored rows are
 * rewritten here, on every read path, rather than trusted.
 */

// The exact legacy template, and nothing broader: several label words
// ("aggressive", "conservative") are ordinary English, so a vocabulary-wide scrub
// would mangle unrelated drama prose.
const LEGACY_PROFILE_SENTENCE =
  /Behavior profile \([^)]*\) now aligns with upward competitive signals\.?/gi

/** The label-free sentence a legacy REBUILD_PROGRESS summary is rewritten to. */
export const LEGACY_REBUILD_SUMMARY = 'Competitive signals are trending upward.'

export function publicDramaSummary(summary: string | null): string | null {
  if (summary == null) return summary
  return summary.replace(LEGACY_PROFILE_SENTENCE, LEGACY_REBUILD_SUMMARY)
}
