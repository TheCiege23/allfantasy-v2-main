import type { DraftContext } from '@/lib/adp/computeAllFantasyAdp'

/**
 * ONE derivation of the AllFantasy ADP context tuple, shared by the writer and every reader.
 *
 * 🛑 THIS EXISTS BECAUSE THE WRITER AND THE READER DISAGREED, AND THE DISAGREEMENT WAS SILENT.
 * `contextHash` is a sha256 over all seven fields, so a single differing field means a reader
 * finds ZERO rows for a player the recompute wrote moments earlier. There is no partial match and
 * no error — just an empty result.
 *
 * And an empty result is indistinguishable from the legitimate one. `readSnapshotForLeague` never
 * falls back to market ADP by design, so the UI renders em-dashes — which is exactly what it is
 * supposed to render when we genuinely have no samples. A hash mismatch therefore looks like the
 * feature working correctly on a cold table.
 *
 * The three fields that actually differed, before this module:
 *
 *   draftType   writer read `DraftSession.draftType`; the reader read `settings.draft.type`
 *               and defaulted to 'snake'. Nothing keeps those two in step.
 *   teamCount   writer read `DraftSession.teamCount`; the reader read `League.leagueSize`,
 *               which is nullable and defaulted to 12. A 10-team league with a null leagueSize
 *               was written as 10 and read as 12.
 *   leagueType  writer lowercased `leagueVariant`; the reader passed it through raw, so a stored
 *               "Dynasty" was written as `dynasty` and read as `Dynasty`.
 *
 * ⚠ THE DRAFT SESSION WINS WHERE IT EXISTS, AND THAT IS NOT ARBITRARY. The snapshot is an
 * aggregate of picks, and those picks came from a session. The session's own `draftType` and
 * `teamCount` describe the draft that produced them; `League.leagueSize` describes the league
 * today, which is a different question and can differ after an expansion. Anything reading a board
 * must ask under the same terms the board was written under.
 *
 * `DraftSession.leagueId` is `@unique`, so a league has at most one session and "the session"
 * is never ambiguous.
 */

/** The League columns this derivation needs. Kept explicit so a caller's `select` cannot drift. */
export interface DraftContextLeague {
  sport: string
  season: number
  scoring: string | null
  isDynasty: boolean
  leagueVariant: string | null
  leagueSize: number | null
  /** Optional; only consulted for `draftType` when there is no session. */
  settings?: unknown
}

/** The DraftSession columns this derivation needs. Null when the league has no session. */
export interface DraftContextSession {
  draftType: string | null
  teamCount: number | null
}

export interface BuildDraftContextInput {
  league: DraftContextLeague
  session?: DraftContextSession | null
  /** Explicit season override (CLI / historical reads). Falls back to `league.season`. */
  season?: string | null
}

/** Default when neither a session nor league settings name one. */
export const DEFAULT_DRAFT_TYPE = 'snake'
/** Default when neither a session nor `League.leagueSize` gives a size. */
export const DEFAULT_TEAM_COUNT = 12
/** Default when `League.scoring` is null. */
export const DEFAULT_SCORING_FORMAT = 'ppr'

function draftTypeFromSettings(settings: unknown): string | null {
  if (!settings || typeof settings !== 'object') return null
  const draft = (settings as { draft?: unknown }).draft
  if (!draft || typeof draft !== 'object') return null
  const type = (draft as { type?: unknown }).type
  const s = typeof type === 'string' ? type.trim() : ''
  return s ? s : null
}

export function buildDraftContext(input: BuildDraftContextInput): DraftContext {
  const { league, session } = input

  const variant = (league.leagueVariant ?? '').trim().toLowerCase()
  const leagueType = variant || (league.isDynasty ? 'dynasty' : 'redraft')

  const draftType = (
    (session?.draftType ?? '').trim() ||
    draftTypeFromSettings(league.settings) ||
    DEFAULT_DRAFT_TYPE
  ).toLowerCase()

  /*
   * A session team count of 0 is not a team count. `??` alone would accept it, so the guard is on
   * "is this a usable positive number", not merely "is this non-null".
   */
  const sessionTeams =
    typeof session?.teamCount === 'number' && session.teamCount > 0 ? session.teamCount : null
  const leagueTeams =
    typeof league.leagueSize === 'number' && league.leagueSize > 0 ? league.leagueSize : null
  const teamCount = sessionTeams ?? leagueTeams ?? DEFAULT_TEAM_COUNT

  const season =
    input.season != null && String(input.season).trim()
      ? String(input.season).trim()
      : String(league.season)

  return {
    sport: String(league.sport).toUpperCase(),
    leagueType,
    draftType,
    scoringFormat: String(league.scoring ?? DEFAULT_SCORING_FORMAT).toLowerCase(),
    rosterFormat: 'standard',
    teamCount,
    season,
  }
}
