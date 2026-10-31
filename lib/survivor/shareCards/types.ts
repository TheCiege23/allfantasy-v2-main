/**
 * Survivor share cards (handoff 74d0a46e). Shared, framework-free types and constants.
 * Safe to import from client components: no prisma, no node built-ins.
 */

export const SHARE_MOMENT_TYPES = ['immunity', 'out', 'idol', 'exile', 'champ', 'recap'] as const
export type ShareMomentType = (typeof SHARE_MOMENT_TYPES)[number]

export const SHARE_CARD_FORMATS = ['post', 'story', 'link'] as const
export type ShareCardFormat = (typeof SHARE_CARD_FORMATS)[number]

/** Exact export sizes from the handoff README. */
export const SHARE_CARD_SIZES: Record<ShareCardFormat, { width: number; height: number }> = {
  post: { width: 1080, height: 1350 },
  story: { width: 1080, height: 1920 },
  link: { width: 1200, height: 630 },
}

export function isShareMomentType(value: unknown): value is ShareMomentType {
  return typeof value === 'string' && (SHARE_MOMENT_TYPES as readonly string[]).includes(value)
}

export function parseShareCardFormat(value: unknown): ShareCardFormat {
  return typeof value === 'string' && (SHARE_CARD_FORMATS as readonly string[]).includes(value) ? (value as ShareCardFormat) : 'post'
}

/**
 * Published facts captured when the moment is created. Every field here was already shown to the
 * league (a display name, a final tally read at the Torch Ceremony, finalized points). There is
 * deliberately no field for a voter, a ballot, or an idol that has not been played.
 */
export interface ShareMomentPayload {
  v: 1
  displayName: string
  leagueName: string
  /** League sport code, e.g. NFL, NBA, NHL, MLB, SOCCER, NCAAF, NCAAB. */
  sport: string
  season: number
  tribeName: string | null
  /** Whitelisted `/survivor/tribes/crests/...` path, or null. */
  crestPath: string | null
  /** immunity: week points. out/champ: season points. */
  points?: number | null
  /** immunity: finish inside the tribe (pre-merge) or the island (post-merge). */
  rank?: number | null
  rankScope?: 'tribe' | 'island'
  /** immunity/champ: immunity wins this season, including this one. */
  immunityWins?: number | null
  /** out: the final public tally, e.g. "2–1". champ: the jury tally, e.g. "3–1–1". */
  tally?: string | null
  /** out: weeks played. champ: season length in weeks. */
  weeks?: number | null
  /** out: where the manager goes next, when the league says so publicly. */
  next?: 'exile' | 'jury' | null
  /** idol: catalog id of the played power, its display name, and the published scroll effect. */
  idolId?: string | null
  idolName?: string | null
  idolProtective?: boolean
  votesCancelled?: number | null
  votesCounted?: number | null
  /** exile */
  tokens?: number | null
  exileWeeks?: number | null
  rejoinWeek?: number | null
  /**
   * recap: the league's week after Tribal Council, for every member to share. It names no manager —
   * only the tribe that attended (public) and counts — so it cannot share someone's exit for them.
   */
  remaining?: number | null
  onExile?: number | null
  merged?: boolean
}

export interface ShareMomentRecord {
  id: string
  leagueId: string
  type: ShareMomentType
  week: number
  subjectUserId: string
  subjectRosterId: string | null
  payload: ShareMomentPayload
  final: boolean
  publishedAt: Date | string | null
  createdAt: Date | string
}

/** What the share UI receives per moment. */
export interface ShareMomentListItem {
  id: string
  type: ShareMomentType
  week: number
  title: string
  subtitle: string
  iconPath: string
  headline: string
  offeredNote: string
  published: boolean
  pageUrl: string
  imageUrl: Record<ShareCardFormat, string>
  isSubject: boolean
}
