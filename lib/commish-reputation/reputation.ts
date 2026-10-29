/**
 * Commish reputation (docs/AF_COMMISSIONER_SETTINGS_SPEC.md §3, idea 10) — pure.
 *
 * Managers already rate their commissioner once a season (five 1–5 questions, stored per league in
 * `League.settings.commissioner_ratings`). Until now nothing read those ratings back except the one
 * league's own rate page. This rolls them up ACROSS every league a commissioner runs, and earns the
 * "well-run league" badge a commissioner can show on their public listings — the open-teams board and
 * league discovery — to recruit managers.
 *
 * ⚠ THE BADGE IS EARNED ON VOLUME AS WELL AS SCORE. Three friends rating a brand-new league 5/5 is not a
 * reputation. A commissioner needs `MIN_RATINGS` ratings (from at least `MIN_RATERS` different
 * managers) before any score is shown publicly at all; below that the public sees "new commissioner",
 * never a number.
 *
 * ⚠ OPT-IN. Nothing here is public unless the commissioner switches it on for the league being listed
 * (`commissioner_reputation_public`). Ratings are anonymous: no rater id or comment ever leaves this
 * module in a public shape.
 */

export const RATING_QUESTIONS = [
  { id: 'fairness', label: 'How fair was the commissioner in handling league decisions?' },
  { id: 'communication', label: 'How well did the commissioner communicate with league members?' },
  { id: 'responsiveness', label: 'How responsive was the commissioner to issues and questions?' },
  { id: 'organization', label: 'How well-organized was the league this season?' },
  { id: 'enjoyment', label: 'Overall, how much did you enjoy this league?' },
] as const

export type QuestionId = (typeof RATING_QUESTIONS)[number]['id']

export const RATINGS_KEY = 'commissioner_ratings'
export const PUBLIC_KEY = 'commissioner_reputation_public'

/** Public score needs this much evidence. */
export const MIN_RATINGS = 5
export const MIN_RATERS = 3
/** "Well-run league" badge: an average of at least this, on the 1–5 scale. */
export const WELL_RUN_MIN = 4.2
/** Entries kept per league; oldest dropped first. */
export const STORED_MAX = 400

export type RatingEntry = {
  userId: string
  season: number
  ratings: Record<string, number>
  comment: string | null
  submittedAt: string
}

export function readEntries(settings: unknown): RatingEntry[] {
  const s = settings && typeof settings === 'object' ? (settings as Record<string, unknown>) : {}
  const store = s[RATINGS_KEY] as { entries?: unknown } | undefined
  if (!store || !Array.isArray(store.entries)) return []
  return store.entries.filter((e): e is RatingEntry => {
    const x = e as Partial<RatingEntry>
    return typeof x?.userId === 'string' && typeof x.season === 'number' && !!x.ratings && typeof x.ratings === 'object'
  })
}

export function isPublic(settings: unknown): boolean {
  return Boolean(settings && typeof settings === 'object' && (settings as Record<string, unknown>)[PUBLIC_KEY] === true)
}

export type ValidationError = 'ratings_required' | `invalid_${QuestionId}`

/** Every question must be a whole 1–5. */
export function validateRatings(raw: unknown): { ok: true; ratings: Record<QuestionId, number> } | { ok: false; error: ValidationError } {
  if (!raw || typeof raw !== 'object') return { ok: false, error: 'ratings_required' }
  const r = raw as Record<string, unknown>
  const out = {} as Record<QuestionId, number>
  for (const q of RATING_QUESTIONS) {
    const v = r[q.id]
    if (typeof v !== 'number' || !Number.isInteger(v) || v < 1 || v > 5) return { ok: false, error: `invalid_${q.id}` }
    out[q.id] = v
  }
  return { ok: true, ratings: out }
}

/** One entry's own average across the questions it answered. */
function entryScore(e: RatingEntry): number | null {
  const vals = RATING_QUESTIONS.map((q) => e.ratings[q.id]).filter((v): v is number => typeof v === 'number' && v >= 1 && v <= 5)
  return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null
}

export type Summary = {
  ratings: number
  raters: number
  leagues: number
  /** Mean of each rating's own average, 1–5; null with no ratings. */
  overall: number | null
  byQuestion: Record<QuestionId, number | null>
  seasons: number[]
}

const round1 = (n: number) => Math.round(n * 10) / 10

/** Roll ratings up across leagues. Each league's entries count once each. */
export function summarize(leagues: ReadonlyArray<{ leagueId: string; entries: readonly RatingEntry[] }>): Summary {
  const all = leagues.flatMap((l) => l.entries.map((e) => ({ ...e, leagueId: l.leagueId })))
  const scores = all.map(entryScore).filter((s): s is number => s != null)
  const byQuestion = {} as Record<QuestionId, number | null>
  for (const q of RATING_QUESTIONS) {
    const vals = all.map((e) => e.ratings[q.id]).filter((v): v is number => typeof v === 'number' && v >= 1 && v <= 5)
    byQuestion[q.id] = vals.length ? round1(vals.reduce((a, b) => a + b, 0) / vals.length) : null
  }
  return {
    ratings: scores.length,
    raters: new Set(all.map((e) => e.userId)).size,
    leagues: new Set(all.map((e) => e.leagueId)).size,
    overall: scores.length ? round1(scores.reduce((a, b) => a + b, 0) / scores.length) : null,
    byQuestion,
    seasons: [...new Set(all.map((e) => e.season))].sort((a, b) => b - a),
  }
}

export type PublicReputation =
  | { kind: 'new'; ratings: number }
  | { kind: 'rated'; overall: number; ratings: number; leagues: number; wellRun: boolean }

/** The only shape that is ever shown to people outside the league. */
export function publicReputation(s: Summary): PublicReputation {
  if (s.ratings < MIN_RATINGS || s.raters < MIN_RATERS || s.overall == null) return { kind: 'new', ratings: s.ratings }
  return { kind: 'rated', overall: s.overall, ratings: s.ratings, leagues: s.leagues, wellRun: s.overall >= WELL_RUN_MIN }
}

/** Append one rating, keeping the newest `STORED_MAX`. */
export function appendEntry(entries: readonly RatingEntry[], entry: RatingEntry): RatingEntry[] {
  return [...entries, entry].slice(-STORED_MAX)
}
