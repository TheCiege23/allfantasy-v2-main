import { prisma } from "@/lib/prisma"
import { LEAGUE_VISIBILITY_KEY, leagueAudience } from "@/lib/league-privacy/leagueAudience"
import { isNativePlatform } from "./externalListing"

/**
 * Private AllFantasy leagues in Find a League: listed, joined by the commissioner's approval.
 *
 *   public league   → listed, joined with its published code (DiscoveryQueryLayer, unchanged)
 *   private league  → listed with SAFE FIELDS ONLY; "Ask to join" writes a FindLeagueSpotRequest
 *                     (the same row and notification the other-platform listing uses); the
 *                     commissioner approves; the player then joins through POST /api/leagues/join
 *                     `{ action: 'join_approved_request', leagueId }`
 *   invite link     → still joins directly; the commissioner handed it out, which is the invitation
 *
 * ⚠ A PRIVATE CARD MUST NEVER CARRY THE JOIN CODE. The code is what turns a request into a join:
 * a card with `/join?code=` on it would make every private league open to anyone who looks. The
 * card also carries no description, commissioner identity, vibes, AI features or detail link —
 * everything a non-member can read about the league is on this list:
 *
 *   name · sport · format · season · team count · seats held · draft status / type / date ·
 *   paid flag and entry fee (needed so a paid league is still withheld where paid leagues are
 *   restricted, and so nobody asks to join without knowing it costs money)
 *
 * WHICH private leagues are listed is deliberately narrow, because nobody opted in to this:
 *   - made on AllFantasy (an imported league's seats are on the other platform);
 *   - `league_privacy_visibility` is EXPLICITLY "private" — unset is legacy or a structural league
 *     (tournaments, Exile Island, transfers), `invite_only` and `password_protected` are the
 *     commissioner saying "only people I invite";
 *   - not created "Unlisted" in the wizard (`settings.visibility === "unlisted"`; canonical creation
 *     stores that as "private", so this is the only place the choice survives);
 *   - not removed from the League finder by its commissioner (`leagueFinderDelistedAt`);
 *   - has an open seat and has not started drafting (isPrivateListingOpen).
 */

export const PRIVATE_JOIN_MODE = "approval" as const

function toRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {}
}

/** Is this league one Find a League lists as "private — ask to join"? Pure; seats and draft are separate. */
export function isPrivateRequestableLeague(league: { platform: string | null | undefined; settings: unknown }): boolean {
  if (!isNativePlatform(league.platform)) return false
  const s = toRecord(league.settings)
  if (leagueAudience(s) !== "private") return false
  if (String(s[LEAGUE_VISIBILITY_KEY] ?? "").trim().toLowerCase() !== "private") return false
  if (String(s.visibility ?? "").trim().toLowerCase() === "unlisted") return false
  if (s.leagueFinderDelistedAt) return false
  return true
}

/** Still recruiting: a seat is open and the draft has not started. Pure. */
export function isPrivateListingOpen(args: {
  seatsHeld: number
  leagueSize: number | null | undefined
  draftStatus: string | null | undefined
}): boolean {
  const size = Number(args.leagueSize ?? 0)
  if (!Number.isFinite(size) || size <= 0) return false
  if (args.seatsHeld >= size) return false
  const status = String(args.draftStatus ?? "").trim().toLowerCase()
  return !status || status === "pre_draft"
}

export type ApprovedRequestResolution =
  | { ok: true; leagueId: string; alreadyMember: boolean }
  | { ok: false; status: number; error: string; code: string }

/**
 * May this player take a seat in `leagueId` because its commissioner approved their request?
 * Used by POST /api/leagues/join; the seat itself is written there, under every usual gate.
 */
export async function resolveApprovedRequestLeague(rawLeagueId: unknown, userId: string): Promise<ApprovedRequestResolution> {
  const leagueId = typeof rawLeagueId === "string" ? rawLeagueId.trim() : ""
  if (!leagueId) return { ok: false, status: 400, error: "Missing leagueId", code: "MISSING_LEAGUE" }

  const [league, request, roster] = await Promise.all([
    prisma.league.findUnique({ where: { id: leagueId }, select: { id: true, platform: true } }),
    prisma.findLeagueSpotRequest.findUnique({
      where: { leagueId_requesterUserId: { leagueId, requesterUserId: userId } },
      select: { status: true },
    }),
    prisma.roster.findUnique({
      where: { leagueId_platformUserId: { leagueId, platformUserId: userId } },
      select: { id: true },
    }),
  ])
  if (!league || !isNativePlatform(league.platform)) {
    return { ok: false, status: 404, error: "League not found", code: "LEAGUE_NOT_FOUND" }
  }
  if (roster) return { ok: true, leagueId, alreadyMember: true }
  if (request?.status === "accepted") return { ok: true, leagueId, alreadyMember: false }
  if (request?.status === "pending") {
    return { ok: false, status: 403, error: "Your request is waiting for the commissioner.", code: "REQUEST_PENDING" }
  }
  if (request?.status === "declined") {
    return { ok: false, status: 403, error: "The commissioner passed on your request.", code: "REQUEST_DECLINED" }
  }
  return { ok: false, status: 403, error: "Ask the commissioner to join this league first.", code: "NOT_APPROVED" }
}
