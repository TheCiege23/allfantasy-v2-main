/**
 * Saved Find a League searches, and the daily check that tells a player when new leagues match.
 *
 * A search is stored as the discovery query string (what /api/discover/leagues receives), in a
 * canonical form so the same filters saved twice are one row. Once a day the morning-briefing
 * cron re-runs each search for its owner and sends ONE in-app notification naming what's new.
 *
 * ⚠ THE FIRST CHECK ONLY RECORDS. A search saved today matches leagues that already existed;
 * alerting on all of them tomorrow would be "here is what you were just looking at". So the
 * first run seeds `seenLeagueIds` and stays quiet, and every later run names only the rest.
 *
 * ⚠ AN ALERT NAMES FREE LEAGUES ONLY. The page hides paid leagues from a viewer in a restricted
 * state (lib/geo/paidLeagueGeo.ts) using the request's location, which a cron doesn't have. So a
 * paid match is counted, never named, and the link lands on the page, which applies the rule.
 */

import type { DiscoverLeaguesInput, DiscoveryCard } from "./types"

export const MAX_SAVED_SEARCHES = 5
/** Ids remembered per search; a search matching more than this re-alerts on the oldest. */
export const SEEN_CAP = 300
/** A search is due again this long after its last check (daily cron, some slack for drift). */
export const RECHECK_AFTER_MS = 20 * 60 * 60 * 1000

/** The keys /api/discover/leagues reads, in a fixed order, so equal filters give equal strings. */
const QUERY_KEYS = [
  "q",
  "sport",
  "style",
  "draftType",
  "draftStatus",
  "entryFee",
  "teamCountMin",
  "teamCountMax",
  "aiEnabled",
  "draftWhen",
  "tzRegion",
  "rankBand",
  "vibe",
  "visibility",
  "viewerTz",
] as const

/** Defaults that say nothing, dropped so "entryFee=all" and no entryFee are the same search. */
const NEUTRAL: Record<string, string> = {
  entryFee: "all",
  visibility: "public",
  draftWhen: "any",
  tzRegion: "any",
  rankBand: "all",
  vibe: "all",
  style: "all",
  draftType: "all",
  draftStatus: "all",
}

/** Known keys only, neutral values and paging dropped, fixed order. Null when nothing is left. */
export function canonicalSearchQuery(raw: string): string | null {
  const params = new URLSearchParams(raw.startsWith("?") ? raw.slice(1) : raw)
  const out = new URLSearchParams()
  for (const key of QUERY_KEYS) {
    const value = params.get(key)?.trim().slice(0, 100)
    if (!value || NEUTRAL[key] === value) continue
    out.set(key, value)
  }
  // The viewer's zone only matters to the windows that read a wall clock.
  const when = out.get("draftWhen")
  if (when !== "weeknight" && when !== "weekend") out.delete("viewerTz")
  const s = out.toString()
  return s ? s : null
}

function intParam(params: URLSearchParams, key: string): number | null {
  const n = parseInt(params.get(key) ?? "", 10)
  return Number.isFinite(n) ? n : null
}

/** The stored query back into a discovery request, newest first, for one owner. */
export function discoverInputFromQuery(query: string): DiscoverLeaguesInput {
  const p = new URLSearchParams(query)
  return {
    query: p.get("q"),
    sport: p.get("sport"),
    style: (p.get("style") ?? "all") as DiscoverLeaguesInput["style"],
    draftType: (p.get("draftType") ?? "all") as DiscoverLeaguesInput["draftType"],
    draftStatus: (p.get("draftStatus") ?? "all") as DiscoverLeaguesInput["draftStatus"],
    entryFee: (p.get("entryFee") ?? "all") as DiscoverLeaguesInput["entryFee"],
    teamCountMin: intParam(p, "teamCountMin"),
    teamCountMax: intParam(p, "teamCountMax"),
    aiEnabled: p.get("aiEnabled") === "true" || null,
    draftWhen: (p.get("draftWhen") ?? "any") as DiscoverLeaguesInput["draftWhen"],
    tzRegion: (p.get("tzRegion") ?? "any") as DiscoverLeaguesInput["tzRegion"],
    rankBand: (p.get("rankBand") ?? "all") as DiscoverLeaguesInput["rankBand"],
    vibe: (p.get("vibe") ?? "all") as DiscoverLeaguesInput["vibe"],
    viewerTimeZone: p.get("viewerTz"),
    visibility: "public",
    sort: "newest",
    page: 1,
    limit: 24,
  }
}

export interface SavedSearchCheck {
  /** Ids to store as seen after this check. */
  seen: string[]
  /** What to tell the player, or null for nothing. */
  alert: { title: string; body: string } | null
}

function hasOpenSeat(card: DiscoveryCard): boolean {
  return card.maxMembers > 0 && card.memberCount < card.maxMembers
}

/** PURE: one search's results against what it has already shown. */
export function checkSavedSearch(input: {
  label: string
  seenLeagueIds: string[]
  firstCheck: boolean
  results: DiscoveryCard[]
}): SavedSearchCheck {
  const seenSet = new Set(input.seenLeagueIds)
  const fresh = input.results.filter((card) => hasOpenSeat(card) && !seenSet.has(`${card.source}:${card.id}`))
  const seen = [...fresh.map((c) => `${c.source}:${c.id}`), ...input.seenLeagueIds].slice(0, SEEN_CAP)
  if (input.firstCheck || fresh.length === 0) return { seen, alert: null }

  const named = fresh.filter((c) => !c.isPaid).slice(0, 3).map((c) => c.name)
  const more = fresh.length - named.length
  const title =
    fresh.length === 1 ? `A new league matches "${input.label}"` : `${fresh.length} new leagues match "${input.label}"`
  const body =
    named.length > 0
      ? `${named.join(", ")}${more > 0 ? ` and ${more} more` : ""}. Seats are open now.`
      : "Seats are open now. Take a look before they fill."
  return { seen, alert: { title, body } }
}
