/**
 * "Have you had your rookie draft this season?" — the import confirm screen's question, and the one
 * rule that turns the answer into the draft status pick reads use.
 *
 * WHY. Which seasons' picks still exist (`upcomingDraftSeasons` in lib/league-trade-engine/
 * futurePickInventory.ts) turns on the league's status: only `pre_draft` / `drafting` keeps the current
 * season's picks. Sleeper reports that state itself. ESPN, MFL and Yahoo imports report `in_season` (or
 * `complete`) all year, so an MFL dynasty league imported before its rookie draft lost this season's
 * picks from its pick board, its trade tools and Draft HQ: they read as already used.
 *
 * WHAT IS STORED. `League.settings.rookieDraftDone = { season, done, confirmedByUserId, confirmedAt }`.
 * AF-owned (lib/league/afOwnedLeagueSettings.ts), so a re-import keeps it. It answers for ONE season:
 * when the league rolls to the next season the answer no longer applies and the platform's status is
 * read again, because a stale "done" would hide a whole draft's worth of picks.
 *
 * WHO WINS. A platform that reports the draft state (Sleeper) is live and wins; the question is not
 * even asked there. The answer only fills in for a platform that cannot say.
 */

export const ROOKIE_DRAFT_DONE_KEY = 'rookieDraftDone'

export type RookieDraftDoneRecord = {
  season: number
  done: boolean
  confirmedByUserId: string
  confirmedAt: string
}

/** The draft state a platform reported, or null when it does not report one. */
export function rookieDraftStateFromPlatform(
  platform: string | null | undefined,
  status: string | null | undefined,
): 'done' | 'not_done' | null {
  if (String(platform ?? '').trim().toLowerCase() !== 'sleeper') return null
  const s = String(status ?? '').trim().toLowerCase()
  if (s === 'pre_draft' || s === 'drafting') return 'not_done'
  if (s === 'in_season' || s === 'complete') return 'done'
  return null
}

/** The stored answer for this season; null when there is none, or it was for another season. */
export function readRookieDraftDone(settings: unknown, season: number | null | undefined): boolean | null {
  if (season == null) return null
  const raw = settings && typeof settings === 'object' ? (settings as Record<string, unknown>)[ROOKIE_DRAFT_DONE_KEY] : null
  const r = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : null
  if (!r || r.season !== season || typeof r.done !== 'boolean') return null
  return r.done
}

export function buildRookieDraftDoneRecord(args: {
  season: number
  done: boolean
  userId: string
  now?: Date
}): RookieDraftDoneRecord {
  return {
    season: args.season,
    done: args.done,
    confirmedByUserId: args.userId,
    confirmedAt: (args.now ?? new Date()).toISOString(),
  }
}

/**
 * The status to decide which drafts are still ahead. The platform's own draft state when it has one,
 * else the commissioner's answer for this season, else the platform's status unchanged.
 */
export function effectiveDraftStatus(args: {
  platform: string | null | undefined
  providerStatus: string | null | undefined
  settings: unknown
  leagueSeason: number | null | undefined
}): string | null {
  const provider = args.providerStatus ?? null
  if (rookieDraftStateFromPlatform(args.platform, provider) != null) return provider
  const answer = readRookieDraftDone(args.settings, args.leagueSeason)
  if (answer === true) return 'in_season'
  if (answer === false) return 'pre_draft'
  return provider
}

/** League types with a yearly rookie draft. */
const ROOKIE_DRAFT_TYPES = new Set(['dynasty', 'c2c', 'devy'])

export function hasRookieDraft(leagueType: string | null | undefined): boolean {
  return ROOKIE_DRAFT_TYPES.has(String(leagueType ?? '').trim().toLowerCase())
}
