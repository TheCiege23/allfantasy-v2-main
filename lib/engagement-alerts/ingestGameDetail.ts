import type { LiveGameDetail, GameDetailScoringPlay } from '@/lib/live/espnGameSummary'
import { trimEspnGameSummary } from '@/lib/live/espnGameSummary'
import { getEspnGameSummary, ESPN_SPORT_SITE_PATH } from '@/lib/sports-live-scores-service'
import { ESPN_SITE_API_BASE } from '@/lib/providers/espnUrls'

export function soccerScoringPlays(raw: unknown): GameDetailScoringPlay[] {
  const root = raw as { keyEvents?: Array<Record<string, any>> } | null
  return (Array.isArray(root?.keyEvents) ? root.keyEvents : []).filter(p =>
    p.scoringPlay === true || /^(goal|own goal|penalty.*scored)$/i.test(String(p.type?.text ?? ''))
  ).flatMap(p => {
    const id = p.id == null ? '' : String(p.id)
    const text = typeof p.text === 'string' ? p.text : typeof p.shortText === 'string' ? p.shortText : ''
    return id && text ? [{ id, text, period: p.period?.number ?? null, clock: p.clock?.displayValue ?? null,
      type: p.type?.text ?? null, teamAbbrev: p.team?.abbreviation ?? null, teamLogo: null,
      homeScore: typeof p.homeScore === 'number' ? p.homeScore : null, awayScore: typeof p.awayScore === 'number' ? p.awayScore : null }] : []
  })
}

/** Soccer summaries are consumed for alerts without changing the game-view UI's sport contract. */
export async function engagementGameDetail(sport: string, gameId: string): Promise<{ detail: LiveGameDetail | null; failed: boolean; stale: boolean }> {
  if (sport !== 'SOCCER') return getEspnGameSummary({ sport, gameId })
  if (!/^\d{5,12}$/.test(gameId)) return { detail: null, failed: true, stale: false }
  try {
    const response = await fetch(`${ESPN_SITE_API_BASE}/${ESPN_SPORT_SITE_PATH.SOCCER}/summary?event=${gameId}`, { cache: 'no-store', signal: AbortSignal.timeout(8000) })
    if (!response.ok) throw new Error(`Soccer summary HTTP ${response.status}`)
    const raw = await response.json()
    const detail = trimEspnGameSummary(raw, { sport, gameId, fetchedAt: new Date().toISOString() })
    if (!detail) return { detail: null, failed: true, stale: false }
    if (!detail.scoringPlays.length) detail.scoringPlays = soccerScoringPlays(raw)
    return { detail, failed: false, stale: false }
  } catch { return { detail: null, failed: true, stale: false } }
}
