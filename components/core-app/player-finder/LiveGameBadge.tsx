import { agoLabel, scoreLine, type LiveGameBadge as LiveGameBadgeData } from '@/lib/core-app/liveGameBadge'

/**
 * The live game badge (lib/core-app/liveGameBadge.ts): while his game is on, LIVE with the score; after
 * it, FINAL — and his points in each of your leagues exactly as that league's platform scored them,
 * with how fresh each number is. Free: facts.
 *
 * ⚠ A LEAGUE WITH NO SCORE ROW SAYS NOTHING, NEVER 0. The live tick refreshes Sleeper leagues only; a
 * zero would read as "he has done nothing" for a league we simply do not score.
 */

export function LiveGameBadge({ data, nowIso }: { data: LiveGameBadgeData | null; nowIso: string }) {
  if (!data) return null
  const { game, leagues } = data
  const now = new Date(nowIso)
  const line = scoreLine(game)
  const opponent = game.isHome ? game.away : game.home
  return (
    <section className="af-card af-pf-live" aria-labelledby="af-pf-live-h" data-state={game.state}>
      <h3 className="af-pf-live-head" id="af-pf-live-h">
        <span className="af-pf-live-tag">
          {game.state === 'live' ? <span className="af-pf-live-dot" aria-hidden="true" /> : null}
          {game.state === 'live' ? 'Live' : 'Final'}
        </span>
        <span className="af-pf-live-score af-num">{line ?? `${game.isHome ? 'vs' : '@'} ${opponent}`}</span>
        <span className="af-pf-live-week">Week {game.week}</span>
      </h3>
      {leagues.length > 0 ? (
        <ul className="af-pf-live-list">
          {leagues.map((l) => (
            <li key={l.leagueId} className="af-pf-live-row">
              <span className="af-pf-live-league">{l.leagueName}</span>
              <strong className="af-pf-live-pts af-num">{l.points.toFixed(1)}</strong>
              <span className="af-pf-live-meta">
                {l.isStarter ? 'starting' : 'on your bench'} · {l.finalized ? 'final' : `updated ${agoLabel(l.updatedAt, now)}`}
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="af-pf-live-none">No league score on file for him this week — points refresh live for Sleeper leagues.</p>
      )}
    </section>
  )
}
