import { BLOG_CATEGORY_LABELS, type BlogCategory } from './types'

/** Sport codes as a reader says them; anything else is shown as stored. */
const SPORT_LABELS: Record<string, string> = {
  SOCCER: 'Soccer',
  NCAAF: 'College Football',
  NCAAB: 'College Basketball',
}

/** "NFL · Draft Prep" for a share card; just the part that is known when the other is not. */
export function blogShareCardLabel(sport: string | null | undefined, category: string | null | undefined): string {
  const s = (sport ?? '').trim()
  const sportLabel = SPORT_LABELS[s.toUpperCase()] ?? s
  const categoryLabel = BLOG_CATEGORY_LABELS[(category ?? '') as BlogCategory] ?? ''
  return [sportLabel, categoryLabel].filter(Boolean).join(' · ')
}
