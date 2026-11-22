import { formatDistanceStrict } from 'date-fns'
import { getServerNowUTC } from '@/lib/time-engine/serverClock'
import { normalizeToUTC } from '@/lib/time-engine/normalize'

/**
 * Human freshness label relative to server time (authoritative).
 */
function formatFreshnessLabel(
  lastUpdated: Date | string | number | null | undefined,
  serverNow?: Date
): string {
  const now = serverNow ?? getServerNowUTC()
  if (lastUpdated == null) return 'Updated: unknown'
  const d = lastUpdated instanceof Date ? lastUpdated : normalizeToUTC(lastUpdated)
  if (Number.isNaN(d.getTime())) return 'Updated: unknown'
  return `Updated ${formatDistanceStrict(d, now, { addSuffix: true })}`
}

export function getTimeFreshnessSummary(parts: {
  injuriesLastUpdatedAt?: Date | string | null
  scoresLastUpdatedAt?: Date | string | null
  projectionsLastUpdatedAt?: Date | string | null
  newsLastUpdatedAt?: Date | string | null
  liveScoresLastUpdatedAt?: Date | string | null
}): string {
  const lines: string[] = []
  if (parts.injuriesLastUpdatedAt) lines.push(formatFreshnessLabel(parts.injuriesLastUpdatedAt))
  if (parts.scoresLastUpdatedAt) lines.push(`Scores ${formatFreshnessLabel(parts.scoresLastUpdatedAt)}`)
  if (parts.projectionsLastUpdatedAt) lines.push(`Projections ${formatFreshnessLabel(parts.projectionsLastUpdatedAt)}`)
  if (parts.newsLastUpdatedAt) lines.push(`News ${formatFreshnessLabel(parts.newsLastUpdatedAt)}`)
  if (parts.liveScoresLastUpdatedAt) lines.push(`Live scores ${formatFreshnessLabel(parts.liveScoresLastUpdatedAt)}`)
  return lines.length ? lines.join(' · ') : 'Freshness: use individual feeds where available.'
}
