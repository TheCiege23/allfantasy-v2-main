import type { DraftContext } from '@/lib/adp/computeAllFantasyAdp'

/**
 * ONE derivation of the AllFantasy ADP context tuple, shared by the writer and every reader.
 *
 * ð THIS EXISTS BECAUSE THE WRITER AND THE READER DISAGREED, AND THE DISAGREEMENT WAS SILENT.
 * `contextHash` is a sha256 over all seven fields, so a single differing field means a reader
 * finds ZERO rows for a player the recompute wrote moments earlier. There is no partial match and
 * no error â just an empty result.
 *
 * And an empty result is indistinguishable from the legitimate one. `readSnapshotForLeague` never
 * falls back to market ADP by design, so the UI renders em-dashes â which is exactly what it is
 * supposed to render when we genuinely have no samples. A hash mismatch therefore looks like the
 * feature working correctly on a cold table.
 *
 * The TWO fields that actually differed, before this module:
 *
 *   draftType   writer read `DraftSession.draftType`; the reader read `settings.draft.type`
 *               and defaulted to 'snake'. Nothing keeps those two in step, and they are
 *               different VALUES ('linear' vs 'snake'), not different spellings.
 *   teamCount   writer read `DraftSession.teamCount`; the reader read `League.leagueSize`,
 *               which is nullable and defaulted to 12. A 10-team league with a null leagueSize
 *               was written as 10 and read as 12.
 *
 * ⚠ AN EARLIER VERSION OF THIS COMMENT CLAIMED A THIRD: that the writer lowercased
 * `leagueVariant` while the reader passed it through raw, so "Dynasty" and "dynasty" produced
 * different hashes. THAT WAS WRONG. `buildContextHash` lowercases `leagueType` itself (along with
 * draftType, scoringFormat and rosterFormat, and it uppercases sport), so casing on any of those
 * cannot change a hash. Both sides also read the same column. The lowercasing below is kept
 * because a canonical context object is worth having on its own terms - it is just not what was
 * broken. Recorded rather than quietly deleted: the claim reached a commit message.
 *
 * â  THE DRAFT SESSION WINS WHERE IT EXISTS, AND THAT IS NOT ARBITRARY. The snapshot is an
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
  /** `'rookies_only'` / `'rookie'` mark a rookie draft, which gets its own board (see `buildDraftContext`). */
  playerPool?: string | null
}

export interface BuildDraftContextInput {
  league: DraftContextLeague
  session?: DraftContextSession | null
  /** Explicit season override (CLI / historical reads). Falls back to `league.season`. */
  season?: string | null
  /**
   * When the caller knows the QB format from somewhere other than league settings (a mock draft's own options).
   * Absent: read from `league.settings` (`rosterFormatFromSettings`).
   */
  superflex?: boolean | null
  /** A rookie draft known by other evidence (an imported draft too short to be a startup). */
  rookieDraft?: boolean | null
}

const SUPERFLEX_RE = /super[_\s-]?flex|sflex|2qb|two[_\s-]?qb/i
const FOOTBALL = new Set(['NFL', 'NCAAF'])

/**
 * SUPERFLEX OR 1QB, FROM THE LEAGUE'S OWN SETTINGS (2026-11-22: AF ADP split the two boards).
 *
 * 🛑 THE SPLIT IS THE POINT. A quarterback goes rounds earlier in a superflex draft; pooling both formats put
 * every QB's AF ADP somewhere between the two, right for neither. Read from every shape league settings carry:
 * the sport config toggle (native), a Sleeper-style `roster_positions` list (a `SUPER_FLEX` slot, or two plain
 * `QB` starters — FantasyCalc treats both as `numQbs: 2`, see `trade-value/superflexResolution.ts`), and the
 * imported `roster_format_type` label. Nothing found = standard: the assumption that cannot move a QB up.
 */
export function rosterFormatFromSettings(settings: unknown): 'superflex' | 'standard' {
  if (!settings || typeof settings !== 'object') return 'standard'
  const s = settings as Record<string, unknown>
  const sc = (s.sportConfig && typeof s.sportConfig === 'object' ? s.sportConfig : {}) as Record<string, unknown>
  if (sc.enableSuperflex === true) return 'superflex'
  if (typeof s.roster_format_type === 'string' && SUPERFLEX_RE.test(s.roster_format_type)) return 'superflex'
  const positions = Array.isArray(s.roster_positions) ? s.roster_positions : Array.isArray(s.rosterPositions) ? s.rosterPositions : null
  if (positions) {
    const slots = positions.map((p) => String(p ?? '').trim().toUpperCase())
    if (slots.includes('SUPER_FLEX') || slots.includes('SUPERFLEX') || slots.includes('OP')) return 'superflex'
    if (slots.filter((p) => p === 'QB').length >= 2) return 'superflex'
  }
  return 'standard'
}

/** A session whose player pool is rookies only is a rookie draft. */
export function isRookiePool(playerPool: string | null | undefined): boolean {
  const p = String(playerPool ?? '').trim().toLowerCase()
  return p === 'rookies_only' || p === 'rookie' || p === 'rookies'
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

  const sport = String(league.sport).toUpperCase()
  /*
   * 🛑 A ROOKIE DRAFT IS NOT A STARTUP, so it gets its own board. In a rookie draft the best rookie goes 1.01; pooled
   * into the dynasty startup board, every rookie looked like a first-round startup pick.
   */
  const rookie = input.rookieDraft === true || isRookiePool(session?.playerPool)

  const context: DraftContext = {
    sport,
    leagueType: rookie ? `${leagueType}:rookie` : leagueType,
    draftType,
    scoringFormat: String(league.scoring ?? DEFAULT_SCORING_FORMAT).toLowerCase(),
    rosterFormat: 'standard',
    teamCount,
    season,
  }
  /*
   * Superflex is a football question; every other sport's board stays 'standard'. An explicit answer from the
   * caller wins over settings (a mock draft has no league settings to read).
   */
  if (FOOTBALL.has(sport)) {
    const superflex = input.superflex != null ? input.superflex : rosterFormatFromSettings(league.settings) === 'superflex'
    if (superflex) context.rosterFormat = 'superflex'
  }
  return context
}
