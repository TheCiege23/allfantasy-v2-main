import './af-screen-skeleton.css'
import { skeletonKindForScreen } from '@/lib/core-app/screenSkeletonKind'

/**
 * The screen-area placeholder while a /core screen streams in behind a shell that has already
 * painted.
 *
 * `app/core/loading.tsx` draws the WHOLE shell as structure, because it shows
 * before the shell exists (a hard load). This is its content column alone — and also what
 * `CoreScreenArea` shows the instant a tab is clicked (coreNavPending.tsx): by the time it renders, the real
 * rail, nav and league tabs are on screen, and redrawing them as placeholders would flash the
 * chrome the user can already see.
 *
 * Same classes as the route skeleton (scoped under `.af-core` in af-core-shell.css), so the two
 * lay out identically and nothing jumps when either is replaced.
 *
 * `screen` (the arriving screen's segment, when the caller knows it) picks the shape: a stat strip
 * over table rows, a scoreboard over rows, a team card over a roster, or — unknown — the generic
 * card grid (lib/core-app/screenSkeletonKind.ts).
 */
export default function CoreScreenSkeleton({ screen }: { screen?: string | null } = {}) {
  const kind = skeletonKindForScreen(screen)
  return (
    <div aria-busy="true" data-skeleton={kind}>
      <p className="af-sk-sr">Loading…</p>
      <div className="af-sk-head" aria-hidden>
        <div className="af-sk-block af-sk-title" />
        <div className="af-sk-block af-sk-sub" />
      </div>
      {kind === 'cards' ? (
        <div className="af-sk-cards" aria-hidden>
          {Array.from({ length: 6 }, (_, i) => (
            <div className="af-sk-block af-sk-card" key={i} />
          ))}
        </div>
      ) : (
        <div className="af-sk-screen" aria-hidden>
          {kind === 'table' ? (
            <div className="af-sk-stats">
              {Array.from({ length: 4 }, (_, i) => (
                <div className="af-sk-block af-sk-stat" key={i} />
              ))}
            </div>
          ) : kind === 'scoreboard' ? (
            <div className="af-sk-block af-sk-board" />
          ) : (
            <div className="af-sk-block af-sk-teamcard" />
          )}
          <div className="af-sk-rows">
            {Array.from({ length: kind === 'scoreboard' ? 6 : 9 }, (_, i) => (
              <div className="af-sk-row" key={i}>
                <div className="af-sk-block af-sk-chip" />
                <div className="af-sk-block af-sk-name" />
                <div className="af-sk-block af-sk-num" />
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
