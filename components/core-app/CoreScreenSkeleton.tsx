/**
 * The screen-area placeholder while a /core screen streams in behind a shell that has already
 * painted.
 *
 * `app/core/[[...screen]]/loading.tsx` draws the WHOLE shell as structure, because it shows
 * before the shell exists. This is its content column alone: by the time it renders, the real
 * rail, nav and league tabs are on screen, and redrawing them as placeholders would flash the
 * chrome the user can already see.
 *
 * Same classes as the route skeleton (scoped under `.af-core` in af-core-shell.css), so the two
 * lay out identically and nothing jumps when either is replaced.
 */
export default function CoreScreenSkeleton() {
  return (
    <div aria-busy="true">
      <p className="af-sk-sr">Loading…</p>
      <div className="af-sk-head" aria-hidden>
        <div className="af-sk-block af-sk-title" />
        <div className="af-sk-block af-sk-sub" />
      </div>
      <div className="af-sk-cards" aria-hidden>
        {Array.from({ length: 6 }, (_, i) => (
          <div className="af-sk-block af-sk-card" key={i} />
        ))}
      </div>
    </div>
  )
}
