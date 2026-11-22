/**
 * Optional welcome clips after creating a league. Set `NEXT_PUBLIC_LEAGUE_CONCEPT_VIDEO_BASE`
 * to a CDN base URL; files are expected at `{base}/{concept}.mp4` (lowercase key).
 * Falls back to local league-type intros under `/public/league-type-*-intro.mp4`.
 */
const LOCAL_LEAGUE_TYPE_INTRO: Record<string, string> = {
  redraft: '/media/create-league/concept/videos/Redraft.mp4',
  dynasty: '/league-type-dynasty-intro.mp4',
  keeper: '/league-type-keeper-intro.mp4',
  best_ball: '/league-type-best-ball-intro.mp4',
  guillotine: '/league-type-guillotine-intro.mp4',
  survivor: '/league-type-survivor-intro.mp4',
  devy: '/league-type-devy-intro.mp4',
  c2c: '/league-type-c2c-intro.mp4',
  zombie: '/league-type-zombie-intro.mp4',
  salary_cap: '/league-type-salary-cap-intro.mp4',
  big_brother: '/league-type-big-brother-intro.mp4',
  idp: '/league-type-idp-intro.mp4',
}

export function getConceptIntroVideoUrl(conceptOrSport: string): string | undefined {
  const base = process.env.NEXT_PUBLIC_LEAGUE_CONCEPT_VIDEO_BASE?.replace(/\/$/, '')
  const key = String(conceptOrSport).trim().toLowerCase()
  if (!key) return undefined
  if (base) {
    return `${base}/${key}.mp4`
  }
  return LOCAL_LEAGUE_TYPE_INTRO[key]
}
