import { extractSeasonAggregate } from './core'

export const NBA_VERIFIED_BOX_SOURCE = 'af_verified_nba_boxes'

type SeasonLine = { playerId: string; source?: string; stats: unknown }
type Sample = { games: number; seconds: number }

function sample(stats: unknown): Sample | null {
  const line = extractSeasonAggregate(stats)
  const seconds = line?.components.minutes
  return line && seconds != null && seconds > 0 ? { games: line.gamesPlayed, seconds } : null
}

function record(value: unknown): Record<string, unknown> {
  return value != null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

export function readVerifiedNbaInactiveSince(value: unknown): string | undefined {
  const raw = record(value).verifiedNbaInactiveSince
  if (typeof raw !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(raw)) return
  const date = new Date(raw)
  return Number.isFinite(date.valueOf()) && date.toISOString().slice(0, 10) === raw ? raw : undefined
}

export function readVerifiedNbaTeam(value: unknown): string | undefined {
  const team = record(value).verifiedNbaTeam
  if (typeof team === 'string' && /^[A-Z]{3}$/.test(team)) return team
}

/**
 * A reviewed NBA season line replaces the provider totals it corroborated.
 * For individually reviewed lines, switch back only if the provider adds real playing time.
 * The hourly cohort's continuously verified final-box lines own their current season sample.
 */
export function pickNbaVerifiedSeasonLines<T extends SeasonLine>(lines: T[]): T[] {
  const reviewed = new Map<string, { line: T; basis: Sample; providerSeconds: number; managed: boolean }>()
  for (const line of lines) {
    if (line.source !== NBA_VERIFIED_BOX_SOURCE) continue
    const basis = sample(line.stats)
    const provider = record(record(line.stats).providerAtVerification).seconds
    if (!basis || typeof provider !== 'number' || !Number.isFinite(provider) || provider < 0) continue
    reviewed.set(line.playerId, { line, basis, providerSeconds: provider, managed: record(line.stats).nbaRecheckVerified === true })
  }

  if (!reviewed.size) return lines.filter(line => line.source !== NBA_VERIFIED_BOX_SOURCE)
  const selected = new Map([...reviewed].map(([id, row]) => [id, row.line]))
  const untouched: T[] = []
  for (const line of lines) {
    if (line.source === NBA_VERIFIED_BOX_SOURCE) continue
    const review = reviewed.get(line.playerId)
    if (!review) {
      untouched.push(line)
      continue
    }
    if (review.managed) continue
    const next = sample(line.stats)
    if (!next || next.games < review.basis.games || next.seconds <= Math.max(review.basis.seconds, review.providerSeconds)) continue
    const current = sample(selected.get(line.playerId)?.stats)
    if (!current || next.seconds > current.seconds) selected.set(line.playerId, line)
  }
  return [...untouched, ...selected.values()]
}
