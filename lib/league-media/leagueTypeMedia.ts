import { resolveLeagueIntroFormatKey } from '@/lib/league/resolveLeagueIntroFormatKey'

type LeagueTypeMedia = {
  key: string
  label: string
  thumbnail: string
  /** Card / My Leagues fallback when the league has no custom logo */
  defaultLeagueImageUrl: string
  selectionVideo: string
  introVideo: string
  thumbnailFallback: string
}

const FALLBACK_THUMBNAIL = '/af-crest.svg'

const LEAGUE_TYPE_MEDIA_MAP: Record<string, Omit<LeagueTypeMedia, 'key'>> = {
  // The legacy redraft-league-intro.mp4 contains Guillotine artwork; use the packaged Redraft clip.
  redraft: {
    label: 'Redraft',
    thumbnail: '/images/league-types/redraft.png',
    /*
     * A redraft league with no logo of its own shows the robot king — the same art the commissioner
     * hub uses for redraft (lib/core-app/commissioner/leagueArt.ts). The shield above stays the
     * create-league card; as a league crest it read as one more "AF" letter mark (user call, 2026-10-30).
     */
    defaultLeagueImageUrl: '/league-art/af-robot-king.webp',
    selectionVideo: '/media/create-league/concept/videos/Redraft.mp4',
    introVideo: '/media/create-league/concept/videos/Redraft.mp4',
    thumbnailFallback: FALLBACK_THUMBNAIL,
  },
  dynasty: {
    label: 'Dynasty',
    thumbnail: '/league-type-dynasty.png',
    defaultLeagueImageUrl: '/league-art/league-type-dynasty.webp',
    selectionVideo: '/league-type-dynasty.mp4',
    introVideo: '/league-type-dynasty-intro.mp4',
    thumbnailFallback: FALLBACK_THUMBNAIL,
  },
  keeper: {
    label: 'Keeper',
    thumbnail: '/league-type-keeper.png',
    defaultLeagueImageUrl: '/league-art/league-type-keeper.webp',
    selectionVideo: '/league-type-keeper.mp4',
    introVideo: '/league-type-keeper-intro.mp4',
    thumbnailFallback: FALLBACK_THUMBNAIL,
  },
  best_ball: {
    label: 'Best Ball',
    thumbnail: '/league-type-best-ball.png',
    defaultLeagueImageUrl: '/league-art/league-type-best-ball.webp',
    selectionVideo: '/league-type-best-ball.mp4',
    introVideo: '/league-type-best-ball-intro.mp4',
    thumbnailFallback: FALLBACK_THUMBNAIL,
  },
  guillotine: {
    label: 'Guilly',
    thumbnail: '/league-type-guillotine.png',
    defaultLeagueImageUrl: '/league-art/league-type-guillotine.webp',
    selectionVideo: '/league-type-guillotine.mp4',
    introVideo: '/league-type-guillotine-intro.mp4',
    thumbnailFallback: FALLBACK_THUMBNAIL,
  },
  pirate: {
    label: 'Pirate League',
    thumbnail: '/images/league-types/pirate-hero.png',
    defaultLeagueImageUrl: '/league-art/pirate-hero.webp',
    selectionVideo: '/media/league-intros/pirate-claim.mp4',
    introVideo: '/media/league-intros/pirate-claim.mp4',
    thumbnailFallback: FALLBACK_THUMBNAIL,
  },
  survivor: {
    label: 'Survivor',
    thumbnail: '/league-type-survivor.png',
    defaultLeagueImageUrl: '/league-art/league-type-survivor.webp',
    selectionVideo: '/league-type-survivor.mp4',
    introVideo: '/league-type-survivor-intro.mp4',
    thumbnailFallback: FALLBACK_THUMBNAIL,
  },
  tournament: {
    label: 'Tournament',
    thumbnail: '/league-type-tournament.png',
    defaultLeagueImageUrl: '/league-art/league-type-tournament.webp',
    selectionVideo: '/league-type-tournament.mp4',
    introVideo: '/league-type-tournament.mp4',
    thumbnailFallback: FALLBACK_THUMBNAIL,
  },
  devy: {
    label: 'Devy',
    thumbnail: '/league-type-devy.png',
    defaultLeagueImageUrl: '/league-art/league-type-devy.webp',
    selectionVideo: '/league-type-devy.mp4',
    introVideo: '/league-type-devy-intro.mp4',
    thumbnailFallback: FALLBACK_THUMBNAIL,
  },
  c2c: {
    label: 'Campus to Canton (C2C)',
    thumbnail: '/league-type-c2c.png',
    defaultLeagueImageUrl: '/league-art/league-type-c2c.webp',
    selectionVideo: '/league-type-c2c.mp4',
    introVideo: '/league-type-c2c-intro.mp4',
    thumbnailFallback: FALLBACK_THUMBNAIL,
  },
  zombie: {
    label: 'Zombie',
    thumbnail: '/league-type-zombie.png',
    defaultLeagueImageUrl: '/league-art/league-type-zombie.webp',
    selectionVideo: '/league-type-zombie.mp4',
    introVideo: '/league-type-zombie-intro.mp4',
    thumbnailFallback: FALLBACK_THUMBNAIL,
  },
  salary_cap: {
    label: 'Salary Cap',
    thumbnail: '/league-type-salary-cap.png',
    defaultLeagueImageUrl: '/league-art/league-type-salary-cap.webp',
    selectionVideo: '/league-type-salary-cap.mp4',
    introVideo: '/league-type-salary-cap-intro.mp4',
    thumbnailFallback: FALLBACK_THUMBNAIL,
  },
  big_brother: {
    label: 'Big Brother',
    thumbnail: '/league-type-big-brother.png',
    defaultLeagueImageUrl: '/league-art/league-type-big-brother.webp',
    selectionVideo: '/league-type-big-brother.mp4',
    introVideo: '/league-type-big-brother-intro.mp4',
    thumbnailFallback: FALLBACK_THUMBNAIL,
  },
  idp: {
    label: 'IDP',
    thumbnail: '/league-type-idp.png',
    defaultLeagueImageUrl: '/league-art/league-type-idp.webp',
    selectionVideo: '/league-type-idp.mp4',
    introVideo: '/league-type-idp-intro.mp4',
    thumbnailFallback: FALLBACK_THUMBNAIL,
  },
}

const LEAGUE_TYPE_ALIASES: Record<string, string> = {
  bestball: 'best_ball',
  devy_dynasty: 'devy',
  merged_devy_c2c: 'c2c',
  dynasty_idp: 'idp',
  /** Feeder leagues created by tournament mode use this Prisma variant string */
  tournament_mode: 'tournament',
}

export function normalizeLeagueTypeKey(raw?: string | null): string {
  const key = String(raw ?? '').trim().toLowerCase()
  if (!key) return 'redraft'
  return LEAGUE_TYPE_ALIASES[key] ?? key
}

export function getLeagueTypeMedia(raw?: string | null): LeagueTypeMedia {
  const key = normalizeLeagueTypeKey(raw)
  const media = LEAGUE_TYPE_MEDIA_MAP[key] ?? LEAGUE_TYPE_MEDIA_MAP.redraft
  return { key, ...media }
}

/**
 * Stable league concept key for intro overlays and My Leagues card art.
 *
 * Priority matches {@link resolveLeagueIntroFormatKey}: Prisma `leagueType`, then settings.
 * `leagueVariant` is **not** used to override a canonical `leagueType` (it caused Redraft +
 * `guillotine` modifier to play Guillotine media). When type is absent, variant is consulted only
 * if it maps to a registered league-type media bundle (survivor, big_brother, …).
 */
export function resolveLeagueConceptIntroKey(input: {
  leagueType?: string | null
  leagueVariant?: string | null
  settings?: unknown
  isDynasty?: boolean | null
  guillotineMode?: boolean | null
  bestBallMode?: boolean | null
}): string {
  const settingsRecord =
    input.settings && typeof input.settings === 'object' && !Array.isArray(input.settings)
      ? (input.settings as Record<string, unknown>)
      : {}

  const fromColumnOrSettings = resolveLeagueIntroFormatKey({
    leagueTypeColumn: input.leagueType,
    settings: settingsRecord,
  })
  if (fromColumnOrSettings) {
    return normalizeLeagueTypeKey(fromColumnOrSettings)
  }

  const variantRaw = String(input.leagueVariant ?? '').trim()
  if (variantRaw) {
    const nk = normalizeLeagueTypeKey(variantRaw)
    if (LEAGUE_TYPE_MEDIA_MAP[nk]) return nk
  }

  if (input.guillotineMode === true) return 'guillotine'
  if (input.bestBallMode === true) return 'best_ball'

  if (settingsRecord.guillotineMode === true || settingsRecord.guillotine_mode === true) {
    return 'guillotine'
  }
  if (settingsRecord.bestBallMode === true || settingsRecord.best_ball_mode === true) {
    return 'best_ball'
  }
  if (input.isDynasty) return 'dynasty'
  return 'redraft'
}

/** Card/list avatar fallback — same canonical resolution as league concept intros. */
export function resolveLeagueCardTypeKey(league: {
  leagueType?: string | null
  leagueVariant?: string | null
  settings?: Record<string, unknown>
  isDynasty?: boolean | null
  guillotineMode?: boolean | null
  bestBallMode?: boolean | null
}): string {
  return resolveLeagueConceptIntroKey({
    leagueType: league.leagueType,
    leagueVariant: league.leagueVariant,
    settings: league.settings,
    isDynasty: league.isDynasty,
    guillotineMode: league.guillotineMode,
    bestBallMode: league.bestBallMode,
  })
}
