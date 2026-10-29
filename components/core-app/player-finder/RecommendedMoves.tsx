'use client'

import { AppLinkHint } from '@/components/core-app/player-finder/AppLinkHint'
import { useOptionalLanguage } from '@/components/i18n/LanguageProviderClient'
import { useMessages } from '@/components/i18n/useMessages'
import { playerFinderMessages } from '@/lib/core-app/messages/playerFinder'
import { coreUiCopy } from '@/lib/core-app/coreUiCopy'
import { formatDelta, type PlayerMove } from '@/lib/core-app/playerMoves'
import { moveText } from '@/lib/core-app/playerMovesCopy'

/**
 * "Recommended moves" — the handoff's tone-barred cards.
 *
 * Every card names platform › league › screen, carries the point delta, and
 * ends in "Open in <platform>". The composition (which moves exist, in what
 * order, with what number) is `composePlayerMoves` and is unit-tested; this
 * only draws it.
 *
 * Spanish (2026-10-04): each move's title, path and note are rebuilt from its `parts` by
 * `moveText` (lib/core-app/playerMovesCopy.ts); the lock reason goes through `coreUiCopy`'s lock
 * patterns. The provider starts at English on server and client alike, so the first paint agrees.
 */
export function RecommendedMoves({
  moves,
  emptyReason,
}: {
  moves: PlayerMove[]
  /** Why the list is empty, when it is — the loader's own words. */
  emptyReason: string | null
}) {
  const { language } = useOptionalLanguage()
  const msg = useMessages(playerFinderMessages)
  return (
    <section className="af-pf-block af-pf-moves" aria-labelledby="af-pf-moves-h">
      <header className="af-pf-block-head">
        <h3 className="af-pf-h3" id="af-pf-moves-h">
          {msg.movesTitle}
        </h3>
        <p className="af-pf-block-sub">
          {msg.movesSub}
        </p>
      </header>

      {moves.length === 0 ? (
        <p className="af-pf-unavailable">
          {emptyReason
            ? coreUiCopy(emptyReason, language)
            : msg.movesNothing}
        </p>
      ) : (
        <ul className="af-pf-move-list">
          {moves.map((m) => {
            const t = moveText(m, language)
            return (
              <li key={m.key} className="af-card af-pf-move" data-tone={m.tone}>
                <div className="af-pf-move-text">
                  <h4 className="af-pf-move-title">{t.title}</h4>
                  <p className="af-pf-move-path">
                    {t.path}
                    {t.note ? <span className="af-pf-move-note"> · {t.note}</span> : null}
                  </p>
                </div>
                {m.delta != null ? (
                  <span
                    className="af-pf-move-delta af-num"
                    data-tone={m.tone}
                    title={m.scoring === 'league' ? msg.movesLeagueScoring : msg.movesStandardScoring}
                  >
                    {formatDelta(m.delta)}
                  </span>
                ) : (
                  <span className="af-pf-move-delta af-pf-move-delta--none af-num">—</span>
                )}
                {m.locked ? (
                  /* The platform would refuse it right now; the reason sits in the path line. */
                  <span className="af-chip af-num af-pf-move-locked" title={coreUiCopy(m.locked, language)}>
                    {msg.locked}
                  </span>
                ) : m.link ? (
                  m.link.external ? (
                    <a
                      className="af-btn af-pf-move-btn"
                      href={m.link.href}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      {msg.openIn(m.link)}
                      <AppLinkHint platform={m.link.platformLabel} screen={m.link.screen} />
                    </a>
                  ) : (
                    <a className="af-btn af-pf-move-btn" href={m.link.href}>
                      {msg.openIn(m.link)}
                    </a>
                  )
                ) : null}
              </li>
            )
          })}
        </ul>
      )}

      <p className="af-pf-readonly-note">{msg.movesReadOnly}</p>
    </section>
  )
}

export default RecommendedMoves
