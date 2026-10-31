/**
 * Find a League listings for leagues that PLAY ON ANOTHER PLATFORM (Sleeper, ESPN, Yahoo, …)
 * and were imported into AllFantasy.
 *
 * A native league is joined here with its invite code. An imported league cannot be: its seats
 * live on the other platform, so a player asks for a spot (FindLeagueSpotRequest) and the
 * commissioner sends their platform invite.
 *
 * ⚠ ONLY THE LEAGUE'S COMMISSIONER MAY LIST IT, AND THE IMPORT IS THE PROOF. Anyone in a league
 * can import it, so "has an imported copy" proves nothing. What counts, in order of strength:
 *   - "provider": the platform said so — `League.isCommissioner` (Sleeper's is_owner at import)
 *     or a `settings.commissionerVerification` record with method "api";
 *   - "attestation": the importer personally claimed it at import (method "attestation").
 * A "membership-only" record, or none, is not a commissioner and cannot list. Both records must
 * name the league's own `userId` — the same rule activeLeagueContext applies.
 */

export const EXTERNAL_LISTING_KEY = "findLeagueExternal"

export type ListingVerification = "provider" | "attestation"

export interface ExternalListing {
  listed: boolean
  /** Spots the commissioner says are open. The other platform's roster is not readable here. */
  openSpots: number
  note: string | null
  listedAt: string | null
}

const NATIVE_PLATFORMS = new Set(["", "manual", "allfantasy", "af", "native"])

const PLATFORM_LABELS: Record<string, string> = {
  sleeper: "Sleeper",
  espn: "ESPN",
  yahoo: "Yahoo",
  fantrax: "Fantrax",
  mfl: "MyFantasyLeague",
  fleaflicker: "Fleaflicker",
  nfl: "NFL Fantasy",
  cbs: "CBS",
}

export const EXTERNAL_LISTING_NOTE_MAX = 280
export const EXTERNAL_LISTING_MAX_SPOTS = 32

function toRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {}
}

export function isNativePlatform(platform: string | null | undefined): boolean {
  return NATIVE_PLATFORMS.has(String(platform ?? "").trim().toLowerCase())
}

export function platformLabel(platform: string | null | undefined): string {
  const key = String(platform ?? "").trim().toLowerCase()
  return PLATFORM_LABELS[key] ?? (key ? key[0].toUpperCase() + key.slice(1) : "another platform")
}

export function readExternalListing(settings: unknown): ExternalListing {
  const raw = toRecord(toRecord(settings)[EXTERNAL_LISTING_KEY])
  const spots = Number(raw.openSpots)
  const note = typeof raw.note === "string" ? raw.note.trim().slice(0, EXTERNAL_LISTING_NOTE_MAX) : ""
  return {
    listed: raw.listed === true,
    openSpots: Number.isInteger(spots) ? Math.max(0, Math.min(EXTERNAL_LISTING_MAX_SPOTS, spots)) : 0,
    note: note || null,
    listedAt: typeof raw.listedAt === "string" ? raw.listedAt : null,
  }
}

export function listingVerification(league: {
  userId: string
  isCommissioner?: boolean | null
  settings: unknown
}): ListingVerification | null {
  if (league.isCommissioner === true) return "provider"
  const record = toRecord(toRecord(league.settings).commissionerVerification)
  if (record.appUserId !== league.userId) return null
  if (record.method === "api") return "provider"
  if (record.method === "attestation") return "attestation"
  return null
}

/** Shown on the card, so a player knows how much the "commissioner" label is worth. */
export function verificationLabel(verification: ListingVerification, platform: string | null | undefined): string {
  return verification === "provider"
    ? `Commissioner verified by ${platformLabel(platform)}`
    : "Commissioner self-reported at import"
}
