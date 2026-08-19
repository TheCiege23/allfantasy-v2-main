import type { DraftTypeId } from '@/lib/league-creation-wizard/types'
import { resolveDraftIntroStemFromWizardId, resolveDraftSelectionVideoUrl } from '@/lib/draft/draft-intro-video'

export type DraftTypeMedia = {
  selectionVideo: string
  thumbnail: string
  thumbnailFallback: string
  /** Default imagery for draft-type previews / room chrome */
  defaultDraftImageUrl: string
}

const FALLBACK = '/af-crest.png'

/** Human-readable packaged thumbnails under /media/create-league/drafts/thumbnails/ */
const DRAFT_PACKAGED_THUMB_LABEL: Record<string, string> = {
  snake: 'Snake Draft',
  linear: 'Linear Draft',
  auction: 'Auction Draft',
}

/** Legacy row art when no packaged thumbnail applies */
const DRAFT_TYPE_MEDIA_MAP: Record<string, Omit<DraftTypeMedia, 'selectionVideo'>> = {
  snake: {
    thumbnail: '/images/draft-types/snake-draft.png',
    defaultDraftImageUrl: '/images/draft-types/snake-draft.png',
    thumbnailFallback: FALLBACK,
  },
  linear: {
    thumbnail: '/league-type-keeper.png',
    defaultDraftImageUrl: '/league-type-keeper.png',
    thumbnailFallback: FALLBACK,
  },
  auction: {
    thumbnail: '/league-type-salary-cap.png',
    defaultDraftImageUrl: '/league-type-salary-cap.png',
    thumbnailFallback: FALLBACK,
  },
  slow_draft: {
    thumbnail: '/league-type-best-ball.png',
    defaultDraftImageUrl: '/league-type-best-ball.png',
    thumbnailFallback: FALLBACK,
  },
  mock_draft: {
    thumbnail: '/league-type-dynasty.png',
    defaultDraftImageUrl: '/league-type-dynasty.png',
    thumbnailFallback: FALLBACK,
  },
  devy_snake: {
    thumbnail: '/league-type-devy.png',
    defaultDraftImageUrl: '/league-type-devy.png',
    thumbnailFallback: FALLBACK,
  },
  devy_linear: {
    thumbnail: '/league-type-devy.png',
    defaultDraftImageUrl: '/league-type-devy.png',
    thumbnailFallback: FALLBACK,
  },
  devy_auction: {
    thumbnail: '/league-type-devy.png',
    defaultDraftImageUrl: '/league-type-devy.png',
    thumbnailFallback: FALLBACK,
  },
  c2c_snake: {
    thumbnail: '/league-type-c2c.png',
    defaultDraftImageUrl: '/league-type-c2c.png',
    thumbnailFallback: FALLBACK,
  },
  c2c_linear: {
    thumbnail: '/league-type-c2c.png',
    defaultDraftImageUrl: '/league-type-c2c.png',
    thumbnailFallback: FALLBACK,
  },
  c2c_auction: {
    thumbnail: '/league-type-c2c.png',
    defaultDraftImageUrl: '/league-type-c2c.png',
    thumbnailFallback: FALLBACK,
  },
}

/** Ordered thumbnail URL tries for Segmented / hero poster — first shipped wins at runtime via img onError elsewhere. */
export function getDraftThumbnailCandidates(id: DraftTypeId): readonly string[] {
  const stem = resolveDraftIntroStemFromWizardId(id)
  const ordered: string[] = []
  const seen = new Set<string>()
  const push = (u: string) => {
    if (!seen.has(u)) {
      seen.add(u)
      ordered.push(u)
    }
  }

  if (stem) {
    // Only `snake`/`linear`/`auction` have packaged thumbnails under
    // /public/media/create-league/drafts/thumbnails/ (Title Case, verified on disk).
    // Other draft types (auto, offline, mock_draft, ...) have no packaged file at
    // any name, so guessing bare-stem filenames here only produced guaranteed 404s
    // before falling through to `row.thumbnail` below.
    const label = DRAFT_PACKAGED_THUMB_LABEL[stem]
    if (label) {
      for (const ext of ['png', 'jpg', 'webp'] as const) {
        push(`/media/create-league/drafts/thumbnails/${label}.${ext}`)
      }
    }
  }

  const row = DRAFT_TYPE_MEDIA_MAP[id] ?? DRAFT_TYPE_MEDIA_MAP.snake!
  push(row.thumbnail)

  return ordered
}

export function getDraftTypeMedia(id: DraftTypeId): DraftTypeMedia {
  const selectionVideo = resolveDraftSelectionVideoUrl(id)
  const row = DRAFT_TYPE_MEDIA_MAP[id] ?? DRAFT_TYPE_MEDIA_MAP.snake!
  const candidates = getDraftThumbnailCandidates(id)
  const thumb = candidates[0] ?? row.thumbnail
  return {
    ...row,
    selectionVideo,
    thumbnail: thumb,
    thumbnailFallback: row.thumbnailFallback ?? FALLBACK,
  }
}
