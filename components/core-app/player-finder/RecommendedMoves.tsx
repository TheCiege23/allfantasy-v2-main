import { AppLinkHint } from '@/components/core-app/player-finder/AppLinkHint'
import { formatDelta, type PlayerMove } from '@/lib/core-app/playerMoves'

/**
 * "Recommended moves" — the handoff's tone-barred cards.
 *
 * Every card names platform › league › screen, carries the point delta, and
 * ends in "Open in <platform>". The composition (which moves exist, in what
 * order, with what number) is `composePlayerMoves` and is unit-tested; this
 * only draws it.
 */
export function RecommendedMoves({
  moves,
  emptyReason,
}: {
  moves: PlayerMove[]
  /** Why the list is empty, when it is — the loader's own words. */
  emptyReason: string | null
}) {
  return (
    <section className="af-pf-block af-pf-moves" aria-labelledby="af-pf-moves-h">
      <header className="af-pf-block-head">
        <h3 className="af-pf-h3" id="af-pf-moves-h">
          Recommended moves
        </h3>
        <p className="af-pf-block-sub">You make them on the platform — we tell you exactly where</p>
      </header>

      {moves.length === 0 ? (
        <p className="af-pf-unavailable">{emptyReason ?? 'Nothing to do — he is where he should be in every league you have him.'}</p>
      ) : (
        <ul className="af-pf-move-list">
          {moves.map((m) => (
            <li key={m.key} className="af-card af-pf-move" data-tone={m.tone}>
              <div className="af-pf-move-text">
                <h4 className="af-pf-move-title">{m.title}</h4>
                <p className="af-pf-move-path">
                  {m.path}
                  {m.note ? <span className="af-pf-move-note"> · {m.note}</span> : null}
                </p>
              </div>
              {m.delta != null ? (
                <span
                  className="af-pf-move-delta af-num"
                  data-tone={m.tone}
                  title={m.scoring === 'league' ? 'under this league’s own scoring' : 'standard scoring'}
                >
                  {formatDelta(m.delta)}
                </span>
              ) : (
                <span className="af-pf-move-delta af-pf-move-delta--none af-num">—</span>
              )}
              {m.locked ? (
                /* The platform would refuse it right now; the reason sits in the path line. */
                <span className="af-chip af-num af-pf-move-locked" title={m.locked}>
                  locked
                </span>
              ) : m.link ? (
                m.link.external ? (
                  <a
                    className="af-btn af-pf-move-btn"
                    href={m.link.href}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    {m.link.label}
                    <AppLinkHint platform={m.link.platformLabel} screen={m.link.screen} />
                  </a>
                ) : (
                  <a className="af-btn af-pf-move-btn" href={m.link.href}>
                    {m.link.label}
                  </a>
                )
              ) : null}
            </li>
          ))}
        </ul>
      )}

      <p className="af-pf-readonly-note">
        Lineup and IR moves are priced under each league&apos;s own scoring; claims are standard
        scoring. AllFantasy only reads your leagues — the change happens on the platform.
      </p>
    </section>
  )
}

export default RecommendedMoves
