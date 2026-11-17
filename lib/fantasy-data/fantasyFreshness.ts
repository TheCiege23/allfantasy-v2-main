/**
 * Fantasy data freshness — computes staleness tiers from evidence snapshots.
 * Used by AI grounding and UI to show data age warnings.
 */
import type { FantasyDataEvidenceSnapshot } from "./fantasyDataEvidence"

type FantasyFreshnessTier =
  | "fresh"        // < 6 hours old
  | "recent"       // 6–24 hours old
  | "stale"        // 1–7 days old
  | "very_stale"   // > 7 days old
  | "pending"      // data exists but has never been imported
  | "unavailable"  // no data in DB at all

export type FantasyFreshnessReport = {
  tier: FantasyFreshnessTier
  ageHours: number | null
  lastSyncedAt: string | null
  summary: string
  showWarning: boolean
  /** Instruction injected into AI grounding packet. */
  aiInstruction: string
}

const STALE_HOURS = 24
const VERY_STALE_HOURS = 24 * 7

function ageHoursFrom(isoString: string | null): number | null {
  if (!isoString) return null
  const parsed = Date.parse(isoString)
  if (!Number.isFinite(parsed)) return null
  return (Date.now() - parsed) / 3_600_000
}

function tierFromAge(ageHours: number): FantasyFreshnessTier {
  if (ageHours < 6) return "fresh"
  if (ageHours < STALE_HOURS) return "recent"
  if (ageHours < VERY_STALE_HOURS) return "stale"
  return "very_stale"
}

function summarize(tier: FantasyFreshnessTier, ageHours: number | null, sport: string): string {
  switch (tier) {
    case "fresh":
      return `${sport} data is current (updated ${ageHours != null ? Math.round(ageHours * 60) + " min" : "recently"} ago).`
    case "recent":
      return `${sport} data is recent (updated ~${ageHours != null ? Math.round(ageHours) + "h" : "today"} ago).`
    case "stale":
      return `${sport} data is stale (${ageHours != null ? Math.round(ageHours / 24) + " day(s)" : "several days"} old). Trigger an import to refresh.`
    case "very_stale":
      return `${sport} data is very stale (${ageHours != null ? Math.round(ageHours / 24) + " day(s)" : "over a week"} old). Import is overdue.`
    case "pending":
      return `${sport} import has not run yet. Data is empty.`
    case "unavailable":
      return `No ${sport} data available — provider keys may be missing or import has never run.`
  }
}

function aiInstruction(tier: FantasyFreshnessTier, sport: string): string {
  switch (tier) {
    case "fresh":
    case "recent":
      return `${sport} player, ADP, and injury data is current. You may cite it with confidence.`
    case "stale":
      return `${sport} data is stale. Always say "as of the last import" before citing stats or ADP. Recommend the user trigger a data refresh.`
    case "very_stale":
      return `${sport} data is very stale. Do NOT cite specific ADP numbers or injury statuses as current fact. Say data may be outdated and recommend refreshing.`
    case "pending":
      return `${sport} data has not been imported yet. Do not cite any player data, ADP, or injuries. Tell the user an import is needed.`
    case "unavailable":
      return `No ${sport} data is available. Do not invent player data, ADP, projections, or injuries. Acknowledge the data gap honestly.`
  }
}

export function computeFantasyFreshness(
  evidence: Pick<FantasyDataEvidenceSnapshot, "sport" | "lastFullSyncAt" | "dataAvailability" | "players" | "adp">,
): FantasyFreshnessReport {
  const { sport, lastFullSyncAt, dataAvailability } = evidence

  if (dataAvailability === "unavailable") {
    return {
      tier: "unavailable",
      ageHours: null,
      lastSyncedAt: null,
      summary: summarize("unavailable", null, sport),
      showWarning: true,
      aiInstruction: aiInstruction("unavailable", sport),
    }
  }

  const ageHours = ageHoursFrom(lastFullSyncAt)
  if (ageHours === null) {
    return {
      tier: "pending",
      ageHours: null,
      lastSyncedAt: null,
      summary: summarize("pending", null, sport),
      showWarning: true,
      aiInstruction: aiInstruction("pending", sport),
    }
  }

  const tier = tierFromAge(ageHours)
  return {
    tier,
    ageHours: Math.round(ageHours * 10) / 10,
    lastSyncedAt: lastFullSyncAt,
    summary: summarize(tier, ageHours, sport),
    showWarning: tier === "stale" || tier === "very_stale",
    aiInstruction: aiInstruction(tier, sport),
  }
}
