/**
 * Weekly recap review (docs/AF_COMMISSIONER_SETTINGS_SPEC.md §3, idea 6) — pure rules.
 *
 * The Tuesday recap (`/api/cron/weekly-awards`) normally posts itself. In REVIEW mode the cron
 * writes the recap as a draft instead and tells the commissioners; one of them edits it and posts
 * it, or discards it. Optionally, a draft nobody touched posts itself on the Wednesday-morning run
 * of the daily commissioner job, so a busy commissioner never costs the league its recap.
 *
 * Default is AUTO — exactly what every league has today. Nothing changes until a commissioner picks
 * review.
 */

export const REVIEW_SETTINGS_KEY = 'weekly_recap_review'
export const DRAFT_PREFIX = 'recap-draft:v1:'
export const DRAFT_TTL_MS = 30 * 86_400_000
/** A draft must be at least this old before the daily run may post it untouched. */
export const AUTO_POST_MIN_AGE_MS = 12 * 3600_000
export const RECAP_TEXT_MAX = 6000

export type RecapReviewSettings = {
  mode: 'auto' | 'review'
  /** In review mode: post an untouched draft on the next morning's run. */
  autoPostIfUntouched: boolean
}

export type RecapDraft = {
  version: 1
  leagueId: string
  leagueName: string
  ownerUserId: string
  /** Set for imported Sleeper leagues: the post writes its legacy dedupe key too. */
  sleeperLeagueId: string | null
  season: string
  week: number
  /** What the generator wrote. */
  generatedText: string
  /** The commissioner's edit, when there is one. */
  editedText: string | null
  editedBy: string | null
  generatedAt: string
  status: 'pending' | 'posted' | 'discarded'
  closedAt: string | null
  closedBy: string | null
  /** True when the daily run posted it because nobody reviewed it. */
  autoPosted: boolean
}

const asRecord = (v: unknown): Record<string, unknown> =>
  v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {}

export function readRecapReview(settings: unknown): RecapReviewSettings {
  const raw = asRecord(asRecord(settings)[REVIEW_SETTINGS_KEY])
  return { mode: raw.mode === 'review' ? 'review' : 'auto', autoPostIfUntouched: raw.autoPostIfUntouched !== false }
}

export function parseRecapReview(v: unknown): RecapReviewSettings | null {
  const r = asRecord(v)
  if (r.mode !== 'auto' && r.mode !== 'review') return null
  return { mode: r.mode, autoPostIfUntouched: r.autoPostIfUntouched !== false }
}

export function draftKey(leagueId: string, season: string | number, week: number): string {
  return `${DRAFT_PREFIX}${leagueId}:${season}:${week}`
}

export function draftLeaguePrefix(leagueId: string): string {
  return `${DRAFT_PREFIX}${leagueId}:`
}

export function newDraft(input: Omit<RecapDraft, 'version' | 'editedText' | 'editedBy' | 'status' | 'closedAt' | 'closedBy' | 'autoPosted' | 'generatedAt'>, now: Date): RecapDraft {
  return { version: 1, ...input, editedText: null, editedBy: null, generatedAt: now.toISOString(), status: 'pending', closedAt: null, closedBy: null, autoPosted: false }
}

export function readDraft(v: unknown): RecapDraft | null {
  const r = asRecord(v)
  if (r.version !== 1 || typeof r.leagueId !== 'string' || typeof r.generatedText !== 'string' || typeof r.week !== 'number') return null
  return r as unknown as RecapDraft
}

/** The text that would be posted: the commissioner's edit, else what was generated. */
export function draftText(d: RecapDraft): string {
  return d.editedText ?? d.generatedText
}

/** Cleans a commissioner's edit. Empty is refused: an empty recap is a discard, said plainly. */
export function cleanRecapText(v: unknown): string | null {
  if (typeof v !== 'string') return null
  const t = v.replace(/\r\n/g, '\n').trim().slice(0, RECAP_TEXT_MAX)
  return t.length > 0 ? t : null
}

/** Whether the daily run should post this draft for the league as nobody reviewed it. */
export function shouldAutoPost(d: RecapDraft, review: RecapReviewSettings, now: Date): boolean {
  return (
    d.status === 'pending' &&
    review.mode === 'review' &&
    review.autoPostIfUntouched &&
    d.editedText === null &&
    now.getTime() - Date.parse(d.generatedAt) >= AUTO_POST_MIN_AGE_MS
  )
}
