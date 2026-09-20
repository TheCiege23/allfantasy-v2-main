/**
 * "This screen's data did not load" — for a league-scoped /core screen whose
 * read FAILED, as distinct from one with no league in context.
 *
 * 🛑 IT EXISTS BECAUSE A FAILED READ USED TO RENDER THE LEAGUE PICKER. My Team,
 * Matchup and Trade Center each load their data only when a league is selected,
 * and each wrapped that load in `.catch(() => null)`. The render branch treats
 * null as "no league in context", so ANY transient failure — a slow query, a
 * provider hiccup — silently landed a manager who HAD selected a league on the
 * cross-league "pick a league" board, with no error, nothing logged, and no hint
 * that anything had gone wrong. Picking the same league again usually "fixed" it,
 * which is exactly the kind of bug that never gets reported.
 *
 * Measured 2026-09-20 while adding /core/matchup to the authenticated phone gate:
 * over three runs of the same commit against the same seeded league, the box
 * score rendered twice and the picker once. The gate's premise assertion is what
 * caught it; without that, two runs in three would have certified the screen.
 *
 * ⚠ IT IS A SERVER COMPONENT AND DELIBERATELY NOT `CoreScreenErrorBoundary`'s
 * FALLBACK. That one is a client class component whose "try again" resets React
 * state, which is the right shape for a render that THREW mid-stream. This is a
 * data read that failed before render, so the only meaningful retry is a fresh
 * request — a plain link does that, needs no client bundle, and cannot itself
 * fail to hydrate. Two surfaces, two genuinely different jobs.
 */
export function ScreenLoadError({ screen, retryHref }: { screen: string; retryHref: string }) {
  return (
    <div className="af-card" role="alert" style={{ padding: 24, maxWidth: 720 }}>
      <h1 className="af-display" style={{ margin: 0, fontSize: 22, letterSpacing: '-0.03em' }}>
        {screen} did not load
      </h1>
      <p style={{ marginTop: 8, fontSize: 13, lineHeight: 1.5, color: 'var(--muted)' }}>
        Something failed on our side while reading this league. Your league and its settings are
        untouched — nothing has changed.
      </p>
      {/*
        A plain link, not a button: this is a server component, and re-requesting
        the same URL is the whole retry. It also keeps the league in the URL, so
        the retry lands back on THIS screen rather than the picker — which is the
        behaviour this component exists to stop.
      */}
      <a className="af-btn" href={retryHref} style={{ marginTop: 14, display: 'inline-flex' }}>
        Try again
      </a>
    </div>
  )
}

export default ScreenLoadError
