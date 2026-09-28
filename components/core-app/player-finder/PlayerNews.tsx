import type { SectionState } from '@/lib/core-app/leagueHome'
import { LOCK_ZONE } from '@/lib/core-app/lineupLock'
import type { PlayerCardNews } from '@/lib/core-app/playerCard'

/**
 * "News" — the latest items about him, newest first, each with WHEN and WHERE it came from.
 *
 * Built from the same merge as the quick player card (playerCard.ts): linked headlines from the
 * news feed plus the injury feed's per-player sentences, which carry real attribution (the news
 * feed's player tags are headline n-grams). The designation note already on the card is not
 * repeated as the top item.
 *
 * ⚠ ON GAME DAY THE TIMESTAMP IS THE STORY. "Out" posted at 11:32 and "Questionable" from
 * Friday are different facts; every item says how old it is.
 */

const SOURCE_LABELS: Record<string, string> = {
  espn: 'ESPN',
  rolling_insights: 'Rolling Insights',
  api_sports: 'API-Sports',
  sleeper: 'Sleeper',
  sleeper_live: 'Sleeper',
  thesportsdb: 'TheSportsDB',
}

/** "ESPN", "Rolling Insights" — a feed key is not something a reader should have to decode. */
export function newsSource(source: string | null | undefined): string | null {
  const key = String(source ?? '').trim().toLowerCase()
  if (!key) return null
  if (SOURCE_LABELS[key]) return SOURCE_LABELS[key]
  if (key.startsWith('newsapi')) return 'News'
  return key.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
}

export function newsWhen(iso: string | null, nowIso: string): string | null {
  if (!iso) return null
  const at = new Date(iso)
  const now = new Date(nowIso)
  if (Number.isNaN(at.getTime())) return null
  const mins = Math.floor((now.getTime() - at.getTime()) / 60_000)
  if (mins >= 0 && mins < 60) return mins < 1 ? 'just now' : `${mins} min ago`
  if (mins >= 0 && mins < 24 * 60) return `${Math.floor(mins / 60)}h ago`
  try {
    return new Intl.DateTimeFormat('en-US', { timeZone: LOCK_ZONE, weekday: 'short', month: 'numeric', day: 'numeric' }).format(at)
  } catch {
    return at.toISOString().slice(0, 10)
  }
}

export function PlayerNews({ state, nowIso }: { state: SectionState<PlayerCardNews[]>; nowIso: string }) {
  return (
    <section className="af-pf-block af-pf-news" aria-labelledby="af-pf-news-h">
      <h3 className="af-label" id="af-pf-news-h">
        News
      </h3>
      {state.available ? (
        <ul className="af-pf-news-list">
          {state.data.map((item, i) => {
            const when = newsWhen(item.publishedAt, nowIso)
            return (
              <li key={`${item.title}-${i}`} className="af-pf-news-item">
                {item.url ? (
                  <a href={item.url} target="_blank" rel="noopener noreferrer" className="af-pf-news-title">
                    {item.title}
                  </a>
                ) : (
                  <span className="af-pf-news-title">{item.title}</span>
                )}
                <span className="af-pf-news-meta af-num">
                  {[newsSource(item.source), when].filter(Boolean).join(' · ')}
                </span>
              </li>
            )
          })}
        </ul>
      ) : (
        <p className="af-pf-unavailable">{state.reason}</p>
      )}
    </section>
  )
}

export default PlayerNews
