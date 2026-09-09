import '@/components/core-app/af-core.css'
import '@/components/core-app/af-core-shell.css'

/**
 * AF Core — the streaming boundary for every /core screen.
 *
 * 🛑 WITHOUT THIS FILE THE WHOLE ROUTE BLOCKS ON ITS SERVER RENDER. `page.tsx`
 * is `force-dynamic` and awaits ~57 sequential loader stages before it returns
 * a single byte, and the shell carries no Suspense of its own. Next.js has
 * nothing to show in the meantime, so the browser sits on the PREVIOUS screen
 * rendering nothing at all — measured at p90 7.0s on /core/trades and 6.2s on
 * /core/waivers (Railway, 24h). The click registered; the app just looked dead.
 *
 * ⚠ IT ALSO MAKES `<Link>` PREFETCH WORTH ANYTHING ON THIS ROUTE. App Router
 * prefetches a dynamic route only as far as its nearest loading boundary — with
 * no boundary there is nothing to prefetch, so every nav link was a cold start.
 *
 * ⚠ AND IT FIRES BETWEEN SIBLING SCREENS, NOT ONLY ON FIRST LOAD. /core/waivers
 * and /core/trades are the same `[[...screen]]` segment under different params;
 * the param is part of the segment key, so React re-suspends and this fallback
 * shows on that navigation too. That is the exact trip the report was about.
 *
 * This is a fallback, NOT a fix for the render cost. The two real causes are
 * the service running in `sfo` against a `us-east-1` database (~65ms per
 * roundtrip, ~57 of them serial) and the loader chain being sequential where it
 * could be parallel. Both are still open; this only stops the wait being
 * invisible.
 */

/*
 * ⚠ THE REAL SHELL'S OWN CLASSES, NOT A PARALLEL SKELETON LAYOUT. `.af-shell`
 * owns the 68px/232px/1fr grid AND both of its breakpoints (the nav drops at
 * 1080px, the whole thing goes single-column at 720px). A hand-rolled skeleton
 * grid would have to restate all three and would drift out of step with them
 * silently — and every pixel it got wrong would show up as content jumping the
 * moment the real page swapped in. Borrowing the classes means the fallback and
 * the page are laid out by one set of rules by construction.
 *
 * ⚠ `af-core` IS LOAD BEARING ON THE ROOT, not decoration: every token this
 * file's colours resolve through (`--bg`, `--line`, `--surface`, `--rail`) is
 * defined on `.af-core` in af-core.css, not on `:root`. Without it the skeleton
 * renders on a transparent ground with invisible borders. Both stylesheets are
 * imported above for the same reason — a hard load of /core paints this file
 * before anything in AfCoreShell has been asked for.
 */
export default function AfCoreLoading() {
  return (
    <div className="af-core af-shell af-sk-shell" aria-busy="true">
      {/*
        The rail, nav and topbar are chrome: identical on every /core screen and
        already correct before any loader has returned. They are drawn as solid
        structure rather than shimmer so the fallback reads as the app arriving
        rather than as a placeholder page.
      */}
      <div className="af-rail" aria-hidden>
        <div className="af-sk-block af-sk-rail-logo" />
        <div className="af-rail-divider" />
        <div className="af-rail-scroll">
          {Array.from({ length: 7 }, (_, i) => (
            <div className="af-sk-block af-sk-rail-tile" key={i} />
          ))}
        </div>
        <div className="af-rail-foot">
          <div className="af-sk-block af-sk-rail-tile" />
        </div>
      </div>

      <div className="af-nav" aria-hidden>
        <div className="af-nav-scroll">
          {[5, 4].map((count, group) => (
            <div className="af-nav-group" key={group}>
              <div className="af-sk-block af-sk-nav-heading" />
              <div className="af-nav-items">
                {Array.from({ length: count }, (_, i) => (
                  <div className="af-sk-block af-sk-nav-item" key={i} />
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="af-main">
        <header className="af-topbar" aria-hidden>
          <div className="af-sk-block af-sk-search" />
          <div className="af-sk-block af-sk-avatar" />
        </header>

        <main className="af-content">
          {/*
            One live region, not a spinner per card. A screen reader should hear
            "Loading" once and then the screen itself; announcing every skeleton
            block would bury the page that is about to arrive.
          */}
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
        </main>
      </div>
    </div>
  )
}
