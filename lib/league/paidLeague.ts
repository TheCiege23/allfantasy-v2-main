import { extractEntryFeeUsdFromSettings } from "@/lib/league-finance/extractEntryFeeFromSettings"

/**
 * What a league's settings say about money. AllFantasy never collects dues — a paid league's
 * commissioner runs them off the platform — but whether a league is paid still decides who may
 * join it (lib/geo/restrictedStates: some states restrict paid fantasy leagues) and what Find a
 * League has to disclose on its card.
 *
 * Discovery and the join route both read through here, so the card and the gate can't disagree.
 * The fee itself comes from the reader league finance already uses.
 */

function toRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {}
}

function positiveNumber(value: unknown): number | null {
  const n = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN
  return Number.isFinite(n) && n > 0 ? n : null
}

/** The entry fee in dollars, when the settings carry one. */
export function leagueEntryFee(settings: unknown): number | null {
  const raw = toRecord(settings)
  // Discovery has always accepted a numeric string ("25"); the finance reader takes numbers only.
  return extractEntryFeeUsdFromSettings(raw) ?? positiveNumber(raw.entryFee) ?? positiveNumber(raw.buyIn)
}

export function isPaidLeagueSettings(settings: unknown): boolean {
  const raw = toRecord(settings)
  if (typeof raw.isPaidLeague === "boolean") return raw.isPaidLeague
  if (typeof raw.paid === "boolean") return raw.paid
  return leagueEntryFee(raw) != null
}
