/**
 * Draft intro / selection clips for Create League + draft rooms.
 * Uses shipped assets under `/public/media/create-league/drafts/` and `/public/media/draft-intros/`.
 * Unknown stems fail closed (empty / null) so callers never crash on missing files.
 *
 * Two different clips, two different jobs — keep them apart:
 *   SELECTION — the short loop behind a draft-format tile and the create-league hero.
 *   INTRO     — the long cut that plays once, when the draft actually starts.
 * Where no long cut ships, the intro falls back to the selection loop, which is what every
 * format did before the snake and auction intros were wired.
 */

/**
 * Ordered clip URLs per format stem — first URL is the canonical primary hero clip.
 * Every path here is verified present on disk; a URL for a file that does not ship is not a
 * fallback, it is a guaranteed 404 that masks whatever sits behind it.
 */
export const DRAFT_SELECTION_VIDEO_BY_STEM: Record<string, readonly string[]> = {
  snake: ['/media/create-league/drafts/videos/Snake Draft.mp4'],
  linear: ['/media/create-league/drafts/videos/Linear Draft.mp4'],
  auction: ['/media/create-league/drafts/videos/Auction Draft.mp4'],
  auto: ['/media/create-league/drafts/videos/Auto Draft.mp4'],
  offline: ['/media/create-league/drafts/videos/Offline Draft.mp4'],
  weighted_lottery: ['/media/create-league/drafts/videos/Weighted Lottery.mp4'],
}

/**
 * Long-form intro cut, played once when a draft starts. Only these two stems ship one;
 * every other format falls back to its selection loop via {@link resolveDraftIntroVideoUrl}.
 *
 * ⚠ `/media/draft-intros/snake-draft-intro.mp4` is NOT snake's intro — it is byte-identical to
 * `/media/league-intros/redraft-league-intro.mp4` (verified with `cmp`, against a control that
 * differs). It sat in snake's fallback chain and is deliberately not referenced here.
 */
const DRAFT_INTRO_VIDEO_BY_STEM: Record<string, string> = {
  snake: '/media/create-league/drafts/videos/Snake Draft Intro.mp4',
  auction: '/media/draft-intros/Auction Draft Intro.mp4',
}

/** Poster / card / board imagery keyed by format STEM, so `devy_snake` and `c2c_linear` resolve too. */
const DRAFT_TYPE_IMAGE_BY_STEM: Record<string, string> = {
  snake: '/images/draft-types/snake-draft.png',
  linear: '/media/create-league/drafts/thumbnails/Linear Draft.png',
  auction: '/media/create-league/drafts/thumbnails/Auction Draft.png',
  auto: '/media/create-league/drafts/thumbnails/Auto Draft.png',
  offline: '/media/create-league/drafts/thumbnails/Offline Draft.png',
  weighted_lottery: '/media/create-league/drafts/thumbnails/Weighted Lottery.png',
}

export function normalizeDraftTypeKey(raw: unknown): string {
  return String(raw ?? '').trim().toLowerCase()
}

/**
 * Maps wizard ids (`devy_snake`, `slow_draft`, …) to a draft-format stem for media lookup.
 */
export function resolveDraftIntroStemFromWizardId(raw: unknown): string {
  const s = normalizeDraftTypeKey(raw)
  if (!s) return ''
  if (s === 'third_round_reversal' || s === 'third-round-reversal') return 'snake'
  if (s.includes('snake')) return 'snake'
  if (s.includes('linear')) return 'linear'
  if (s.includes('auction')) return 'auction'
  if (s === 'slow_draft' || s === 'slow') return 'slow'
  if (s === 'mock_draft' || s === 'mock') return 'mock'
  if (s === 'offline') return 'offline'
  if (s === 'auto') return 'auto'
  if (s.includes('rookie')) return 'rookie'
  if (s.includes('startup')) return 'startup'
  if (s.includes('weighted') && s.includes('lottery')) return 'weighted_lottery'
  if (s.includes('lottery')) return 'lottery'
  return s
}

/** Primary hero/list selection video for a wizard draft id (non-empty when shipped). */
export function resolveDraftSelectionVideoUrl(raw: unknown): string {
  const stem = resolveDraftIntroStemFromWizardId(raw)
  if (!stem) return ''
  const list = DRAFT_SELECTION_VIDEO_BY_STEM[stem]
  return list?.[0] ?? ''
}

/**
 * Clip for the draft-start overlay: the long intro cut where one ships, else the selection loop.
 * Null when the format has neither.
 */
export function resolveDraftIntroVideoUrl(draftTypeKey: unknown): string | null {
  const stem = resolveDraftIntroStemFromWizardId(draftTypeKey)
  if (!stem) return null
  const url = DRAFT_INTRO_VIDEO_BY_STEM[stem] ?? DRAFT_SELECTION_VIDEO_BY_STEM[stem]?.[0] ?? ''
  return url || null
}

export function resolveDraftIntroPosterUrl(draftTypeKey: unknown): string | null {
  const stem = resolveDraftIntroStemFromWizardId(draftTypeKey)
  if (!stem) return null
  return DRAFT_TYPE_IMAGE_BY_STEM[stem] ?? null
}

/** Room/board default artwork when no custom asset exists */
export function resolveDraftBoardImageUrl(draftTypeKey: unknown): string | null {
  return resolveDraftIntroPosterUrl(draftTypeKey)
}
