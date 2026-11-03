import { prisma } from "@/lib/prisma"
import { getBaseUrl } from "@/lib/get-base-url"
import { resolveUserCareerTier } from "@/lib/ranking/tier-visibility"
import { discoverPublicLeagues } from "./PublicDiscoveryService"
import { RANK_BAND_LABELS, parseLeagueSearch } from "./findLeagueFilters"
import { platformLabel } from "./externalListing"
import { vibeLabel } from "./vibes"
import type { DiscoverLeaguesInput, DiscoveryCard } from "./types"

const SHOWN = 5

/**
 * Chimmy's `find_open_leagues` tool: "find me a 12 team dynasty league that drafts on weeknights".
 *
 * The same plain-English parser as the Find a League search box, the same discovery read, the
 * same rank bands for the asker. Returns prose for the model, with a link to the page holding
 * the identical search so the person can see every result and join from there.
 *
 * ⚠ FREE LEAGUES ONLY. Whether paid leagues may be shown depends on where the asker is
 * (lib/geo/paidLeagueGeo.ts), and a tool call has no request to read that from. The page does,
 * so paid leagues are left to the link, and the result says so.
 */
export async function findOpenLeaguesForChimmy(userId: string | null, rawQuery: string): Promise<string> {
  const parsed = parseLeagueSearch(rawQuery)
  const input: DiscoverLeaguesInput = {
    query: parsed.text || null,
    sport: parsed.sport ?? null,
    style: parsed.style ?? "all",
    draftType: parsed.draftType ?? "all",
    teamCountMin: parsed.teamCount ?? null,
    teamCountMax: parsed.teamCount ?? null,
    draftWhen: parsed.draftWhen ?? "any",
    tzRegion: parsed.tzRegion ?? "any",
    vibe: parsed.vibe ?? "all",
    entryFee: "free",
    visibility: "public",
    sort: "ranking_match",
    page: 1,
    limit: 24,
  }
  const viewerTier = await resolveUserCareerTier(prisma as never, userId, 1)
  const result = await discoverPublicLeagues(input, getBaseUrl(), { viewerTier, viewerUserId: userId })
  const open = result.leagues.filter((c) => c.maxMembers > 0 && c.memberCount < c.maxMembers)

  const pageUrl = `${getBaseUrl()}/find-league?q=${encodeURIComponent(rawQuery.trim())}`
  const askedPaid = parsed.entryFee === "paid"
  const paidNote = askedPaid
    ? "Paid leagues aren't listed in chat because whether they're open depends on the person's state. Send them to the Find a League link to see paid leagues."
    : "Only free leagues are listed here; paid ones are on the Find a League link."

  if (open.length === 0) {
    return [
      `Searched Find a League for: ${rawQuery.trim() || "any league"}. NO OPEN FREE LEAGUE MATCHED.`,
      "Say so plainly; do not invent leagues. Suggest loosening one filter (team count, draft time, league type) or creating their own league.",
      paidNote,
      `Find a League with this search: ${pageUrl}`,
    ].join("\n")
  }

  const lines = open.slice(0, SHOWN).map((c, i) => `${i + 1}. ${describeLeague(c)}`)
  return [
    `Open leagues in Find a League for: ${rawQuery.trim() || "any league"} — ${open.length} with an open seat, best rank fit first.`,
    ...lines,
    open.length > SHOWN ? `${open.length - SHOWN} more on the page.` : "",
    paidNote,
    `Send them here to see all of them and join: ${pageUrl}`,
    "Only mention leagues listed above. Never promise a seat; the commissioner or the join step decides.",
  ]
    .filter(Boolean)
    .join("\n")
}

function describeLeague(c: DiscoveryCard): string {
  const facts = [
    c.sport,
    c.leagueStyle ? c.leagueStyle.replace(/_/g, " ") : null,
    `${c.maxMembers} teams`,
    `${c.maxMembers - c.memberCount} open`,
    c.draftType,
    c.draftDate ? `drafts ${c.draftDate.slice(0, 10)}` : "draft not scheduled",
    c.rankBand ? RANK_BAND_LABELS[c.rankBand] : null,
    c.vibes && c.vibes.length > 0 ? c.vibes.map(vibeLabel).join(", ") : null,
    c.joinMode === "request" ? `plays on ${platformLabel(c.externalPlatform)} (ask for a spot)` : null,
  ].filter(Boolean)
  return `${c.name} — ${facts.join(" · ")}`
}
